# Modernization audit

The application is a static React/Vite SPA. pdf-lib performs document mutations in browser memory; PDF.js uses a bundled, same-version worker for previews. Nginx only serves static assets. There is no upload API or telemetry.

The initial repository had no lint/typecheck scripts, CI, browser tests, ignore files or release workflow. Its root Nginx image, floating base tag, immediate merge download, unvalidated header rewrite, hidden compression growth and uncancelled preview loading were modernization targets. Existing tests covered utility functions and paper sizes, not user workflows.

Dependencies are locked to stable versions. React 19, Vite 8, Vitest 5 and PDF.js 6 replace legacy major versions. TypeScript 6 is retained because typescript-eslint currently requires <6.1; TypeScript 7 is incompatible. Tailwind 3 and tailwind-merge 2 remain a compatible pair to preserve the design without a CSS rewrite. Unused progress/tooltip primitives and dependencies were removed. PostCSS is patched; minimatch 11.0.1 is overridden for the tooling-only denial-of-service advisory, with lint/build verification.

Large documents still require browser memory proportional to document size. pdf-lib mutations execute on the UI thread; a Web Worker rewrite is outside this modernization. Previews are bounded and only active tools render. Digital signatures may be invalidated by mutation. Crop hides content; it is not redaction. Header edits do not convert PDF features or establish conformance.

Release governance requires repository configuration: protect main and version tags, configure beta/production environments with required reviewers, and restrict production to stable tags. Workflow files cannot install repository protection rules themselves.
