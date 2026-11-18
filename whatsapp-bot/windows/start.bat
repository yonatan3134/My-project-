@echo off
wscript.exe "%~dp0hidden.vbs"
echo The bot is starting. Settings page: http://localhost:8080
timeout /t 8 >nul
start "" http://localhost:8080
