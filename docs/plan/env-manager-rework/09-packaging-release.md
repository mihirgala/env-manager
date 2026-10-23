# Step 9 — packaging + release (Windows, macOS, Linux)

Version: **0.1.0**. Artifacts unsigned, with signing hooks wired. macOS universal.
Tauri does not cross-compile: Windows → Windows, macOS → macOS, Linux → Linux.

## 9.1 `src-tauri/tauri.conf.json`

```jsonc
{
  "productName": "env-manager",
  "version": "0.1.0",
  "identifier": "com.envmanager.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "app": {
    "windows": [{ "label": "main", "title": "env-manager", "width": 1100, "height": 750,
                  "minWidth": 360, "minHeight": 480 }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis", "dmg", "app", "appimage", "deb", "rpm"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png",
             "icons/icon.icns", "icons/icon.ico"],
    "category": "DeveloperTool",
    "shortDescription": "Local-first .env manager with an encrypted vault",
    "longDescription": "Keeps .env files as the source of truth, backs them up encrypted in a local SQLite vault, and moves them between machines as encrypted bundles. No account, no server.",
    "publisher": "env-manager",
    "copyright": "MIT",
    "macOS": { "minimumSystemVersion": "10.15" },
    "linux": { "deb": { "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0"] } },
    "windows": { "nsis": { "installMode": "currentUser" } },
    "createUpdaterArtifacts": false
  }
}
```

Also: remove `withGlobalTauri` if unused; keep `csp: null` only if everything is local
(otherwise set a strict `default-src 'self'` CSP — no remote calls exist).

## 9.2 Icon + metadata

- Current `src-tauri/icons/*` are the Tauri defaults. Replace with a real logo:
  `pnpm tauri icon path/to/logo-1024.png` (regenerates all platforms).
- Fix `index.html` title/favicon; `public/favicon.svg` should match.
- `package.json` version stays `0.1.0`; `Cargo.toml` version stays `0.1.0`. Bump all three
  together (add a note in `docs/DISTRIBUTION.md`).
- `capabilities/default.json`: `core:default`, `dialog:allow-open`, `dialog:allow-save`,
  `core:window:allow-set-theme` (dark mode). No `fs:*` permissions.

## 9.3 Local build

```powershell
pnpm install
pnpm build
pnpm tauri build
```

Outputs: `src-tauri/target/release/bundle/msi/*.msi`,
`.../nsis/*-setup.exe`, plus the raw `env-manager.exe`.

Prerequisites currently **missing on this machine**: Rust toolchain (`rustup`, stable),
VS 2022 C++ Build Tools, WebView2 runtime (present on Win 10/11). Install those before a
local build, or rely on CI.

## 9.4 CI — `.github/workflows/release.yml` (new)

Triggers: `push` tags `v*`, plus `workflow_dispatch`. Permissions: `contents: write`.

```yaml
name: release
on:
  push: { tags: ['v*'] }
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: ''
          - platform: macos-latest
            args: '--target universal-apple-darwin'
          - platform: ubuntu-22.04
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4          # reads packageManager
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with: { workspaces: './src-tauri -> target' }
      - name: Linux deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
            libayatana-appindicator3-dev patchelf rpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Windows Authenticode (optional, secret-gated)
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          # macOS signing/notarization (optional, secret-gated)
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          tagName: v__VERSION__
          releaseName: 'env-manager v__VERSION__'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

- Empty secrets → unsigned build, no failure.
- Also `actions/upload-artifact` per platform as a fallback when running by dispatch
  (no tag).
- `pnpm test` on all three runners doubles as a cross-platform test signal.

## 9.5 Artifact matrix

| OS | Files | Notes |
|---|---|---|
| Windows | `env-manager_0.1.0_x64_en-US.msi`, `env-manager_0.1.0_x64-setup.exe` | per-user NSIS install; SmartScreen warning when unsigned |
| macOS | `env-manager_0.1.0_universal.dmg`, `.app` | Universal (arm64 + x64); Gatekeeper warning when unsigned |
| Linux | `env-manager_0.1.0_amd64.AppImage`, `.deb`, `.rpm` | AppImage is portable; deb/rpm for package installs |

## 9.6 Release procedure (document in `docs/DISTRIBUTION.md`)

1. Green `pnpm test` + `pnpm build` locally.
2. Bump version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
3. `git tag v0.1.0 && git push origin v0.1.0` (git CLI not on PATH here — use `gh` or a
   shell with Git for Windows).
4. CI builds, attaches artifacts to a **draft** release.
5. Download, smoke-test each artifact, write checksums (`Get-FileHash`/`shasum -a 256`),
   publish the release.
6. Unsigned install instructions in the release notes (see 9.7).

## 9.7 Unsigned install instructions (put in release notes + docs)

- **Windows**: More info → Run anyway. Installer is per-user.
- **macOS**: right-click → Open (or `xattr -dr com.apple.quarantine /Applications/env-manager.app`).
- **Linux**: `chmod +x env-manager_0.1.0_amd64.AppImage && ./env-manager_0.1.0_amd64.AppImage`.

## 9.8 Constraints to state clearly in the PR/notes

- No macOS/Linux artifact can be produced from this Windows host.
- macOS distribution realistically needs an Apple Developer ID for a warning-free install;
  hooks are ready, credentials intentionally absent.
- Auto-updater is out of scope (`createUpdaterArtifacts: false`).

## Verification

- `pnpm tauri build` succeeds on Windows (after toolchain install) and the `.msi` installs,
  launches, reads/writes a `.env`, and creates `~/.env-manager/vault.db`.
- CI workflow parses (`gh workflow list` after push) and a dispatch run produces three
  artifact sets.
- `git status` shows no artifacts, no `vault.db`, no `*.envmgr`.
