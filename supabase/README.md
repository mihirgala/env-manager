# Supabase (optional cloud, P2)

Local-only is the default — no account needed. Cloud mode stores **ciphertext
only**: `env_snapshots.envelope` is `{ v, salt, nonce, algo, ciphertext }` and
`plaintext_sha256` is used for conflict detection only. There are no plaintext
columns. All tables are owner-only via RLS (`owner_id = auth.uid()`).

Apply with the Supabase CLI:

```powershell
supabase db push
```
