[CmdletBinding()]
param(
    [switch]$SkipSmoke,
    [switch]$SkipInstall,
    [switch]$SkipCompile,
    [string]$VsixOut
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")

Set-Location $repoRoot

$nodeModulesPath = Join-Path $repoRoot "node_modules"
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host ""
    Write-Host "node_modules is missing. Run 'npm ci' first, then re-run this script." -ForegroundColor Red
    exit 1
}

$packageJsonPath = Join-Path $repoRoot "package.json"
$packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
if (-not $VsixOut) {
    $VsixOut = Join-Path $repoRoot "$($packageJson.name)-$($packageJson.version).vsix"
}

Write-Host "PromptFuel dev validate/install" -ForegroundColor Green
Write-Host "Repo: $repoRoot"
Write-Host "VSIX: $VsixOut"

if (-not $SkipCompile) {
    Invoke-Step "Clean out/" {
        $outDir = Join-Path $repoRoot "out"
        if (Test-Path $outDir) {
            Remove-Item -Recurse -Force $outDir
            Write-Host "Cleaned out\" -ForegroundColor Green
        } else {
            Write-Host "out\ does not exist, nothing to clean." -ForegroundColor Green
        }
    }

    Invoke-Step "Compile TypeScript" {
        npm run compile
    }
} else {
    Write-Host ""
    Write-Host "==> Compile skipped (-SkipCompile)" -ForegroundColor Yellow
}

Invoke-Step "Validate manifest" {
    npm run validate:manifest
}

if (-not $SkipSmoke) {
    $requiredOutputs = @(
        "out\extension.js",
        "out\config.js",
        "out\dataFolder.js",
        "out\core\providers.js",
        "out\core\quotaTypes.js",
        "out\core\configDefaults.js",
        "out\core\formatQuota.js"
    )
    $missingOutputs = $requiredOutputs | Where-Object { -not (Test-Path (Join-Path $repoRoot $_)) }
    if ($missingOutputs) {
        Write-Host ""
        Write-Host "Compiled output is missing. Run npm run compile first, or run dev-validate-install.ps1 without -SkipCompile." -ForegroundColor Red
        Write-Host "Missing: $($missingOutputs -join ', ')" -ForegroundColor Red
        exit 1
    }

    Invoke-Step "Smoke: core" {
        npm run smoke:core
    }
}

Invoke-Step "Clean old VSIX files" {
    Get-ChildItem "$repoRoot\prompt-fuel-*.vsix" | Remove-Item -Force
    Write-Host "Cleaned old VSIX files." -ForegroundColor Green
}

Invoke-Step "Package VSIX" {
    npx @vscode/vsce package --no-dependencies --out $VsixOut
}

if (-not $SkipInstall) {
    $codeCommand = Get-Command "code.cmd" -ErrorAction SilentlyContinue

    if (-not $codeCommand) {
        $fallbackCodePath = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"
        if (Test-Path $fallbackCodePath) {
            $codeCommandPath = $fallbackCodePath
        } else {
            throw "Could not find code.cmd. Install manually with: code.cmd --install-extension $VsixOut --force"
        }
    } else {
        $codeCommandPath = $codeCommand.Source
    }

    Invoke-Step "Install VSIX into VS Code" {
        & $codeCommandPath --install-extension $VsixOut --force
    }

    Write-Host ""
    Write-Host "Installed. In VS Code, run: Developer: Reload Window" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
