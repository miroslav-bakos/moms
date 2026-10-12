# Release review — 12 October 2026

The release source is free software under GPL-3.0-only, maintained by Miroslav
Bakoš <miroslav@miroslavbakos.com>. It contains no licence activation, paid tiers,
trial expiry, retired provider integration or competitor-monitoring feature.

The review covers tracked source and history, package manifests, local module
references, installation instructions, migration defaults, authentication and
request origins, backup/restore boundaries, browser rendering, desktop lifecycle,
GitHub workflows and third-party notices. Secrets, working data, private network
configuration and private development records must stay outside this repository.

Corrections include patched npm dependencies, Docker-context exclusions for local
credentials, removal of authenticated API caching, recovery of backups with
retired settings, preservation of disabled VAT controls after order status changes,
and an automated browser CI gate. XLSX export compatibility is checked with the
updated UUID dependency. Windows runtime preparation includes a pinned PostgreSQL
copyright notice.

Verification commands:

```sh
npm ci
npm run verify
sh scripts/verify-db.sh
npm ci --prefix testing
npx --prefix testing playwright install chromium
npm run verify:ui
```

The desktop and lifecycle Docker harnesses use only disposable databases and
files. Actual Windows and macOS installer acceptance and marketplace approval
remain platform/account-specific release checks. Source review and these tests
cannot guarantee the absence of every defect or replace marketplace acceptance.

GitHub is the canonical source after publication. Preserve its history; keep
production deployment credentials outside Actions unless a separate deployment
workflow is intentionally configured. Private-to-public visibility changes need
a review of the complete Git history as well as the current source tree.
