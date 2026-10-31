# PDF Toolkit

Private PDF tools with English and Norwegian Bokmål localization. PDF documents stay in your browser; Nginx serves static files and never receives documents. No telemetry or document uploads.

Merge, extract, rotate, resize, crop, structurally compress, and inspect/edit PDF version headers. Apply operations to an in-memory working file, switch tools, then Download or Save & Download. Each tool can also accept its own input. Refreshing or closing the page loses the session; theme and language preferences alone persist locally.

## Development

Use Node 24 LTS and npm:

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm run format:check
npm run test:run
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

The stack is React 19, TypeScript 6, Vite 8, pdf-lib, PDF.js 6, Tailwind 3 and Nginx. TypeScript 6 and Tailwind 3 remain compatible with the linting and existing design. PDF.js uses a local, matching bundled worker. In environments with system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Browser tests cover desktop and mobile; `TEST_BASE_URL` can target a running production container instead of Vite preview.

## Deploy

```sh
# Use the supplied deployment Compose file, or copy its definition onto the host.
docker compose pull
docker compose up -d
```

Default image: `ghcr.io/onlydrey/pdf-toolkit:latest`; beta: `ghcr.io/onlydrey/pdf-toolkit:beta`. Prefer a reviewed version or immutable digest in production. Open [localhost:8080](http://localhost:8080); health endpoint: `/healthz`. Containers run as UID 101 with a read-only filesystem and writable `/tmp`.

For local builds, use `docker compose -f docker-compose.yml -f compose.local.yml up --build`. See [deployment and release instructions](docs/DEPLOYMENT.md) for registry-only installation, approval setup, upgrade, rollback and supported platforms.

## Limitations and privacy

- PDF manipulation runs locally in JavaScript. No server-side processing, uploads, analytics, or remote PDF worker is used. A normal initial page load requests static assets; document processing does not upload anything. Offline operation requires the page and assets to remain available; no service-worker offline installation is provided.
- Inputs are limited to 100 MiB per document or combined merge input. Memory use can be several times the source size, and large operations may pause the UI. Thumbnail grids share one PDF.js document/worker per file. Only the active tool adopts session changes or renders previews; Extract shows at most 12 previews and preview canvas height is bounded.
- Malformed, empty, unsupported and encrypted PDFs report errors. Decrypt a copy locally first. Test important documents with your normal reader; complex forms, annotations, signatures, unusual fonts, and advanced PDF features need manual validation. Changes may invalidate digital signatures.
- Compression rewrites object streams without reducing image quality. It may provide little benefit. The actual candidate size/change is shown; if the result is not smaller, the original bytes remain the working file.
- Crop changes the visible crop box. Hidden content remains in the file: **crop is not redaction**. Margins use unrotated PDF coordinates, in points.
- Version Fix edits only the three header version characters. It does not convert PDF features, remove encryption, or establish PDF/A/conformance. It validates a complete header and document, considers catalog `/Version`, and blocks downgrades. Raising a header is not proof of compatibility with any reader.

CI validates types, lint, formatting, tests, production build, dependency advisories, browser workflows, container startup and container vulnerabilities. Release publication happens only through approved version tags. Stable tags update `latest`; prereleases update `beta` exclusively. Both target amd64 and arm64, with SBOM and provenance. See [audit notes](docs/AUDIT.md) and [verification results](docs/VERIFICATION.md) for evidence and remaining checks.

MIT — see [LICENSE](LICENSE).
