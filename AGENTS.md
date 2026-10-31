# PDF Toolkit development

Use Node 24 LTS and npm ci. Keep all PDF processing in the browser; never add document uploads or telemetry. Preserve the existing design and English/Norwegian translation parity.

Run npm run typecheck, npm run lint, npm run format:check, npm run test:run and npm run build. Browser tests use npm run test:e2e after npx playwright install chromium. Keep PDF.js and its bundled worker at exactly the same version. Use targeted tests while developing and a full regression before review.

Docker listens on 8080 as UID 101. Verify with scripts/test-container.sh. Release workflows must never publish on ordinary branch pushes; beta cannot write latest. Never dispatch workflows or create official releases without explicit user approval.
