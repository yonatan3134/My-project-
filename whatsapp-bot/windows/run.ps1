# Keeps the bot running: starts it again a few seconds after it stops for any reason.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$env:PANEL_PORT = '8080'
$env:PANEL_HOST = '127.0.0.1'
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null
$log = Join-Path $root 'data\bot.log'
$flag = Join-Path $root 'data\stop'

# only one copy at a time
$mutex = New-Object System.Threading.Mutex($false, 'Local\whatsapp-channels-bot')
if (-not $mutex.WaitOne(0)) { exit }

while (-not (Test-Path $flag)) {
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 20MB)) { Move-Item $log "$log.old" -Force }
  # cmd keeps the log in UTF-8 (PowerShell's own redirection would not)
  cmd /c "node dist\index.js >> `"$log`" 2>&1"
  if (Test-Path $flag) { break }
  Start-Sleep -Seconds 5
}
$mutex.ReleaseMutex()
