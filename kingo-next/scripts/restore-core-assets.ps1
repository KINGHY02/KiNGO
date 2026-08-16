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
$externalFiles = @($manifest.externalFiles)

function Get-Sha256Hash {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
    }

    $output = & certutil.exe -hashfile $Path SHA256
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to calculate SHA256 for $Path."
    }
    $hash = ($output | Where-Object { $_ -match '^[0-9a-fA-F]{64}$' } | Select-Object -First 1)
    if (-not $hash) {
        throw "Failed to parse SHA256 for $Path."
    }
    return ([string]$hash).ToUpperInvariant()
}

function Invoke-VerifiedArchiveDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [int]$MaximumAttempts = 3
    )

    for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt++) {
        try {
            if (Test-Path -LiteralPath $Destination) {
                Remove-Item -LiteralPath $Destination -Force
            }
            Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
            return
        }
        catch {
            if ($attempt -ge $MaximumAttempts) {
                throw
            }
            Write-Warning "External core download attempt $attempt failed. Retrying..."
            Start-Sleep -Seconds ([Math]::Pow(2, $attempt))
        }
    }
}

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
    foreach ($entry in $externalFiles) {
        $path = Join-Path $targetDirectory ([string]$entry.path)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            return $false
        }
        if ((Get-Sha256Hash -Path $path) -ne ([string]$entry.sha256).ToUpperInvariant()) {
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

$actualHash = Get-Sha256Hash -Path $archivePath
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

foreach ($entry in $externalFiles) {
    $relativePath = [string]$entry.path
    $url = [string]$entry.url
    $archiveHash = ([string]$entry.archiveSha256).ToUpperInvariant()
    $fileHash = ([string]$entry.sha256).ToUpperInvariant()
    if (-not $url.StartsWith("https://", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "External core asset URL must use HTTPS: $url"
    }
    $targetPath = [System.IO.Path]::GetFullPath((Join-Path $targetDirectory $relativePath))
    $targetRoot = [System.IO.Path]::GetFullPath($targetDirectory) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $targetPath.StartsWith($targetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "External core asset path escapes the target directory: $relativePath"
    }
    if ((Test-Path -LiteralPath $targetPath -PathType Leaf) -and
        (Get-Sha256Hash -Path $targetPath) -eq $fileHash) {
        continue
    }

    $externalArchive = Join-Path $workDirectory ("external-" + $archiveHash.Substring(0, 16) + ".zip")
    Invoke-VerifiedArchiveDownload -Uri $url -Destination $externalArchive
    $actualArchiveHash = Get-Sha256Hash -Path $externalArchive
    if ($actualArchiveHash -ne $archiveHash) {
        throw "External core archive checksum mismatch for $relativePath. Expected $archiveHash, got $actualArchiveHash."
    }

    $extractDirectory = Join-Path $workDirectory ("external-" + $fileHash.Substring(0, 16))
    if (Test-Path -LiteralPath $extractDirectory) {
        Remove-Item -LiteralPath $extractDirectory -Recurse -Force
    }
    Expand-Archive -LiteralPath $externalArchive -DestinationPath $extractDirectory -Force
    $fileName = [System.IO.Path]::GetFileName($relativePath)
    $extracted = Get-ChildItem -LiteralPath $extractDirectory -Recurse -File |
        Where-Object { $_.Name -eq $fileName } |
        Select-Object -First 1
    if (-not $extracted) {
        throw "External core archive does not contain $fileName."
    }
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($targetPath)) | Out-Null
    Copy-Item -LiteralPath $extracted.FullName -Destination $targetPath -Force
    $actualFileHash = Get-Sha256Hash -Path $targetPath
    if ($actualFileHash -ne $fileHash) {
        throw "External core file checksum mismatch for $relativePath. Expected $fileHash, got $actualFileHash."
    }
}

[System.IO.File]::WriteAllText(
    $markerPath,
    $expectedHash + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Host "KiNGO core assets restored and verified ($expectedHash)."
