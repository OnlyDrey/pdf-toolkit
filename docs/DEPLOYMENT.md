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

Open **Actions → Publish a release → Run workflow** and enter just:

1. **`channel`**: `beta` or `production`.
2. **`version`**: a base semantic version, such as `1.2.0`.

There is no commit input, beta sequence field, manual Git tag step or confirmation checkbox. The workflow is manual-only; development pushes and version-tag pushes do not start publishing. Configuring this workflow is not authorization for Codex to run it.

### Beta example

Choose `channel: beta`, `version: 1.2.0`. At preparation time, the workflow resolves the current HEAD of **`work`** and records that exact SHA. It reads all existing Git tags for that base, finds the highest `v1.2.0-beta.N`, and reserves the next number, starting at 1. If the highest is `beta.4`, the new release is `v1.2.0-beta.5` and its Docker version is `1.2.0-beta.5`.

The workflow branch selector chooses the release-policy code only: selecting `main` in that UI still builds `work` for Beta. After CI, both-platform build/scans and the beta Environment approval, publication updates the versioned image and moving **`beta`** tag. Beta never writes `latest`.

### Production example

Choose `channel: production`, `version: 1.2.0`. The application source is always the current HEAD of **`main`**, even if the workflow UI selector is `work`. The workflow reserves **`v1.2.0`**, validates the recorded SHA, and builds/scans its image. A human must approve the protected **production** Environment before any GHCR publication or GitHub Release creation.

Production publishes **`1.2.0`** and **`latest`**, with a stable GitHub Release. It never modifies `beta`. An existing stable tag or versioned release is rejected rather than reused or overwritten.

### Pipeline and immutable artifacts

1. Validate the two inputs, resolve channel HEAD once and verify Environment protection settings.
2. Calculate the version and atomically create an annotated Git tag. Its message records source SHA, version and workflow-run URL. Global `release-promotion` concurrency serializes release runs; atomic ref creation also prevents collisions with other tag writers. A beta collision refreshes tags and retries a bounded number of times; it never forces an existing ref.
3. Check out the resolved SHA and run the existing reusable CI with `require_full_validation: true`. Dependabot cost controls cannot skip a release check.
4. Check the branch HEAD/reservation again, then build one AMD64/ARM64 OCI archive using the existing Dockerfile and CI build cache, including OCI source/version labels, SBOM and provenance. No registry image is pushed at this stage.
5. Verify both architecture configs and metadata, then scan each exact platform separately for HIGH/CRITICAL vulnerabilities. Preserve the complete original archive and checksum only after both scans pass.
6. Wait for protected Environment approval. Both existing beta and production reviewer gates remain enabled; Production approval is mandatory.
7. Download and verify the same archive against the checksum recorded in the trusted build-job output (not merely a checksum file from the artifact), plus source/version labels and the expected multi-platform digest. Immediately before upload and again before moving channel aliases, require the selected source branch HEAD and annotated reservation to remain exactly unchanged. If either changed, stop; do not silently select or build a newer commit.
8. Use Skopeo with `--all --preserve-digests` to copy those scanned bytes to GHCR without rebuilding or converting the manifests. Verify the remote digest, then set only the selected moving channel alias and a unique `sha-<source>-<run>-<attempt>` build reference.
9. Create the versioned GitHub Release. Notes and attached JSON metadata record the exact source SHA, version, image digest and run. The final run summary reports success/failure for preparation, CI, build/scans and publication.

Existing registry images are never guessed to be equivalent merely because their tag contains a SHA. Reuse comes from the validated artifact within the run and Buildx cache; the publication job does not rebuild the image. GHCR version/build tags must be absent before upload. Only moving channel aliases intentionally change. Digests, rather than technically mutable registry tags, are the reproducible deployment identity.

### Failures and reserved numbers

Reserved tags are retained even if CI, scanning, approval or publication fails. Beta numbers can therefore have gaps. Subsequent runs allocate a higher beta number. A failed Production reservation also consumes its stable version; do not delete/move the tag to hide a failure. Inspect the run and choose a new version, or explicitly authorize recovery of a failed job within the same run when its artifacts are still valid. Existing versioned releases/images are never overwritten during recovery.

Plan artifacts are retained for 90 days and scanned image archives for seven days; annotated tags preserve the source/run trace after artifact expiry. A source-branch advance during validation or approval deliberately aborts publication. Retry as a new release with the current branch HEAD and a new version reservation. Partial uploads may leave a version image without a moving alias or GitHub Release: the summary/logs make that failure visible, and it requires explicit review rather than silent reuse.

### Required repository settings and permissions

A repository administrator must:

- Make this manual workflow available on the **default branch** before GitHub shows **Run workflow**. Codex updates only `work`; a maintainer performs any review/merge to `main` separately.
- Protect `main` with human review and require CI **`ready`**; see [dependency maintenance](DEPENDENCIES.md). Restrict release-policy changes and dispatch rights to trusted maintainers.
- Protect `v*` tag updates/deletion while allowing the repository's GitHub Actions integration to create new version tags. Reservation uses `GITHUB_TOKEN`, so creating the tag does not recursively trigger other push workflows. It never writes an application branch.
- Configure **beta** and **production** Environments with required human reviewers, **Prevent self-review** enabled, and **administrator bypass disabled**. Missing settings or inaccessible protection metadata fail closed. A GitHub plan supporting these protections is required.
- Allow only trusted workflow-policy refs (typically `work` and `main`) in each Environment's deployment rules. These rules apply to the **workflow dispatch ref**, not the automatically resolved app source. Do not restrict production to the `main` workflow ref if operators should be able to select trusted `work` policy while releasing `main` app HEAD. Source enforcement is independent and handled by the release plan/rechecks.
- Permit the Environment-gated publication job to write the repository-linked GHCR package. Restrict other image writers; make the package public for anonymous pulls or use pull-only deployment credentials. Do not enable automatic merge or unattended publishing.

Global permissions are `contents: read`. Preparation additionally has `contents: write` only to reserve the annotated version tag, plus `actions: read` for Environment checks; it has no GHCR write permission. CI has read-only repository access; build/scanning also has `actions: read` for the protection recheck, and has no package write permission. Only the approved publication job has `packages: write`, `contents: write` for the GitHub Release, and `actions: read` for protection rechecks. It authenticates with `GITHUB_TOKEN`, not a broad PAT. Artifact Actions use their scoped runtime credentials. The publication runner installs maintained Ubuntu Skopeo to upload OCI archives without a rebuild.

Valid input is a base `X.Y.Z` with no leading zeroes, `v`, prerelease suffix, whitespace or build metadata. Beta numbering is read from Git tags with pagination and integer-safe arithmetic, including failed reservations. Production uses exactly the base version.

Deploy and roll back using the root Compose file and a reviewed version/digest as described above. No source checkout or rebuild is needed on deployment hosts. Workflow dispatch and image/release publication require a separate explicit user authorization; this implementation task performs neither. See [AGENTS.md](../AGENTS.md).

## Privacy and PDF limitations

Documents are processed in browser memory, with no upload API or telemetry. Only theme and language preferences persist locally. Refreshing or closing the page loses working files. Offline use requires the page and assets to remain available; no service-worker installation is provided.

Inputs are limited to 100 MiB per document or combined merge input. Memory use can be several times the source size, and pdf-lib mutations may pause the UI. Thumbnail grids share one PDF.js document/worker per file; only the active tool renders previews, with at most 12 Extract thumbnails and bounded canvas height.

Malformed, empty, unsupported and encrypted PDFs report errors. Decrypt a copy locally first. Complex forms, annotations, unusual fonts and signatures need manual reader checks; modifications can invalidate digital signatures. Structural compression does not reduce image quality and may yield little improvement. It reports the actual candidate size and retains the original bytes when the rewrite is not smaller.

Crop changes the visible crop box in unrotated PDF coordinates; hidden content stays in the file. **Crop is not redaction.** Version Fix changes only the header's three version characters, checks the document and catalog version, and blocks downgrades. It does not convert features or establish reader compatibility or PDF/A conformance.

## Builds without GitHub Actions

Use the [cross-platform local release guide](LOCAL_RELEASE.md) for Python 3.11+, PowerShell 5.1/Bash commands, frontend ZIPs, optional Docker/OCI archives, offline version allocation and manual deployment/rollback. No GitHub authentication is needed for local builds or packaging. Local production confirmation does not publish anything.

The protected release workflow reuses this engine for version calculation and checksummed frontend packaging. The frontend bundle is attached after Environment approval alongside source/image metadata; the OCI image continues through both architecture scans and is published without a rebuild. Local optional publication uploads assets only to an existing approved GitHub Release and never creates tags or pushes images.
