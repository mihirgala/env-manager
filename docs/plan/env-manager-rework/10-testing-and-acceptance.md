# Step 10 — testing, QA, definition of done

## 10.1 Automated suites

| File | Covers |
|---|---|
| `src/lib/dotenv.test.ts` | untouched: lossless round-trip on all fixtures |
| `src/lib/identity.test.ts` | + `withSubpath` / `splitSubpath`, Windows separators |
| `src/lib/env-files.test.ts` (new) | template/backup exclusion, `.env.*` acceptance, case |
| `src/lib/scan.test.ts` (new) | candidate build, dedupe, non-git toggle, skip-list args |
| `src/lib/crypto.test.ts` | v2 envelope, identity+AAD binding, wrong key, cross-salt decrypt |
| `src/lib/store.test.ts` (new) | put/latest/list, retention 20, cascade delete |
| `src/lib/sync.test.ts` (rewritten) | backup/restore/status, ciphertext-only, backup-before-write |
| `src/lib/bundle.test.ts` (new) | round-trip, parse errors, no plaintext/hashes, portability |
| `src/lib/theme.test.ts` (new) | resolve matrix, persistence fallback, class toggle |
| `src/lib/vault.test.ts` | project CRUD, duplicate identity behaviour (no silent re-point) |
| `src/lib/paths.test.ts` (new, if paths are centralised) | join/split on `/` and `\` |

Commands:

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml   # if Rust present
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## 10.2 Static checks / greps

```powershell
# no server/auth/keychain remnants
Select-String -Path (Get-ChildItem -Recurse -Include *.ts,*.tsx,*.rs,*.md,*.json -File |
  Where-Object FullName -notmatch 'node_modules|target|pnpm-lock|docs\\plan') `
  -Pattern 'supabase|rls|keychain|oauth|github sign|local-only|VITE_'
# no npm
Select-String -Path (Get-ChildItem -Recurse -Include *.md,*.json,*.yaml -File |
  Where-Object FullName -notmatch 'node_modules|target|docs\\plan') -Pattern 'npm run|npm install|npx '
# no plaintext store assertions
Select-String -Path src/lib/store.ts,src/lib/bundle.ts -Pattern 'plaintext'   # only sha field names allowed
```

## 10.3 Manual QA matrix

Run for each build you intend to ship (at minimum Windows locally; CI artifacts for macOS/Linux).

**Layout / theme**
- [ ] 360 / 768 / 1280 px: no horizontal scroll, no clipped buttons, 44px targets.
- [ ] Light, Dark, System (flip OS theme live) on every screen.
- [ ] Restart in Dark: no white flash; title bar matches.
- [ ] Unlock screen themed; toasts readable in both themes.

**Vault**
- [ ] First run: create passphrase, recovery code shown once, copy confirmed.
- [ ] Quit + relaunch → unlock prompt; wrong passphrase → clear error, no data loss.
- [ ] Recovery code unlocks.
- [ ] Lock now → crypto actions disabled (Save still works).
- [ ] Save a `.env` → snapshot written; `vault.db` contains no plaintext:
      `Select-String -Path $HOME\.env-manager\vault.db -Pattern '<a fixture secret>' -Encoding utf8` → no match.
- [ ] External edit → "changed on disk" badge; Reload works.
- [ ] Restore dialog shows added/changed/removed keys; Apply creates `.env.backup-<ts>`.

**Scan**
- [ ] Temp tree: repo root `.env`, repo `.env.example`, monorepo `apps/web/.env.local`,
      non-git folder `.env`, `node_modules/x/.env`.
- [ ] Scan finds only trackable entries; `.env.example` absent everywhere (tabs too).
- [ ] Subfolder identity shows `…::apps/web`; bulk add creates separate projects.
- [ ] Re-scan marks existing rows "already added"; duplicates disabled.
- [ ] Cancel stops promptly; depth + skip list respected.

**Bundles**
- [ ] Export while locked is blocked with a hint.
- [ ] Bundle JSON greps clean for secret values and hashes.
- [ ] Import on a second vault/profile (different project ids, same identity) restores files.
- [ ] Wrong passphrase → error, nothing written.
- [ ] Plaintext export/import warns; import backs up first.

**Package**
- [ ] Installer: install → launch → add project → save → uninstall leaves `.env` files and
      (`~/projects`) untouched.
- [ ] No files created inside any target repo (`git status` clean in fixture repos).
- [ ] App works with networking disabled.

## 10.4 Definition of done

- All 10 steps ticked in `00-index.md`.
- `pnpm test` and `pnpm build` green on a clean clone (`pnpm install --frozen-lockfile`).
- No `supabase/`, `.env.example`, `package-lock.json`, cloud/auth/keychain references.
- `vault.db` verified ciphertext-only; bundles verified hash-free.
- Both themes pass the matrix; scan and bulk add verified on a real `~/projects` tree.
- Windows artifact built; CI workflow exists and produces macOS/Linux artifacts on dispatch/tag.
- Docs (`README`, `ARCHITECTURE`, `ROADMAP`, `CONTRIBUTING`, `DISTRIBUTION`, skills, `AGENTS`)
  describe only the shipping behaviour.
