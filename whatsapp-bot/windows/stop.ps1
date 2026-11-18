# Stops the bot and its keep-alive loop.
$root = Split-Path -Parent $PSScriptRoot
$flag = Join-Path $root 'data\stop'
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null
Set-Content -Path $flag -Value 'stop'
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*dist*index.js*' -and $_.CommandLine -notlike '*\cli\*') -or
  ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like "*$root*run.ps1*")
}
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Remove-Item $flag -Force -ErrorAction SilentlyContinue
