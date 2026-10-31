# PDF Toolkit development

## Mandatory Git rules

- Work exclusively on the existing `work` branch. Verify the current branch, worktree and remote before modifying files.
- The repository is `OnlyDrey/pdf-toolkit`; `origin` must be `https://github.com/OnlyDrey/pdf-toolkit.git` (or its equivalent SSH URL).
- Push changes only to `origin/work`, using an explicit refspec such as `git push origin HEAD:refs/heads/work`.
- Never modify, push, merge or rebase `main`. Reading its ref for release validation is permitted.
- Every new commit message MUST contain `[skip ci]`.
- Do not manually trigger GitHub Actions, publish images/packages/releases, or create pull requests automatically.
- Preserve existing commits and user changes. Do not force-push.

## Layout and commands

Keep application code, tests, scripts, Docker assets and build configuration directly under `app/`, preserving the existing `src/`, `tests/` and `scripts/` organization. `.github/` contains repository automation, `docs/` contains guides, and root `compose.yaml` deploys published GHCR images without a build. Root `.gitignore` is the necessary exception to the minimal root layout: it excludes deployment `.env` files and generated artifacts.

Use Node 24 LTS. From the repository root, run `cd app`, `npm ci`, then `npm run dev`. Run targeted checks during implementation and one complete regression at the end: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build` and `npm run test:e2e`. Formatting commands also cover repository documentation, Compose and workflows using the configuration in `app/`. Install Chromium with `npx playwright install --with-deps chromium` when needed; an existing system browser can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

From the root, validate `docker compose config --quiet`, build with `docker build -t pdf-toolkit:verify app`, then run `app/scripts/test-container.sh`. Local build/deployment uses `docker compose -f app/compose.local.yaml up --build`. Test browser workflows against the actual hardened Nginx container when Docker assets change. Check workflow paths and documentation links after moves.

## Application and release constraints

Keep all PDF processing in the browser; never add uploads or telemetry. Preserve the design and English/Norwegian translation parity. Keep PDF.js and its bundled worker at exactly the same version.

Docker listens on 8080 as UID 101 and supports a read-only root filesystem with writable `/tmp`. Preserve multi-platform build support and security hardening. Ordinary branch pushes must never publish images. Release workflows accept approved version tags only, require validation and human environment reviewers, and must keep beta from updating latest. Do not change dependency versions or application behavior during repository-only cleanup.
