# Plan docs

This folder holds the working plan for the current rework: dropping the hosted backend,
moving to a local encrypted SQLite vault, portable crypto, bundle import/export,
parent-folder scanning, dark mode, and cross-platform packaging.

Start here: [env-manager-rework/00-index.md](env-manager-rework/00-index.md).

These files are the source of truth for *intent* and sequencing. Code, tests, and
`AGENTS.md` remain the source of truth for *current behaviour*. When a step lands, tick it in
the index so the next session can resume without re-reading everything.

Notes for search/replace or verification commands: exclude `docs/plan` from greps that look
for removed terms (supabase, keychain, oauth, npm, `.env.example`) — the plan mentions them
on purpose.
