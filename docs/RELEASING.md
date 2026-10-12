# Changes, releases and deployments

Use a short-lived `codex/<change>` branch from current `main` for every fix or feature.
Push the branch and open a pull request into `main`. Required GitHub Actions checks
are `checks` (offline, database and release safety) and `browser` (mocked UI).
Keep the branch up to date with `main`, resolve review conversations, inspect the
final diff, then squash merge. Delete the merged branch. Direct pushes, force
pushes and deletion of `main` are blocked, including for administrators.

This is a single-maintainer project: PRs and checks are required, but a second
person's approval is not. Review the PR before merging. Add required approvals
when another maintainer joins. A merge is not a release or a production deployment.

## Publish a pilot release

1. Prepare a version PR: update `package.json` and `package-lock.json` together,
   and update `.github/RELEASE-NOTES.md` for the actual changes and limitations.
2. Merge after required checks pass. Record the full merged commit SHA. Wait for
   the **Verify** run on that exact `main` commit to succeed.
3. Manually run **Desktop bundles** on `main` while it points to the chosen commit.
   Wait for all five native build/install jobs to pass. Record the run ID and SHA.
   If `main` moved first, choose the newer tested commit and rebuild; do not reuse
   builds from an older commit.
4. Run **Publish verified pilot release** from `main`, supplying the exact SHA,
   successful Desktop bundles and Verify run IDs, and matching unused version tag.
   Dispatch while `main` still points to that SHA; if it advanced during building,
   test/build the newer commit first. Publication provenance must identify the same SHA.
   The workflow checks both runs, main ancestry, package version, all five archives,
   source contents, checksums and privacy boundaries before publishing a prerelease.
5. Check the release page and downloadable assets. Existing tags and assets must
   never be replaced to fix a released version; publish another patch version.

Example: a fix after `v0.1.0` is released as `v0.1.1`. Native bundles remain unsigned
pilot packages until signing and hardware acceptance are completed. CI builds are
not a substitute for real device acceptance.

## Deploy separately

Production runs an explicitly selected, published release tag and its resolved
commit, not the moving `main` branch. Use the deployment host's private release
command; host addresses and operational credentials are kept outside this public
repository. Prereleases require explicit pilot opt-in. The deploy command must
verify release provenance, retain the previous image, snapshot the database and
settings/labels privately, and require `/health` HTTP 200 before recording success.
A code rollback must not silently restore old data or reverse database migrations.

The legacy private repository remains an operational archive. Pushing its `main`
must not rebuild or restart production. Keep its history separate from GitHub.

## Urgent fixes and stabilization

Normally use the same branch → PR → checks → squash merge → patch release flow.
No permanent `develop` or `release` branch is needed. Keep incomplete features off
`main` until ready, or behind a disabled feature flag.

If an older supported version needs a fix while `main` has incompatible changes,
branch from that version's tag, forward-port the fix to `main`, and explicitly
extend the release gate to the reviewed maintenance branch before publishing it.
The current publisher intentionally accepts only tested commits from `main`.
