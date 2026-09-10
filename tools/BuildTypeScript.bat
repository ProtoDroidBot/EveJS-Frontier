@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0BuildTypeScript.ps1"
exit /b %errorlevel%
