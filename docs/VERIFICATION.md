# Verification and execution limits

## Maintenance preparation — 2026-11-04

Baseline: `361cd69c40fdf057f294f318025f771300e92203`, the source of [failed run 41778248924](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41778248924). Logs were read without rerunning Actions. Source validation, Docker/smoke/Trivy and both hosted engine platforms passed; browser contrast failed (57 passed, one failed, two flaky). Release readiness correctly blocked publication. The reporting job wrote a summary, then deliberately returned failure for skipped publication.

- `064b771`: atomic themes, stronger muted text, non-interpolating navigation/selection states, explicit palette/font synchronization, rendered-frame contrast regression and informational release reporting. Types/lint/format/build, 68 policy tests and 12 targeted Nginx browser cases passed, including three repeats per device of the previously flaky image accessibility case with retries disabled.
- `310768d`: compatible package/transitive updates, Node 24.22.2/Alpine 3.24, refreshed stable Nginx digest, removal of unused Tabs, and matching Tailwind plugin major-update policy. Types/lint/format, 91 unit tests, Linux engine tests, production build and eight targeted Nginx cases passed. `npm ls --all` reports no peer-tree errors; npm audit reports zero vulnerabilities. actionlint 1.7.12 validates both workflows.

The final complete regression runs after documentation is committed. Its results are recorded here after execution; targeted results above do not claim that final gate has already passed.

## Reproducing the final gate

From the repository root, install using `npm ci --prefix app`. Build `docker build -t pdf-toolkit:verify app`, run `app/scripts/test-container.sh`, and validate `docker compose config --quiet`. A managed proxy may require the public CA BuildKit secret described in [deployment](DEPLOYMENT.md).

Serve that production image locally with the normal UID/read-only/tmpfs/capability constraints. Set `TEST_BASE_URL` to its local HTTP URL, then run `app/scripts/release.sh all --channel beta --version 1.1.0 --offline --non-interactive --output-dir /tmp/pdf-toolkit-verification`. This runs typecheck, lint, formatting, unit/policy/Python tests, production build, desktop/mobile browser regression and package/manifest/ZIP/checksum verification. The offline package version is provisional, creates no Git tag and must not be treated as a published release. Run `npm audit --prefix app --audit-level=high` separately for a fresh online audit.

Use Trivy 0.76.1 against the final runtime image with `--scanners vuln --severity HIGH,CRITICAL --exit-code 1`. Keep TLS verification enabled; a restricted environment may use the official GHCR vulnerability database repository. Validate workflows with actionlint and check local Markdown paths/anchors. No hosted Actions are needed for these checks.

## Boundaries

This host has Linux AMD64 Docker and system Chromium. It cannot establish native Windows PowerShell 5.1 or ARM64 execution. Four Windows-specific Python checks are skipped locally; the failed hosted run's Windows checks passed for its older pinned source, not this maintenance revision. Docker manifests retain both release architectures. Hosted approval/publication is not tested by dispatching a release.

Axe/keyboard/reflow checks cover English/Norwegian, light/dark, mobile/desktop, 320/640 CSS pixels and 200% root text size. They are not manual screen-reader, browser-chrome 400% zoom, every-browser or WCAG certification claims. Large-raster previews have deliberate fallbacks; cache/history limits are not peak-heap guarantees. The existing Vite large-chunk advisory remains. See [workspace limits](WORKSPACE.md) and [accessibility](ACCESSIBILITY.md).
