@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\ElysianToolSuite\Bootstrap.ps1" -Tool NpcDogma %*
if errorlevel 1 (
  echo.
  echo Elysian NPC Dogma Workbench could not start.
  pause
  exit /b 1
)
