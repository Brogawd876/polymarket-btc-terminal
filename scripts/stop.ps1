$ErrorActionPreference = "Stop"

$Port = 3001

Write-Host ""
Write-Host "Stopping Polymarket BTC Terminal..." -ForegroundColor White

try {
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
} catch {
    $listeners = @()
}

if (-not $listeners) {
    Write-Host "Backend is already stopped." -ForegroundColor Green
    exit 0
}

foreach ($listener in $listeners) {
    Write-Host "Stopping backend PID $($listener.OwningProcess) on port $Port..."
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1
Write-Host "Backend stopped." -ForegroundColor Green
