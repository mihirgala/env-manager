/**
 * Encrypted sync — P2. Typed stubs only.
 *
 * Push/Pull show a diff preview and never silently overwrite: on conflict
 * the app writes `.env.backup-<ts>` and prompts. Status `behind | ahead`
 * arrives with cloud; P1 only uses `clean | diverged | local-only`.
 */

export type SyncStatus = 'clean' | 'behind' | 'ahead' | 'diverged' | 'local-only'

export interface DiffPreview {
  projectId: string
  added: string[]
  removed: string[]
  changed: string[]
}

function notImplemented(name: string): never {
  throw new Error(`sync: ${name} not implemented until P2`)
}

export async function pushProject(_projectId: string): Promise<void> {
  return notImplemented('pushProject')
}

export async function pullProject(_projectId: string): Promise<DiffPreview> {
  return notImplemented('pullProject')
}

export async function previewDiff(_projectId: string): Promise<DiffPreview> {
  return notImplemented('previewDiff')
}

export async function projectStatus(_projectId: string): Promise<SyncStatus> {
  return notImplemented('projectStatus')
}
