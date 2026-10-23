## What / why

## Checklist

- [ ] `pnpm test` green, `pnpm build` green
- [ ] No real `.env`, secrets, `vault.db`, `*.envmgr`, `*.backup-*`, or build artifacts in the diff
- [ ] Dotenv round-trip preserved (`serialize(parse(f)) === f`) if the parser changed
- [ ] No files written into target repos; scan is read-only; export/remove leaves `.env` intact
- [ ] Both themes checked at 360px and 1280px; no horizontal scroll
- [ ] Keyboard: Tab reaches new actions; Escape closes diff/preview cards
- [ ] No network calls, telemetry, or plaintext secrets in logs/stores/bundles
