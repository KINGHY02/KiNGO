param(
    [ValidateSet('verify', 'package')]
    [string]$Mode = 'package',
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $projectRoot 'package.json'
$tauriConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$coresRoot = Join-Path $projectRoot 'src-tauri\resources\cores'

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )
    Write-Host "`n==> $Title" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Title failed with exit code $LASTEXITCODE."
    }
}

$package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$tauri = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$package.version -ne [string]$tauri.version) {
    throw "Version mismatch: package.json=$($package.version), tauri.conf.json=$($tauri.version)"
}

$requiredCores = @(
    'hy2\hysteria2.exe',
    'hysteria\hysteria-tun-windows-6.0-386.exe',
    'juicity\juicity-client.exe',
    'mieru\mieru.exe',
    'mihomo\mihomo.exe',
    'naiveproxy\naive.exe',
    'shadowquic\shadowquic.exe',
    'sing-box\sing-box.exe',
    'subs-check\subs-check.exe',
    'xray\xray.exe'
)

$missing = @($requiredCores | Where-Object {
    $path = Join-Path $coresRoot $_
    -not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0
})
if ($missing.Count -gt 0 -and $SkipInstall) {
    throw "Missing core files while -SkipInstall is enabled: $($missing -join ', ')"
}

Push-Location $projectRoot
try {
    if (-not $SkipInstall) {
        Invoke-Step 'Install dependencies and restore verified core assets' { npm.cmd ci }
    }
    $missing = @($requiredCores | Where-Object {
        $path = Join-Path $coresRoot $_
        -not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0
    })
    if ($missing.Count -gt 0) {
        throw "Core inventory is incomplete: $($missing -join ', ')"
    }

    Invoke-Step 'Generate installer artwork' { npm.cmd run assets:installer }
    Invoke-Step 'Build frontend and prepare core payloads' { npm.cmd run build }
    Invoke-Step 'Check Rust formatting' { cargo fmt --manifest-path src-tauri/Cargo.toml -- --check }
    Invoke-Step 'Check Rust backend' { cargo check --manifest-path src-tauri/Cargo.toml }
    Invoke-Step 'Test Rust backend' { cargo test --manifest-path src-tauri/Cargo.toml }

    if ($Mode -eq 'package') {
        # The signing private key exists only in GitHub Actions. Local packages
        # deliberately disable updater artifacts.
        Invoke-Step 'Build local NSIS installer' {
            npm.cmd run tauri -- build --bundles nsis --config src-tauri/tauri.pr.conf.json
        }
        $bundleDirectory = Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis'
        $installer = Get-ChildItem -LiteralPath $bundleDirectory -Filter '*.exe' -File |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if (-not $installer) { throw "NSIS installer was not found in $bundleDirectory" }
        $artifactDirectory = Join-Path $projectRoot "artifacts\v$($package.version)"
        New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
        $artifactPath = Join-Path $artifactDirectory $installer.Name
        Copy-Item -LiteralPath $installer.FullName -Destination $artifactPath -Force
        $hash = Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256
        [IO.File]::WriteAllText(
            (Join-Path $artifactDirectory 'SHA256SUMS.txt'),
            "$($hash.Hash.ToLowerInvariant())  $($installer.Name)`n",
            [Text.UTF8Encoding]::new($false)
        )
        Write-Host "`nInstaller: $artifactPath" -ForegroundColor Green
        Write-Host "SHA256:    $($hash.Hash.ToLowerInvariant())" -ForegroundColor Green
    }
}
finally { Pop-Location }
