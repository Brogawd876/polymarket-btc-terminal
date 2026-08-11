$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$MetadataPath = Join-Path $Root 'runtime\backend.json'
$ExtensionPath = Join-Path $Root 'apps\extension\dist\chrome-mv3'
$Port = 3001

Write-Host "`nPolymarket BTC Terminal Status" -ForegroundColor White
try { $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1 }
catch { $listener = $null }

$metadata = $null
if (Test-Path -LiteralPath $MetadataPath) {
    try { $metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json }
    catch { Write-Host 'Runtime metadata is unreadable.' -ForegroundColor Yellow }
}

if (-not $listener) {
    Write-Host 'Backend: OFFLINE' -ForegroundColor Red
    if ($metadata) { Write-Host 'A stale runtime record exists and will be cleaned up by STOP.bat or the next successful start.' -ForegroundColor Yellow }
    Write-Host 'Run start.bat to start the app.'
} else {
    $owned = $metadata -and [int]$metadata.pid -eq [int]$listener.OwningProcess -and [int]$metadata.port -eq $Port -and [System.IO.Path]::GetFullPath([string]$metadata.root) -eq $Root
    if ($owned) { Write-Host "Backend: RUNNING (verified PID $($listener.OwningProcess))" -ForegroundColor Green }
    else { Write-Host "Backend: PORT IN USE, OWNERSHIP UNVERIFIED (PID $($listener.OwningProcess))" -ForegroundColor Yellow }

    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3
        Write-Host "Health:  $($health.status)" -ForegroundColor Green
    } catch { Write-Host 'Health:  unavailable' -ForegroundColor Yellow }

    try {
        $readiness = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/readiness" -TimeoutSec 5
        Write-Host "State:   $($readiness.operationalState)" -ForegroundColor White
        $reasons = @($readiness.readiness.blockingReasons)
        if ($reasons.Count -eq 0) { Write-Host 'Blockers: none' -ForegroundColor Green }
        else { Write-Host 'Blockers:' -ForegroundColor Yellow; foreach ($reason in $reasons) { Write-Host "  - $reason" -ForegroundColor Yellow } }
    } catch { Write-Host 'Readiness: warming up or unavailable' -ForegroundColor Yellow }
}

Write-Host "`nExtension:" -ForegroundColor White
if (Test-Path -LiteralPath (Join-Path $ExtensionPath 'manifest.json')) { Write-Host "  READY: $ExtensionPath" -ForegroundColor Green }
else { Write-Host "  NOT BUILT: $ExtensionPath" -ForegroundColor Yellow }

Write-Host "`nLogs:" -ForegroundColor White
if ($metadata -and $metadata.stdoutLog) { Write-Host "  Output: $($metadata.stdoutLog)"; Write-Host "  Errors: $($metadata.stderrLog)" }
else { Write-Host "  $Root\logs" }
