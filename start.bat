@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-proxy.ps1"
if errorlevel 1 (
  echo [ghost-overlay] Startup aborted due to preflight error.
  exit /b %errorlevel%
)

npx electron .
