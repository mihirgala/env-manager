/**
 * Supabase cloud client — ciphertext only, owner RLS enforced server-side.
 * Constructed only when Settings holds a URL + anon key; otherwise sync
 * throws `CloudNotConfiguredError` and the app stays local-only.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CloudClient, CloudProject, CloudSnapshot } from './sync'
import type { CryptoEnvelope } from './crypto'

interface ProjectRow {
  id: string
  identity: string
  display_name: string | null
}

interface SnapshotRow {
  envelope: CryptoEnvelope
  plaintext_sha256: string
  device_name: string | null
  created_at: string
}

/**
 * OAuth redirect back to the desktop app. The host never resolves — the
 * Tauri sign-in window intercepts it (see `open_oauth_window` in main.rs)
 * before anything loads. Must be allowlisted in Supabase under
 * Auth → URL Configuration → Redirect URLs.
 */
export const OAUTH_CALLBACK_URL = 'https://env-manager.local/auth/callback'

export class SupabaseCloudClient implements CloudClient {
  private readonly client: SupabaseClient

  constructor(supabaseUrl: string, anonKey: string, accessToken?: string) {
    this.client = createClient(supabaseUrl, anonKey, {
      // PKCE must be set here: auth-js reads flowType from client settings
      // only (per-call options are ignored), and the default is implicit.
      auth: { flowType: 'pkce' },
      global: accessToken !== undefined ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
    })
  }

  /** Email OTP sign-in (passwordless). Returns when the OTP is sent. */
  async signInWithEmail(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ email })
    if (error !== null) throw new Error(`supabase sign-in: ${error.message}`)
  }

  async verifyOtp(email: string, token: string): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({ email, token, type: 'email' })
    if (error !== null) throw new Error(`supabase verify: ${error.message}`)
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut()
  }

  /** GitHub OAuth sign-in URL for the desktop sign-in window (PKCE). */
  async oAuthUrl(): Promise<string> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: 'github',
      // NOTE: do NOT set skipBrowserRedirect here. It is a server directive:
      // with it, /authorize returns the provider URL as JSON instead of
      // redirecting — which renders as a blank page in the sign-in window.
      // The app already avoids navigating the main window by loading this
      // URL in the dedicated popup window instead.
      options: { redirectTo: OAUTH_CALLBACK_URL },
    })
    if (error !== null) throw new Error(`supabase oauth: ${error.message}`)
    if (data.url === '') throw new Error('supabase oauth: no sign-in URL returned')
    return data.url
  }

  /** Exchange the intercepted callback `code` for a session (PKCE). */
  async exchangeCodeForSession(code: string): Promise<void> {
    const { error } = await this.client.auth.exchangeCodeForSession(code)
    if (error !== null) throw new Error(`supabase oauth: ${error.message}`)
  }

  async sessionEmail(): Promise<string | null> {
    const { data } = await this.client.auth.getSession()
    return data.session?.user.email ?? null
  }

  /** True when a session exists — independent of email visibility. */
  async isSignedIn(): Promise<boolean> {
    const { data } = await this.client.auth.getSession()
    return data.session !== null
  }

  async listProjects(): Promise<CloudProject[]> {
    const { data, error } = await this.client.from('projects').select('id, identity, display_name')
    if (error !== null) throw new Error(`supabase: ${error.message}`)
    return (data as ProjectRow[]).map((r) => ({ id: r.id, identity: r.identity, displayName: r.display_name }))
  }

  async upsertProject(identity: string, displayName: string): Promise<CloudProject> {
    const user = (await this.client.auth.getUser()).data.user
    if (user === null) throw new Error('supabase: sign in first')
    const { data, error } = await this.client
      .from('projects')
      .upsert(
        { owner_id: user.id, identity, display_name: displayName },
        { onConflict: 'owner_id,identity' },
      )
      .select('id, identity, display_name')
      .single()
    if (error !== null) throw new Error(`supabase: ${error.message}`)
    const row = data as ProjectRow
    return { id: row.id, identity: row.identity, displayName: row.display_name }
  }

  async latestSnapshot(projectId: string): Promise<CloudSnapshot | null> {
    const { data, error } = await this.client
      .from('env_snapshots')
      .select('envelope, plaintext_sha256, device_name, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error !== null) throw new Error(`supabase: ${error.message}`)
    if (data === null) return null
    const row = data as SnapshotRow
    return {
      envelope: row.envelope,
      plaintextSha256: row.plaintext_sha256,
      deviceName: row.device_name,
      createdAt: row.created_at,
    }
  }

  async pushSnapshot(
    projectId: string,
    snap: { envelope: CryptoEnvelope; plaintextSha256: string; deviceName: string },
  ): Promise<void> {
    const user = (await this.client.auth.getUser()).data.user
    if (user === null) throw new Error('supabase: sign in first')
    const { error } = await this.client.from('env_snapshots').insert({
      project_id: projectId,
      owner_id: user.id,
      envelope: snap.envelope,
      plaintext_sha256: snap.plaintextSha256,
      device_name: snap.deviceName,
    })
    if (error !== null) throw new Error(`supabase: ${error.message}`)
  }
}

/** In-memory cloud for tests — mimics server behavior, sees envelopes only. */
export class MemoryCloudClient implements CloudClient {
  private projects: CloudProject[] = []
  private snapshots = new Map<string, CloudSnapshot[]>()
  private n = 0

  async listProjects(): Promise<CloudProject[]> {
    return [...this.projects]
  }

  async upsertProject(identity: string, displayName: string): Promise<CloudProject> {
    const existing = this.projects.find((p) => p.identity === identity)
    if (existing !== undefined) return existing
    const row: CloudProject = { id: `cloud-${++this.n}`, identity, displayName }
    this.projects.push(row)
    return row
  }

  async latestSnapshot(projectId: string): Promise<CloudSnapshot | null> {
    const all = this.snapshots.get(projectId) ?? []
    return all.length > 0 ? (all[all.length - 1] as CloudSnapshot) : null
  }

  async pushSnapshot(
    projectId: string,
    snap: { envelope: CryptoEnvelope; plaintextSha256: string; deviceName: string },
  ): Promise<void> {
    const all = this.snapshots.get(projectId) ?? []
    all.push({ ...snap, deviceName: snap.deviceName, createdAt: new Date(0).toISOString() })
    this.snapshots.set(projectId, all)
  }

  /** Test helper: what the "server" stored (ciphertext only). */
  storedSnapshots(projectId: string): CloudSnapshot[] {
    return [...(this.snapshots.get(projectId) ?? [])]
  }
}
