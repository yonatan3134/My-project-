@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
echo The bot is stopped. To start it again: start.bat
pause
