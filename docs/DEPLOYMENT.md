# Deployment and releases

## Run a published image

No checkout, Node or build is required on deployment hosts. Install Docker Engine and Compose, download [compose.yaml](../compose.yaml) into an empty deployment directory, then run:

```sh
docker compose pull
docker compose up -d
```

The default is the stable `latest` image. To deploy beta directly:

```sh
PDF_TOOLKIT_IMAGE=ghcr.io/onlydrey/pdf-toolkit:beta docker compose up -d --pull always
```

For beta, set `PDF_TOOLKIT_IMAGE=ghcr.io/onlydrey/pdf-toolkit:beta` in `.env`. For stable, prefer an explicit version such as `ghcr.io/onlydrey/pdf-toolkit:1.2.0`, or preferably `ghcr.io/onlydrey/pdf-toolkit@sha256:<digest>` from its release notes. These are examples, not a claim that those releases exist. Make the GHCR package public for anonymous pulls, or authenticate with a credential restricted to package reads.

Nginx listens on port 8080 as UID/GID 101 and requires only writable `/tmp`. `/healthz` returns `ok`. Put a TLS reverse proxy in front for Internet deployments; configure HSTS at that HTTPS edge. Hashed assets cache for one year; HTML revalidates. Responses carry CSP, frame protection, MIME protection, referrer and permissions policies. No endpoint accepts documents or processes PDFs.

Images target `linux/amd64` and `linux/arm64`. Local native-platform startup is checked separately from the release workflow's multi-platform build and scans. A successful local build does not establish arm64 runtime verification.

## Upgrade and rollback

Record the currently deployed digest before upgrading. Change `PDF_TOOLKIT_IMAGE` to the reviewed version/digest, run `docker compose pull`, then `docker compose up -d`. Check `docker compose ps` and `curl -f http://localhost:8080/healthz`, then open the application and a representative PDF. Reload open browser tabs after an upgrade. Keep the prior image until checks pass.

To roll back, restore the previous image digest and run the same pull/up commands. There is no server-side document database or migration. Browser memory sessions are lost on refresh, so download ongoing work before upgrading. Moving `latest` and `beta` tags are convenient but do not provide reproducibility; digests do.

## Local development and container verification

All application commands run inside `app/`. Use Node 24 LTS:

```sh
cd app
npm ci
npm run dev
```

Run `npm run build` there for static production assets. From the repository root, local container commands are:

```sh
docker compose -f app/compose.local.yaml up --build
docker build -t pdf-toolkit:verify app
app/scripts/test-container.sh
```

In a managed build environment that requires an extra CA, pass `--secret id=proxy_ca,src="$CODEX_PROXY_CERT"` to `docker build`. It is mounted only during dependency installation. Normal builds do not need this secret.

## Release governance

Before releasing, repository administrators must:

1. Protect `main` with required CI checks and reviewed pull requests.
2. Restrict creation, update and deletion of `v*` tags to release maintainers. Treat version tags and `sha-<full commit>` image tags as immutable. GHCR tags themselves are mutable; digest references provide the immutable identity.
3. Create `beta` and `production` environments with required human reviewers, prevent self-review, and restrict deployment refs to the appropriate tags. The workflow fails closed if it cannot find required reviewers. Branch/tag rules and protection configuration are administrator responsibilities.
4. Enable Actions package writes for this repository, with package permissions inherited from the repository. No broad PAT is needed for publication.

Development pushes and PRs validate only. They cannot publish production images. No workflow dispatch trigger exists. After explicit release approval, a maintainer creates and pushes an annotated tag on the intended validated commit:

- `v1.2.0-beta.1` → image `1.2.0-beta.1`, moving `beta`, GitHub prerelease.
- `v1.2.0` → image `1.2.0`, moving `latest`, stable GitHub Release. The commit must be reachable from `main`.
- `sha-<full commit>` → candidate multi-platform image used for repeatable promotion; never intentionally overwritten.

The tag workflow runs the complete CI workflow, waits for environment approval, builds a candidate only if no image exists for that commit, and scans both amd64 and arm64 by digest for HIGH/CRITICAL vulnerabilities. Failure blocks promotion. Candidate SHA tags can exist even when a scan fails; deploy only reviewed version tags or recorded passing digests. A failed candidate is not a release.

When stable and beta tags identify the same commit, stable promotion reuses the beta artifact and its SBOM/provenance without rebuilding. Its OCI `version` label retains the original build's prerelease version; stable is an alias of exactly those bytes. A new commit requires a new build. Version tags omit the leading `v` in GHCR. Beta's strict tag parser only selects `beta`, so it cannot write `latest`.

Buildx attaches SBOM and provenance where supported. OCI labels record repository, source revision, original build version and license. Release notes record the promoted digest. Builds/actions/base images are pinned and Dependabot proposes updates. CI runs dependency audits and native-image scanning; release scans apply again before promotion. Review all dependency/base-image update PRs and do not bypass a failed vulnerability gate.

Routine Codex work is restricted to `work`, with `[skip ci]` in every new commit and pushes exclusively to `origin/work`; see [AGENTS.md](../AGENTS.md). Do not manually dispatch Actions, create PRs automatically, or publish images, packages or releases as part of development tasks. No official release has been authorized by this cleanup request. Do not push release tags until the repository protections are configured and the release is explicitly approved. Publication, external CI and cross-platform runtime behavior must be verified by their actual runs.

## Privacy and PDF limitations

Documents are processed in browser memory, with no upload API or telemetry. Only theme and language preferences persist locally. Refreshing or closing the page loses working files. Offline use requires the page and assets to remain available; no service-worker installation is provided.

Inputs are limited to 100 MiB per document or combined merge input. Memory use can be several times the source size, and pdf-lib mutations may pause the UI. Thumbnail grids share one PDF.js document/worker per file; only the active tool renders previews, with at most 12 Extract thumbnails and bounded canvas height.

Malformed, empty, unsupported and encrypted PDFs report errors. Decrypt a copy locally first. Complex forms, annotations, unusual fonts and signatures need manual reader checks; modifications can invalidate digital signatures. Structural compression does not reduce image quality and may yield little improvement. It reports the actual candidate size and retains the original bytes when the rewrite is not smaller.

Crop changes the visible crop box in unrotated PDF coordinates; hidden content stays in the file. **Crop is not redaction.** Version Fix changes only the header's three version characters, checks the document and catalog version, and blocks downgrades. It does not convert features or establish reader compatibility or PDF/A conformance.
