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

## Public-source readiness review

Reviewed source revision: `82b822a2dac1d70c00622d54141a0f7912076e72`.
The repository is suitable for publication as a GPLv3 source project with
best-effort support, subject to the limitations below. This does not certify a
finished commercial product or a tested installer on every operating system.

- Reviewed 316 tracked files and 327 reachable Git blobs across 10 commits.
  No private business branding, customer data, credential patterns or original
  private development history were found. Network addresses in documentation
  are placeholders. Removed-feature names remain only in absence tests and
  the review description; those features are not implemented or seeded.
- Root and browser-test npm dependency audits reported zero vulnerabilities.
  Dependency audit results are time-specific and do not prove that every
  vulnerability is known.
- Local documentation links resolve; synthetic screenshots are repository-local
  and show fictional orders including Amazon and Shopify.
- GPLv3, author/contact, third-party vendor notices, contribution guidance and
  private vulnerability reporting are present. Runtime settings, backups,
  credentials and generated bundles are excluded from source control.
- Offline checks, isolated database checks and the 28 mocked browser suites
  have passed in GitHub Actions. The browser layout regression checks overflow
  and overlap rather than a system-font-dependent fixed height.
- GitHub issues, releases and uploaded Actions artifacts were empty at review;
  the wiki was disabled. The repository remained private during the review.

### Release boundaries

Docker/source installation is documented. Native Windows/macOS installer
acceptance is still outstanding; no downloadable native release is promised.
The guided callback-only Tailscale Funnel setup needs Tailscale beside a host
MOMS process. Default Docker Compose does not provide that networking integration;
see [the callback guide](MARKETPLACE-CONNECTIONS.md#docker-limitations).

Marketplace app approval, address access, scopes and shipping-account credentials
must be obtained by each operator. Mocked tests do not replace acceptance with a
seller's own marketplace/carrier accounts. Only complete eligible marketplace
shipments are confirmed; partial shipment writeback is not offered. Profit views
use recorded costs and are not a tax ledger.

Publishing this source does not configure deployment from GitHub or publish
production data. Keep deployment credentials and runtime data separate. Before
changing visibility, check that no new private files, issue attachments or
artifacts have been added since this review.
