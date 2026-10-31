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

Autoprefixer 10.6.2 installs without peer overrides; `npm ls --all`, the production TypeScript/Vite build and npm audit pass. The lockfile changes only Autoprefixer's entry/root pin and its metadata. No other direct package has a compatible newer stable release, and the broad-peer suggestions for Node typings, TypeScript and jiti are evaluated with their toolchains. The Tailwind migration below replaces the older jiti loader. The audit still reports zero vulnerabilities.

## Tailwind 4 migration

Tailwind CSS 4.3.3 uses its matching `@tailwindcss/vite` 4.3.3 plugin; tailwind-merge is 3.7.0. The CSS-first `@theme` configuration preserves all existing semantic HSL tokens, radius values and class-based dark mode. The compatible tailwindcss-animate 1.0.7 plugin remains. Redundant Tailwind 3 and PostCSS configuration files, direct PostCSS and Autoprefixer are removed; Vite/Tailwind's maintained CSS toolchain provides processing and prefixing. Transitive PostCSS remains patched through Vite.

The migration maps small shadows to `shadow-xs` and focus outlines to `outline-hidden`, preserves the existing green status palette and button cursors, and explicitly retains v3 sibling spacing. Visual comparison caught the changed v4 spacing semantics before completion. Three new class-conflict regression tests cover the tailwind-merge migration. Production build, lint, formatting, the peer tree, 40 unit tests and audit pass locally.

TypeScript 7 remains deferred until the stable lint toolchain supports it. Node 26 typings are intentionally excluded. The Tailwind 4 browser baseline is modern Chrome 111+, Safari 16.4+ and Firefox 128+; older browsers are not claimed as supported. Chromium screenshots do not establish Safari/Firefox rendering parity. Application logic, English/Norwegian translations, PDF.js and its matching worker are unchanged.

Visual regression: 72 before/after Chromium states are pixel-identical on this Linux host: desktop/mobile, light/dark, English/Norwegian, empty upload, all seven tools with a shared PDF and open paper-size menus. Captures disable transitions/animations and normalize popup scroll position; PDF rendering is allowed to settle. The initial spacing difference was fixed, and screenshot-induced viewport/focus differences were removed from the harness. This is same-host visual parity, not a claim of identical cross-browser rendering or archive bytes.

## Docker and Actions modernization

The Node builder is updated to `24.22.1-alpine3.23` at the verified multi-platform index digest `sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2`. Nginx stays at current stable `1.30.6-alpine-slim` and its existing digest. Both base indexes advertise AMD64 and ARM64. Dependabot now leaves Nginx minor/channel changes for deliberate review rather than treating mainline 1.31 as a stable refresh; patch/security updates remain visible under the existing policy.

All Action candidates were checked against their release notes and exact-commit `action.yml`/`action.yaml` inputs. Every supplied workflow input matches the pinned upstream schema. Current Actions run on Node 24 (Trivy is composite); the reviewed hosted-runner logs show runner 2.338.2, above the Node 24 minimum 2.327.1. These are deliberate wrapper major migrations and do not change the application's Node major.

| Action                     | Updated stable version |
| -------------------------- | ---------------------- |
| actions/checkout           | v7.0.1                 |
| actions/setup-node         | v7.1.0                 |
| actions/setup-python       | v7.1.0                 |
| actions/upload-artifact    | v7.0.2                 |
| actions/download-artifact  | v8.0.2                 |
| docker/setup-qemu-action   | v4.4.0                 |
| docker/setup-buildx-action | v4.4.1                 |
| docker/build-push-action   | v7.4.0                 |
| docker/login-action        | v4.7.0                 |
| aquasecurity/trivy-action  | v0.36.0                |

Upload steps explicitly preserve zipped artifact transport (`archive: true`); downloads explicitly preserve extraction of that transport (`skip-decompress: false`). Named artifact paths and trusted SHA256 verification remain intact. Release Node setup disables automatic package-manager cache discovery; CI's explicit npm cache stays. Login retains normal Docker credentials for Skopeo rather than switching to Buildx-only scope. Checkout keeps credentials disabled and never opts into unsafe privileged PR checkout. The manual form, source pinning/rechecks, atomic reservations, full CI, both scans, approval Environments, permissions and moving-tag separation are unchanged. Trivy 0.76.1 is explicitly selected in CI and releases, avoiding a scanner downgrade to the updated wrapper's older default.

Docker/local parity checks also identified Tailwind's automatic discovery of different build-context files. Explicit CSS source directives now retain the original `src/` and `index.html` scope, independent of Docker's ignored scripts/tests. This preserves consistent generated application CSS.

Targeted workflow validation passes actionlint, 38 release-policy tests and 32 engine tests (one Windows-only skip). No workflow is dispatched. Upstream Action updates include dependency/security fixes and safer metadata-log handling; no application npm advisory existed at baseline, so none is claimed as newly remediated. Existing security overrides and scan severity gates remain intact.

The final scoped frontend still matches all 72 baseline screenshots pixel-for-pixel. Native AMD64 multi-stage Docker build, startup/health, UID 101, read-only assets, security headers, SPA fallback and worker MIME checks pass. Docker and local Vite emit the same CSS asset hash. Trivy's official GHCR database reports zero HIGH/CRITICAL runtime findings. An intermediate rebuild exhausted the managed filesystem; pruning unused BuildKit cache allowed the final build to complete. No dependency/scan gate was bypassed. ARM64 base manifests are verified; ARM64 runtime and real hosted Actions execution remain external checks.

## Final complete regression

The shared Python engine's `all` action passed on the clean Docker/Actions phase commit `53c0c52fc9488e1009c5667f7fb0759f8ba65f44`. It ran TypeScript checks, ESLint, Prettier, 40 application unit tests, 38 release-policy tests, 32 engine tests (one Windows-only test skipped), the production build, all 10 desktop/mobile browser cases against the actual read-only Nginx container and a fresh online npm audit (zero vulnerabilities). No redundant dependency installation or Actions run was needed.

The local beta package records full validation as `passed`, its exact clean source SHA, tool/platform metadata and a remotely checked version. Independent verification passed for both frontend/release ZIPs, the manifest, payload checksums and transport ZIP sidecar. Offline version allocation/failure behavior remains covered by engine tests. Packages are local files, not published Git tags/images/releases.

Container checks and both Compose definitions pass. Trivy reports zero HIGH/CRITICAL findings in the final runtime image. Local/container CSS SHA256 is identical: `cdb6f3c2ed4be3b2bc2a132dcff2247dbe74110450a443e2d2a5e4b2520ff541`. The final scoped CSS matches all 72 pre-migration screenshots pixel-for-pixel. actionlint and local YAML/permission/source/approval contracts pass; all Action pins were verified against upstream commits and input manifests. Local documentation links resolve.

Remaining validation boundaries: this host does not execute Windows PowerShell 5.1 or ARM64 containers. Their launchers, lockfile platform entries, CI matrix and multi-platform manifests are preserved, but native Windows/ARM64 runs are not claimed. Hosted Action runtime/artifact integration and protected release publication require separately authorized external runs. No Actions minutes are consumed here. The existing large Vite chunk warning remains; no unrelated bundle/UI redesign was introduced.

## Dependabot cleanup recommendations

No PR is merged, closed, retargeted, approved or labeled by this task. All three remaining open PRs target `main`, which does not receive this work automatically. Review/promote the completed `work` changes through the normal human process before closing useful update coverage on `main`.

| Open PR                                                                            | Relationship to this work                                                                                        | Recommendation after accepting the modernization                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#8 — Autoprefixer 10.6.2](https://github.com/OnlyDrey/pdf-toolkit/pull/8)         | Compatible update was validated, then the direct dependency became redundant with Tailwind 4's Vite integration. | Safe to close as obsolete once the migration is accepted; there is no remaining Autoprefixer pin to update.                                                                                                                |
| [#6 — Trivy Action 0.36.0](https://github.com/OnlyDrey/pdf-toolkit/pull/6)         | Its exact version/commit is incorporated in both workflows, with scanner version explicitly preserved.           | Safe to close as superseded once the workflow changes are accepted.                                                                                                                                                        |
| [#15 — grouped Node/Nginx images](https://github.com/OnlyDrey/pdf-toolkit/pull/15) | Node 24.22.1 is incorporated; Nginx 1.31.8 is intentionally declined because it changes stable to mainline.      | Do not merge the group wholesale. Close/replace it once the reviewed Node update and stable-line policy are accepted; it is only partially superseded by version, and its remaining Nginx change is deliberately rejected. |

Previously closed, unmerged PRs #12/#13 (Tailwind/merge) and #3/#5/#7/#9 (Actions) are covered by the tested migration/current pins. Keep #11 (TypeScript 7), #10 (Node 26 typings), #2 (Node 26 image) and #4 (mainline Nginx) deferred for the documented compatibility/channel reasons. No closed PR is reopened. Historical failed checks remain historical: Tailwind's integration failure is fixed locally, the unsupported TypeScript update is excluded, and unapproved Dependabot `ready` failures remain intentional until a maintainer requests full validation.

Every implementation phase is committed with `[skip ci]` and pushed exclusively to `origin/work` before the next phase. No manual dispatch, Git tag, registry push, GitHub Release, PR creation/closure/merge or repository approval/settings change occurs. Native Windows/ARM64 and hosted Actions verification still require separate authorization/capable environments.

Completed phase commits before these final recommendations:

- `f7819fa49260f740e3e5bbbf870329e1833a89da` — Document dependency compatibility and failed-check audit [skip ci]
- `5026ca345965948797bb515559a6b83cc937ecd4` — Update compatible Autoprefixer dependency and lockfile [skip ci]
- `ed7d702d2be2c692966086b7c489f458254c81d4` — Migrate Tailwind 4 and class merging with verified visual parity [skip ci]
- `53c0c52fc9488e1009c5667f7fb0759f8ba65f44` — Modernize Docker and Action pins while preserving release controls [skip ci]
- `cf322d13555b576655904607d0e7aa4051cf66bb` — Record complete modernization regression and platform limits [skip ci]
