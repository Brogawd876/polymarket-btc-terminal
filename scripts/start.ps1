# Polymarket BTC 5m Terminal Startup Script

Write-Host "Checking for existing backend processes..."
$existing = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*apps/server*" -or $_.CommandLine -like "*bundle.js*" }
if ($existing) {
    Write-Host "Stopping existing backend process..."
    Stop-Process -Id $existing.Id -Force
    Start-Sleep -Seconds 1
}

Write-Host "Starting Polymarket Terminal Backend..."
$pnpmCmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if ($pnpmCmd) {
    $backendProc = Start-Process -FilePath "pnpm.cmd" -ArgumentList "run", "start:prod" -PassThru -NoNewWindow
} else {
    $backendProc = Start-Process -FilePath "node" -ArgumentList "apps/server/dist/bundle.js" -PassThru -NoNewWindow
}

Write-Host "Waiting for backend health check..."
$maxAttempts = 15
$attempt = 0
$healthy = $false

while ($attempt -lt $maxAttempts) {
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/v1/health" -Method Get -TimeoutSec 2
        if ($res.status -eq "ok") {
            $healthy = $true
            break
        }
    } catch {
        # Server still booting
    }
    Start-Sleep -Seconds 1
    $attempt++
}

if ($healthy) {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " SUCCESS: POLYMARKET BTC TERMINAL IS LIVE!" -ForegroundColor Green
    Write-Host " Backend URL:  http://127.0.0.1:3001" -ForegroundColor Cyan
    Write-Host " Health Check: http://127.0.0.1:3001/api/v1/health" -ForegroundColor Cyan
    Write-Host "========================================================`n"
} else {
    Write-Host "`n[ERROR] Backend failed to start within timeout." -ForegroundColor Red
    exit 1
}
