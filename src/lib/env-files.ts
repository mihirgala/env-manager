/**
 * Env-file policy — one source of truth for tabs, scan, status, export and
 * bundles. Rust's `list_env_files` returns raw names; all filtering happens
 * here so the rules cannot drift.
 *
 * Trackable: `.env` and `.env.<segment(s)>` (e.g. `.env.local`,
 * `.env.development.local`). Templates, backups and `.envrc` are not.
 */

const TEMPLATE_SEGMENTS = new Set(['example', 'sample', 'template', 'dist'])
const SEGMENT_RE = /^[a-z0-9_-]+$/

export function isTrackableEnvFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower === '.env') return true
  if (!lower.startsWith('.env.')) return false

  const segments = lower.slice('.env.'.length).split('.')
  if (segments.length === 0) return false
  for (const segment of segments) {
    // Rejects path separators, spaces, empty segments and odd extensions.
    if (!SEGMENT_RE.test(segment)) return false
    if (TEMPLATE_SEGMENTS.has(segment)) return false
    if (segment === 'backup' || segment.startsWith('backup-')) return false
  }
  return true
}

/** Keep the original case/spelling; only filter. */
export function trackableEnvFiles(names: string[]): string[] {
  return names.filter(isTrackableEnvFile)
}
