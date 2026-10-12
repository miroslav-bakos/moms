# Development and verification

Node 22, npm and PostgreSQL 16 match the deployed Docker runtime. Run `npm ci` once and `npm run harness:install` to install the offline pre-commit gate. Existing deployment hooks are preserved. The gate checks the current working tree, so review staged changes and avoid partially staging behavior changes. Isolated DB and browser checks remain required when relevant; they are not run automatically on every commit. No additional test framework is needed for the existing assertion checks.

| Command | Purpose | Safety |
| --- | --- | --- |
| `npm run verify` / `npm test` | Syntax + all allowlisted offline checks | Network blocked; deployment .env not loaded; temporary settings |
| `npm run verify:changed -- --base=HEAD` | Relevant offline groups based on tracked/untracked changes | Shared or unknown code selects all groups; syntax always runs |
| `npm run verify:ui` | Reviewed browser mock suites | Local mock servers, EN/SK and mobile; install testing dependencies and Chromium first |
| `sh scripts/verify-db.sh` | Real SQL, recipes, shopping receipts, import and backup/restore | Dedicated ephemeral PostgreSQL; no published ports or production volumes; cleanup on exit |
| `npm run verify:db` | Same database checks without Docker wrapper | Requires explicit `MOMS_TEST_DATABASE_URL` for a dedicated PostgreSQL test service |

The database suite stages source and migrations in a temporary directory, creates random test databases and removes them in each check's finally block. Backup tests also create/drop a temporary restricted role. PostgreSQL test credentials need CREATE DATABASE/ROLE; the runtime needs `pg_dump`, `pg_restore`, `psql` compatible with PostgreSQL 16 (current Docker image supplies them). Never supply production credentials to this command. A killed process may leave scratch databases in a separately managed test service; the Docker wrapper removes the entire test service on exit.

The runner starts each check in a separate Node process with bounded time/output. Offline checks can replace fetch with fixtures, but accidental socket access fails. It prints one successful summary; failures retain diagnostics. The preload is a development guard, not an adversarial sandbox. Database tests run sequentially; offline checks stay lightweight. No live network diagnostics, repair scripts or browser mutations are allowlisted.

For frontend behavior use Playwright against mocked routes or a seeded, disposable app. Cover affected actions, errors, desktop/mobile and EN/SK. Only mocked browser checks are included in this public repository. Do not describe skipped browser tests as passed.

Run targeted verification while editing, then full offline verification before commit and isolated DB checks when relevant. Review `git diff --check`, commit, let the configured deployment hook finish, and check `/health`. Do not rerun unrelated suites without a new change or failure. CI runs the same offline and isolated DB commands; it never deploys.

Archive UI regression with mocked APIs (no deployed app or credentials): after installing `testing` dependencies and Chromium, run `node testing/archive-cards.mock.cjs` from the repository root. It uses `@playwright/test`; `MOMS_PLAYWRIGHT_MODULE` can point to an existing Playwright installation. Optional `MOMS_UI_SCREENSHOTS=/tmp/archive` saves desktop/mobile PNGs. This standalone mock test does not load the legacy live-target Playwright configuration.

## Desktop data paths

`src/paths.js` supplies one path resolver for label generation/upload/serving, encrypted settings, backups and restore recovery. The desktop launcher sets the absolute `MOMS_DATA_DIR` before importing application modules; see [DESKTOP.md](DESKTOP.md) for start/stop/restart, optional login autostart and prerequisites. It uses `defaultDataDirectory()` for Windows LocalAppData/MOMS, macOS Library/Application Support/MOMS, or Linux XDG_DATA_HOME/MOMS (fallback ~/.local/share/MOMS). This is a bootstrap path, not a secret or a setting copied between customer machines in a backup.

Within that root the application uses `labels/`, `settings/` and `backups/`. Existing SETTINGS_DIR/BACKUP_DIR overrides remain supported. Without MOMS_DATA_DIR the existing deployment keeps repository-relative labels/settings and /backup; Docker mounts continue working. Setting a new root does not automatically move existing files: copy them with the app stopped before switching, or use a verified full backup/restore. PostgreSQL storage and client executables still need desktop packaging.

Backup restore tests now exercise the external data root, including exact label bytes, secret keys, rollback and interrupted recovery. Windows directory fsync is skipped because Node cannot use its directory-handle API there; file fsync remains. Actual Windows installation/restart behavior requires testing on Windows.

### Shutdown verification
`npm run verify` includes offline scheduler/lifecycle checks. `node scripts/check-lifecycle.js --http` exercises a loopback HTTP request without the app database. `sh scripts/verify-lifecycle.sh` builds an isolated Docker app and disposable PostgreSQL instance, checks health, SIGTERM exit 0 and restart; it exposes no host ports and removes its containers, volumes and images. It uses no production settings or labels.

Mobile/push browser regression uses only a disposable static server and mocked APIs: `node testing/mobile-push.mock.cjs`. It checks EN/SK at desktop and 390px, QR modes/revocation, explicit permission, subscribe/unsubscribe and failed-save cleanup. `MOMS_CHROMIUM_PATH` selects an existing Chromium executable. `node scripts/check-https-pairing.js` uses a temporary test CA trusted only by its test client to verify TLS, secure cookies and untrusted-proxy/cross-origin refusal; it never provisions production trust.

The isolated DB suite also verifies concurrent single-use pairing, expiry/revocation, duplicate push registration/throttling, and four fixture channels across fresh processes with an interrupted import and retry. This proves persistence/invariants with fixtures; it does not substitute for a live marketplace pilot with test accounts. PostgreSQL is now packaged for desktop as described in DESKTOP.md.

Finished-stock UI regression: `node testing/finished-stock.mock.cjs` uses only a static server and mocked APIs. It covers EN/SK desktop/390px, lost-response receipt retries, production and existing-stock corrections. It accepts the same Playwright/Chromium environment overrides as the archive mock.

Scan UI regression: `node testing/scan.mock.cjs` uses a static server and mocked APIs to exercise adding shipments, camera/photo decoding, mini-card/list layout switching, existing order details and reviewed bulk changes in EN/SK on desktop and 390px mobile. It never writes production orders.

Shipped workflow transitions archive locally and retain the marketplace dispatch result. Pending confirmation can be checked from archived order details and the seven-day dashboard report. Migration 043 archives existing Shipped orders without creating shipments or sending channel notifications. Etsy confirmation also recognizes a positive shipment notification timestamp when `was_shipped` is absent.

Live Scan starts camera capture when Add shipment is clicked, closes capture after a match, and stops tracks on close/navigation. The bundled decoder checks both barcode orientations; synthetic Code 128 fixtures cover domestic/international GLS and Posta without customer label data. GLS lookups validate the printed check digit and zero padding, restrict aliases to GLS-labelled orders, and reject ambiguous matches while allowing archived returns without reopening them. `testing/scan.mock.cjs` exercises automatic camera addition and these decoding fixtures; private saved-label samples are never committed.

Run `npm ci --prefix testing` and `npx --prefix testing playwright install chromium` before `npm run verify:ui`. GitHub Actions runs this browser gate independently of offline/SQL checks.
The browser runner clears inherited application credentials, disables deployment dotenv loading, and isolates settings/backups for each fixture process.
