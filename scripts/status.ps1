$ErrorActionPreference = "Stop"

$Port = 3001
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

Write-Host ""
Write-Host "Polymarket BTC Terminal Status" -ForegroundColor White

try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
} catch {
    $listener = $null
}

if (-not $listener) {
    Write-Host "Backend: OFFLINE" -ForegroundColor Red
    Write-Host "Run start.bat to start the app."
    exit 0
}

Write-Host "Backend: RUNNING on http://127.0.0.1:$Port (PID $($listener.OwningProcess))" -ForegroundColor Green

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3
    Write-Host "Health:  $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "Health:  backend port is open, but health check failed" -ForegroundColor Yellow
}

try {
    $readiness = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/readiness" -TimeoutSec 5
    Write-Host "State:   $($readiness.operationalState)" -ForegroundColor White
    if ($readiness.readiness.blockingReasons.Count -gt 0) {
        Write-Host "Blockers:" -ForegroundColor Yellow
        foreach ($reason in $readiness.readiness.blockingReasons) {
            Write-Host "  - $reason" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Blockers: none" -ForegroundColor Green
    }
} catch {
    Write-Host "Readiness: still warming up or unavailable" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Logs:"
Write-Host "  $Root\logs\backend.out.log"
Write-Host "  $Root\logs\backend.err.log"
