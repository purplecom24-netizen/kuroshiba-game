@echo off
REM ===========================================================================
REM  Kuroshiba frontend launcher (Windows / just double-click)
REM  First run auto-installs frontend dependencies.
REM  Requires Node.js (LTS) installed.
REM  NOTE: keep this file ASCII-only to avoid cmd.exe encoding issues.
REM ===========================================================================
setlocal
cd /d "%~dp0frontend"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js / npm was not found.
  echo Install the "LTS" version from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First-time setup: installing frontend dependencies (a few minutes)...
  call npm install
)

echo.
echo ============================================================
echo  Frontend running at: http://localhost:5173
echo  Open that URL in your browser after it starts.
echo  Do NOT close this window (closing it stops it).
echo ============================================================
echo.
call npm run dev

pause
