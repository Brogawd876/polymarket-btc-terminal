param(
    [switch]$NoBrowser,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$LogsDir = Join-Path $Root "logs"
$RuntimeDir = Join-Path $Root "runtime"
$MetadataPath = Join-Path $RuntimeDir "backend.json"
$BuildStatePath = Join-Path $RuntimeDir "build-state.json"
$Port = 3001
$ExtensionId = "jkpghfeaioigocjjdfeeocfjilhjbdno"
$ExtensionPath = Join-Path $Root "apps\extension\dist\chrome-mv3"
$ServerOutput = Join-Path $Root "apps\server\dist\bundle.js"
$HealthUrl = "http://127.0.0.1:$Port/api/v1/health"

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "OK  $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "!!  $Message" -ForegroundColor Yellow }
function Write-Fail([string]$Message) { Write-Host "ERR $Message" -ForegroundColor Red }

function Get-BackendListener {
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

function Test-Health {
    try {
        $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
        return $health.status -eq "ok"
    } catch { return $false }
}

function Test-OwnedListener($Listener, $Metadata) {
    if (-not $Listener -or -not $Metadata) { return $false }
    if ([int]$Metadata.port -ne $Port -or [int]$Metadata.pid -ne [int]$Listener.OwningProcess) { return $false }
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

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    catch { return $null }
}

function Write-JsonFile([string]$Path, $Value) {
    $temporary = "$Path.tmp"
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-InputFiles([string[]]$Paths) {
    $files = @()
    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) { $files += Get-Item -LiteralPath $path; continue }
        if (Test-Path -LiteralPath $path -PathType Container) {
            $files += Get-ChildItem -LiteralPath $path -Recurse -File | Where-Object {
                $_.FullName -notmatch '[\\/](dist|node_modules)[\\/]'
            }
        }
    }
    return $files | Sort-Object FullName -Unique
}

function Get-Fingerprint([string[]]$Paths) {
    $lines = Get-InputFiles $Paths | ForEach-Object {
        $relative = $_.FullName.Substring($Root.Length).TrimStart('\')
        $stream = [System.IO.File]::OpenRead($_.FullName)
        $fileSha = [Security.Cryptography.SHA256]::Create()
        try { $contentHash = ([BitConverter]::ToString($fileSha.ComputeHash($stream))).Replace('-', '') }
        finally { $fileSha.Dispose(); $stream.Dispose() }
        "$relative|$contentHash"
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Test-NeedsBuild([string]$Output, [string]$Fingerprint, [string]$SavedFingerprint, [string[]]$Inputs) {
    if (-not (Test-Path -LiteralPath $Output)) { return $true }
    if ($SavedFingerprint) { return $SavedFingerprint -ne $Fingerprint }
    $outputTime = (Get-Item -LiteralPath $Output).LastWriteTimeUtc
    $newerInput = Get-InputFiles $Inputs | Where-Object { $_.LastWriteTimeUtc -gt $outputTime } | Select-Object -First 1
    return $null -ne $newerInput
}

function Invoke-Pnpm([string[]]$Arguments) {
    $process = Start-Process -FilePath "pnpm.cmd" -ArgumentList $Arguments -WorkingDirectory $Root -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) { throw "pnpm $($Arguments -join ' ') failed with exit code $($process.ExitCode)" }
}

function Wait-ForBackend([int]$Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Health) { return $true }
        Start-Sleep -Milliseconds 750
    }
    return $false
}

function Save-BackendMetadata($Listener, [string]$OutLog, [string]$ErrLog, [string]$ShutdownToken) {
    $process = Get-ProcessDetails ([int]$Listener.OwningProcess)
    $processStart = Get-ProcessStartTimeUtc $process
    $created = if ($processStart) { $processStart.ToString('o') } else { $null }
    Write-JsonFile $MetadataPath ([ordered]@{
        schemaVersion = 1
        pid = [int]$Listener.OwningProcess
        port = $Port
        root = $Root
        processStartTimeUtc = $created
        startedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        healthUrl = $HealthUrl
        stdoutLog = $OutLog
        stderrLog = $ErrLog
        command = 'pnpm run start:prod'
        shutdownToken = $ShutdownToken
    })
}

function Open-CurrentPolymarketMarket {
    $unixNow = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $slotStart = [Math]::Floor($unixNow / 300) * 300
    $url = "https://polymarket.com/event/btc-updown-5m-$slotStart"
    Start-Process $url
    return $url
}

Set-Location $Root
New-Item -ItemType Directory -Force -Path $LogsDir, $RuntimeDir | Out-Null
Get-ChildItem -LiteralPath $LogsDir -File -Filter 'backend-*.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip 40 |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

Write-Host "`nPolymarket BTC Terminal Launcher" -ForegroundColor White
Write-Host "Starts the local backend safely and opens the current BTC 5-minute market." -ForegroundColor Gray

Write-Step "Checking required tools"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Fail "Node.js 20+ is required."; exit 1 }
if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { Write-Fail "pnpm is required."; exit 1 }
Write-Ok "Node.js and pnpm are available"

if (-not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))) {
    Write-Step "Installing app dependencies"
    Invoke-Pnpm @('install')
    Write-Ok "Dependencies installed"
}

$serverInputs = @((Join-Path $Root 'apps\server\src'), (Join-Path $Root 'apps\server\package.json'), (Join-Path $Root 'packages\shared'), (Join-Path $Root 'pnpm-lock.yaml'))
$extensionInputs = @((Join-Path $Root 'apps\extension\src'), (Join-Path $Root 'apps\extension\entrypoints'), (Join-Path $Root 'apps\extension\package.json'), (Join-Path $Root 'apps\extension\wxt.config.ts'), (Join-Path $Root 'packages\shared'), (Join-Path $Root 'pnpm-lock.yaml'))
$buildState = Read-JsonFile $BuildStatePath
$serverFingerprint = Get-Fingerprint $serverInputs
$extensionFingerprint = Get-Fingerprint $extensionInputs

if (-not $SkipBuild -and (Test-NeedsBuild $ServerOutput $serverFingerprint $buildState.serverFingerprint $serverInputs)) {
    Write-Step "Building backend (source changed)"
    Invoke-Pnpm @('build:server')
    Write-Ok "Backend built"
} else { Write-Ok "Backend build is current" }

$manifestPath = Join-Path $ExtensionPath 'manifest.json'
if (-not $SkipBuild -and (Test-NeedsBuild $manifestPath $extensionFingerprint $buildState.extensionFingerprint $extensionInputs)) {
    Write-Step "Building Chrome extension (source changed)"
    Invoke-Pnpm @('build:extension:chrome')
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Extension build did not create $manifestPath" }
    Write-Ok "Chrome extension built"
} else { Write-Ok "Chrome extension build is current" }

if (-not $SkipBuild) {
    Write-JsonFile $BuildStatePath ([ordered]@{
        schemaVersion = 1
        serverFingerprint = $serverFingerprint
        extensionFingerprint = $extensionFingerprint
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    })
} elseif (-not (Test-Path -LiteralPath $ServerOutput) -or -not (Test-Path -LiteralPath $manifestPath)) {
    throw 'SkipBuild requires existing backend and extension build outputs.'
}

Write-Step "Checking backend"
$listener = Get-BackendListener
$metadata = Read-JsonFile $MetadataPath
$backendAlreadyRunning = $false
if ($listener) {
    if (Test-OwnedListener $listener $metadata) {
        if (-not (Test-Health)) { Write-Fail "The recorded backend owns port $Port but is unhealthy. Run STOP.bat, then start again."; exit 1 }
        $backendAlreadyRunning = $true
        Write-Ok "Backend is already running (PID $($listener.OwningProcess))"
    } else {
        Write-Fail "Port $Port is already in use by an unverified process (PID $($listener.OwningProcess))."
        Write-Host "For safety, the launcher did not stop it. Close that process or choose another backend port."
        exit 1
    }
}

if (-not $backendAlreadyRunning) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backendOut = Join-Path $LogsDir "backend-$stamp.out.log"
    $backendErr = Join-Path $LogsDir "backend-$stamp.err.log"
    # Preserve the existing authoritative database location. Migration code owns
    # schema evolution and backups inside this directory.
    $env:POLYMARKET_DATA_DIR = Join-Path $Root 'apps\server\data'
    $env:POLYMARKET_RUNTIME_DIR = $RuntimeDir
    $shutdownBytes = New-Object byte[] 32
    $shutdownRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $shutdownRng.GetBytes($shutdownBytes) } finally { $shutdownRng.Dispose() }
    $shutdownToken = ([BitConverter]::ToString($shutdownBytes)).Replace('-', '').ToLowerInvariant()
    $env:TERMINAL_SHUTDOWN_TOKEN = $shutdownToken

    Start-Process -FilePath 'pnpm.cmd' -ArgumentList @('run', 'start:prod') -WorkingDirectory $Root `
        -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -WindowStyle Hidden | Out-Null

    if (-not (Wait-ForBackend -Seconds 60)) {
        Write-Fail "Backend did not become healthy within 60 seconds."
        Write-Host "Output log: $backendOut"
        Write-Host "Error log:  $backendErr"
        exit 1
    }
    $listener = Get-BackendListener
    if (-not $listener) { Write-Fail "Backend health responded, but no listener was found on port $Port."; exit 1 }
    Save-BackendMetadata $listener $backendOut $backendErr $shutdownToken
    Write-Ok "Backend is running on http://127.0.0.1:$Port (PID $($listener.OwningProcess))"
}

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/live/disarm" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
    Write-Ok "Live execution is disarmed for startup safety"
} catch { Write-Warn "Could not confirm live disarm; check STATUS.bat before trading." }

Write-Step "Checking trading readiness"
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/readiness" -TimeoutSec 5
    Write-Host "State: $($response.operationalState)" -ForegroundColor White
    foreach ($reason in @($response.readiness.blockingReasons)) { Write-Host "  - $reason" -ForegroundColor Yellow }
} catch { Write-Warn "Backend is healthy, but readiness is still warming up." }

if (-not $NoBrowser) {
    Write-Step "Opening Polymarket"
    $openedUrl = Open-CurrentPolymarketMarket
    Write-Ok "Opened $openedUrl"
}

Write-Host "`nChrome extension" -ForegroundColor White
Write-Host "  ID:   $ExtensionId"
Write-Host "  Path: $ExtensionPath"
Write-Host "`nIf the panel looks old, reload extension ID $ExtensionId at chrome://extensions, then refresh Polymarket." -ForegroundColor Yellow
Write-Host "Use STATUS.bat to inspect the backend and STOP.bat to close it." -ForegroundColor Green
