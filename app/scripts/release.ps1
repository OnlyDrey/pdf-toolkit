#requires -Version 5.1
# Keep this launcher compatible with Windows PowerShell 5.1; logic lives in Python.
$ErrorActionPreference = 'Stop'
$releaseArguments = @($args)
$candidates = @(
    @{ Name = 'py'; Prefix = @('-3') },
    @{ Name = 'python3'; Prefix = @() },
    @{ Name = 'python'; Prefix = @() }
)
foreach ($candidate in $candidates) {
    $command = Get-Command $candidate.Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) { continue }
    $prefix = @($candidate.Prefix)
    try {
        & $command.Source @prefix -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { continue }
    } catch { continue }
    & $command.Source @prefix (Join-Path $PSScriptRoot 'release.py') @releaseArguments
    exit $LASTEXITCODE
}
[Console]::Error.WriteLine('Python 3.11+ is required. Install Python and add it to PATH.')
exit 3
