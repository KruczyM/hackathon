$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$StartScript = Join-Path $Root "scripts\start-novapolis.ps1"
$TaskName = "Novapolis Lead Radar"
$Action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""

schtasks.exe /Create /TN $TaskName /TR $Action /SC ONLOGON /RL LIMITED /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Could not install autostart task. Run this command from a normal user PowerShell with permission to create scheduled tasks, or start PowerShell as Administrator."
}

Write-Host "Installed autostart task: $TaskName"
Write-Host "The app will open http://127.0.0.1:8787 after Windows login."
