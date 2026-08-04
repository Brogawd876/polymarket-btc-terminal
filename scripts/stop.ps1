$ErrorActionPreference = "Stop"
Write-Host "Stopping Terminal Processes..."
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match "node.exe" -and $_.CommandLine -match "Polymarket" }
foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "Done."
