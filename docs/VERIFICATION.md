# Verification and remaining manual checks

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
