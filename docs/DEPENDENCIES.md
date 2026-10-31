# Dependency maintenance and CI cost

Dependabot checks npm, Docker and GitHub Actions monthly. Routine minor/patch updates are grouped by runtime, tooling, images and Actions. Open version-update PR limits are three for npm and two each for Docker and Actions. This limits churn without disabling validation. No workflow or configuration enables auto-merge.

Routine major updates to React, PDF libraries, TypeScript, Vite/Vitest, Tailwind, ESLint, Playwright, container base images and Actions are excluded from automatic updates. Review these migrations deliberately in a normal development change, with compatibility checks and the full validation suite. Groups represent compatible version ranges, not proof that dependencies work together; CI must still pass.

## Security visibility

Keep Dependabot alerts and Dependabot security updates enabled in repository settings. They are separate from the monthly routine schedule. Groups apply only to version updates; security update PRs remain individual and visible. GitHub applies a separate security-PR limit, so the configured version-update caps do not suppress urgent security PRs. All security PRs receive code tests and the npm vulnerability audit immediately.

Ignore rules can also prevent a security PR when the only available fix requires an excluded major version. The advisory remains an actionable alert: a maintainer must review it promptly and implement a deliberate major upgrade or another supported remediation. Do not treat the monthly schedule or a missing bot PR as permission to defer security triage.

## Lowest-cost safe validation

The previous CI ran the Docker build, scan, browser installation and desktop/mobile tests on every Dependabot synchronization, alongside npm validation. The selected approach keeps the smaller code job automatic: install, types, lint, formatting, unit/release-policy tests, production build and dependency audit.

For a Dependabot-authored PR, the container/browser job waits for a maintainer to apply the `dependencies:validate` label after reviewing the diff. The `labeled` event starts normal validation for that approval. Label events also run the smaller code/readiness checks; concurrency cancels redundant runs on the same ref. The aggregate check is never skipped, since a skipped required check can otherwise count as success. Subsequent changes to an approved PR rerun all checks. Other PR authors and branch pushes retain full validation. Release callers explicitly force the full suite on their pinned source SHA, so bot/label cost controls cannot skip a release gate.

The aggregate `ready` check fails until both code and container/browser jobs succeed. Administrators must require **`ready`** in branch protection and require maintainer review. Requiring only a skipped container check is unsafe because GitHub can consider skipped checks successful. No `pull_request_target`, write-enabled PR token, automatic label approval or automatic merge is used. The small aggregate job adds a short runner invocation but avoids repeatedly building containers before a bot update has been reviewed.

Maintainer procedure:

1. Review the dependency diff, compatibility and relevant security alerts.
2. Create `dependencies:validate` once in repository labels, then apply it to the PR when ready for the full checks.
3. Wait for `ready` to pass on the latest commit. Resolve failures rather than bypassing checks.
4. Merge only through the repository's normal human review policy. Codex does not modify or merge `main`.

An alternative is to run all checks on every bot update; it offers immediate feedback but uses more minutes. Skipping all bot CI, adding `[skip ci]` to bot PRs, or trusting a skipped Docker check would cost less but removes useful safeguards and is not recommended.

This task changes configuration and runs local checks only. It does not dispatch Actions, apply approval labels, change repository settings or consume Actions minutes.
