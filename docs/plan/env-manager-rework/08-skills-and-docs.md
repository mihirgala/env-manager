# Step 8 — skills and docs

Goal: written instructions match the SQLite-only app, pnpm, dark mode, scanning, and
distribution. No doc should mention Supabase, RLS, accounts, keychain, or npm.

## 8.1 `AGENTS.md`

- Stack: **pnpm**, Vite React + TS, Tauri v2 thin Rust, **SQLite `~/.env-manager/vault.db`
  (ciphertext only)**, libsodium in TS. Delete the "Cloud (optional)" line.
- Commands:
  ```powershell
  pnpm install
  pnpm dev          # Vite only, no Rust
  pnpm tauri dev    # desktop app
  pnpm test
  pnpm build        # must pass before a PR
  pnpm tauri build  # installers (host OS only)
  ```
- Structure block: drop `supabase/`, add `docs/DISTRIBUTION.md`, mention
  `src/lib/{crypto,store,sync,bundle,scan,env-files,theme,paths,config}.ts`.
- Rules rewrite:
  1. No lock-in (unchanged).
  2. Never commit secrets — **fixtures only**, no `.env.example` habit; `*.envmgr` also
     never committed.
  3. Lossless dotenv (unchanged).
  4. Thin Rust: FS, git remote, opaque SQLite snapshot rows, dialogs, scan walk.
  5. Zero-knowledge: passphrase/master key/DEK/plaintext never leave device, never logged,
     never stored; `vault.db` holds envelopes + local sha only.
  6. Remove per-project opt-out; unlink/export leaves `.env` intact.
  7. Identity: normalized remote, monorepo `identity::subpath`, manual link fallback.
  8. GUI-only.
  9. Responsive + **dark mode parity**.
  10. Repo guardrails + pnpm.
- Add **Packaging** section: version `0.1.0`, unsigned now, macOS universal, CI workflow,
  no signing secrets in the repo.

## 8.2 `.opencode/skills/repo-rules/SKILL.md`

- "When to use me": scan/vault/bundle/crypto/UI theme changes (drop Supabase/RLS).
- No lock-in: add "scan is read-only; never read env contents while scanning".
- No secrets: replace Supabase row rule with "`vault.db` envelope rows only; bundles carry
  no hashes; logs redact values".
- Thin Rust: allowed list = fs, git remote, SQLite opaque rows, dialogs, scan walk; forbidden
  = crypto, parsing, sync policy, ignore-rule policy (lives in `env-files.ts`).
- Zero-knowledge + identity: envelope shape, portable key derivation
  (`identity + fileName`, salt in envelope), no keychain, no network, `*.envmgr` excluded
  from commits.
- Packaging checklist: no certs/keystores in repo, artifacts not committed, CI secrets only.
- Fail conditions: add "any network call added", "plaintext env value in a store/log/bundle".

## 8.3 `.opencode/skills/responsive-design/SKILL.md`

- Add **Dark mode** section: both themes are required deliverables; use CSS variables, never
  hardcode hex; verify contrast for text/muted/destructive/badges; `color-scheme` set;
  no flash on boot.
- Add theme toggle requirements (44px, labelled, System/Light/Dark, persisted).
- Replace `npm run build` with `pnpm build`.
- Add scan-results and diff-preview responsive patterns (cards → table at 720px, sticky
  action bar that wraps).

## 8.4 `README.md`

- New diagram: GUI ⇄ `~/.env-manager/vault.db` (ciphertext) ⇄ `.envmgr` bundles you move
  yourself. No server, no accounts.
- "How it works" bullets: identity (+ monorepo subpath), encrypted local vault, passphrase
  entered each launch, auto-backup on save, bundle import/export, plaintext escape hatch,
  parent-folder scan.
- Non-goals/guarantees: keep no-lock-in; add "no network, no telemetry".
- Status: mark the rework (v0.1.0 distribution build) with the new feature list.
- Quick start: pnpm commands; note Rust only needed for `tauri dev/build`.
- Structure: remove `supabase/`, add `docs/DISTRIBUTION.md`.
- Contributing: pnpm; no `.env.example`; fixtures only.
- Add **Install** section pointing at release artifacts + unsigned warnings + link to
  `docs/DISTRIBUTION.md`.

## 8.5 `CONTRIBUTING.md`

- pnpm throughout, `pnpm test` + `pnpm build` gate.
- Secrets section: fixtures only; no `.env.example`; never commit `vault.db`, `*.envmgr`,
  `*.backup-*`.
- Architecture rules: thin Rust list updated; zero-knowledge wording updated.
- Add "Dark mode: check both themes before a PR".

## 8.6 `docs/ARCHITECTURE.md`

- Replace the three-box diagram (no Supabase).
- Module map: `store.ts`, `bundle.ts`, `scan.ts`, `env-files.ts`, `theme.ts`, `paths.ts`,
  `config.ts`; Rust = fs + git + SQLite opaque + dialogs + scan walk; delete the cloud/RLS row.
- Flows: save → snapshot; restore → diff → backup → write; scan → candidates → bulk add;
  export/import bundle; identity + monorepo subpath.
- Keep the team-sharing note but mark it "post-v1, would require a transport we no longer
  ship" (or delete it — prefer delete to avoid implying a cloud roadmap).
- Add a short "Data at rest" table: what is plaintext (`.env` on disk, config.json metadata)
  vs ciphertext (`vault.db` envelopes) vs absent (passphrase, keys, bundle hashes).

## 8.7 `docs/ROADMAP.md`

- Add a "v0.1.0 distribution" milestone containing this rework (removal, portable crypto,
  vault, bundles, scan, dark mode, packaging).
- Remove Supabase/.env.example chores; mark `.env.example` as deleted.
- Keep DONE history for P0–P3 but append a note that cloud was removed in 0.1.0.

## 8.8 `.github/PULL_REQUEST_TEMPLATE.md`

- Checklist: `pnpm build` + `pnpm test` green, both themes checked at 360px, no secrets /
  `vault.db` / bundles / build artifacts in the diff.

## 8.9 New `docs/DISTRIBUTION.md`

Outline (details in [09-packaging-release.md](09-packaging-release.md)): artifacts per OS,
unsigned install steps, signing env vars, release checklist, CI workflow, local build
prerequisites, version bump procedure, checksums.

## Verification

```powershell
Select-String -Path (Get-ChildItem -Recurse -Include *.md -File | Where-Object FullName -notmatch 'node_modules|target|docs\\plan') -Pattern 'supabase|rls|keychain|npm run|npx vitest|\.env\.example' -CaseSensitive:$false
```

Pass: zero matches outside `docs/plan`; every doc names pnpm; every doc describes the
local encrypted vault as the only store.
