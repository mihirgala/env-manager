# Supabase — hosted backend (P2)

Local-only is the default — no account needed. Cloud mode stores **ciphertext
only**: `env_snapshots.envelope` is `{ v, salt, nonce, algo, ciphertext }` and
`plaintext_sha256` is used for conflict detection only. There are no plaintext
columns. All tables are owner-only via RLS (`owner_id = auth.uid()`).

## Release setup (maintainer, one time)

The app ships with a managed backend baked in, so users never touch this.
You do it once:

1. **Create the project** at supabase.com. Copy the Project URL and anon key.
   The anon key is public by design — isolation comes from RLS, and the
   server only ever sees ciphertext.
2. **Auth → Providers → enable GitHub.** Create the OAuth App under your
   GitHub org/user settings (Developer settings → OAuth Apps) with callback
   URL `https://<project-ref>.supabase.co/auth/v1/callback`, then paste the
   Client ID + Secret into Supabase. No email provider or SMTP needed.
3. **Auth → URL Configuration → Redirect URLs → add**
   `https://env-manager.local/auth/callback`. The desktop app intercepts this
   host in its sign-in window (`open_oauth_window` in `src-tauri/src/main.rs`)
   — it never resolves, so no website is required.
3. **Apply the migrations**, in order:
   ```powershell
   supabase link
   supabase db push
   ```
   (`0001_init.sql` = tables + RLS, `0002_profile_trigger.sql` =
   auto-creates a `profiles` row on signup — without it every first Push
   fails on the foreign key.)
   Or paste both files into the dashboard SQL editor.
4. **No SMTP needed.** Sign-in is GitHub OAuth in a desktop window, so the
   project sends zero emails — built-in rate limits never bite.
5. **Bake the credentials into release builds** (placeholders only in git):
   ```powershell
   $env:VITE_SUPABASE_URL="https://xyz.supabase.co"
   $env:VITE_SUPABASE_ANON_KEY="eyJhbGciOi..."
   npm run build        # or: npm run tauri:build
   ```
   See `.env.example`. Without these vars the build simply has no managed
   cloud — the app falls back to local-only + self-host override in
   Settings → Cloud sync.

## User flow (no setup on their side)

Install → Settings → set passphrase → Cloud sync shows **managed cloud** →
**Sign in with GitHub** (opens your browser — approve, then paste the `code`
from the address bar back into the app) → Test connection → Push. Self-hosters can still point at their own project under "Use your own
Supabase project instead" (their backend needs the same provider + redirect
URL configured).
