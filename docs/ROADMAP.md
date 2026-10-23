# Roadmap / TODO — env-manager

GUI-only, local-first. `.env` stays the source of truth. Tracked here; check off as PRs land.

## P0 — Scaffold (v0.1) — DONE (2026-10-11)

Goal: app boots, Add Project skeleton works, no crypto yet.

- [x] `package.json` — Vite React + TS strict, scripts: `dev`, `build`, `tauri dev`, `tauri build`
- [x] `src/` shell — router/screens placeholder: Projects, Project Detail, Settings
- [x] `src/lib/` skeleton (pure TS, no Tauri imports): `identity`, `dotenv`, `vault`, `crypto`,
  `sync` + fixtures
- [x] `src-tauri/` — Tauri v2 init, thin commands: `read_env_file`, `write_env_file`,
  `git_remote_get_url`
- [x] Tauri ↔ TS adapter — `src/lib/tauri.ts` so `pnpm dev` works without Rust
- [x] Add Project skeleton — folder picker → detected remote or manual name
- [x] Base styles — fluid layout, CSS variables, 360px minimum
- [x] `docs/ARCHITECTURE.md` — diagram + module map
- [x] `pnpm build` green, no `.env` / `vault.db` committed

## P1 — Local (v0.2) — DONE (2026-10-11)

Goal: fully useful without an account or internet.

- [x] SQLite vault (`~/.env-manager/vault.db` via `rusqlite`) with project rows
- [x] `links.json` + `config.json` — path ↔ project mapping, never in repo
- [x] Lossless dotenv read/write — comments/order/quoting/blank lines preserved, round-trip tests
- [x] Project list + editor — view/edit `.env` values, dirty indicator, save writes in place
- [x] Early status badges (superseded by the v0.1.0 vault statuses)
- [x] File watcher — badge when `.env` changes outside the app
- [x] Settings → Export backup / Remove project (keeps `.env`)
- [x] Empty states, error toasts, keyboard navigation via native controls

## P2 — Encryption (v0.3) — DONE (2026-10-11)

Goal: secrets at rest are ciphertext only. Zero-knowledge enforced.

- [x] Unlock screen — passphrase → Argon2id → master key (libsodium-sumo in TS), lock per boot
- [x] Recovery key — generate once, show once, confirm before continuing
- [x] Per-file keys (XChaCha20-Poly1305), envelope `{ v, salt, nonce, algo, ciphertext }` +
  `plaintext_sha256`
- [x] Encrypted snapshot backup/restore with diff preview — never silent overwrite,
  conflict → `.env.backup-<ts>`
- [x] `repo-rules` skill review before merging

## P3 — Polish (v0.4) — DONE (2026-10-11)

- [x] Multi-file sets — `.env`, `.env.local`, `.env.*` per project (tabs, per-file tracking)
- [x] Device name in `config.json`, shown in Settings
- [x] Icons, onboarding, first-run explainer
- [x] `CONTRIBUTING.md` + issue/PR templates (open-source hygiene)
- [x] Sharing design note (no shared vault shipped)

## v0.1.0 — distribution rework — IN PROGRESS

Plan: `docs/plan/env-manager-rework/`. The hosted backend was removed in 0.1.0; the shipping app
has no network calls, no accounts, and no server.

- [x] Remove hosted backend, auth UI, and cloud-only dependencies
- [x] Portable crypto (`identity:fileName` DEKs, envelope v2, file name as AAD)
- [x] SQLite vault + append-only encrypted snapshots + retention
- [x] Encrypted `.envmgr` bundle import/export + plaintext escape hatch
- [x] Parent-folder scan (read-only) + bulk add
- [x] Vault-only screens: status, back up, restore diff, import/export
- [x] System / Light / Dark theme with no-flash boot
- [ ] Packaging + CI (Windows/macOS/Linux, unsigned)
- [ ] Acceptance pass at 360px / 1280px in both themes

## Open-source chores (anytime)

- [x] `CONTRIBUTING.md` — build/test/PR rules, no-secrets pledge
- [ ] GitHub: topics, description, issue labels (`good-first-issue`, `P0/P1/P2/P3`)

## Non-goals (v0.1.0)

CLI, auto-sync daemon, team-shared vaults, mobile apps, telemetry. Revisit after 0.1.0.
