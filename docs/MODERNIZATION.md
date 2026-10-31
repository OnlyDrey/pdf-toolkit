# Dependency modernization — 2026-10-31

## Audit and decisions

Baseline: `db96bd8054d1edec5380b0438a4e2cdd91641a15` on `work`. The worktree was clean and origin verified before changes. The initial remote `main` SHA is `a7993ee16e6269d2c3acfed12b1cc70c5c4f1f69`; Codex never modifies it.

Registry metadata and `npm outdated` identify only these outdated direct dependencies. All other runtime/development dependencies are already at the stable registry version. Exact pins and Node 24 LTS remain intentional.

| Dependency     | Installed | Stable candidate | Decision                                                                                          |
| -------------- | --------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| autoprefixer   | 10.5.0    | 10.6.2           | Compatible update; remove if Tailwind's Vite integration makes it redundant.                      |
| tailwindcss    | 3.4.19    | 4.3.3            | Migrate with the matching Vite plugin; preserve tokens and v3 visual defaults.                    |
| tailwind-merge | 2.6.1     | 3.7.0            | Upgrade together with Tailwind 4; verify class conflict resolution.                               |
| typescript     | 6.0.3     | 7.0.2            | Defer: stable typescript-eslint 8.72.1 requires TypeScript >=4.8.4 and <6.1.0. Never force peers. |
| @types/node    | 24.19.2   | 26.6.6           | Keep newest published 24.x typings, aligned with the Node 24 baseline.                            |

Baseline `npm audit --json` reports zero vulnerabilities. Preserve the reviewed minimatch 11.0.1 override unless the dependency graph establishes it is unnecessary. No advisory is hidden or suppressed. Refresh compatible transitive ranges only through npm's peer-aware resolver, without `--force` or `--legacy-peer-deps`.

## Existing failed checks

Read-only GitHub job-log inspection establishes:

- Run [41224226480](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41224226480), Tailwind 4: types, lint and unit tests passed; frontend and Docker builds failed because Tailwind 4 is no longer a direct PostCSS plugin. This is a real integration failure requiring migration.
- Run [41224202377](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41224202377), TypeScript 7: npm failed with ERESOLVE against typescript-eslint's `<6.1.0` peer requirement. Retain TypeScript 6 without bypassing validation.
- Runs [41242054461](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41242054461), [41226280567](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41226280567) and [41226173917](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41226173917): code validation passed. Container checks were intentionally skipped for unapproved Dependabot changes; `ready` correctly refused approval. These await maintainer validation and are not product or quota failures.

No reviewed log shows a quota/billing failure. Do not weaken `ready`, add approval labels or rerun Actions to make checks green. Validate locally and preserve human review gates. Historical run conclusions are not rewritten.

## Docker and Actions review

The stable Nginx channel and 1.30 tag both resolve to the existing 1.30.6-alpine-slim multi-platform digest. Dependabot PR #15 proposes 1.31.8 (mainline), so do not accept the group wholesale as a stable-channel refresh. Evaluate Node 24.22.1 separately and retain stable non-root Nginx.

Review individual Action releases' inputs/runtime before updating immutable SHA pins. Stable candidates: checkout 7.0.1, setup-node 7.1.0, setup-python 7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2, setup-qemu 4.4.0, setup-buildx 4.4.1, build-push 7.4.0, login 4.7.0 and trivy-action 0.36.0. Node 24 action runtimes replace deprecated Node 20 wrappers; the application stays on Node 24. Preserve artifact archive semantics, exact-source checkout, permissions, scans and protected beta/production approval.

## Dependabot PR inventory

Open Dependabot PRs target `main`: [#8](https://github.com/OnlyDrey/pdf-toolkit/pull/8) (Autoprefixer), [#6](https://github.com/OnlyDrey/pdf-toolkit/pull/6) (Trivy Action) and [#15](https://github.com/OnlyDrey/pdf-toolkit/pull/15) (Node/Nginx group). Final supersession recommendations follow local validation. Nothing is merged or closed automatically. Updating `work` does not put these changes on `main`.

## Compatible update validation

Autoprefixer 10.6.2 installs without peer overrides; `npm ls --all`, the production TypeScript/Vite build and npm audit pass. The lockfile changes only Autoprefixer's entry/root pin and its metadata. No other direct package has a compatible newer stable release, and the transitive audit found no newer compatible installed ranges requiring a separate refresh. The audit still reports zero vulnerabilities.

## Tailwind 4 migration

Tailwind CSS 4.3.3 uses its matching `@tailwindcss/vite` 4.3.3 plugin; tailwind-merge is 3.7.0. The CSS-first `@theme` configuration preserves all existing semantic HSL tokens, radius values and class-based dark mode. The compatible tailwindcss-animate 1.0.7 plugin remains. Redundant Tailwind 3 and PostCSS configuration files, direct PostCSS and Autoprefixer are removed; Vite/Tailwind's maintained CSS toolchain provides processing and prefixing. Transitive PostCSS remains patched through Vite.

The migration maps small shadows to `shadow-xs` and focus outlines to `outline-hidden`, preserves the existing green status palette and button cursors, and explicitly retains v3 sibling spacing. Visual comparison caught the changed v4 spacing semantics before completion. Three new class-conflict regression tests cover the tailwind-merge migration. Production build, lint, formatting, the peer tree, 40 unit tests and audit pass locally.

TypeScript 7 remains deferred until the stable lint toolchain supports it. Node 26 typings are intentionally excluded. The Tailwind 4 browser baseline is modern Chrome 111+, Safari 16.4+ and Firefox 128+; older browsers are not claimed as supported. Chromium screenshots do not establish Safari/Firefox rendering parity. Application logic, English/Norwegian translations, PDF.js and its matching worker are unchanged.

Visual regression: 72 before/after Chromium states are pixel-identical on this Linux host: desktop/mobile, light/dark, English/Norwegian, empty upload, all seven tools with a shared PDF and open paper-size menus. Captures disable transitions/animations and normalize popup scroll position; PDF rendering is allowed to settle. The initial spacing difference was fixed, and screenshot-induced viewport/focus differences were removed from the harness. This is same-host visual parity, not a claim of identical cross-browser rendering or archive bytes.
