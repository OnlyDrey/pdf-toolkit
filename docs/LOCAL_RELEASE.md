# Cross-platform local build and release engine

All release logic lives in `app/scripts/release.py` and uses Python 3.11+ standard-library modules. `release.ps1` and `release.sh` only find a supported interpreter and forward arguments/exit codes. Windows uses Windows PowerShell 5.1; Linux uses Bash. Node 24.13+ (24.x LTS), npm and installed application dependencies are required for frontend work. Install dependencies once with `cd app` then `npm ci`. Git is needed for release source/version metadata. Docker is optional for frontend work.

From the repository root:

```powershell
# Windows PowerShell 5.1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\app\scripts\release.ps1 build
.\app\scripts\release.ps1 test
.\app\scripts\release.ps1 clean --dry-run
```

`-ExecutionPolicy Bypass` applies only to that PowerShell process; it does not change machine policy. You can omit it if your policy already permits the checked-in launcher.

```sh
# Ubuntu/Debian: install Python 3.11+ and Git through supported OS packages,
# then install Node 24 LTS from a trusted Node distribution.
./app/scripts/release.sh dev
./app/scripts/release.sh test
./app/scripts/release.sh build
./app/scripts/release.sh clean --dry-run
```

Direct Python invocation is equivalent: `python app/scripts/release.py build` (use `python3` on Linux). Paths with spaces are supported. `--dry-run` prints argument arrays without starting tools or changing files. `--non-interactive` prevents prompts; `--yes` explicitly confirms Production artifact creation or cleanup. Cleanup preserves unknown output files and refuses protected source, tracked files and symlink paths.

Version allocation combines local Git tags and release-manifest/reservation names. Remote tags are queried without interactive authentication when available; `--offline` prevents that query. A remotely unchecked version is **provisional**, including when a remote query fails. It cannot be guaranteed unique against remote releases. Local operations never create or push Git tags.

Both launchers return the engine's exit codes: 0 success; 2 invalid arguments/version or missing confirmation; 3 missing prerequisites; 4 validation/build/tool failure; 5 artifact, path, collision or filesystem failure; 6 publication failure; 130 interruption. Missing Python returns 3. No publication occurs from normal development/build commands.

The standard-library engine tests include a real Bash invocation on Linux and a Windows-only test that executes `powershell.exe`, checks version 5.1 and verifies argument/exit-code forwarding. A Linux run skips that Windows-only test; it is not evidence of an actual Windows execution.

## Versioned packages and offline operation

```powershell
.\app\scripts\release.ps1 package --channel beta --version 1.2.0 --offline --non-interactive
.\app\scripts\release.ps1 all --channel production --version 1.2.0 --yes --non-interactive
.\app\scripts\release.ps1 package --channel beta --version 1.2.0 --output-dir 'C:\Release Files\PDF Toolkit' --non-interactive
```

```sh
./app/scripts/release.sh package --channel beta --version 1.2.0 --offline --non-interactive
./app/scripts/release.sh all --channel production --version 1.2.0 --yes --non-interactive
./app/scripts/release.sh package --channel beta --version 1.2.0 --output-dir '/tmp/PDF Toolkit releases' --non-interactive
```

`package` builds assets only if their input/output fingerprint no longer matches the build stamp, then packages them. `all` validates, builds and packages; `--skip-tests` is an explicit local-only shortcut and is recorded in the manifest. `test` includes type/lint/format checks, application/release/engine tests, a production build, browser tests and (online) npm audit. `dev` runs Vite. Docker and GitHub authentication are not required for frontend-only actions. A Git checkout is required for release source metadata.

Offline operation requires application dependencies already installed. Offline tests skip the network vulnerability audit and record `passed-offline`, rather than claiming a fresh audit. `--offline` suppresses remote Git queries; it is not a machine-wide network sandbox. Docker offline builds additionally disable build-step networking and require cached base/dependency layers. Missing cache layers fail clearly. Local release slots, including failed/partial attempts, reserve beta numbers. Production uses exactly the base version and requires confirmation; in non-interactive mode supply `--yes`. Existing versioned artifacts are never overwritten.

Default output is the ignored `app/releases/` directory. Each version has a `pdf-toolkit-X.Y.Z[-beta.N]/` directory containing:

- A frontend ZIP with `index.html` and locally bundled assets at its root.
- `compose.yaml` pinned to the versioned GHCR image (an unpublished/provisional image may not exist remotely yet).
- `release-notes.md`, `release-manifest.json` and `SHA256SUMS`.
- Optional Docker/OCI archives when requested.

A complete release ZIP and its `.zip.sha256` sidecar are stored beside that directory. `SHA256SUMS` covers the manifest and payload files; the manifest lists payload hashes without recursively hashing itself. The outer ZIP sidecar covers the transport archive. Schema version 1 records source SHA/branch/dirty state/input fingerprint, tool versions, host platform, Docker platforms/format, validation status, provisional status and payload sizes/SHA256 hashes. Checksum data detects corruption; it is not a cryptographic approval signature. Archives are **not promised byte-identical across operating systems**.

Source changes during preparation abort the release. Failed slots/manifests remain traceable and consume their version. Builds in one checkout use a lock; inspect a stale `app/.release-work/build.lock` before removing it manually. `clean --yes --non-interactive` removes known generated directories and owned release slots/bundles, preserves unknown output files or notes added inside a release, and refuses tracked files and symlink/junction/reparse points inside generated trees. Inspect with `clean --dry-run` first.

## Docker builds and exports

Install Docker Engine/Desktop with Linux containers and Buildx. The engine checks daemon mode and the active builder's advertised platforms. It explicitly disables pushes and never updates moving registry tags.

```powershell
.\app\scripts\release.ps1 docker --channel beta --version 1.2.0 --verify-container --non-interactive
.\app\scripts\release.ps1 package --channel beta --version 1.2.0 --with-docker --docker-format docker --non-interactive
.\app\scripts\release.ps1 all --channel beta --version 1.2.0 --with-docker --docker-format oci --platforms 'linux/amd64,linux/arm64' --non-interactive
```

```sh
./app/scripts/release.sh docker --channel beta --version 1.2.0 --verify-container --non-interactive
./app/scripts/release.sh package --channel beta --version 1.2.0 --with-docker --docker-format docker --non-interactive
./app/scripts/release.sh all --channel beta --version 1.2.0 --with-docker --docker-format oci --platforms linux/amd64,linux/arm64 --non-interactive
```

`--docker-format image` (default) loads one platform into the local daemon. `docker` exports one platform to a Docker tar archive. `oci` supports both platforms and preserves SBOM/provenance where the builder/exporter supports them; it needs an OCI-capable Buildx builder, commonly the docker-container driver. A requested unsupported platform/format is an error, not a silently reduced build. Configure QEMU/native builders yourself; the engine does not change daemon privileges or builders automatically. Classic Docker load/archive formats do not preserve multi-platform attestations.

`--verify-container` is available for loaded images and tests non-root metadata, read-only startup, `/healthz` and the application response. Cross-platform runtime behavior still needs a capable host/emulator. The existing multi-stage Dockerfile, UID 101 and read-only deployment model are retained. In managed environments, `--proxy-ca /path/to/public-ca.pem` mounts the CA as a temporary BuildKit secret; TLS verification remains enabled. Use default output or a directory outside `app/` for Docker exports so build contexts cannot recursively include release archives.

## Manual deployment and optional publication

For frontend-only deployment, verify the outer ZIP sidecar and inner `SHA256SUMS`, then unpack the frontend ZIP into a static web server. Use the supplied hardened Nginx configuration as guidance, including the `.mjs` worker MIME type. Files/documents are still processed entirely in the browser.

For a Docker archive, run `docker load --input <archive>-docker.tar`, then deploy the loaded versioned local image using the packaged Compose file with `PDF_TOOLKIT_IMAGE=pdf-toolkit:<version>` and `docker compose up -d --pull never`. PowerShell sets that override with `$env:PDF_TOOLKIT_IMAGE='pdf-toolkit:<version>'`; Bash can prefix the Compose command with the variable assignment. OCI archives require an OCI-capable importer such as Skopeo. For registry deployments use a reviewed version/digest, `docker compose pull`, then `docker compose up -d`. Roll back by restoring the previous digest and repeating those commands. Download active browser sessions before upgrades/reloads.

Normal actions never publish. Image/new-release publication remains the protected workflow in the [deployment guide](DEPLOYMENT.md), or a separately authorized maintainer operation; local builds never create Git tags. GitHub Actions is not required to build/package/deploy locally.

The advanced `publish` action optionally **uploads distribution assets to an already published, approved GitHub Release**. It does not create a release, Git tag or registry image, and does not bypass the existing image/release approval gates. A maintainer can approve/create the existing release manually without Actions. It requires GitHub CLI authentication only for this action, a complete verified package from a clean matching checkout, online full validation recorded as `passed`, a matching existing tag/channel branch HEAD, and explicit authorization/confirmation. Existing remote asset names are rejected; no clobber or automatic merge occurs. Included Docker archives are vulnerability-scanned with Trivy for every recorded platform before upload. Frontend-only packages rely on their required validation/dependency audit. Skipped/offline-only validation is insufficient for this upload path.

```powershell
.\app\scripts\release.ps1 publish --manifest '.\app\releases\pdf-toolkit-1.2.0\release-manifest.json' --authorize-publish --yes --non-interactive
```

```sh
./app/scripts/release.sh publish --manifest app/releases/pdf-toolkit-1.2.0/release-manifest.json --authorize-publish --yes --non-interactive
```

Creating/publishing that pre-existing release or pushing registry images is never implicit. This implementation task authorizes neither. After partial upload failures, inspect the remote assets before retrying; the engine will not overwrite them.

## GitHub Actions integration

The manual workflow still asks only for channel and base version. Beta pins current `work` HEAD; Production pins current `main` HEAD, independently of the dispatch selector. Its immutable policy calls the same Python calculator as local builds. GitHub API tag reservation, serialization, source rechecks, full CI and both architecture scans remain mandatory. Beta uses manual dispatch authorization without an Environment. Production uses protected Environment approval by default or the explicitly configured two-stage owner-operated policy in the deployment guide. Local reservations are filesystem-only and are not remote release reservations.

After successful scans, the workflow uses the shared engine to package the pinned source with its reserved plan. The frontend bundle and checksum become GitHub Release assets only after the selected channel authorization/approval checks. Packaging records `skipped` for its own redundant test invocation: the preceding required CI job validated that exact SHA. The workflow verifies the bundle against the build job's trusted SHA256 output before uploading. The already scanned OCI image is published without rebuilding it. See [required Environments and publication permissions](DEPLOYMENT.md).

CI adds standard-library engine tests on Ubuntu and Windows, with the Windows launcher invoked by **Windows PowerShell 5.1**. The aggregate `ready` check requires both platforms. Workflow policy tests require Python 3.11+ as well as Node 24. These jobs run only when CI is requested by repository triggers; implementing them does not dispatch Actions.

A supplied `--release-plan` is an internal packaging handoff, not evidence of approval. It must match the checkout SHA and valid channel/version; only the protected workflow authorizes registry/new-release publication. Local production confirmation authorizes artifact creation only.

## Windows paths and cleanup boundaries

Source/output roots are canonicalized once, so legitimate Windows temporary directories, spaces, case normalization and 8.3 aliases such as `RUNNER~1` do not count as links. Inherited parent aliases/junctions are resolved when choosing those roots. A selected root that is itself a symlink/junction/reparse point is rejected, as are linked descendants such as `app/dist/junction`. Paths remain pinned to their canonical roots afterward.

The guard checks `lstat` metadata: Unix symlink mode and Windows `FILE_ATTRIBUTE_REPARSE_POINT` (also available on Python 3.11, without `Path.is_junction()`). It never infers a junction merely because `resolve()` changes a name. Traversal below approved roots is rejected; generated-tree walks check entries before descending. Cleanup validates canonical containment, preserves unknown and tracked data and rechecks targets after confirmation. External output directories remain supported when explicitly selected; cleanup removes only owned releases inside them, not their parent/sibling directories or the output root itself.

Windows tests use ordinary temporary directories and `GetShortPathNameW`; real junction tests use `mklink /J` without requesting elevation. Hosts without 8.3 support/junction creation report explicit skips. Actual symlink tests skip on Windows if Developer Mode/symlink privilege is unavailable. The real PowerShell 5.1 forwarding test runs only on Windows; Linux results do not establish native Windows validation.
