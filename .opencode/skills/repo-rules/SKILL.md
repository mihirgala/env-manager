---
name: repo-rules
description: Enforce env-manager no-lock-in, no-secrets, lossless-dotenv, thin-Rust, and zero-knowledge guardrails before pushing code
license: MIT
compatibility: opencode
metadata:
  audience: contributors
  workflow: security-review
---

# Repo Rules — env-manager

Load this before touching vault, scan, bundle, crypto, dotenv parser, theme, or Tauri backend code.

## When to use me

- Adding snapshot, bundle import/export, scan, or sync logic
- Editing `src/lib` dotenv parser, identity, crypto, vault, store, bundle, scan, env-files, theme
- Editing `src-tauri/` Rust commands
- Writing tests with `.env` content
- Changing shared UI surfaces or theme tokens

## 1. No lock-in (hard fail if violated)

- [ ] No files written into target user repos (no `env-manager.json`, no SDK, no deps).
- [ ] `.env` stays source of truth — the app is never required at runtime.
- [ ] Export / Remove / Uninstall leaves `.env` files intact on disk.
- [ ] Scan is read-only: never read env contents while walking folders; list names only.
- [ ] Tests use `src/lib/__fixtures__/` or temp dirs only. Never read/write real home or project
  `.env`.

## 2. Never commit secrets

- [ ] No real `.env`, `vault.db`, `cache/`, `*.envmgr`, `*.backup-*`, tokens, or passphrases in git.
- [ ] Fixtures use `EXAMPLE_KEY=example-value` placeholders only. No template env files.
- [ ] Logs / errors never print plaintext secrets — redact values, log keys + hashes only.
- [ ] `vault.db` envelope rows only: `{ v, salt, nonce, algo, ciphertext }` + local
  `plaintext_sha256` for conflict detection. Bundles carry no hashes and no plaintext.
- [ ] Error messages may name a file or key, never a value.

## 3. Lossless dotenv

- [ ] Parser must round-trip: comments, order, quoting, blank lines, `export` prefixes preserved.
- [ ] Only values change on save. Key add/remove is explicit, never silent reorder.
- [ ] Add/extend round-trip test for every parser change:
  `parse(serialize(parse(fixture))) === fixture`.
- [ ] Env-file selection lives in `env-files.ts` (TS), not Rust.

## 4. Thin Rust

- [ ] `src-tauri/` allowed: fs read/write, `git remote get-url`, file stats, opaque SQLite rows,
  `links.json` / `config.json`, dialogs, read-only scan walk.
- [ ] Forbidden in Rust: crypto, dotenv parsing, snapshot/restore policy, bundle format, env-file
  filtering, theme decisions. Those live in `src/lib` (TS).
- [ ] Every Tauri command has a TS adapter type so Vite `pnpm dev` works without Rust.

## 5. Zero-knowledge + identity

- [ ] Passphrase / master key / DEK / plaintext never leave the device, are never logged, and are
  never written unencrypted.
- [ ] Envelope shape only: `{ v, salt, nonce, algo: "xchacha20poly1305", ciphertext }`; `fileName`
  is AEAD additional data.
- [ ] Portable derivation: `BLAKE2b(master, "identity:fileName")`, not a local database id and not
  a per-project secret. Salt lives in the envelope.
- [ ] No network calls, no telemetry, no remote config, no OS credential store.
- [ ] Identity normalize: `git@github.com:Foo/bar.git` → `github.com/foo/bar`; monorepo
  `identity::subpath`; fallback UUID lives in `~/.env-manager/links.json`, never in repo.
- [ ] Conflicts / restore / import: never silent overwrite — show a diff, write
  `.env.backup-<ts>`, then apply.
- [ ] Theme: use CSS variables in both modes; no hardcoded colors; no flash on boot.

## 6. Packaging

- [ ] No certificates, private keys, keystores, or signing passwords in the repo.
- [ ] No build artifacts (`src-tauri/target/`, installers, checksums) committed.
- [ ] Signing material only in CI secrets; release notes state unsigned builds where applicable.
- [ ] Version stays `0.1.0` across `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json` until a deliberate bump.

## Fail the change if

Any unchecked box above, `pnpm build` or `pnpm test` red, a real secret appears in the diff, any
network call is added, or a plaintext env value appears in a store, log, or bundle.
