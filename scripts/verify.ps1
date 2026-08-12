param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ExtensionManifest = Join-Path $Root 'apps\extension\dist\chrome-mv3\manifest.json'
$ServerBundle = Join-Path $Root 'apps\server\dist\bundle.js'
Set-Location $Root

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

Write-Host 'Checking launcher script syntax...'
$scripts = @('scripts/start.ps1', 'scripts/stop.ps1', 'scripts/status.ps1', 'scripts/install.ps1', 'scripts/verify.ps1')
foreach ($script in $scripts) {
    $tokens = $null; $errors = $null
    [Management.Automation.Language.Parser]::ParseFile((Join-Path $Root $script), [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) { throw "$script has syntax errors: $($errors.Message -join '; ')" }
}
Write-Host 'Launcher syntax: OK' -ForegroundColor Green

if (-not $SkipTests) {
    Write-Host 'Running tests...'
    Invoke-Checked 'pnpm.cmd' @('test')
}

if (-not (Test-Path -LiteralPath $ServerBundle)) { throw "Missing backend build: $ServerBundle" }
if (-not (Test-Path -LiteralPath $ExtensionManifest)) { throw "Missing Chrome extension build: $ExtensionManifest" }
Write-Host 'Build artifacts: OK' -ForegroundColor Green

try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/v1/health' -TimeoutSec 3
    Write-Host "Running backend health: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host 'Backend is not running; health check skipped.' -ForegroundColor Yellow
}

Write-Host 'Verification passed.' -ForegroundColor Green
