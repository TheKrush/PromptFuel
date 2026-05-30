[CmdletBinding()]
param(
    [string]$RepoRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $RepoRoot) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $RepoRoot = Resolve-Path (Join-Path $scriptRoot "..")
}

Set-Location $RepoRoot

$packageJson = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
$expectedVsix = Join-Path $RepoRoot "$($packageJson.name)-$($packageJson.version).vsix"
$vsix = if (Test-Path $expectedVsix) { Get-Item $expectedVsix } else { $null }
if (-not $vsix) {
    Write-Host "Expected VSIX not found: $expectedVsix. Run dev-validate-install.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "Installing $($vsix.Name)..." -ForegroundColor Cyan

$codeCommand = Get-Command "code.cmd" -ErrorAction SilentlyContinue
if (-not $codeCommand) {
    $fallback = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"
    if (Test-Path $fallback) {
        & $fallback --install-extension $vsix.FullName --force
    } else {
        throw "Could not find code.cmd. Install manually with: code.cmd --install-extension $($vsix.FullName) --force"
    }
} else {
    & $codeCommand.Source --install-extension $vsix.FullName --force
}

Write-Host ""
Write-Host "Installed. In VS Code, run: Developer: Reload Window" -ForegroundColor Yellow
