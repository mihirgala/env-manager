/**
 * Path helpers shared by screens — pure TS so they work in `pnpm dev` and tests.
 * Separators follow the folder shape (Windows backslashes vs POSIX slashes)
 * and trailing separators are dropped before joining.
 */

export function joinPath(folder: string, file: string): string {
  const sep = folder.includes('/') ? '/' : '\\'
  return `${folder.replace(/[\\/]+$/, '')}${sep}${file}`
}

/** Comparison key for a folder path (slashes normalized, trailing sep dropped). */
export function folderKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}
