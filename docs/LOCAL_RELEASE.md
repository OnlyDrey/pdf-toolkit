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
