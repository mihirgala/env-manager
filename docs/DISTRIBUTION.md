# Distribution — env-manager

Version **0.1.0**. Installers are unsigned for the first release. Tauri builds are per host OS;
there is no cross-compilation from one runner to another. The shipped app has no server: projects
and encrypted snapshots live only in the local SQLite vault at `~/.env-manager/vault.db`.

## Artifacts

| OS | Artifact | Notes |
|---|---|---|
| Windows x64 | `env-manager_0.1.0_x64_en-US.msi`, `env-manager_0.1.0_x64-setup.exe` | WebView2 required; SmartScreen warning is expected while unsigned |
| macOS universal | `env-manager_0.1.0_universal.dmg` | Intel + Apple Silicon; Gatekeeper warning while unsigned |
| Linux x64 | `env-manager_0.1.0_amd64.AppImage`, `.deb`, `.rpm` | AppImage is the portable option |

Tauri names artifacts from `productName` / `version`; confirm the exact files in the release draft
before publishing.

## Local build

Prerequisites:

- Node 20+ and pnpm
- Rust stable (`rustup`)
- Platform Tauri deps (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))
- Windows: WebView2 + MSVC build tools
- macOS: Xcode command-line tools; add `aarch64-apple-darwin` + `x86_64-apple-darwin` for universal
- Linux: WebKitGTK, `libappindicator`, `librsvg`, `patchelf`

```powershell
pnpm install
pnpm test
pnpm build
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`. Nothing from `src-tauri/target/` is committed.

## macOS universal build

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin
```

## Unsigned install steps (0.1.0)

- **Windows:** run the installer. SmartScreen → **More info → Run anyway**. Verify the SHA-256
  checksum from the release notes first.
- **macOS:** open the `.dmg`, drag to Applications. Right-click the app → **Open**, or allow it in
  **System Settings → Privacy & Security**. Do not disable Gatekeeper globally.
- **Linux:** `chmod +x env-manager_*.AppImage` then run it. For `.deb` / `.rpm`, use the system
  package manager.

## Release checklist

1. `pnpm test` and `pnpm build` green on the release commit.
2. `git status` clean; no `.env`, `vault.db`, `*.envmgr`, `*.backup-*`, or `src-tauri/target/`.
3. Version `0.1.0` matches in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
4. Run the acceptance pass in `docs/plan/env-manager-rework/10-testing-and-acceptance.md`
   (both themes at 360px and 1280px).
5. Build on each OS runner, collect artifacts, and generate checksums.
6. Create a **draft** GitHub release for tag `v0.1.0`; attach every artifact + `SHA256SUMS.txt`.
7. Smoke-test the draft installers on a clean VM/account where possible.
8. Publish only after the artifacts and checksums match.

## Checksums

```powershell
Get-ChildItem .\src-tauri\target\release\bundle -Recurse -File |
  Get-FileHash -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash.ToLower())  $($_.Path | Split-Path -Leaf)" } |
  Set-Content SHA256SUMS.txt
```

```bash
find src-tauri/target/release/bundle -type f -exec shasum -a 256 {} \; > SHA256SUMS.txt
```

Attach `SHA256SUMS.txt` to the release and paste the hashes into the release notes.

## CI outline

Planned workflow: `.github/workflows/release.yml`

- Trigger: tag `v*` plus manual dispatch.
- Matrix: `windows-latest`, `macos-14`, `ubuntu-22.04`.
- Steps: checkout → pnpm + Node → Rust toolchain → platform deps → `pnpm test` →
  `pnpm build` → `tauri-apps/tauri-action` → upload artifacts → draft release.
- macOS builds `--target universal-apple-darwin`; install both Rust targets first.
- Linux installs WebKitGTK + AppIndicator deps before building.
- No signing configuration in 0.1.0. Leave signing env vars unset so Tauri produces unsigned
  artifacts.

### Signing variables (future, CI secrets only)

Do not add certificates, private keys, or passwords to the repo. When signing is enabled, inject
these through CI secrets and document which are enabled in the release notes:

- Apple: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`
- Tauri updater (post-0.1.0): `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Never commit keystores, p12 files, provisioning profiles, or generated signatures.

## Version bump procedure

1. Update `version` in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run `pnpm install` so the lockfile reflects the workspace version if needed.
3. Run `pnpm test` and `pnpm build`.
4. Commit, tag `vX.Y.Z`, push the tag, and let CI draft the release.
5. Verify artifact names and checksums before publishing.

## Out of scope for 0.1.0

- Code signing / notarization
- Auto-update
- MSI per-machine enterprise deployment
- ARM Windows installers
- Mobile targets
