# Installs (or updates) the bot on this Windows computer and starts it.
# Run by double-clicking install.bat. Running it again with a newer download updates the bot
# and keeps the settings, the WhatsApp link and the history.
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'whatsapp-bot'

function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host ''; Write-Host "ERROR: $t" -ForegroundColor Red; Write-Host 'Copy this window to Claude.'; exit 1 }

Write-Host 'WhatsApp channels bot - setup' -ForegroundColor Green

Step 'Checking Node.js'
Refresh-Path
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
  # the bot uses Node's built-in SQLite: Node 22.13 or newer
  $ok = (& node -p "const [a,b]=process.versions.node.split('.').map(Number); a>22||(a===22&&b>=13)?1:0")
  if ($ok -eq '1') { $nodeOk = $true }
}
if (-not $nodeOk) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Start-Process 'https://nodejs.org'
    Fail 'Node.js is missing. Install the LTS version from nodejs.org (opened in the browser), then run install.bat again.'
  }
  Write-Host 'Installing Node.js (if Windows asks for permission, click Yes)...'
  winget upgrade --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements 2>$null | Out-Null
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
  Refresh-Path
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js did not install. Restart the computer and run install.bat again.' }
}
Write-Host "Node.js $(& node -v)"

Step 'Checking ffmpeg (for videos; optional)'
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  try { winget install --id Gyan.FFmpeg -e --silent --accept-source-agreements --accept-package-agreements | Out-Host } catch { }
  Refresh-Path
}
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Write-Host 'ffmpeg found' } else { Write-Host 'ffmpeg not found: videos will be sent as pictures' -ForegroundColor Yellow }

Step "Copying the bot to $dest"
if (Test-Path (Join-Path $dest 'windows\stop.ps1')) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'windows\stop.ps1') }
New-Item -ItemType Directory -Force $dest | Out-Null
robocopy $src $dest /E /XD node_modules data dist .git /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "copying failed (robocopy code $LASTEXITCODE)" }
$envFile = Join-Path $dest '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $dest '.env.example') $envFile }
Set-Location $dest

Step 'Installing libraries (a few minutes on a slow computer)'
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Fail 'build failed' }

Step 'Start with Windows and keep running'
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'whatsapp-bot.vbs'
Set-Content -Path $launcher -Encoding ASCII -Value @(
  'Set sh = CreateObject("WScript.Shell")',
  "sh.Run ""wscript.exe """"$dest\windows\hidden.vbs"""""", 0, False"
)
# the computer must not go to sleep while it is plugged in, or the bot stops posting
try { powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0 } catch { }
Write-Host 'The bot starts by itself when Windows starts. Sleep is turned off while plugged in.'

Step 'Starting the bot'
$pw = Join-Path $dest 'data\panel-password'
& wscript.exe (Join-Path $dest 'windows\hidden.vbs')
for ($i = 0; $i -lt 60 -and -not (Test-Path $pw); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Path $pw)) { Fail "the bot did not start. Look at $dest\data\bot.log" }
Start-Sleep -Seconds 2
Start-Process 'http://localhost:8080'

Write-Host ''
Write-Host '==============================================' -ForegroundColor Green
Write-Host ' Done. The bot is running.' -ForegroundColor Green
Write-Host ' Settings page: http://localhost:8080 (opened in the browser)'
Write-Host " Bot folder:    $dest"
Write-Host ' Stop / start:  stop.bat / start.bat in the windows folder there'
Write-Host '==============================================' -ForegroundColor Green
