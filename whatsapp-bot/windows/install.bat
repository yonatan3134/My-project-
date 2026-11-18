@echo off
chcp 65001 >nul
title WhatsApp bot - setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
