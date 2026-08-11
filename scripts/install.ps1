$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ExtensionPath = Join-Path $Root 'apps\extension\dist\chrome-mv3'
Set-Location $Root

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

Write-Host '[1/9] Verifying Node.js...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required.' }
$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 20) { throw "Node.js 20+ is required; found $(node -v)." }
Write-Host "Node version: $(node -v)" -ForegroundColor Green

Write-Host '[2/9] Verifying pnpm...'
if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host 'pnpm is missing. Installing it with npm...'
    Invoke-Checked 'npm.cmd' @('install', '-g', 'pnpm')
}

Write-Host '[3/9] Installing workspace dependencies...'
Invoke-Checked 'pnpm.cmd' @('install')

Write-Host '[4/9] Verifying environment files...'
if (-not (Test-Path -LiteralPath '.env') -and (Test-Path -LiteralPath '.env.example')) { Copy-Item '.env.example' '.env'; Write-Host 'Created .env from .env.example' }
if (-not (Test-Path -LiteralPath 'apps/server/.env') -and (Test-Path -LiteralPath 'apps/server/.env.example')) { Copy-Item 'apps/server/.env.example' 'apps/server/.env'; Write-Host 'Created apps/server/.env from its example' }

Write-Host '[5/9] Creating runtime directories...'
New-Item -ItemType Directory -Force -Path 'data', 'logs', 'runtime', 'apps/server/data' | Out-Null

Write-Host '[6/9] Typechecking workspace packages...'
Invoke-Checked 'pnpm.cmd' @('typecheck')

Write-Host '[7/9] Building shared package...'
Invoke-Checked 'pnpm.cmd' @('--filter', 'shared', 'build')

Write-Host '[8/9] Building backend server...'
Invoke-Checked 'pnpm.cmd' @('build:server')

Write-Host '[9/9] Building Chrome extension...'
Invoke-Checked 'pnpm.cmd' @('build:extension:chrome')
$manifestPath = Join-Path $ExtensionPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Extension build did not create $manifestPath" }

Write-Host '=========================================================='
Write-Host 'INSTALLATION COMPLETE' -ForegroundColor Green
Write-Host 'Chrome extension directory:'
Write-Host "  $ExtensionPath"
Write-Host 'Double-click start.bat to run the application.'
Write-Host '=========================================================='
