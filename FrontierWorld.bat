@echo off
setlocal
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0FrontierWorld.ps1" %*
exit /b %ERRORLEVEL%
