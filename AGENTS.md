# PDF Toolkit development

## Mandatory Git rules

- Work exclusively on the existing `work` branch. Verify the current branch, worktree and remote before modifying files.
- The repository is `OnlyDrey/pdf-toolkit`; `origin` must be `https://github.com/OnlyDrey/pdf-toolkit.git` (or its equivalent SSH URL).
- Push changes only to `origin/work`, using an explicit refspec such as `git push origin HEAD:refs/heads/work`.
- Never modify, push, merge or rebase `main`. Reading its ref for release validation is permitted.
- Every new commit message MUST contain `[skip ci]`.
- No unattended image/package publishing or workflow dispatch. Manually dispatch workflows or publish GitHub releases only when the user explicitly authorizes that specific action; implementing release controls is not authorization to run them. Never create pull requests automatically.
- Preserve existing commits and user changes. Do not force-push. Commit and push each completed independent phase before beginning the next.

## Layout and commands

Keep application code, tests, scripts, Docker assets and build configuration directly under `app/`, preserving the existing `src/`, `tests/` and `scripts/` organization. `.github/` contains repository automation, `docs/` contains guides, and root `compose.yaml` deploys published GHCR images without a build. Root `.gitignore` is the necessary exception to the minimal root layout: it excludes deployment `.env` files and generated artifacts.

Use Node 24 LTS. From the repository root, run `cd app`, `npm ci`, then `npm run dev`. Run targeted checks during implementation and one complete regression at the end: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run test:release`, `npm run build` and `npm run test:e2e`. Formatting commands also cover repository documentation, Compose and workflows using the configuration in `app/`. Install Chromium with `npx playwright install --with-deps chromium` when needed; an existing system browser can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Use Python 3.11+ for the shared standard-library release engine in `app/scripts/release.py`; keep Bash and Windows PowerShell 5.1 launchers thin. Run `python -m unittest discover -s app/scripts -p test_release.py` alongside the full regression. Local `all` runs validation, production build and packaging; Docker remains optional. Local operations never create or push Git tags. Publishing requires separate explicit user authorization; the optional asset uploader only targets an existing approved release and must preserve scan/validation requirements. See [local releases](docs/LOCAL_RELEASE.md).

From the root, validate `docker compose config --quiet`, build with `docker build -t pdf-toolkit:verify app`, then run `app/scripts/test-container.sh`. Local build/deployment uses `docker compose -f app/compose.local.yaml up --build`. Test browser workflows against the actual hardened Nginx container when Docker assets change. Check workflow paths and documentation links after moves.

## Application and release constraints

Keep all PDF processing in the browser; never add uploads or telemetry. Preserve the design and English/Norwegian translation parity. Keep PDF.js and its bundled worker at exactly the same version.

Docker listens on 8080 as UID 101 and supports a read-only root filesystem with writable `/tmp`. Preserve multi-platform build support and security hardening. Ordinary branch pushes must never publish images. The manual release form has only `channel` and base `version`. Beta resolves current `work` HEAD and Production resolves current `main` HEAD independently of the dispatch branch selector. Atomically reserve a unique version tag, validate/build the pinned SHA, scan both platforms, then require protected Environment approval before publishing the same archive. Abort if the source HEAD or reservation changes. Keep self-review and admin bypass disabled, beta away from latest, and production away from beta. Failed reservations remain traceable and must never be overwritten. Read-only checks of `main` are allowed; Codex must never modify it. Do not change dependency versions or application behavior during repository-only cleanup.

## Dependency maintenance

Dependabot checks routine updates monthly, groups compatible updates, and limits open version-update PRs. Security updates stay separate and security alerts must stay enabled. Do not enable auto-merge or add `[skip ci]` to Dependabot-generated PRs to save minutes. Codex development commits still require `[skip ci]`.

Dependabot PRs run code validation automatically. Before merging one, a maintainer reviews it and applies `dependencies:validate` to enable container/browser checks; require the aggregate `ready` check in branch protection. Release callers force all checks regardless of bot/label optimizations. Critical major upgrades and major-only security fixes require deliberate maintenance and full validation. See [dependency maintenance](docs/DEPENDENCIES.md).
