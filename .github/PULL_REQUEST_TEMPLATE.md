## What / why

## Checklist

- [ ] `npm run build` green, `npx vitest run` green
- [ ] No real `.env`, secrets, `vault.db`, or `*.backup-*` in the diff
- [ ] Dotenv round-trip preserved (`serialize(parse(f)) === f`) if the parser changed
- [ ] No files written into target repos; export/remove leaves `.env` intact
- [ ] Responsive: 360px narrow check, keyboard Tab reaches new actions
