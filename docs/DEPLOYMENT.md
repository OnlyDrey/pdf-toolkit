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

The release workflow supports manual dispatch and intentional `v*` tag pushes. Ordinary development commits and branch pushes cannot publish images. Every path validates the requested commit, checks source restrictions, waits for human Environment approval, scans both image platforms, and uses a unique version. Configuring the workflow is not permission to run it.

### Required repository settings and permissions

A repository administrator must configure:

1. Protect `main` with human review and the aggregate CI **`ready`** check; see [dependency maintenance](DEPENDENCIES.md). Restrict changes to release policy/workflows to trusted reviewers. Codex works only on `work` and never modifies `main`.
2. Protect creation, updates and deletion of `v*` tags. Permit intended tag creation by the release workflow's `GITHUB_TOKEN` (or its GitHub Actions integration) without granting bypass for tag updates/deletion. If rules disallow that integration, manual publication fails closed: adjust the reviewed rules, do not add a broad PAT or bypass validation.
3. Create **`beta`** and **`production`** GitHub Environments. Add required human reviewers, enable **Prevent self-review**, and disable **Allow administrators to bypass configured protection rules**. The workflow checks all three settings before CI and again after approval; missing settings or API permission failures block release.
4. Restrict beta deployment refs to `work` and intentional beta version tags; restrict production refs to `main` and intentional stable version tags. Use selected branch/tag rules appropriate to the repository. The workflow additionally validates strict version syntax and source ancestry; GitHub's glob patterns alone do not enforce SemVer.
5. Enable Actions and allow the repository's token to write its GHCR package. Link the package to this repository and inherit access. Make it public for anonymous deployment pulls, or use a pull-only credential on deployment hosts. Keep Dependabot alerts/security updates enabled.

Global workflow permission is `contents: read`. Preflight also uses `actions: read` to inspect Environment settings. Reusable CI has read-only contents access and inherits no Environment secrets. Only the Environment-gated publication job receives `contents: write` (version tag and GitHub Release), `packages: write` (GHCR), and `actions: read` (protection recheck). Publication authenticates with the scoped `GITHUB_TOKEN`, not a broad personal token. Environments/rulesets require a GitHub plan that supports the required protections; an unsupported or incomplete setup is not silently accepted.

The Actions **Run workflow** button becomes available only after a maintainer makes this `workflow_dispatch` definition available on the repository's default branch. Codex will not modify or merge that branch. Once available there, the operator can select `work` or `main` as described below.

### Manually build and publish Beta

After explicit user release authorization, an authorized maintainer opens **Actions → Release → Run workflow**:

- Select workflow branch **`work`**.
- Set `channel` to **`beta`**.
- Set `version` without `v`, for example **`1.2.0-beta.1`**.
- Set `source_sha` to the approved full lowercase 40-character commit SHA reachable from `work`.
- Check `confirm_publish`, inspect the source/version in the run summary, and start the run.

The workflow runs its release-policy tests, verifies the source SHA and unused tag, then runs complete reusable CI on that exact SHA. After CI passes, a different authorized reviewer approves the **beta** Environment job. Publication rechecks source/protections, builds or reuses a candidate, scans both platforms, creates the version tag, promotes the digest and creates a GitHub prerelease. Beta can only update `beta`; it cannot update `latest`.

This publishes a Beta image; it is not merely a dry-run build. A validation-only build uses normal CI and must not be confused with approval to publish.

### Manually publish Production

After explicit user approval for the specific release, an authorized maintainer uses the same UI:

- Select workflow branch **`main`**; running Production from the workflow on `work` is rejected.
- Set `channel` to **`production`** and a stable version such as **`1.2.0`**.
- Supply an approved full commit SHA reachable from `main` and check `confirm_publish`.
- Inspect the pinned source/version, wait for fresh full CI, and obtain approval from a different **production** Environment reviewer.

A commit existing in the repository or on `work` is insufficient: the API comparison must show that it is an ancestor of (or identical to) `main`. The build source is checked out separately from the workflow policy, and the same SHA is passed to CI, image labels and artifact lookup. Source and version checks run again after approval. Manual dispatch deliberately runs validation even if the selected development commit contains `[skip ci]`; that marker cannot skip the called release CI.

### Tags, artifacts and failure handling

| Trigger/channel                    | Required source              | Git tag / GitHub Release    | GHCR version and moving tags |
| ---------------------------------- | ---------------------------- | --------------------------- | ---------------------------- |
| Manual Beta / `v1.2.0-beta.1` push | Commit reachable from `work` | `v1.2.0-beta.1`, prerelease | `1.2.0-beta.1`, `beta`       |
| Manual Production / `v1.2.0` push  | Commit reachable from `main` | `v1.2.0`, stable release    | `1.2.0`, `latest`            |

Intentional version-tag pushes remain supported with the same validation and Environment approvals. Maintainers protect these tags and approve each release; ordinary pushes never trigger publication. `[skip ci]` can suppress push-triggered workflows, so use the explicit manual path for approved development commits with that marker. Manual release tags are created with `GITHUB_TOKEN`, which does not recursively start another tag workflow.

Only stable SemVer and `-beta.N` versions are accepted; leading `v` in manual input, leading zeroes, build metadata and other prerelease suffixes are rejected. Manual runs require a new Git tag; tag-triggered runs must still point at the original source. Existing GitHub Releases and GHCR version tags are rejected instead of overwritten. Authentication, API and registry errors block publication.

Candidate images use **`sha-<full source commit>`** and target `linux/amd64` and `linux/arm64` with OCI labels, SBOM and provenance. Candidates are created only after validation and explicit Environment approval, and both architectures are scanned for HIGH/CRITICAL vulnerabilities before version/channel promotion. A failed scan can leave an unpromoted SHA candidate; its existence does not establish release readiness. The digest recorded in release notes is the immutable deployment identity; GHCR tags are technically mutable and must be restricted to trusted release writers.

When Beta and Production identify the same source commit, Production reuses and rescans the existing candidate rather than rebuilding it. OCI version metadata retains the original build version because promotion preserves the exact bytes. A new source SHA requires a new candidate. Global publication concurrency serializes the workflow's promotions. A partially failed publication may leave a reserved Git tag or image alias; inspect it manually with explicit authorization and use a new version rather than overwriting an existing version or bypassing uniqueness checks.

Deployment and rollback use the root Compose file and a reviewed version or digest as described above; neither requires source checkout or rebuilding. Do not deploy an unpromoted candidate simply because it has a SHA tag.

Codex development commits contain `[skip ci]` and go only to `origin/work`. Codex may manually publish a GitHub release or dispatch a workflow only when the user explicitly authorizes that specific action; this implementation task provides no such authorization. No unattended publishing, dispatch or automatic PR creation is permitted. See [AGENTS.md](../AGENTS.md).

## Privacy and PDF limitations

Documents are processed in browser memory, with no upload API or telemetry. Only theme and language preferences persist locally. Refreshing or closing the page loses working files. Offline use requires the page and assets to remain available; no service-worker installation is provided.

Inputs are limited to 100 MiB per document or combined merge input. Memory use can be several times the source size, and pdf-lib mutations may pause the UI. Thumbnail grids share one PDF.js document/worker per file; only the active tool renders previews, with at most 12 Extract thumbnails and bounded canvas height.

Malformed, empty, unsupported and encrypted PDFs report errors. Decrypt a copy locally first. Complex forms, annotations, unusual fonts and signatures need manual reader checks; modifications can invalidate digital signatures. Structural compression does not reduce image quality and may yield little improvement. It reports the actual candidate size and retains the original bytes when the rewrite is not smaller.

Crop changes the visible crop box in unrotated PDF coordinates; hidden content stays in the file. **Crop is not redaction.** Version Fix changes only the header's three version characters, checks the document and catalog version, and blocks downgrades. It does not convert features or establish reader compatibility or PDF/A conformance.
