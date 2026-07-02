@echo off
REM ===========================================================================
REM  Kuroshiba backend launcher (Windows / just double-click)
REM  Uses goto-based flow (no parenthesized blocks) so it works even when the
REM  folder path contains parentheses like "(1)" or spaces.
REM  Requires Python 3.11+ (with "Add Python to PATH"). Keep this file ASCII-only.
REM ===========================================================================
cd /d "%~dp0backend"

where python >nul 2>nul
if errorlevel 1 goto no_python

if not exist .venv goto makevenv
goto deps

:makevenv
echo First-time setup: creating Python virtual environment...
python -m venv .venv

:deps
echo Checking dependencies (first run may take a few minutes)...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt

echo.
echo ============================================================
echo  Backend running at: http://localhost:8000
echo  Do NOT close this window - closing it stops the server.
echo ============================================================
echo.
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
goto end

:no_python
echo [ERROR] Python was not found.
echo Install from https://www.python.org/downloads/ and CHECK
echo "Add python.exe to PATH" during installation.

:end
echo.
pause
