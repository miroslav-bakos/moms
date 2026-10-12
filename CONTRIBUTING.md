# Contributing

Bug reports, improvements and forks are welcome. Describe the problem, expected
behaviour and reproduction steps using fictional data. Do not attach real orders,
credentials, private settings, database dumps or full backups.

Keep changes focused. Run `npm ci` and `npm run verify`; database changes also need
`sh scripts/verify-db.sh`. UI changes should be checked with mocked data on desktop
and 390px mobile in English and Slovak. Do not edit applied migrations.

By submitting a contribution, you agree to license it under GPL-3.0-only and
confirm that you have the rights to do so. Preserve third-party notices.

Reviews and support are best-effort, with no guaranteed response or merge date.
