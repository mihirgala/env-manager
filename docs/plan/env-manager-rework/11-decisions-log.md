# Decisions log and open items

## Locked decisions (from planning conversation)

| Topic | Decision | Why |
|---|---|---|
| Hosted backend | Removed entirely (Supabase, Auth, RLS, OAuth) | Local-first product; no server to run, pay for, or trust |
| Storage | `~/.env-manager/vault.db` (SQLite) stores **ciphertext only** + local plaintext sha for change detection | Fits no-secrets rule; still lets users restore lost `.env` files |
| Key entry | Passphrase → Argon2id, typed at every launch; never stored in OS keychain | Manual entry means no silent unlock surface |
| Per-project key | `BLAKE2b(master, "<identity>:<fileName>")`, filename also bound as AEAD AAD; envelope `v: 2` | Makes bundles portable across machines; stops filename swap |
| Snapshots | Auto on every save **and** a manual "Back up now" | Backups stay current without extra ceremony |
| Retention | Newest 20 snapshots per (project, file) | Bounded DB with useful history |
| Cross-machine transport | Encrypted `.envmgr` project bundle (default) + plaintext `.env` import/export (explicit) | No network, still practical |
| Bundle contents | Envelopes + identity + display name; **no hashes** | A plaintext hash is a guessing oracle |
| Import crypto | Decrypt with bundle salt (prompt passphrase if needed), re-encrypt under local key | One salt per vault, simpler recovery |
| `local-only` flag | Removed | No remote to opt out of |
| Devices card/registry | Removed; device name kept only as bundle metadata | No sync peers to track |
| Package manager | pnpm only; `packageManager: pnpm@12.11.2`; delete `package-lock.json` | One lockfile, no drift |
| `.env.example` | Deleted from this repo and ignored everywhere in the app | Templates aren't user data; examples polluted tabs |
| Trackable env files | `.env` and all `.env.*` except `.env.example*`, `.env.sample`, `.env.template`, `.env.dist`, `.env.backup-*` | Matches real usage, skips templates |
| Scan scope | Repo roots **and** monorepo subfolders under a chosen parent | User explicitly wanted monorepo layouts |
| Subfolder identity | `<normalized-remote>::<posix-subpath>` | Portable, unique per folder, matches on another laptop |
| Non-git folders | Optional toggle, off by default, manual link identity, "won't auto-match" warning | Keeps the default set trustworthy |
| Scan safety | Read-only names only; no contents, no writes; skip dirs + depth + dir caps + cancel | Never leak or scan `node_modules` |
| Dark mode | System / Light / Dark, persisted in config + localStorage mirror, no flash, native window theme | User request; palette already existed |
| Version | Stay `0.1.0` | User choice; first distributable build |
| Signing | Unsigned artifacts now; signing env hooks in CI | No certs available yet |
| macOS build | Universal (arm64 + x64) | One file for all Macs |
| Auto-updater | Out of scope | Not requested; avoids an update server |
| Team sharing | Removed from docs | Would need the transport we deleted |

## Open items / prerequisites

- [ ] **App icon**: current `src-tauri/icons/*` are Tauri defaults. Needs a 1024px logo →
      `pnpm tauri icon`.
- [ ] **Rust toolchain** not installed on this Windows machine → local `.msi`/`.exe` build
      needs rustup + VS Build Tools. CI is the alternative.
- [ ] **git CLI** not on PATH in this shell → tagging/pushing needs Git for Windows (or `gh`
      for repo operations).
- [ ] **macOS signing**: no Apple Developer ID; Gatekeeper warning until certificates exist.
- [ ] **Windows signing**: no Authenticode cert; SmartScreen warning until then.
- [ ] **CSP**: `csp: null` is fine while fully offline; consider a strict `default-src 'self'`
      as follow-up hardening.
- [ ] Decide whether plaintext export/import should require a typed confirmation ("I
      understand this file is unencrypted") — planned as warning styling only.
- [ ] Whether to expose snapshot history in the UI ("restore older…") — planned as
      nice-to-have after core restore works.
- [ ] Whether scan should also detect `.env` files two levels below a repo root when the
      intermediate folder is not a package (currently yes, treated as subpath projects).

## Non-goals (explicit)

- CLI, background sync daemon, auto-updater, telemetry, accounts, team-shared vaults.
- Cloud/remote transport of any kind in v0.1.0.
- Windows/macOS/Linux artifacts built from a single host (Tauri limitation).

## Change-control notes

- Adding any network call breaks the "offline, no server" guarantee → reject in review.
- Adding plaintext columns/hashes to `vault.db` or bundles → reject.
- Adding a JSON/config file inside target repos → reject (no-lock-in rule).
- Changing the identity format requires a bundle `version` bump + import migration.
- Changing the key derivation requires envelope `v` bump + explicit "old snapshots are
  unreadable, re-back-up" messaging.
