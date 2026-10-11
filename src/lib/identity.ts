/**
 * Project identity — pure TS, no Tauri imports.
 *
 * The same repo must auto-match on any laptop, so identity is the normalized
 * `git remote origin` URL (`git@github.com:Foo/bar.git` and
 * `https://github.com/foo/bar` → `github.com/foo/bar`).
 * Non-git folders fall back to a manual UUID link stored in
 * `~/.env-manager/links.json` (P1) — never inside the target repo.
 */

export type ProjectIdentity =
  | { kind: 'git'; identity: string; remoteUrl: string }
  | { kind: 'manual'; id: string }

/**
 * Normalize a git remote URL to `host/owner/repo` (all lowercase,
 * no trailing `.git` or `/`).
 *
 * Handles scp-like (`git@github.com:Foo/bar.git`), `ssh://`,
 * `https://` (with optional credentials/port), and `git://` forms.
 */
export function normalizeGitRemote(url: string): string {
  const trimmed = url.trim()
  if (trimmed === '') throw new Error('normalizeGitRemote: empty URL')

  let rest = trimmed
  // Strip scheme: `https://`, `ssh://`, `git://`, ...
  rest = rest.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  // Strip user info: `git@`, `user:pass@`
  rest = rest.replace(/^[^@/]+@/, '')
  // scp-like `host:owner/repo` → `host/owner/repo` (only the first colon;
  // a port like `host:22/owner` is kept and dropped below with the owner split).
  const scp = rest.match(/^([^/:]+):([^/].*)$/)
  if (scp !== null) rest = `${scp[1]}/${scp[2]}`
  // Strip trailing slashes then a single trailing `.git`.
  rest = rest.replace(/\/+$/, '').replace(/\.git$/, '')

  const parts = rest.split('/')
  if (parts.length < 3) throw new Error(`normalizeGitRemote: cannot parse "${url}"`)
  const host = parts[0]?.toLowerCase() ?? ''
  // Drop a numeric port segment (`github.com:22/foo/bar`).
  const pathParts = parts.slice(1).filter((p) => p !== '')
  const pathNoPort =
    pathParts.length > 2 && /^\d+$/.test(pathParts[0] ?? '') ? pathParts.slice(1) : pathParts
  if (host === '' || pathNoPort.length < 2) {
    throw new Error(`normalizeGitRemote: cannot parse "${url}"`)
  }
  const repo = pathNoPort[pathNoPort.length - 1]?.toLowerCase() ?? ''
  const owner = pathNoPort[pathNoPort.length - 2]?.toLowerCase() ?? ''
  return `${host}/${owner}/${repo}`
}

export function detectIdentity(input: { folderPath: string; gitRemoteUrl?: string }): ProjectIdentity {
  const folderPath = input.folderPath.trim()
  if (folderPath === '') throw new Error('detectIdentity: folderPath is required')
  const remote = input.gitRemoteUrl?.trim() ?? ''
  if (remote !== '') {
    return { kind: 'git', identity: normalizeGitRemote(remote), remoteUrl: remote }
  }
  return { kind: 'manual', id: crypto.randomUUID() }
}
