# PDF Toolkit

Simple PDF tools in English and Norwegian Bokmål, processed entirely in your browser.

## Features

Merge, extract, rotate, resize, crop, structurally compress and inspect PDF version headers. Apply changes to a shared working file, switch tools and download when finished. Light, dark and system themes are included.

## Privacy-first architecture

React and PDF.js run locally in the browser; Nginx serves static assets. Documents are never uploaded and there is no telemetry. Working files stay in memory and are lost when the page closes or refreshes. Crop hides content rather than redacting it, and header edits allow higher/lower values but do not convert PDF features. See the [limitations](docs/DEPLOYMENT.md#privacy-and-pdf-limitations).

## Docker Quick Start

Download [compose.yaml](compose.yaml) onto your deployment host—no source checkout or build is needed—then run:

```sh
docker compose pull
docker compose up -d
```

Open [localhost:8080](http://localhost:8080). The default image is `ghcr.io/onlydrey/pdf-toolkit:latest`. Select beta with `PDF_TOOLKIT_TAG=latest-beta`, or pin a version with `PDF_TOOLKIT_TAG=1.2.0-beta.3` (also supported in `.env`). After changing the tag or upgrading a moving channel, run `docker compose pull` before `docker compose up -d`. Images support AMD64 and ARM64, non-root execution, healthchecks and a read-only filesystem. See [deployment, upgrades and rollback](docs/DEPLOYMENT.md).

## Development

Use Node 24 LTS:

```sh
cd app
npm ci
npm run dev
```

Checks: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run` and `npm run build`. Install Chromium with `npx playwright install --with-deps chromium`, then run `npm run test:e2e`.

Python 3.11+ provides the same local build/release commands on Windows PowerShell 5.1 and Linux Bash. See the [local build and packaging guide](docs/LOCAL_RELEASE.md) for prerequisites and examples.

For a local container build, run `docker compose -f app/compose.local.yaml up --build` from the repository root. Development and Git rules are in [AGENTS.md](AGENTS.md).

## Documentation

- [Cross-platform local builds and release packaging](docs/LOCAL_RELEASE.md)
- [Deployment and manual release guide](docs/DEPLOYMENT.md)
- [Dependency maintenance and CI cost](docs/DEPENDENCIES.md)
- [Verification and remaining manual checks](docs/VERIFICATION.md)
- [Modernization audit](docs/AUDIT.md)

## License

[MIT](LICENSE).
