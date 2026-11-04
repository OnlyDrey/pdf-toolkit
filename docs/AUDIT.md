# Current architecture audit

PDF Toolkit is a static React/Vite application. pdf-lib changes documents in browser memory; PDF.js and its locally bundled worker render previews. Nginx serves static assets and health responses only. No endpoint accepts documents, and there is no telemetry or persistent document store.

The grouped sidebar and mobile drawer derive from one tool registry. A shared transactional document session owns working bytes, revision, page identities, selection and bounded Undo/Redo. Tools retain their controls across navigation and commit successful results through that session. The document panel owns preview, page actions and download/save/discard behavior.

Image processing uses a worker when supported, byte-preserving JPEG embedding and streamed PNG processing. Preview data is independent of export resolution. PDF thumbnails are lazy/virtualized; render queues, cached surfaces and resource leases are bounded. Exceptionally large rasters can retain a small preview while conversion/editing keeps source pixels. PDF operations can still allocate substantial memory or occupy the UI thread; there is no unlimited-size or zero-copy guarantee.

The toolchain uses React 19, Vite 8, Tailwind 4 with its Vite plugin, tailwind-merge 3, Vitest 5 and PDF.js 6. TypeScript 6 remains the supported compiler because current typescript-eslint excludes TypeScript 7. Dependency decisions, runtime/image versions and security results are maintained in [modernization](MODERNIZATION.md) and [verification](VERIFICATION.md), rather than duplicated historical snapshots.

Production deployment uses root `compose.yaml` with a published GHCR image. Local Docker builds, application code, tests and the Python release engine live under `app/`. Manual releases pin the selected channel's source SHA, reserve a version, validate/build/scan, then apply the required channel authorization before publication. Beta requires manual initiation without an Environment; Production requires its configured protected or explicit owner-operated approval model. Repository protection settings remain an administrator responsibility.

See [workspace architecture](WORKSPACE.md), [accessibility](ACCESSIBILITY.md), [deployment and release policy](DEPLOYMENT.md), and [local release commands](LOCAL_RELEASE.md). Crop/page removal are not secure redaction, header changes do not convert PDF features, and document mutations may invalidate signatures.
