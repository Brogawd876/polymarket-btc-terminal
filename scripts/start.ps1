$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogsDir = Join-Path $Root "logs"
$BackendOut = Join-Path $LogsDir "backend.out.log"
$BackendErr = Join-Path $LogsDir "backend.err.log"
$Port = 3001
$ExtensionId = "jkpghfeaioigocjjdfeeocfjilhjbdno"
$ExtensionPath = Join-Path $Root "apps\extension\.output\chrome-mv3"

function Write-Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok($Message) {
    Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
    Write-Host "!!  $Message" -ForegroundColor Yellow
}

function Write-Fail($Message) {
    Write-Host "ERR $Message" -ForegroundColor Red
}

function Get-BackendListener {
    try {
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1
    } catch {
        $null
    }
}

function Test-CommandExists($Name) {
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-LatestWriteTime($Path, $Filter) {
    if (-not (Test-Path $Path)) { return [DateTime]::MinValue }
    $files = Get-ChildItem -Path $Path -Recurse -File -Include $Filter -ErrorAction SilentlyContinue
    if (-not $files) { return [DateTime]::MinValue }
    return ($files | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
}

function Test-NeedsBuild($SourcePath, $OutputPath) {
    if (-not (Test-Path $OutputPath)) { return $true }
    $latestSource = Get-LatestWriteTime $SourcePath @("*.ts", "*.tsx", "*.js", "*.json", "*.css")
    $output = Get-Item $OutputPath
    return $latestSource -gt $output.LastWriteTime
}

function Invoke-Pnpm($Arguments) {
    $process = Start-Process -FilePath "pnpm.cmd" -ArgumentList $Arguments -WorkingDirectory $Root -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        throw "pnpm $($Arguments -join ' ') failed with exit code $($process.ExitCode)"
    }
}

function Wait-ForBackend {
    param([int]$Seconds = 45)

    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
            if ($health.status -eq "ok") { return $true }
        } catch {
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Open-CurrentPolymarketMarket {
    $unixNow = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $slotStart = [Math]::Floor($unixNow / 300) * 300
    $url = "https://polymarket.com/event/btc-updown-5m-$slotStart"
    Start-Process $url
    return $url
}

Set-Location $Root
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

Write-Host ""
Write-Host "Polymarket BTC Terminal Launcher" -ForegroundColor White
Write-Host "This will start the local backend and open the current BTC 5-minute market." -ForegroundColor Gray

Write-Step "Checking required tools"
if (-not (Test-CommandExists "node")) {
    Write-Fail "Node.js is not installed or not on PATH."
    Write-Host "Install Node.js 20+ and run this launcher again."
    exit 1
}
if (-not (Test-CommandExists "pnpm.cmd")) {
    Write-Fail "pnpm is not installed or not on PATH."
    Write-Host "Install pnpm, then run this launcher again."
    exit 1
}
Write-Ok "Node.js and pnpm are available"

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-Step "Installing app dependencies"
    Invoke-Pnpm @("install")
    Write-Ok "Dependencies installed"
}

if (Test-NeedsBuild (Join-Path $Root "apps\server\src") (Join-Path $Root "apps\server\dist\bundle.js")) {
    Write-Step "Building backend"
    Invoke-Pnpm @("build:server")
    Write-Ok "Backend built"
}

if (Test-NeedsBuild (Join-Path $Root "apps\extension\src") (Join-Path $ExtensionPath "manifest.json")) {
    Write-Step "Building Chrome extension"
    Invoke-Pnpm @("build:extension:chrome")
    Write-Ok "Chrome extension built"
}

Write-Step "Restarting backend"
$listener = Get-BackendListener
if ($listener) {
    Write-Warn "Stopping existing backend on port $Port (PID $($listener.OwningProcess))"
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

if (Test-Path $BackendOut) { Remove-Item -LiteralPath $BackendOut -Force -ErrorAction SilentlyContinue }
if (Test-Path $BackendErr) { Remove-Item -LiteralPath $BackendErr -Force -ErrorAction SilentlyContinue }

$backend = Start-Process -FilePath "pnpm.cmd" `
    -ArgumentList @("run", "start:prod") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $BackendOut `
    -RedirectStandardError $BackendErr `
    -WindowStyle Hidden `
    -PassThru

if (-not (Wait-ForBackend -Seconds 60)) {
    Write-Fail "Backend did not become healthy within 60 seconds."
    Write-Host "Backend log: $BackendOut"
    Write-Host "Error log:   $BackendErr"
    exit 1
}

Write-Ok "Backend is running on http://127.0.0.1:$Port (PID $($backend.Id))"

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/live/disarm" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 5 | Out-Null
    Write-Ok "Live execution is disarmed for startup safety"
} catch {
    Write-Warn "Could not confirm live disarm; check status before trading."
}

Write-Step "Checking trading readiness"
try {
    $readinessResponse = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/readiness" -TimeoutSec 5
    Write-Host "State: $($readinessResponse.operationalState)" -ForegroundColor White
    if ($readinessResponse.readiness.blockingReasons.Count -gt 0) {
        Write-Host "Current blockers:" -ForegroundColor Yellow
        foreach ($reason in $readinessResponse.readiness.blockingReasons) {
            Write-Host "  - $reason" -ForegroundColor Yellow
        }
    } else {
        Write-Ok "No backend blockers"
    }
} catch {
    Write-Warn "Backend is healthy, but readiness check is still warming up."
}

Write-Step "Opening Polymarket"
$openedUrl = Open-CurrentPolymarketMarket
Write-Ok "Opened $openedUrl"

Write-Host ""
Write-Host "Chrome extension" -ForegroundColor White
Write-Host "  ID:   $ExtensionId"
Write-Host "  Path: $ExtensionPath"
Write-Host ""
Write-Host "If the panel does not appear or looks old:" -ForegroundColor Yellow
Write-Host "  1. Open chrome://extensions"
Write-Host "  2. Find extension ID $ExtensionId"
Write-Host "  3. Click Reload"
Write-Host "  4. Refresh the Polymarket tab"
Write-Host ""
Write-Host "Useful files:" -ForegroundColor White
Write-Host "  Backend log: $BackendOut"
Write-Host "  Error log:   $BackendErr"
Write-Host ""
Write-Host "You can close this window. The backend will keep running." -ForegroundColor Green
