@echo off
REM ===========================================================================
REM  Kuroshiba backend launcher (Windows / just double-click)
REM  First run auto-creates a Python venv and installs dependencies.
REM  Requires Python 3.11+ installed (with "Add Python to PATH" checked).
REM  NOTE: keep this file ASCII-only to avoid cmd.exe encoding issues.
REM ===========================================================================
setlocal
cd /d "%~dp0backend"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python was not found.
  echo Install it from https://www.python.org/downloads/
  echo and CHECK "Add python.exe to PATH" during installation.
  echo.
  pause
  exit /b 1
)

if not exist .venv (
  echo First-time setup: creating Python virtual environment...
  python -m venv .venv
)

echo Checking dependencies (first run may take a few minutes)...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt

echo.
echo ============================================================
echo  Backend running at: http://localhost:8000
echo  Do NOT close this window (closing it stops the server).
echo ============================================================
echo.
.venv\Scripts\python.exe -m uvicorn app.main:app --reload

pause
