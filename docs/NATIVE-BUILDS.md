# Native builds and pilot testing

GitHub Actions → **Desktop bundles** → **Run workflow** builds the current branch.
Version tags matching `v*` also start builds. Builds do not publish a GitHub Release
or change repository visibility. Download successful job artifacts within 14 days.
Each contains a `.tar.gz` bundle and its SHA-256 checksum; the archive preserves
executable permissions. The bundles include Node.js 22 and PostgreSQL 16.

| Artifact | Target |
| --- | --- |
| `moms-macos-apple-silicon` | Mac with Apple M-series chip; built on macOS 14 |
| `moms-macos-intel` | Intel Mac; built on macOS 15 |
| `moms-raspberry-pi-arm64` | Raspberry Pi with 64-bit ARM Linux, such as Raspberry Pi OS Bookworm 64-bit |
| `moms-linux-x64` | 64-bit Intel/AMD Linux |
| `moms-windows-x64` | 64-bit Windows |

Choose the matching architecture. The Pi build is native ARM64 on Ubuntu 22.04,
not an emulator build or a 32-bit ARM package. Linux needs glibc at least the version
recorded in `desktop-manifest.json` and compatible zlib/runtime libraries. macOS
build-host versions are not promises of compatibility with older macOS releases.

## What GitHub verifies

Each target checks its architecture, runs offline checks, prepares pinned runtimes
with verified download checksums, builds the bundle and exercises the real installer.
The installer check starts a disposable PostgreSQL database and app, checks HTTP
health, updates and rolls back, simulates a failed update, and checks preservation
of an order, label and settings key. It never connects a real seller account.
Hardware-specific behavior and operating-system prompts still need a pilot test.

## Test on a Mac

1. Apple menu → About This Mac: **Chip: Apple M…** means Apple Silicon;
   **Processor: Intel…** means Intel. Choose the matching artifact from a green job.
2. Unzip the downloaded artifact, then expand the `.tar.gz`. In Terminal, in the
   directory containing the archive, verify it with `shasum -a 256 -c NAME.tar.gz.sha256`.
3. Open the resulting `moms-bundle` folder and run `Install-MOMS.command`.
   This is an unsigned pilot bundle, not a notarized `.app` or `.dmg`.
   If macOS blocks it, review the specific download in Privacy & Security;
   do not disable Gatekeeper globally.
4. Open `http://localhost:3080`, create the owner login and switch between English
   and Slovak. Use only fictional orders for the first test.
5. Create a material, product recipe and manual order; complete and reopen
   production and check stock. Create/verify a backup. Close and reopen the browser
   and confirm the order remains.
6. The installed launcher is normally
   `~/Library/Application Support/MOMS-App/MOMS.command`. Run it with `stop`,
   `start` or `status` in Terminal to test stopping and starting the application.
   Confirm data survives restart. Autostart after login and phone access should be
   checked separately if needed.

Send the macOS version, chip type and failing step if something fails; remove
credentials/customer data from logs. Keep real shop credentials out of the pilot.
Do not test restoration over an existing working installation.

## Test on Raspberry Pi

Check `uname -m`: this bundle requires `aarch64`. Verify the downloaded checksum
with `sha256sum -c NAME.tar.gz.sha256`, then extract with
`tar -xzf NAME.tar.gz`. Run `sh moms-bundle/Install-MOMS.sh` as your ordinary user,
not root. Open port 3080 locally or from your private LAN, and repeat the fictional
order, stock, backup and restart checks above. Raspberry Pi OS 32-bit is not
supported by this build. A real Pi pilot is still required before declaring
hardware acceptance complete.

See [desktop lifecycle and data paths](DESKTOP.md) and
[installation/configuration](INSTALLATION.md) for details.
