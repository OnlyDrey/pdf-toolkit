# Dependency modernization — 2026-11-04

## Scope and source

This maintenance starts at `361cd69c40fdf057f294f318025f771300e92203` on `work`. npm registry `latest` metadata, upstream GitHub releases, Node's official release index and Docker Registry manifest/config responses were checked on 2026-11-04. Dependencies remain exactly pinned with a regenerated npm lockfile. No forced or legacy peer resolution is used.

## Compatible updates

| Dependency                       | Before  | Updated |
| -------------------------------- | ------- | ------- |
| i18next                          | 26.5.12 | 26.7.1  |
| i18next-browser-languagedetector | 8.2.4   | 8.3.0   |
| lucide-react                     | 1.66.0  | 1.67.0  |
| pdfjs-dist                       | 6.4.299 | 6.5.438 |
| react-i18next                    | 17.1.9  | 17.1.12 |
| tailwindcss / @tailwindcss/vite  | 4.3.3   | 4.3.4   |
| @vitejs/plugin-react             | 6.1.2   | 6.2.1   |
| vitest                           | 5.0.5   | 5.1.0   |
| minimatch override               | 11.0.1  | 11.0.4  |

Compatible transitive ranges were refreshed with npm's peer-aware resolver. The unused Radix Tabs wrapper/dependency was removed: workspace navigation uses grouped buttons rather than tabs. No replacement runtime dependency was introduced. PDF.js and its module worker resolve from the same installed package; worker assets are bundled locally.

The Node builder advances from **24.22.1 / Alpine 3.23** to **24.22.2 / Alpine 3.24**. The stable non-root Nginx image remains **1.30.6-alpine-slim**, with its refreshed multi-platform digest. Both selected manifests contain Linux AMD64 and ARM64. Exact digests are maintained in [Dockerfile](../app/Dockerfile). The builder installs and compiles in one snapshot after copying source, avoiding extra copies of installed modules on Docker’s `vfs` driver. Source changes rerun reproducible `npm ci`; a separate BuildKit npm cache reuses verified downloads. The runtime stage, non-root user, read-only support and secret-only CA handling are unchanged. Local execution still requires Node **24.13+ within 24.x LTS**, and the release engine uses Python **3.11+ standard library only**.

## Deliberately retained versions

- **TypeScript 6.0.3:** newest supported 6.x stable. TypeScript 7.0.2 is stable and was evaluated, but current `typescript-eslint` 8.72.1 declares `>=4.8.4 <6.1.0`. Its parser/compiler API integration does not support replacing the compiler with TypeScript 7's native implementation. Do not bypass peers or install a second compiler to disguise this incompatibility.
- **@types/node 24.19.2:** newest published 24.x typings. The registry's 26.6.6 targets a different Node major; Node 26 is outside the approved application baseline.
- **Nginx stable channel:** do not substitute the separate mainline channel merely because its minor number is higher.

Other direct packages are already at the checked stable registry version: React/React DOM 19.3.1, pdf-lib 1.17.1, Vite 8.3.5, Playwright 1.64.1, ESLint 10.14.0 and Prettier 3.9.10, among others. `npm outdated` now reports only the two intentional TypeScript/Node-typing major deferrals above.

## Actions, scanning and Dependabot

Existing immutable Action references already match upstream stable releases: checkout 7.0.1, setup-node 7.1.0, setup-python 7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2, setup-qemu 4.4.0, setup-buildx 4.4.1, build-push 7.4.0, login 4.7.0 and trivy-action 0.36.0. Trivy **0.76.1** is also current. They were preserved rather than repinned to floating tags. No workflow was dispatched to check them.

Dependabot remains monthly, grouping compatible updates and allowing three npm/two Docker/two Actions version PRs. Major Tailwind Vite-plugin updates now require the same deliberate review as Tailwind itself. Security update visibility, maintainer review, the aggregate `ready` gate and release callers' full validation remain mandatory; no automatic merge is enabled.

## CI stabilization

Read-only logs for [run 41778248924](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41778248924) confirm that source validation, Docker build/smoke tests, Trivy and Windows/Linux engine checks passed. Production-browser validation failed on transient low-contrast palettes; the two Images to PDF cases passed only on retry. This was a real accessibility/timing defect, not an Actions quota failure.

`064b771` makes palette changes atomic, removes selected-navigation/language color interpolation, strengthens muted text and adds rendered-frame contrast coverage. Axe assertions and thresholds remain unchanged. The Release result job previously wrote useful output and then deliberately exited 1 whenever publication was skipped. It now completes reporting normally, explicitly labels every stage, reports missing metadata as **Unavailable**, and says **Not published** when a prerequisite fails. Failed validation/preparation/publication jobs still fail the workflow; publication gates are unchanged.

Phase-specific checks passed before their commits: 68 release-policy tests and 12 targeted production-browser cases for stabilization; types/lint/format, 91 unit tests, engine tests, audit and eight targeted production-browser cases for upgrades. See [current verification](VERIFICATION.md) for the final complete regression and execution limits. No PRs, release reservations or packages were published by this maintenance.
