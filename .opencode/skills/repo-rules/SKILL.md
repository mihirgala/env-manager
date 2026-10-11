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

Load this before touching cloud, sync, crypto, dotenv parser, or Tauri backend code.

## When to use me

- Adding Push/Pull/sync, Supabase queries, migrations, RLS
- Editing `src/lib` dotenv parser, identity, crypto, vault
- Editing `src-tauri/` Rust commands
- Writing tests with `.env` content

## 1. No lock-in (hard fail if violated)

- [ ] No files written into target user repos (no `env-manager.json`, no SDK, no deps).
- [ ] `.env` stays source of truth — app never required at runtime.
- [ ] Export / Remove / Uninstall leaves `.env` files intact on disk.
- [ ] Tests use `src/lib/__fixtures__/` or temp dirs only. Never read/write real home or project `.env`.

## 2. Never commit secrets

- [ ] No real `.env`, `vault.db`, `cache/`, `*.backup-*`, tokens, or passphrases in git.
- [ ] Fixtures use `EXAMPLE_KEY=example-value` placeholders only.
- [ ] Logs / errors never print plaintext secrets — redact values, log keys + hashes only.
- [ ] Supabase rows contain ciphertext + `plaintext_sha256` only. No plaintext columns.

## 3. Lossless dotenv

- Parser must round-trip: comments, order, quoting, blank lines, `export` prefixes preserved.
- Only values change on pull. Key add/remove is explicit, never silent reorder.
- Add/extend round-trip test for every parser change: `parse(serialize(parse(fixture))) === fixture`.

## 4. Thin Rust

- `src-tauri/` allowed: fs read/write, `git remote get-url`, file watcher, OS keychain.
- Forbidden in Rust: crypto, dotenv parsing, sync logic, Supabase calls. Those live in `src/lib` (TS).
- Every Tauri command has a TS adapter type so Vite `npm run dev` works without Rust.

## 5. Zero-knowledge + identity

- Passphrase / master key / DEK / plaintext never leave device, never logged, never sent to Supabase.
- Envelope shape only: `{ v, salt, nonce, algo: "xchacha20poly1305", ciphertext }`.
- RLS: `owner_id = auth.uid()` on `projects` + `env_snapshots`. No service-role key in client.
- Identity normalize: `git@github.com:Foo/bar.git` → `github.com/foo/bar`. Fallback UUID lives in `~/.env-manager/links.json`, never in repo.
- Conflicts: never silent overwrite — show diff, write `.env.backup-<ts>`, then apply.

## Fail the change if

Any unchecked box above, `npm run build` red, or a real secret appears in diff.
