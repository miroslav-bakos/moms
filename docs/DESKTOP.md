# Desktop launcher and background agent

The launcher runs MOMS under the signed-in user, with optional autostart after login. Desktop bundles include Node 22 and PostgreSQL 16 and automatically create a private, authenticated loopback database. Native Windows/macOS acceptance and signing remain separate pilot checks; the native Linux installation/update/recovery flow is exercised against disposable data.

## Running

From the application directory:

```sh
npm run desktop -- start
npm run desktop -- open
npm run desktop -- status
npm run desktop -- restart
npm run desktop -- stop
npm run desktop -- autostart enable
npm run desktop -- autostart disable
```

`start` launches a detached background agent and confirms the worker's listening callback over private IPC before reporting `running`. Repeated `start` reuses the agent. `run` starts the agent in the foreground for an installer or debugging. `restart` drains the current worker before starting another; it requires an already running agent. `stop` is idempotent and waits for the worker to exit. Commands accept `--data-dir <absolute-path>`; otherwise `MOMS_DATA_DIR` or the platform default is used:

Open `http://localhost:3080` in a browser after starting, or use the configured `PORT`. Closing the browser leaves the background agent running.

| Platform | Default data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\MOMS` |
| macOS | `~/Library/Application Support/MOMS` |
| Linux | `$XDG_DATA_HOME/MOMS`, falling back to `~/.local/share/MOMS` |

A bundle automatically supplies `runtime/postgresql`. Development can set `MOMS_POSTGRES_DIR` to an absolute runtime directory. Without an explicit `DATABASE_URL`, the agent initializes `postgres/data` using SCRAM authentication and data checksums, keeps random credentials in private `postgres/connection.json`, and binds PostgreSQL to 127.0.0.1 on its recorded port. It applies pending migrations before accepting HTTP requests and stops PostgreSQL after draining the worker. Unidentified/incomplete clusters and major-version upgrades are refused without deleting data. The application repository `.env` is never loaded by the worker. A private data-directory `.env` can still set application options or an explicit external database; inherited environment values take precedence. Existing `SETTINGS_DIR` and `BACKUP_DIR` overrides remain supported.

The pinned Unix runtime build retains zlib for compatibility with compressed existing backups, and omits optional ICU/readline/OpenSSL dependencies. An external database requiring TLS needs a supplied OpenSSL-enabled PostgreSQL client runtime. Bundled database credentials, paths and ports are local bootstrap configuration and are not moved between machines as active settings when restoring a backup.

The data directory contains `labels/`, `settings/`, `backups/` and a private `.desktop/` runtime directory. Existing data is never automatically moved or deleted. Changing roots creates a separate instance; migrate data with the app stopped or use verified full backup/restore. Keep the data path stable across app updates. Moving the application or Node executable requires enabling autostart again with the new paths.

The user-owned background agent supervises one worker. It retries unexpected exits, including the application's exit after interrupted-restore recovery, and stops after five failures within one minute. A manual restart resets the retry budget. An intentional stop does not restart. Shutdown uses authenticated local IPC, including on Windows, and the existing application drain finishes requests/imports before closing the database. The worker's drain has a 60-second limit; the agent terminates only its own child after 65 seconds and reports an error if shutdown was not clean. Losing the agent's IPC connection also initiates worker shutdown.

The private `.desktop/app.log` contains worker diagnostics; do not share it without removing personal data and secrets. Logs larger than 5 MiB are moved to `app.log.previous` on the next agent launch. This is session rotation, not a continuous log size limit. POSIX runtime directories/files use 0700/0600; Windows uses the current user's data-directory permissions.

## Autostart

Autostart is opt-in. Enabling it applies at the next login; it does not start the app immediately. Disabling it removes future login startup and leaves the current instance running; use `stop` to stop it. Entries use absolute executable/application/data paths and contain no database credentials. Each data root has a distinct entry name.

| Platform | Registration |
| --- | --- |
| Linux desktop | `$XDG_CONFIG_HOME/autostart/moms-<id>.desktop` (default `~/.config/autostart`) |
| macOS | `~/Library/LaunchAgents/moms-<id>.plist` |
| Windows | Current user's Task Scheduler logon task `moms-<id>`, using PowerShell and `schtasks.exe` |

These are login agents; unattended startup before a user signs in is outside this launcher step. Linux needs a desktop session implementing [XDG autostart](https://specifications.freedesktop.org/autostart-spec/latest/). macOS uses a per-user [LaunchAgent](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html). Windows uses an interactive, least-privilege logon task following [Task Scheduler registration](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create); no password is stored. The console appearance and native integration need verification with the packaged Windows runtime.

## Recovery and verification

A private lock identifies the owning agent. A live PID is never killed or its lock stolen; duplicate agents are rejected. A dead owner's unique lock file is removed on the next start. PID reuse is handled conservatively: stop/check the owner rather than forcibly taking over a live PID. An empty or malformed lock causes a clear error; inspect running launchers before manually repairing `.desktop/lock`. It can result from termination in the brief interval between lock-directory creation and writing its owner file. Never remove a live owner's lock.

The offline harness covers supervision, retries, ordered stop/restart, stale readiness, lock recovery, data/config isolation and all platform autostart definitions. `node scripts/check-desktop.js --ipc` exercises real private pipes with temporary fixture workers and no database. `sh scripts/verify-desktop.sh` exercises the actual app and PostgreSQL in an isolated Docker stack, without host ports or production volumes: startup, duplicate start, restart, worker recovery, unchanged settings keys/labels, IPC stop, container restart and SIGTERM exit 0. Native Windows/macOS login and reboot acceptance tests remain outstanding before advertising those installers as tested.

## Build, install and update

Prepare runtimes on a native build host with `sh scripts/prepare-desktop-runtime.sh /absolute/new-runtime-dir` (Linux x64/macOS arm64), or `scripts/prepare-desktop-runtime.ps1 -Destination C:\absolute\new-runtime-dir` (Windows x64). Unix compilation requires a C compiler, make and zlib development headers. Downloads are pinned to publisher checksums for Node 22.23.3 and PostgreSQL 16.15. Node/PostgreSQL licenses are included. Windows also includes the matching C runtime supplied in the EDB archive. Sources: [Node releases](https://nodejs.org/dist/v22.23.3/SHASUMS256.txt), [PostgreSQL source](https://ftp.postgresql.org/pub/source/v16.15/), [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries).

```sh
node scripts/build-desktop.js --output /absolute/new-bundle \
  --node /absolute/runtime/node --postgres /absolute/runtime/postgresql
```

Build on the target platform. The bundle includes an installer entry (`Install-MOMS.sh`, `.command` or `.cmd`) and a platform/architecture/version/file-hash manifest; no application `.env`, labels, settings, DB files or Git/Beads storage are included. Linux bundles record the build host's minimum glibc requirement; use a compatible build host for the intended distribution. `.github/workflows/desktop.yml` defines manual native builds and installation regressions on Ubuntu 22.04, macOS arm64 and Windows x64; this repository's private LAN origin does not automatically execute GitHub workflows.

Install with the bundle's entry or its bundled Node: `runtime/node scripts/install-desktop.js --bundle /absolute/bundle`. Default installation root is the platform data default plus `-App`, separate from customer data. `--root` and `--data-dir` choose absolute paths; an update cannot switch data roots. Start from the installed `MOMS.sh`, `MOMS.command` or `MOMS.cmd`, which opens the local browser interface. The stable loader selects the current release from `installed.json`.

Updates verify all staged files before switching releases, drain the old app, save a full private pre-update backup, preserve the prior release and re-register existing autostart against the new paths. A failed first boot restores the complete pre-update database/assets before restarting the prior release. Interrupted restore retains the existing recovery journal/emergency backups. Never delete `postgres/connection.json`, which is required to access the cluster. A rollback after successful use preserves current data and is permitted only across identical migration sets; use `scripts/install-desktop.js --rollback --root /absolute/install-root`. Crossing a migration boundary requires verified backup recovery and is refused automatically. No automatic network updater or executable download runs on customer machines; local bundles must come from the trusted publisher. Distribution signing/notarization and licensing issuance require the publisher's identities and commercial setup.

`sh scripts/verify-managed-desktop.sh` tests automatic bootstrap, migration, backup download, full isolated DB regressions and PostgreSQL/application shutdown in an unprivileged Docker container. `node scripts/check-desktop-install.js --bundle /absolute/bundle` uses only fresh temporary data and exercises real native first boot, update, rollback and deliberately failed boot with complete backup recovery. It never uses deployment credentials.

### Free software

MOMS is free software under GPL-3.0-only. There are no activation keys, paid tiers, trial expiry or update entitlements. Installation, launch and updates do not require a publisher account. Existing installations can update to a free bundle without an entitlement file; backup and integrity checks remain in place.

### Optional private Tailscale access

Install Tailscale separately and sign in to the intended tailnet. The integration never runs `tailscale up`, changes ACLs, resets Serve or enables public Funnel. With a local HTTP app, `node scripts/tailscale.js enable --port 8443 --target-port 3080` explicitly creates private background HTTPS Serve and verifies its configuration; `status` reports the private URL and `disable` removes only the matching port/target. Conflicting handlers/public Funnel are refused. Other Serve ports remain intact. Certificate/tailnet HTTPS permission must already be enabled by its administrator. See the [official Serve instructions](https://tailscale.com/docs/reference/tailscale-cli/serve).

For a native desktop proxy, set `MOMS_TRUST_LOOPBACK_PROXY=true` in the data-root `.env`, set `APP_BASE_URL` to the reported HTTPS origin and restart. Only loopback proxy addresses are trusted; forwarded headers from the LAN cannot assert HTTPS. Container proxy source addresses differ: do not blindly trust the whole LAN or Docker subnet. Native TLS works independently of proxy configuration. Tailscale must also be available on the phone, and its network policy must permit access.

As checked on 2026-10-06, Tailscale's Personal plan is intended for non-commercial use. Business use needs an appropriate business plan/trial; this app does not include or promise free business Tailscale service. Review the [current pricing and terms](https://tailscale.com/pricing?plan=business) before enrollment. Tailscale is optional and no account/network changes happen at application startup.

### Optional private-content notifications

Push is disabled by default. Enable it in application settings, provide a `mailto:` contact or public HTTPS contact URL, then restart. On each supported HTTPS device, explicitly click Enable notifications and grant browser permission. iPhone requires a supported installed home-screen web app; unsupported/HTTP devices receive an explanation. Disable notifications unsubscribes that device. Failed registration removes a newly created browser subscription.

Only a fixed synchronization notice is sent, at most once per subscription per 15 minutes. Order numbers, names, addresses, SKUs and channel payloads never enter notifications. Actual orders stay in the local database. The browser vendor's push service still receives delivery metadata and requires outbound Internet access; shutting down the desktop stops new notifications. VAPID keys are generated once in encrypted settings and restored with complete backups. Subscription endpoints/keys stay server-side; accepted endpoints are limited to supported browser vendors. Dead subscriptions are removed and delivery failures never roll back a successful import. At most 20 devices are supported; registrations refresh their 90-day server retention.
