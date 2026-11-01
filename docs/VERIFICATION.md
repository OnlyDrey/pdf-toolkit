# Verification and remaining manual checks

## VersionFix, branding, accessibility and beta channel — 2026-11-01

The final code at `f84e097` passed the complete shared-engine regression locally with Node 24/Python 3.12 and system Chromium, targeting the freshly built hardened Nginx image. No Actions were dispatched and no images, tags or releases were published. The subsequent documentation commit records these results.

| Check                                     | Result                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, ESLint, Prettier              | Passed                                                                                                                                                                            |
| Unit tests                                | 45 passed                                                                                                                                                                         |
| Release-policy and mocked CLI integration | 67 passed; source pinning, reservations, permissions/approval and channel isolation retained                                                                                      |
| Python engine                             | 44 passed, 4 Windows-only cases skipped (48 total)                                                                                                                                |
| Browser workflows and accessibility       | 24 passed on desktop/Pixel 7; includes 56 tool/theme/language axe combinations and 10 additional state scans                                                                      |
| Production build                          | Passed; existing large-bundle advisory remains                                                                                                                                    |
| Fresh Docker multi-stage build            | Passed, native AMD64                                                                                                                                                              |
| Hardened container                        | Healthy as UID/GID 101, read-only filesystem, security headers, SPA routes, PDF worker MIME and five branding assets passed                                                       |
| npm audit                                 | Zero vulnerabilities                                                                                                                                                              |
| Trivy runtime image                       | Zero HIGH/CRITICAL findings; official GHCR database, no suppression                                                                                                               |
| Workflow/reference checks                 | actionlint passed all workflows; local documentation links and Bash syntax passed                                                                                                 |
| Compose selection                         | Default/empty tag, latest-beta, stable/beta version pins, persistent .env, full-image override precedence, invalid reference rejection and preserved service settings passed      |
| Local packaging                           | Complete provisional offline `9.9.2-beta.2`; manifest, inner artifact checksums, outer SHA256 sidecar, frontend/outer ZIP integrity and immutable packaged Compose default passed |
| Cleanup                                   | Engine tests passed; real launcher dry-run planned owned generated artifacts without deletion                                                                                     |

Packaging records clean source `f84e097c82aad74794ac25e095157c32d2df52e6` and `passed-offline`; the dependency audit was run separately online. This is a local validation artifact, not a reserved public version. Its outer ZIP SHA256 is `0cdcad4944c9d90e489e5ae2187a9c330ea0bcd32771189d959ef8deb7d4964b`. The failed earlier local attempt remains traceable and the allocator advanced the local beta number.

The initial container regression correctly failed its two favicon cases because public files inherited private host permissions. Generated directories/files are now normalized to 0755/0644 in the builder, keeping root ownership and non-root execution. A new image build, targeted Nginx branding checks and the entire regression passed after the correction; no test or release gate was bypassed.

Captured 72 before/after visual matrix states: desktop/mobile, both themes, both languages, empty state, every tool and the Resize menu. Representative captures were manually inspected for navigation, VersionFix, drop zones, toolbar/destructive hierarchy, Crop previews and menu layout. Four further production-container captures cover confirmation and keyboard focus. Expected differences are stronger boundaries/text, distinct inset tab focus with bottom-only selection, wrapping header/toolbar/actions at narrow widths, compact VersionFix details and a restrained readable Discard action. The navbar glyph preserves the original Lucide paths/proportions. No visual baselines were silently replaced and no unexplained differences remain in the inspected captures.

Remaining limits: no actual Windows/PowerShell 5.1 run or ARM64 runtime verification was available. Reflow is tested at 320/640 CSS pixels and 200% root text size; real browser-chrome 200%/400% zoom, assistive technology and cross-browser/OS testing still need manual review. PDF previews are visual summaries. Header rewriting is not genuine compatibility conversion and can invalidate signatures; the reviewed conversion-engine options remain deferred. Automated axe success is not WCAG certification. External GHCR publication, GitHub approval behavior and multi-platform release builds remain intentionally unexecuted; existing production Environment/owner settings in the deployment guide still apply. Beta needs no Environment or new repository setting for latest-beta.

| Phase                                     | Commit    |
| ----------------------------------------- | --------- |
| Audit and plan                            | `e0dc138` |
| Bidirectional header-only VersionFix      | `4d08e45` |
| Canonical logo and favicon assets         | `e4e21e1` |
| Shared keyboard/focus/forms/feedback      | `ce3dcc2` |
| Axe coverage and follow-up remediation    | `506d130` |
| latest-beta and Compose channel selection | `75330be` |
| Nginx asset permissions                   | `f84e097` |

All phase commits contain `[skip ci]` and were pushed only to origin/work. Remote main remained `8066d72965f06af3466bf2fbf13f60d31106a7ed`, matching the starting ref.

## Earlier baseline

Validation was performed locally on 2026-10-31 with Node 24 and system Chromium. GitHub Actions was not manually dispatched and no release/image was published by this work.

- TypeScript, ESLint and Prettier checks pass.
- The 37 unit tests exercise PDF validation, encrypted input rejection, complete header matching, fixed-width byte edits, downgrade/catalog-version checks, serialized rotation/resize/crop geometry, translation-key parity, page ranges and paper sizes.
- The 10 Playwright cases (five workflows on each device profile) cover desktop and Pixel 7 layouts, real downloads and PDF re-parsing, merge/extract/rotate/resize/crop sessions, invalid/encrypted files, compression retention, version limitations, repeated operations, invalid range feedback, theme/language switching and keyboard file selection.
- Browser tests target the real read-only Nginx container with its production CSP. They exposed and verified a fix for `.mjs` worker MIME types, which Vite preview alone did not catch. The bundled PDF.js worker is requested locally and previews render successfully.
- Docker checks include startup, `/healthz`, non-root UID/GID, read-only static assets, SPA routing, Nginx configuration, module-worker MIME and HTTP security/cache headers.
- npm audit reports zero vulnerabilities after patched PostCSS and a tooling-only minimatch override.
- Trivy 0.76.1 scans the runtime image using its official GHCR database source. The initial old-registry Nginx base failed with inherited HIGH/CRITICAL OS-library findings. The current stable `nginx/nginx-unprivileged:1.30.6-alpine-slim` base replaces it, has 21 OS packages rather than 70, and passes the HIGH/CRITICAL gate. No advisory is suppressed.
- actionlint 1.7.12 validates workflow syntax and expressions. Action commits and base-image manifest digests are pinned.

## External and manual validation

GitHub CI, GHCR publishing, release creation, approval protection behavior, SBOM/provenance upload and multi-platform release builds require actual external runs. They are configured but not claimed as executed locally. Base-image manifests contain both amd64 and arm64; native amd64 container startup is verified, arm64 runtime remains a manual deployment check.

Configure protected branches/version tags and required reviewers on beta/production environments before any release. The workflow checks for configured reviewers before publishing. Approve a real beta tag, inspect both architecture scan results and attestations, deploy by digest on amd64 and arm64 hosts, then approve a stable tag on the same commit to verify artifact reuse. Never use an unpromoted SHA candidate merely because it exists.

Manually validate representative large/scanned PDFs, complex forms, annotations, signatures, unusual fonts, rotated or nonzero-origin page boxes, and reader-specific behavior in Chromium, Firefox and Safari. Browser operations are memory-bound and pdf-lib mutations may block the UI. Previews are bounded, but this is not a complete worker-based processing rewrite. Crop does not redact; header edits do not establish PDF feature compatibility. Preview font/advanced rendering behavior depends on browser and PDF.js support. Production builds still report a large JavaScript bundle warning; the existing SPA architecture is retained.

The environment blocks Playwright's browser-download host, so local browser tests use installed system Chromium. CI installs Playwright's matching Chromium through its standard setup command. The default Trivy DB mirror is blocked locally; the official allowed GHCR source was used instead. Docker's inherited outbound proxy is explicitly bypassed only for localhost health probes.

## Structure cleanup regression

The repository-only refactor moved application code and build assets into `app/`, renamed production deployment to root `compose.yaml`, and updated CI, release, cache, Dependabot and documentation paths. Application sources, tests, scripts, lockfile and build configurations were checked against the pre-refactor commit: 53 files are byte-identical. Dependency versions and PDF/UI behavior did not change.

TypeScript, ESLint, Prettier, 37 unit tests, the production build, actionlint, workflow-path/tag-only publication assertions, local documentation links, and stable/beta/version/digest Compose configuration checks passed. All 10 desktop/mobile Playwright cases passed through the root production Compose definition. Container checks passed for startup, health, UID 101, read-only assets, security headers, SPA routing and worker MIME types.

A fresh build with `docker build -t pdf-toolkit:structure app` was attempted but blocked while fetching the unchanged pinned Node base: Docker Hub registry and authentication endpoints returned HTTP 503. A retry also failed. To finish runtime validation without changing the production Dockerfile or dependency versions, a temporary local image used the retained, previously validated runtime image plus freshly compiled relocated assets and Nginx configuration. This verifies the runtime and deployment paths; it does not establish a successful fresh multi-stage build. Retry the full command when Docker Hub recovers. ARM64 runtime and external CI remain unverified by this cleanup.

Existing dependencies were reused without another installation. No workflow was manually dispatched and no image, package, release or PR was published. The cleanup commit contains `[skip ci]`; only `origin/work` is updated, and `main` is left untouched. See [AGENTS.md](../AGENTS.md) for persistent Git rules.

## Earlier manual release controls and dependency optimization (superseded UX)

Local validation of the manual-release change passed 27 release-policy tests, the existing 37 unit tests and 10 desktop/mobile browser cases, TypeScript, ESLint, Prettier, production build and actionlint. Browser regression for this workflow-only change used Vite preview; production Docker assets and application behavior were not modified.

YAML/contract checks verified exact-SHA forwarding to both reusable CI jobs and image builds, forced full release validation, Environment-gated write permissions, two-platform build/scan configuration, tag reservation after scans, pinned Actions references and local documentation links. The actual CI condition was checked against normal PRs, unapproved/approved Dependabot PRs and forced release validation. The aggregate `ready` job always evaluates both job results, so a skipped Docker/browser job cannot itself establish merge readiness.

Release-policy tests use local GitHub API fixtures for branch ancestry, annotated tags, version collisions, denied API access and absent/bypassable approval configuration. They do not establish that repository Environments, tag rules, GHCR permissions or the default-branch dispatch UI are already configured. Administrators must configure those settings and require `ready` before relying on the gates. No workflow was dispatched, no approval label was applied, no dependency PR was merged, and no image/package/release was published. No GitHub Actions minutes were consumed by this task; publication remains untested until a separately authorized run.

## Simplified two-input release workflow

The current manual form has only channel and base version. Release policy tests use local GitHub API fixtures to verify that Beta resolves work HEAD and Production resolves main HEAD regardless of the workflow selector, that beta numbering includes all tag pages and uses exact integer arithmetic, and that concurrency conflicts never overwrite a version. They cover stale source HEADs, reserved-tag changes, existing stable tags/releases, and missing or bypassable Environment protection.

The release archive is built/scanned before Environment approval and is uploaded unchanged afterward. Tests verify both required OCI platforms, source/version labels, preserved multi-platform digest and rejection of unrelated or tampered images. Offline Trivy smoke checks with synthetic empty OCI images confirmed that the generated single-platform layouts select amd64 and arm64 separately; this is a scan-input compatibility check, not a scan of a real newly published application image.

Local validation passed 38 release-policy tests, the existing 37 application unit tests, 10 desktop/mobile browser tests, type/lint/format checks, the production build, actionlint, YAML/permissions/source/concurrency/artifact-order contracts and documentation links. Browser regression used Vite preview. Application dependencies, Docker assets and the reusable CI workflow are unchanged.

No Actions workflow, actual release reservation, image upload or GitHub Release creation was executed. The default-branch UI, GitHub Environment approvals, tag rules, real multi-platform archive export, Skopeo/GHCR digest preservation and release metadata upload still require a separately authorized end-to-end run. Administrators must promote the workflow to the default branch, allow unique tag creation, configure both protected Environments for trusted workflow refs independently of application sources, and grant the publication token repository-linked package access. Artifact retention and source-HEAD stability apply as documented in the deployment guide. No GitHub Actions minutes were consumed by this task.

## Cross-platform local build and release system

The shared Python 3.11+ engine passes 32 standard-library tests, with the Windows-only case skipped on Linux. They cover version allocation, offline operation, production confirmation, argument/exit-code forwarding, source/plan mismatches, atomic local slots, collision preservation, build reuse/source drift, safe cleanup, ZIP/checksum integrity, Docker platform selection, OCI graph/digest validation, failure traceability and authorized asset-upload constraints. The existing 38 release-policy tests also pass using the Python version calculator. No application dependencies, UI, localization or PDF processing behavior changed.

Real frontend packaging produced an intact ZIP, pinned deployment Compose, release notes, manifest, payload checksums and outer ZIP checksum. The existing production multi-stage Dockerfile successfully built on AMD64; the engine verified UID 101, revision/version labels, read-only container startup, healthcheck and served frontend. This supersedes the earlier Docker Hub outage limitation for a native build. Root and local Compose configuration, actionlint and local documentation links are checked separately.

The final complete regression uses the engine's `all` action: TypeScript, ESLint, Prettier, 37 application unit tests, 38 release-policy tests, engine tests, production Vite build, 10 browser cases and release packaging. Offline execution explicitly records `passed-offline` and skips a fresh network audit. Existing Chromium/dependencies are reused. A separate final online `npm audit --audit-level=high` reports zero vulnerabilities.

This Linux host cannot execute Windows PowerShell 5.1. CI now includes Ubuntu/Windows engine tests and a real classic PowerShell invocation, but those jobs have not been dispatched. The active local Buildx builder advertises only AMD64 and rejects ARM64 requests. It also reports that its classic Docker driver cannot export Docker archives; archive integrity/platform behavior is exercised with local fixtures. OCI/multi-platform export needs a capable builder and remains an external validation requirement. Production image/new-release publication still requires the documented protected Environments and explicit authorization; optional local publication only uploads verified assets to an already approved release.

All implementation phase commits contain `[skip ci]` and update only `origin/work`. No Actions run, Git tag, image push, release publication or pull request is created by this task.

## Dependency modernization regression

See the [modernization report](MODERNIZATION.md) for package/Action/base-image versions, TypeScript 7 deferral, Dependabot failure diagnoses and validation evidence. The final local regression passes 40 unit tests, 38 policy tests, 32 engine tests (one Windows-only skip), 10 browser cases through hardened production Nginx, production build, formatting/types/lint, online dependency audit and release packaging/checksums. All 72 captured desktop/mobile/theme/language/tool visual states match before/after. Docker builds and health checks pass; local/container CSS hashes match and Trivy finds zero HIGH/CRITICAL runtime vulnerabilities. Native Windows/ARM64 and hosted release publication remain external checks.

## Channel-specific approval policy — 2026-11-01

The Beta Environment 404 fix replaces the earlier requirement for protected Environments on both channels. Beta never queries or attaches an Environment. Production defaults to configured required reviewers; an explicitly enabled owner-operated mode requires owner initiation and a separate post-scan rerun confirmation. Existing reviewer/deployment rules stay enforced, and ambiguous 404/listing/authorization failures never become fallback approval. See the [current release guide](DEPLOYMENT.md#owner-operated-production-approval).

Local validation passes 67 release-policy/integration tests, including the actual CLI with a fake GitHub transport, Environment absence/access cases, owner identities and build-attempt history, immutable-plan tampering and 1,536 publication-gate status combinations. The complete regression also passes TypeScript, ESLint, formatting, 40 application unit tests, 32 engine tests (one Windows-only skip), the production build, 10 desktop/mobile browser cases and local packaging/ZIP/manifest/SHA256 checks. actionlint validates YAML/expressions; documentation links are checked locally. Offline execution explicitly skips the network dependency audit. No dependencies, Docker assets, UI or translation behavior changed.

No workflow is dispatched, no approval/settings are changed and no image, Git tag or release is published during implementation. Live GitHub Environment enforcement and owner-confirmation rerun/artifact integration require a separately authorized external run; local tests do not claim those were executed. Failed runs using older policy must not be resumed as though their policy changed.

## Windows path-validation hotfix — 2026-11-01

Read-only inspection of [beta run #2](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41282501433) confirms 24 Windows engine errors and one PowerShell forwarding-test failure. The launcher correctly returned the engine's exit code 5; the shared cause was `guarded_path()` comparing an absolute path's spelling with its resolved spelling and labeling any difference a symlink/junction. Windows canonicalization can expand the legitimate 8.3 ancestor `RUNNER~1`. A name change alone does not prove a reparse point, and the old guard did not inspect metadata.

The fix canonicalizes selected roots once, explicitly checks symlink/reparse metadata (compatible with Python 3.11), uses canonical containment and checks entries before tree traversal. Selected roots may have inherited parent aliases; linked root leaves and generated descendants remain rejected. Cleanup stays inside the approved application/output directories, preserves tracked/unknown files and revalidates after confirmation. Fingerprints normalize directory inputs too, so short and long spellings do not produce incompatible relative paths. The PowerShell/Bash launchers remain thin and unchanged.

Linux validation passes 44 of 48 engine tests; four Windows-only cases are skipped. New coverage includes ordinary temporary directories/spaces, simulated canonical alias expansion, Windows reparse metadata, real Linux symlinks, inherited parent aliases, traversal/sibling-prefix rejection, external-output cleanup boundaries, root/target substitution and tracked-file preservation. Native Windows cases cover `GetShortPathNameW`, actual junctions (including descendants and inherited parents), bounded cleanup and PowerShell 5.1 forwarding of spaced source/output arguments. Junctions use unprivileged creation; symlink/8.3 capability skips are explicit. This Linux host has no native Windows runner or PowerShell 5.1, so Windows success is **not** claimed.

The complete local regression passes typechecking, ESLint, formatting, 40 application unit tests, 67 release-policy/CLI integration tests, the engine suite, production build, 10 desktop/mobile browser cases and frontend/release packaging with independent ZIP/manifest/SHA256 verification. An actual Bash/CLI cleanup in an isolated fixture with spaced paths and an inherited parent alias removes only generated/owned artifacts and preserves outside/unknown files. Offline mode skips the dependency network audit. actionlint and CI contract checks confirm the Ubuntu/Windows matrix and required release readiness gate are unchanged; no failing check is bypassed.

The reservation `v0.0.2-beta.1` remains at annotated object `240483fff407164537792a1efaf880c0edb4029f`, pointing to `01567d6eb8a8f6c93085b14e1a16644a2ac49045`. At inspection time the next available beta is `v0.0.2-beta.2`. Follow the [recovery instructions](DEPLOYMENT.md#recovery-from-the-windows-validation-failure-run-2): a separately authorized new dispatch using the fixed `work` policy and unchanged base `0.0.2`, with automatic numbering and all validation/scanning gates intact. No tag deletion/reuse, workflow dispatch or publication is performed by this hotfix.
