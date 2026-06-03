$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$HealthUrl = "http://127.0.0.1:8787/api/health"
$AppUrl = "http://127.0.0.1:8787"

function Test-NovapolisRunning {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-NovapolisRunning)) {
  if (-not (Test-Path (Join-Path $Root "dist\index.html"))) {
    Push-Location $Root
    npm run build
    Pop-Location
  }

  Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"npm start`""

  Start-Sleep -Seconds 5
}

Start-Process $AppUrl
