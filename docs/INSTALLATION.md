# Installation and configuration

MOMS runs on your computer; the computer must be on for polling, backups and OAuth authorization. Start with manual orders, then connect one marketplace at a time. Windows/macOS native installers still require acceptance testing; the Docker source installation below is the documented starting point.

## Docker installation

Install Git and Docker Engine/Desktop with Docker Compose. Until this repository becomes public, cloning requires access to the private repository.

```sh
git clone https://github.com/miroslav-bakos/moms.git
cd moms
cp .env.example .env
```

On Windows PowerShell use `Copy-Item .env.example .env` instead of `cp`. Edit `.env` with a text editor:

- Set `APP_SECRET` to a unique random secret of at least 32 characters; a password manager can generate it. Preserve it across updates.
- Set nonempty `APP_BASIC_AUTH_USER` and `APP_BASIC_AUTH_PASSWORD` to your own login and strong password.
- Keep `DATABASE_URL=postgres://orders:orders@db:5432/orders` for the supplied Compose stack. Its database is internal to Docker; PostgreSQL is not published to the host. If changing database credentials, change both Compose database values and this URL before first initialization.
- Leave all marketplace `*_ENABLED` values false for the first start. The example values are not working shop credentials.

```sh
docker compose up -d --build
docker compose ps
curl --fail http://localhost:3080/health
```

Open `http://localhost:3080` and sign in with your configured login. A healthy `/health` returns HTTP 200. PowerShell can use `Invoke-WebRequest http://localhost:3080/health`. If startup fails, inspect `docker compose logs --tail=80 app db`; logs may contain private information, so redact them before sharing.

## First configuration

1. Open Settings and the setup guide. Choose manual orders or one marketplace.
2. Configure seller VAT registration and applicable rates. Non-payers, artists and sole traders can use MOMS; tax treatment depends on your own business. Review cost currency and entered costs before interpreting profit.
3. Add products, materials and recipes, then map marketplace SKUs. Use the read-only SKU rehearsal to review production and shortages before changing stock.
4. Configure workflow stages and which mean production complete. Completion consumes recorded stock once; reopening restores it.
5. Configure carrier credentials and real sender details only if you will create labels. Review parcel weight, service and customs fields for your own goods.
6. Connect a shop using the [marketplace manual](MARKETPLACE-CONNECTIONS.md), then enable that channel and perform the first synchronization.
7. Configure backups and optionally a mounted external backup-copy directory. Create and verify a backup before importing real business data.

Secrets saved through Settings are encrypted and are not returned to the browser. Some settings require a restart. For Docker use `docker compose restart app` after saving them. Bootstrap values remain in your private `.env`; never upload that file, settings directories, labels or backups to GitHub.

## Phone and local network access

On your own Wi-Fi open `http://YOUR-COMPUTER-LAN-IP:3080`. Set `MOMS_LAN_ADDRESS` to that address if the phone QR needs it. Allow port 3080 only on your trusted private network in the host firewall. Do not forward this port from your router to the Internet. HTTPS and Tailscale are not needed for local HTTP access; some browser features require HTTPS. [Desktop documentation](DESKTOP.md) describes optional private HTTPS Serve, which is separate from public OAuth callbacks.

## Updates, backups and stopping

```sh
# First create and verify a full backup in Settings.
git pull --ff-only
docker compose up -d --build
```

Keep `.env`, `settings/`, `labels/`, `backups/` and the database volume. Full `.moms.gz` backups contain customer data and credentials; store them privately, preferably with a copy on another device. See [recovery steps](SELLER-OPERATIONS.md#backup-copies-and-recovery). Restore replaces the destination installation, so test against a separate installation first.

`docker compose stop` stops the app and database; `docker compose up -d` starts them again. Do not run `docker compose down -v` during an update: it deletes named volumes, including the database.

## Native/source installation

For the background launcher, data-directory paths, runtime requirements and autostart, follow [DESKTOP.md](DESKTOP.md). A plain source checkout does not include bundled Node/PostgreSQL runtimes. Development prerequisites and isolated verification are in [DEVELOPMENT.md](DEVELOPMENT.md). Keep the native launcher's private data directory stable across upgrades; its worker does not read the repository `.env`.
