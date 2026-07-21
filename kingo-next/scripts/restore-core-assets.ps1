param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$partsDirectory = Join-Path $projectRoot "core-assets"
$manifestPath = Join-Path $partsDirectory "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedHash = ([string]$manifest.sha256).ToUpperInvariant()
$targetDirectory = Join-Path $projectRoot "src-tauri\resources\cores"
$workDirectory = Join-Path $projectRoot "src-tauri\target\core-assets"
$archivePath = Join-Path $workDirectory ([string]$manifest.archive)
$markerPath = Join-Path $workDirectory "restored.sha256"
$requiredFiles = @($manifest.requiredFiles)

function Test-CoreAssetsRestored {
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        return $false
    }
    if ((Get-Content -LiteralPath $markerPath -Raw).Trim().ToUpperInvariant() -ne $expectedHash) {
        return $false
    }
    foreach ($relativePath in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $targetDirectory $relativePath) -PathType Leaf)) {
            return $false
        }
    }
    return $true
}

if (Test-CoreAssetsRestored) {
    Write-Host "KiNGO core assets are already restored."
    exit 0
}

New-Item -ItemType Directory -Force -Path $workDirectory | Out-Null
$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
try {
    foreach ($partName in @($manifest.parts)) {
        $partName = [string]$partName
        if ([System.IO.Path]::GetFileName($partName) -ne $partName) {
            throw "Invalid core asset part name: $partName"
        }
        $partPath = Join-Path $partsDirectory $partName
        if (-not (Test-Path -LiteralPath $partPath -PathType Leaf)) {
            throw "Missing core asset part: $partName"
        }
        $partStream = [System.IO.File]::OpenRead($partPath)
        try {
            $partStream.CopyTo($archiveStream)
        }
        finally {
            $partStream.Dispose()
        }
    }
}
finally {
    $archiveStream.Dispose()
}

$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) {
    throw "Core asset archive checksum mismatch. Expected $expectedHash, got $actualHash."
}

New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $targetDirectory -Force

foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $targetDirectory $relativePath) -PathType Leaf)) {
        throw "Restored core asset is missing: $relativePath"
    }
}

[System.IO.File]::WriteAllText(
    $markerPath,
    $expectedHash + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Host "KiNGO core assets restored and verified ($expectedHash)."
