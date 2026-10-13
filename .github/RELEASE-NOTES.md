MOMS 0.1.1 is a pilot update: free GPLv3 software for makers, artists and small workshops, with no paid tiers or activation limits.

Manage SAShE, Etsy, Amazon and Shopify orders, production stages, materials and finished stock, product recipes, recorded costs/VAT and sales summaries. Create shipping labels through Slovenská pošta and GLS Slovakia using your own carrier account; confirm eligible full-order marketplace shipments with saved tracking. Includes backups/recovery and English/Slovak UI.

## Changes since 0.1.0

- Amazon funds now show the next planned release day and amount in the dashboard summary and account details, in English and Slovak. Amounts are grouped by currency using deferred transaction maturity dates from Amazon. The view covers transactions posted in the last 180 days; missing dates and failed refreshes are marked explicitly. A release date is not a bank payout date.
- The board toolbar uses more compact search and saved-view controls, with mobile support.
- Release publication now requires matching verified source and native bundle builds. Production deployment remains a separate operator action.

## Choose your installer bundle

| Download | Computer |
| --- | --- |
| `moms-macos-apple-silicon.tar.gz` | Mac with Apple M-series chip |
| `moms-macos-intel.tar.gz` | Intel Mac |
| `moms-raspberry-pi-arm64.tar.gz` | Raspberry Pi running 64-bit ARM Linux; 32-bit OS unsupported |
| `moms-linux-x64.tar.gz` | 64-bit Intel/AMD Linux |
| `moms-windows-x64.tar.gz` | 64-bit Windows |

Download the matching `.sha256` file to verify the archive. Extract the `.tar.gz`, then run `Install-MOMS.command` on macOS, `Install-MOMS.sh` as an ordinary user on Linux/Pi, or `Install-MOMS.cmd` on Windows. The bundles include Node.js and PostgreSQL; no separate database server is needed. Open `http://localhost:3080` after installation and create your owner login.

[Installation/configuration](https://github.com/miroslav-bakos/moms/blob/main/docs/INSTALLATION.md) · [Mac/Pi pilot testing](https://github.com/miroslav-bakos/moms/blob/main/docs/NATIVE-BUILDS.md) · [Marketplace and Etsy callback setup](https://github.com/miroslav-bakos/moms/blob/main/docs/MARKETPLACE-CONNECTIONS.md)

## Validation and pilot limits

Each bundle passed native CI installer tests with a disposable database: first boot/HTTP health, update, rollback, simulated failed-update recovery and preservation of a fixture order, label and settings key. General CI covers offline checks, isolated PostgreSQL tests and mocked desktop/mobile browser workflows. No real seller data or credentials are included in the bundles; synthetic README screenshots are examples only.

This is a pilot pre-release. Mac bundles are unsigned and not notarized, and Windows installers are unsigned. Actual end-user hardware/login/reboot acceptance remains a pilot step, including a real Raspberry Pi. Mac build hosts are macOS 14 (Apple Silicon) and macOS 15 (Intel); compatibility with older macOS versions is not promised. Linux minimum glibc is recorded in each bundle manifest. Marketplace/carrier access requires your own approved credentials; tests do not replace provider acceptance. Public callback setup through the guide needs a host MOMS process beside Tailscale; default Docker Compose does not provide that integration automatically.

Provided as-is, with best-effort spare-time support. Report security issues privately to miroslav@miroslavbakos.com; remove credentials and customer data from reports.
