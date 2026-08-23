param(
    [string]$InstallDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    # NSIS resolves $INSTDIR before the preinstall hook. Prefer that exact path
    # so a stale registry entry from an interrupted installation cannot make a
    # fresh install inspect another directory. The product registry is only a
    # fallback for updater launches that do not provide an install directory.
    $registeredDir = $null
    try {
        $productKey = Get-Item 'Registry::HKEY_CURRENT_USER\Software\KINGHY02\KiNGO' -ErrorAction Stop
        $registeredDir = [string]$productKey.GetValue('')
    }
    catch {
        $registeredDir = $null
    }

    $candidate = @($InstallDir, $registeredDir) |
        ForEach-Object { if ($_ -ne $null) { ([string]$_).Trim().Trim('"') } } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        exit 0
    }

    $root = [IO.Path]::GetFullPath($candidate).TrimEnd('\')
    $appFile = Join-Path $root 'KiNGO.exe'
    $coreRoot = Join-Path $root 'resources\cores'

    function Get-KiNGOOwnedProcess {
        @(
            Get-Process -ErrorAction SilentlyContinue | Where-Object {
                try {
                    if (-not $_.Path) {
                        return $false
                    }
                    $path = [IO.Path]::GetFullPath($_.Path)
                    $path.Equals($appFile, [StringComparison]::OrdinalIgnoreCase) -or
                        $path.StartsWith($coreRoot + '\', [StringComparison]::OrdinalIgnoreCase)
                }
                catch {
                    $false
                }
            }
        )
    }

    $owned = @(Get-KiNGOOwnedProcess)
    if ($owned.Count -gt 0) {
        $owned | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (@(Get-KiNGOOwnedProcess).Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 250
    }

    # Do not probe executable files with FileShare::None here. Antivirus and
    # indexing software can hold short-lived read handles and were previously
    # misreported as a running KiNGO core. Current releases install immutable
    # .payload files and materialize executables in a versioned data directory,
    # so only a still-running KiNGO-owned process is a real blocker.
    $remaining = @(Get-KiNGOOwnedProcess)
    if ($remaining.Count -gt 0) {
        Write-Output ('Running KiNGO processes: ' + (($remaining | ForEach-Object { $_.Path }) -join '; '))
        exit 32
    }

    exit 0
}
catch {
    Write-Output ('KiNGO preinstall check failed: ' + $_.Exception.Message)
    exit 33
}
