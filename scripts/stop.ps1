param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RuntimeDir = Join-Path $Root 'runtime'
$MetadataPath = Join-Path $RuntimeDir 'backend.json'
$Port = 3001

function Get-Listener {
    try { Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1 }
    catch { $null }
}

function Get-ProcessDetails([int]$ProcessId) {
    try { Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop }
    catch { $null }
}

function Get-ProcessStartTimeUtc($Process) {
    if (-not $Process -or -not $Process.CreationDate) { return $null }
    if ($Process.CreationDate -is [DateTime]) { return $Process.CreationDate.ToUniversalTime() }
    return ([Management.ManagementDateTimeConverter]::ToDateTime([string]$Process.CreationDate)).ToUniversalTime()
}

function Read-Metadata {
    if (-not (Test-Path -LiteralPath $MetadataPath)) { return $null }
    try { Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json }
    catch { return $null }
}

function Test-Owned($Listener, $Metadata) {
    if (-not $Listener -or -not $Metadata) { return $false }
    if ([int]$Metadata.pid -ne [int]$Listener.OwningProcess -or [int]$Metadata.port -ne $Port) { return $false }
    if ([System.IO.Path]::GetFullPath([string]$Metadata.root) -ne $Root) { return $false }
    $process = Get-ProcessDetails ([int]$Listener.OwningProcess)
    if (-not $process) { return $false }
    if ($Metadata.processStartTimeUtc -and $process.CreationDate) {
        $actual = Get-ProcessStartTimeUtc $process
        $expected = [DateTime]::Parse([string]$Metadata.processStartTimeUtc).ToUniversalTime()
        if ([Math]::Abs(($actual - $expected).TotalSeconds) -gt 2) { return $false }
    }
    return $true
}

function Wait-ForExit([int]$ProcessId, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

if (-not $Quiet) { Write-Host "`nStopping Polymarket BTC Terminal..." -ForegroundColor White }
$listener = Get-Listener
if (-not $listener) {
    if (Test-Path -LiteralPath $MetadataPath) { Remove-Item -LiteralPath $MetadataPath -Force }
    Write-Host 'Backend is already stopped.' -ForegroundColor Green
    exit 0
}

$metadata = Read-Metadata
if (-not (Test-Owned $listener $metadata)) {
    Write-Host "Refusing to stop PID $($listener.OwningProcess): ownership of port $Port could not be verified." -ForegroundColor Red
    Write-Host "No process was terminated. Check STATUS.bat for details."
    exit 2
}

$pidToStop = [int]$listener.OwningProcess
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/live/disarm" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null
    Write-Host 'Live execution disarmed.' -ForegroundColor Green
} catch { Write-Host 'Could not confirm disarm before shutdown.' -ForegroundColor Yellow }

$gracefulRequested = $false
try {
    $headers = @{ 'X-Terminal-Shutdown' = [string]$metadata.shutdownToken }
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/shutdown" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null
    $gracefulRequested = $true
    Write-Host 'Graceful shutdown requested.'
} catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -notin @(404, 405)) {
        Write-Host 'Graceful shutdown endpoint did not accept the request.' -ForegroundColor Yellow
    }
}

if ($gracefulRequested -and (Wait-ForExit $pidToStop 8)) {
    Remove-Item -LiteralPath $MetadataPath -Force -ErrorAction SilentlyContinue
    Write-Host 'Backend stopped cleanly.' -ForegroundColor Green
    exit 0
}

Write-Host "Stopping verified backend PID $pidToStop..."
Stop-Process -Id $pidToStop -ErrorAction SilentlyContinue
if (-not (Wait-ForExit $pidToStop 5)) {
    Write-Host 'Backend did not exit in time; using bounded forced termination.' -ForegroundColor Yellow
    Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
    if (-not (Wait-ForExit $pidToStop 3)) { Write-Host 'Backend could not be stopped.' -ForegroundColor Red; exit 1 }
}

Remove-Item -LiteralPath $MetadataPath -Force -ErrorAction SilentlyContinue
Write-Host 'Backend stopped.' -ForegroundColor Green
