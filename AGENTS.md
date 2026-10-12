# Development workflow

- Develop on a short-lived `codex/<change>` branch from current `main`.
- Commit and push the branch, open a PR, inspect the final diff and wait for required
  GitHub checks before squash merging. Never push directly to `main` or bypass its rules.
- A fix or merge does not authorize a new public release or production deployment.
  Publish and deploy only when explicitly requested; follow `docs/RELEASING.md`.
- Run relevant verification from `docs/DEVELOPMENT.md`; preserve the pre-commit hook.
- Keep credentials, customer data, private deployment configuration and tracking
  records outside this public repository.
