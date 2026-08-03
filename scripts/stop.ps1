$ErrorActionPreference = "Stop"
Write-Host "Stopping Terminal Processes..."
Stop-Process -Name "node" -ErrorAction SilentlyContinue
