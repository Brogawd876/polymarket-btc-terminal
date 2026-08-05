$ErrorActionPreference = "Stop"

Write-Host "[1/10] Verifying Node version..."
$nodeVer = node -v
Write-Host "Node version: $nodeVer"

Write-Host "[2/10] Verifying pnpm..."
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing pnpm globally..."
    npm install -g pnpm
}

Write-Host "[3/10] Installing workspace dependencies..."
pnpm install

Write-Host "[4/10] Verifying .env setup..."
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env from .env.example"
    }
}
if (-not (Test-Path "apps/server/.env")) {
    if (Test-Path "apps/server/.env.example") {
        Copy-Item "apps/server/.env.example" "apps/server/.env"
        Write-Host "Created apps/server/.env from apps/server/.env.example"
    }
}

Write-Host "[5/10] Creating data and log directories..."
New-Item -ItemType Directory -Force -Path "data" | Out-Null
New-Item -ItemType Directory -Force -Path "logs" | Out-Null
New-Item -ItemType Directory -Force -Path "apps/server/data" | Out-Null

Write-Host "[6/10] Typechecking workspace packages..."
pnpm typecheck

Write-Host "[7/10] Building shared package..."
pnpm --filter shared build

Write-Host "[8/10] Building backend server..."
pnpm build:server

Write-Host "[9/10] Building Chromium extension..."
pnpm build:extension:chrome

$extPath = Resolve-Path "apps/extension/.wxt/chrome-mv3" -ErrorAction SilentlyContinue
if (-not $extPath) {
    $extPath = Resolve-Path "apps/extension/dist" -ErrorAction SilentlyContinue
}

Write-Host "=========================================================="
Write-Host "INSTALLATION COMPLETE AND VERIFIED"
Write-Host "Extension directory for Chromium loading:"
Write-Host "  $extPath"
Write-Host "To start the application, run:"
Write-Host "  .\start.bat"
Write-Host "=========================================================="
