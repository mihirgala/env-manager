/**
 * User-facing error copy. Raw errors (errno strings, crypto failures) leak
 * internals and confuse — every toast / alert in the GUI should go through
 * `friendlyError` so users get what happened plus what to do next. Technical
 * detail is preserved in `console` for debugging.
 */

const RULES: { match: RegExp; message: string }[] = [
  { match: /locked|unlock/i, message: 'Locked — unlock with your passphrase first (Settings → Encryption shows the state).' },
  { match: /needs the desktop app/i, message: 'This needs the desktop app — run `pnpm tauri dev` instead of the browser preview.' },
  { match: /not readable|no such file|not found in the vault|project not found/i, message: 'Couldn’t find that file or project — was it moved, renamed, or deleted outside the app?' },
  { match: /recovery|passphrase|decrypt/i, message: 'Wrong passphrase or recovery code — try again, or reset encryption (existing encrypted backups stay unreadable).' },
  { match: /backup/i, message: 'Couldn’t write a safety backup — check the folder still exists and is writable.' },
  { match: /folder picker/i, message: 'The folder picker didn’t return a folder — try again or paste the path.' },
]

/** Human-readable one-liner for any thrown value. Never throws itself. */
export function friendlyError(err: unknown, fallback = 'Something went wrong — try again.'): string {
  try {
    const raw = err instanceof Error ? (err.message ?? '') : String(err ?? '')
    if (raw.trim() === '') return fallback
    for (const { match, message } of RULES) {
      if (match.test(raw)) return message
    }
    // Unknown: keep it short and safe (no paths / tokens).
    const firstLine = raw.split('\n')[0] ?? ''
    return firstLine.length <= 140 ? firstLine : fallback
  } catch {
    return fallback
  }
}
