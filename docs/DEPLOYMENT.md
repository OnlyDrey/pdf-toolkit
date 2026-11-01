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

The workflow branch selector chooses the release-policy code only: selecting `main` in that UI still builds `work` for Beta. Manual dispatch authorizes Beta: no beta Environment, reviewers or Environment API read is required. After full CI and both-platform build/scans, publication updates the versioned image and moving **`beta`** tag. Beta never writes `latest`.

### Production example

Choose `channel: production`, `version: 1.2.0`. The application source is always the current HEAD of **`main`**, even if the workflow UI selector is `work`. The workflow reserves **`v1.2.0`**, validates the recorded SHA, and builds/scans its image. By default, a human must approve the protected **production** Environment before any GHCR publication or GitHub Release creation. When required reviewers are unavailable, a repository owner can explicitly configure the two-stage owner-operated model below; there is no automatic downgrade.

Production publishes **`1.2.0`** and **`latest`**, with a stable GitHub Release. It never modifies `beta`. An existing stable tag or versioned release is rejected rather than reused or overwritten.

### Pipeline and immutable artifacts

1. Validate the two inputs, resolve channel HEAD once and record the channel approval policy (Production checks Environment settings).
2. Calculate the version and atomically create an annotated Git tag. Its message records source SHA, version and workflow-run URL. Global `release-promotion` concurrency serializes release runs; atomic ref creation also prevents collisions with other tag writers. A beta collision refreshes tags and retries a bounded number of times; it never forces an existing ref.
3. Check out the resolved SHA and run the existing reusable CI with `require_full_validation: true`. Dependabot cost controls cannot skip a release check.
4. Check the branch HEAD/reservation again, then build one AMD64/ARM64 OCI archive using the existing Dockerfile and CI build cache, including OCI source/version labels, SBOM and provenance. No registry image is pushed at this stage.
5. Verify both architecture configs and metadata, then scan each exact platform separately for HIGH/CRITICAL vulnerabilities. Preserve the complete original archive and checksum only after both scans pass.
6. Beta proceeds on dispatch authorization. Production completes any selected production Environment gate; owner mode additionally requires a separate owner confirmation after successful scans. Configured reviewer protection always wins over owner-mode preference.
7. Download and verify the same archive against the checksum recorded in the trusted build-job output (not merely a checksum file from the artifact), plus source/version labels and the expected multi-platform digest. Immediately before upload and again before moving channel aliases, require the selected source branch HEAD and annotated reservation to remain exactly unchanged. If either changed, stop; do not silently select or build a newer commit.
8. Use Skopeo with `--all --preserve-digests` to copy those scanned bytes to GHCR without rebuilding or converting the manifests. Verify the remote digest, then set only the selected moving channel alias and a unique `sha-<source>-<run>-<attempt>` build reference.
9. Create the versioned GitHub Release. Notes and attached JSON metadata record the exact source SHA, version, image digest and run. The final run summary reports success/failure for preparation, CI, build/scans and publication.

Existing registry images are never guessed to be equivalent merely because their tag contains a SHA. Reuse comes from the validated artifact within the run and Buildx cache; the publication job does not rebuild the image. GHCR version/build tags must be absent before upload. Only moving channel aliases intentionally change. Digests, rather than technically mutable registry tags, are the reproducible deployment identity.

### Failures and reserved numbers

Reserved tags are retained even if CI, scanning, approval or publication fails. Beta numbers can therefore have gaps. Subsequent runs allocate a higher beta number. A failed Production reservation also consumes its stable version; do not delete/move the tag to hide a failure. Inspect the run and choose a new version, or explicitly authorize recovery of a failed job within the same run when its artifacts are still valid. Existing versioned releases/images are never overwritten during recovery.

Plan artifacts are retained for 90 days and scanned image archives for seven days; annotated tags preserve the source/run trace after artifact expiry. A source-branch advance during validation or approval deliberately aborts publication. Retry as a new release with the current branch HEAD and a new version reservation. Partial uploads may leave a version image without a moving alias or GitHub Release: the summary/logs make that failure visible, and it requires explicit review rather than silent reuse.

### Recovery from the Windows validation failure (run #2)

The [0.0.2 beta run #2](https://github.com/OnlyDrey/pdf-toolkit/actions/runs/41282501433) reserved **`v0.0.2-beta.1`** before Windows validation failed. Its immutable annotated tag object is `240483fff407164537792a1efaf880c0edb4029f`, targeting source `01567d6eb8a8f6c93085b14e1a16644a2ac49045`. CI readiness correctly blocked building/scanning/publication; do not delete, move, reuse or overwrite this reservation.

After this hotfix is accepted and a release is explicitly authorized, start a **new** manual dispatch with workflow ref **work**, channel **beta** and base version **0.0.2**. With the currently observed tags, automatic allocation selects **`v0.0.2-beta.2`** (Docker version `0.0.2-beta.2`); a concurrent/newer reservation may advance that number. The new run resolves current work HEAD and must pass Windows and Linux engine tests, full CI and both architecture scans. Rerunning the old failed run retains its old policy/source and does not pick up the hotfix. Do not bypass `ready` or remove Windows tests to publish. This implementation does not dispatch or publish anything.

### Required repository settings and permissions

A repository administrator must:

- Make this manual workflow available on the **default branch** before GitHub shows **Run workflow**. Codex updates only `work`; a maintainer performs any review/merge to `main` separately.
- Protect `main` with human review and require CI **`ready`**; see [dependency maintenance](DEPENDENCIES.md). Restrict release-policy changes and dispatch rights to trusted maintainers.
- Protect `v*` tag updates/deletion while allowing the repository's GitHub Actions integration to create new version tags. Reservation uses `GITHUB_TOKEN`, so creating the tag does not recursively trigger other push workflows. It never writes an application branch.
- Beta requires no Environment. For Production, prefer a **production** Environment with required human reviewers, **Prevent self-review** enabled, and **administrator bypass disabled**. Leave repository variable `PRODUCTION_APPROVAL_MODE` unset (or `environment`). If required reviewers are unavailable, explicitly opt into `owner` as documented below. Unreadable settings/401/403 errors never enable fallback.
- Allow only trusted workflow-policy refs (typically `work` and `main`) in the production Environment's deployment rules. These rules apply to the **workflow dispatch ref**, not the automatically resolved app source. Do not restrict production to the `main` workflow ref if operators should be able to select trusted `work` policy while releasing `main` app HEAD. Source enforcement is independent and handled by the release plan/rechecks.
- Permit the publication job, after its required approval/confirmation checks, to write the repository-linked GHCR package. Restrict other image writers; make the package public for anonymous pulls or use pull-only deployment credentials. Do not enable automatic merge or unattended publishing.

Global permissions are `contents: read`. Preparation additionally has `contents: write` only to reserve the annotated version tag, plus `actions: read` for approval/run metadata checks; it has no GHCR write permission. CI has read-only repository access; build/scanning also has `actions: read` for the protection recheck, and has no package write permission. The production Environment gate is a separate job with no token permissions; publication requires its success whenever an Environment was selected. This preserves deployment rules without attaching an empty/nonexistent Environment to Beta. Only the authorized publication job has `packages: write`, `contents: write` for the GitHub Release, and `actions: read` for protection rechecks. It authenticates with `GITHUB_TOKEN`, not a broad PAT. Artifact Actions use their scoped runtime credentials. The publication runner installs maintained Ubuntu Skopeo to upload OCI archives without a rebuild.

Valid input is a base `X.Y.Z` with no leading zeroes, `v`, prerelease suffix, whitespace or build metadata. Beta numbering is read from Git tags with pagination and integer-safe arithmetic, including failed reservations. Production uses exactly the base version.

Deploy and roll back using the root Compose file and a reviewed version/digest as described above. No source checkout or rebuild is needed on deployment hosts. Workflow dispatch and image/release publication require a separate explicit user authorization; this implementation task performs neither. See [AGENTS.md](../AGENTS.md).

### Owner-operated Production approval

Use this only when protected required reviewers are unavailable and `OnlyDrey/pdf-toolkit` remains personally owned. A repository administrator must explicitly set **Settings → Secrets and variables → Actions → Variables → `PRODUCTION_APPROVAL_MODE` = `owner`**. This is a repository policy setting, not a third workflow input. No setting is changed by Codex.

1. The actual repository owner chooses `channel: production`, the base `version`, and **Run workflow**. The owner ID and actual manual-run actor are verified through GitHub's API before reserving a tag. A collaborator cannot initiate an owner-mode release. Organizations must use protected Environment approval.
2. CI, both platform builds/scans and any configured production Environment deployment rules run normally. A configured required-reviewer rule takes precedence and must remain valid; owner preference never disables it. An existing Environment with wait timers, custom rules or branch restrictions is still selected by the **Production approval** job.
3. Without configured required reviewers, the first **Publish release** attempt intentionally stops with **Owner confirmation required**, publishing nothing. Review the successful CI, both scan results, source SHA, version and recorded image digest.
4. The repository owner confirms by choosing **Re-run failed jobs** on that same run. Do not choose **Re-run all jobs**, dispatch the reserved version again, delete its tag or edit artifacts. The workflow verifies the original owner, current rerun actor and successful **Build and scan** job from an earlier attempt. Retrying a failed build is not confirmation: if that retry builds an artifact for the first time, publication stops again until a later owner confirmation.
5. Publication rechecks source HEAD, the immutable reserved plan, approval configuration and exact artifact checksums/digest. It uploads the already scanned image without a rebuild. Source/config changes, missing/expired artifacts or unrelated job history stop publication.

This is a deliberate two-stage single-owner approval policy, not independent reviewer approval. Restrict settings, policy changes, dispatch and rerun rights accordingly. Returning to protected reviewers is preferred when supported. Changes to approval mode after reservation stop that run rather than silently changing its authorization.

### Environment 404 and access troubleshooting

Beta never looks up `/environments/beta`; a missing Beta Environment is harmless. Production treats a resource 404 as ambiguous, then checks the paginated Environment listing. A successful listing without `production` establishes absence: default mode requests configuration, while explicit owner mode can use no Environment. If the resource is listed but unreadable, or listing fails (including a plan/permission-related 404), publication fails closed with configuration guidance. A 404 is not proof that protection is absent.

401 means check token validity; 403 means inspect repository/Actions permissions, organization policy or rate limits. GitHub may hide permission failures as 404. Owner mode still needs readable Environment metadata/listing and Actions run/job metadata; if the plan cannot expose these, fix access/plan support before releasing. Do not provide a broad PAT or disable protections as a workaround.

The public manual form remains only `channel` and base `version`. The workflow file must exist with `workflow_dispatch` on the default branch for the manual UI to appear. This repository already has that workflow: select **work** in the workflow branch selector to use this fix without changing `main`. The selector chooses policy code; application source is still `work` for Beta and `main` for Production. A maintainer may promote the policy to the default branch separately. An old failed run reuses its old policy when rerun: start a new Beta dispatch using the fixed policy. Any previous reservation stays traceable and must not be overwritten.

## Privacy and PDF limitations

Documents are processed in browser memory, with no upload API or telemetry. Only theme and language preferences persist locally. Refreshing or closing the page loses working files. Offline use requires the page and assets to remain available; no service-worker installation is provided.

Inputs are limited to 100 MiB per document or combined merge input. Memory use can be several times the source size, and pdf-lib mutations may pause the UI. Thumbnail grids share one PDF.js document/worker per file; only the active tool renders previews, with at most 12 Extract thumbnails and bounded canvas height.

Malformed, empty, unsupported and encrypted PDFs report errors. Decrypt a copy locally first. Complex forms, annotations, unusual fonts and signatures need manual reader checks; modifications can invalidate digital signatures. Structural compression does not reduce image quality and may yield little improvement. It reports the actual candidate size and retains the original bytes when the rewrite is not smaller.

Crop changes the visible crop box in unrotated PDF coordinates; hidden content stays in the file. **Crop is not redaction.** Version Fix changes only the header's three version characters, validates the PDF and allows higher or lower header values while preserving catalog overrides and every other byte. It does not convert features or establish reader compatibility or PDF/A conformance.

## Builds without GitHub Actions

Use the [cross-platform local release guide](LOCAL_RELEASE.md) for Python 3.11+, PowerShell 5.1/Bash commands, frontend ZIPs, optional Docker/OCI archives, offline version allocation and manual deployment/rollback. No GitHub authentication is needed for local builds or packaging. Local production confirmation does not publish anything.

The protected release workflow reuses this engine for version calculation and checksummed frontend packaging. The frontend bundle is attached after the selected channel authorization/approval policy alongside source/image metadata; the OCI image continues through both architecture scans and is published without a rebuild. Local optional publication uploads assets only to an existing approved GitHub Release and never creates tags or pushes images.
