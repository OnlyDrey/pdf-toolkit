# Verification and execution limits

## Maintenance preparation — 2026-11-04

Baseline: `361cd69c40fdf057f294f318025f771300e92203`, the source of [failed run 41778248924](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41778248924). Logs were read without rerunning Actions. Source validation, Docker/smoke/Trivy and both hosted engine platforms passed; browser contrast failed (57 passed, one failed, two flaky). Release readiness correctly blocked publication. The reporting job wrote a summary, then deliberately returned failure for skipped publication.

- `064b771`: atomic themes, stronger muted text, non-interpolating navigation/selection states, explicit palette/font synchronization, rendered-frame contrast regression and informational release reporting. Types/lint/format/build, 68 policy tests and 12 targeted Nginx browser cases passed, including three repeats per device of the previously flaky image accessibility case with retries disabled.
- `310768d`: compatible package/transitive updates, Node 24.22.2/Alpine 3.24, refreshed stable Nginx digest, removal of unused Tabs, and matching Tailwind plugin major-update policy. Types/lint/format, 91 unit tests, Linux engine tests, production build and eight targeted Nginx cases passed. `npm ls --all` reports no peer-tree errors; npm audit reports zero vulnerabilities. actionlint 1.7.12 validates both workflows.

## Final regression

The shared-engine `all --offline` gate completed successfully on clean source `ce5879d428b6229ab71c7130c001ae52fbab08ce`. Browser tests used the freshly built production Nginx container, not Vite preview. Its ten frontend files match the host build byte-for-byte.

| Check                             | Result                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reproducible installation         | `npm ci --prefer-offline` passed; 258 installed packages                                                         |
| TypeScript / ESLint / formatting  | Passed                                                                                                           |
| Application unit tests            | 91 passed                                                                                                        |
| Release-policy/integration tests  | 68 passed                                                                                                        |
| Python release-engine tests       | 48 checks: 44 passed, four Windows-specific skips                                                                |
| Desktop/mobile browser regression | 62 passed, no retries/flaky results                                                                              |
| Accessibility                     | Both languages/themes, live-frame navigation contrast, mobile/desktop and reflow checks passed                   |
| Production build                  | Passed; existing large-chunk advisory only                                                                       |
| Docker and container              | Fresh multi-stage AMD64 build, health, UID 101, read-only assets, CSP/security headers and worker loading passed |
| Compose                           | Root/local definitions and latest/latest-beta/version-pinned image selection passed                              |
| npm audit                         | Zero vulnerabilities across all reported severities                                                              |
| Trivy 0.76.1                      | Zero HIGH/CRITICAL runtime vulnerabilities; official GHCR DB updated 2026-11-04, no ignored findings             |
| Workflow/documentation validation | actionlint passed; 43 local links/anchors resolve                                                                |
| Offline packaging                 | Frontend/release ZIP integrity, manifest and independent SHA256 checks passed                                    |

The scanned image ID matches the tested container: `sha256:387421538545a50169b2608be7c63a177c05635f713dc93aaab5cb5c2b03009c`. Runtime OS is Alpine 3.24.3. Initial Docker builder snapshot preparation exhausted this host’s disk; unused build cache was pruned without deleting existing images. Combining install/build in one builder snapshot with an isolated npm cache resolved that local storage failure while retaining reproducibility and runtime hardening.

The local package records its exact clean source/input fingerprint and `passed-offline` validation. Its beta version is provisional and was never tagged or published. The separate online npm audit and exact-image Trivy scan above supplement, rather than relabel, the offline receipt.

A final reporting-only correction uses **Unavailable** for missing version/source/digest outputs; absent outputs must not imply that a partially prepared tag was never reserved. All 68 policy tests, lint and actionlint passed again after that correction. Application/dependency/container contents did not change, so broader browser/build results remain valid without another complete run. Failed release jobs and publication gates remain unchanged; the reporting job is informational.

No Actions run was dispatched/retried, no PR created, and no image/package/release published. Development commits all contain `[skip ci]` and were pushed only to `origin/work`.

## Reproducing the final gate

From the repository root, install using `npm ci --prefix app`. Build `docker build -t pdf-toolkit:verify app`, run `app/scripts/test-container.sh`, and validate `docker compose config --quiet`. A managed proxy may require the public CA BuildKit secret described in [deployment](DEPLOYMENT.md).

Serve that production image locally with the normal UID/read-only/tmpfs/capability constraints. Set `TEST_BASE_URL` to its local HTTP URL, then run `app/scripts/release.sh all --channel beta --version 1.1.0 --offline --non-interactive --output-dir /tmp/pdf-toolkit-verification`. This runs typecheck, lint, formatting, unit/policy/Python tests, production build, desktop/mobile browser regression and package/manifest/ZIP/checksum verification. The offline package version is provisional, creates no Git tag and must not be treated as a published release. Run `npm audit --prefix app --audit-level=high` separately for a fresh online audit.

Use Trivy 0.76.1 against the final runtime image with `--scanners vuln --severity HIGH,CRITICAL --exit-code 1`. Keep TLS verification enabled; a restricted environment may use the official GHCR vulnerability database repository. Validate workflows with actionlint and check local Markdown paths/anchors. No hosted Actions are needed for these checks.

## Boundaries

This host has Linux AMD64 Docker and system Chromium. It cannot establish native Windows PowerShell 5.1 or ARM64 execution. Four Windows-specific Python checks are skipped locally; the failed hosted run's Windows checks passed for its older pinned source, not this maintenance revision. Docker manifests retain both release architectures. Hosted approval/publication is not tested by dispatching a release.

Axe/keyboard/reflow checks cover English/Norwegian, light/dark, mobile/desktop, 320/640 CSS pixels and 200% root text size. They are not manual screen-reader, browser-chrome 400% zoom, every-browser or WCAG certification claims. Large-raster previews have deliberate fallbacks; cache/history limits are not peak-heap guarantees. The existing Vite large-chunk advisory remains. See [workspace limits](WORKSPACE.md) and [accessibility](ACCESSIBILITY.md).
