$ErrorActionPreference = "Stop"

$TaskName = "Novapolis Lead Radar"
schtasks.exe /Delete /TN $TaskName /F | Out-Host

Write-Host "Removed autostart task: $TaskName"
