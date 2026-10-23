# Step 1 — strip the hosted backend, switch to pnpm only

Goal: the app has no server, no auth, no accounts, no keychain, no npm. Nothing here
needs new features — it is deletion + tooling.

## 1.1 pnpm only

```powershell
pnpm remove @supabase/supabase-js @tauri-apps/plugin-fs
git rm package-lock.json   # or: Remove-Item package-lock.json
```

- `package.json`: add `"packageManager": "pnpm@12.11.2"`.
- `.gitignore`: add `package-lock.json` (prevents `npm install` re-creating it) and
  `*.envmgr` (vault bundle exports must never be committed).
- Keep `pnpm-workspace.yaml` (it holds pnpm settings: `allowBuilds`,
  `minimumReleaseAgeExclude`).
- Regenerate the lockfile: `pnpm install`.

## 1.2 Delete files

| Path | Why |
|---|---|
| `.env.example` | no build-time cloud env vars anymore |
| `supabase/` (`config.toml`, `README.md`, `migrations/`) | hosted backend gone |
| `src/lib/cloud.ts` | Supabase client + `MemoryCloudClient` |
| `src/components/github-sign-in.tsx` | OAuth sign-in gone |

Also remove `!.env.example` from `.gitignore`.

## 1.3 Config module

Rename `src/lib/cloud-config.ts` → `src/lib/config.ts` and keep only:

```ts
interface AppConfig {
  deviceName?: string        // bundle metadata only
  theme?: 'system' | 'light' | 'dark'
  cryptoSalt?: string        // Argon2id salt
  recoveryBlob?: RecoveryBlob
  seenOnboarding?: boolean
}
```

Delete: `cloudUrl`, `cloudKey`, `devices`, `lastSynced`, `CloudEndpoint`,
`hostedCloudEndpoint`, `effectiveCloudEndpoint`, `cloudSource`, `clearCustomCloud`,
`isCloudConfigured`, `makeCloudClient`, `lastSyncedKey`, `KnownDevice`.
Keep `loadConfig`, `saveConfig`, `ensureDeviceName` (used for bundle labels only).

## 1.4 Rust cleanup (`src-tauri/`)

Remove:

- `keyring` dependency in `Cargo.toml` + `keychain_set/get/delete` + `keychain_stub` commands.
- OAuth window block: `OAUTH_CALLBACK_HOST`, `OauthState`, `open_oauth_window`,
  `take_oauth_code`, `close_oauth_window`, `is_oauth_window_open`, the
  `.manage(OauthState(...))` line, and the duplicated `let handle = app.clone();`.
- `open_in_browser`, `watch_stub` (dead code).
- `tauri-plugin-fs` (Cargo dep, `.plugin(tauri_plugin_fs::init())`, and the `fs:*`
  permissions in `capabilities/default.json` — nothing imports the JS package).

Update the header comment: no Supabase references.

## 1.5 TS adapter cleanup (`src/lib/tauri.ts`)

Delete `openOAuthWindow`, `takeOAuthCode`, `closeOAuthWindow`, `isOAuthWindowOpen`,
`openInBrowser`, `keychainSet`, `keychainGet`, `keychainDelete`.
Keep `isTauri`, pickers, fs helpers, git remote, device name, projects, `linksRead/Write`,
`configRead/Write`.

## 1.6 Call sites

| File | Change |
|---|---|
| `src/screens/settings.tsx` | delete cloud card, custom backend fields, test connection, sign-in/out, Devices card, `makeCloudClient` imports |
| `src/screens/project-detail.tsx` | remove cloud imports (`isCloudConfigured`, `makeCloudClient`, `lastSyncedKey`) — real rewiring in step 7 |
| `src/screens/projects.tsx` | remove cloud status branch (step 7 does the final status model) |
| `src/screens/add-project.tsx` | remove cloud auto-pull block (step 5 rebuilds this screen) |
| `src/lib/sync.ts` | temporarily retarget `CloudClient` → local store in step 3; delete `CloudNotConfiguredError` here |
| `src/lib/errors.ts` | audit for sign-in/cloud-specific messages; keep only desktop/`pnpm` hints |
| `src/App.tsx`, `src/main.tsx` | no change needed |
| `index.html` | fix `<title>tmp-vite</title>` → `env-manager` |

## 1.7 Command references → pnpm

Search and replace `npm run` / `npm install` / `npx vitest`:

`AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
`.github/PULL_REQUEST_TEMPLATE.md`, `.opencode/skills/responsive-design/SKILL.md`,
`.opencode/skills/repo-rules/SKILL.md`, `src-tauri/tauri.conf.json`
(`beforeDevCommand: "pnpm dev"`, `beforeBuildCommand: "pnpm build"`), plus in-app copy:
`src/lib/tauri.ts`, `src/lib/errors.ts`, `src/lib/vault.ts`,
`src/screens/project-detail.tsx`, `src/screens/settings.tsx`, `src/screens/projects.tsx`.

## Verification

```powershell
pnpm install
pnpm test
pnpm build
Select-String -Path (Get-ChildItem -Recurse -Include *.ts,*.tsx,*.rs,*.md,*.json -File | Where-Object FullName -notmatch 'node_modules|target|lock|docs\\plan') -Pattern 'supabase|keychain|oauth|VITE_|\.env\.example' -CaseSensitive:$false
```

Pass: command builds, no matches outside `docs/plan`, `.env.example` and `supabase/`
gone, only `pnpm-lock.yaml` present.
