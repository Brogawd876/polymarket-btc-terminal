$ErrorActionPreference = "Stop"
Write-Host "Verifying Terminal Configuration by running tests..."
pnpm test
if ($LASTEXITCODE -ne 0) {
    Write-Error "Tests failed!"
    exit $LASTEXITCODE
}
Write-Host "Pinging backend /api/v1/health..."
$response = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/health" -Method Get -ErrorAction Stop
Write-Host "Backend health response: $($response | ConvertTo-Json -Compress)"

Write-Host "Verification passed."
