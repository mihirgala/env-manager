# Roadmap / TODO — env-manager

GUI-only, local-first. `.env` stays source of truth. Tracked here; check off as PRs land.

## P0 — Scaffold (v0.1) — DONE (2026-10-11)

Goal: app boots, Add Project skeleton works, no crypto yet.

- [x] `package.json` — Vite React + TS strict, scripts: `dev`, `build`, `tauri dev`, `tauri build`
- [x] `src/` shell — router/screens placeholder: Projects, Project Detail, Settings
- [x] `src/lib/` skeleton (pure TS, no Tauri imports):
  - [x] `identity.ts` — normalize `git remote origin` → `github.com/foo/bar`, fallback UUID type
  - [x] `dotenv.ts` — lossless parse/serialize stub + `__fixtures__/` (sample `.env` files, fake values only)
  - [x] `vault.ts`, `crypto.ts`, `sync.ts` — typed stubs + TODOs (no logic yet)
- [x] `src-tauri/` — Tauri v2 init, thin commands stub: `read_env_file`, `write_env_file`, `git_remote_get_url`
- [x] Tauri ↔ TS adapter — `src/lib/tauri.ts` so `pnpm dev` works without Rust (mock fallback)
- [x] Add Project skeleton — folder picker → shows detected remote or manual name, saves nothing yet
- [x] Base styles — fluid layout, CSS vars (dark-mode ready), 360px min. Follow `responsive-design` skill
- [x] `docs/ARCHITECTURE.md` — diagram + module map
- [x] `pnpm build` green, no `.env` / `vault.db` committed

Exit criteria: `pnpm dev` shows project list shell; `pnpm tauri dev` opens desktop window; Add Project picker opens.

## P1 — Local (v0.2) — DONE (2026-10-11)

Goal: fully useful without account or internet.

- [x] SQLite vault (`~/.env-manager/vault.db` via `rusqlite`): `projects`, `env_sets` tables
- [x] `links.json` + `config.json` — path ↔ project mapping, never in repo
- [x] Lossless dotenv read/write — comments/order/quoting/blank lines preserved, round-trip tests
- [x] Project list + editor — view/edit `.env` values, dirty indicator, save writes file in place
- [x] Status badges — `clean | diverged` from stored vs on-disk sha
- [x] File watcher — badge when `.env` changes on disk outside app (mtime poll via `file_stat` + focus check)
- [x] Settings → Export backup / Remove project (keeps `.env`) — per `repo-rules` skill
- [x] Empty states, error toasts, keyboard nav (Tab reaches all actions — native buttons/inputs)

Exit criteria: add real folder → edit values → file on disk updated losslessly → export works.

## P2 — Encryption (v0.3) — DONE (2026-10-11)

Goal: secrets at rest are ciphertext only. Zero-knowledge enforced.

- [x] Unlock screen — passphrase → Argon2id → master key (libsodium-sumo in TS), lock per boot
- [x] Recovery key — generate 256-bit once, show-once screen, confirm-before-continue
- [x] Per-project DEKs (XChaCha20-Poly1305), envelope `{ v, salt, nonce, ciphertext }` + `plaintext_sha256`
- [x] Encrypted snapshot push/pull with diff preview — never silent overwrite, conflict → `.env.backup-<ts>` + prompt
- [x] Load `repo-rules` skill review before merging any of this

Exit criteria: same passphrase decrypts the same identity on a simulated second machine; snapshots hold ciphertext only.

## P3 — Polish (v0.4) — DONE (2026-10-11)

- [x] Multi-file sets — `.env`, `.env.local`, `.env.*` per project (file tabs, per-file tracking, per-file export)
- [x] Device name in `config.json`, shown in Settings
- [x] Icons, onboarding, first-run explainer
- [x] `CONTRIBUTING.md` + issue/PR templates (open-source hygiene)
- [x] Team sharing prep (design note only — no shared vault in v1)

## Local-vault rework (v0.1.0) — IN PROGRESS

Plan: `docs/plan/env-manager-rework/`. Hosted backend removed; SQLite vault only,
manual encrypted bundles, parent-folder scan, dark mode, cross-platform packaging.

## Open-source chores (anytime)

- [x] `CONTRIBUTING.md` — build/test/PR rules, no-secrets pledge
- [ ] GitHub: topics, description, issue labels (`good-first-issue`, `P0/P1/P2/P3`)

## Non-goals (v1)

CLI, auto-sync daemon, team-shared vaults, mobile apps. Revisit post-v0.4.
