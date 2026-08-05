$ErrorActionPreference = "Stop"

Write-Host "Searching for Polymarket Terminal backend process..."
$procs = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { 
    $_.CommandLine -like "*@polymarket-btc/server*" -or 
    $_.CommandLine -like "*apps/server*" -or 
    $_.CommandLine -like "*dist/bundle.js*" 
}

if (-not $procs) {
    Write-Host "No active Polymarket Terminal backend process found."
    exit 0
}

foreach ($p in $procs) {
    Write-Host "Gracefully stopping process PID $($p.Id)..."
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "Polymarket Terminal backend shutdown complete."
