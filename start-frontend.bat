@echo off
REM ===========================================================================
REM  Kuroshiba frontend launcher (Windows / just double-click)
REM  Uses goto-based flow (no parenthesized blocks) so it works even when the
REM  folder path contains parentheses like "(1)" or spaces.
REM  Requires Node.js (LTS) installed. Keep this file ASCII-only.
REM ===========================================================================
cd /d "%~dp0frontend"

where npm >nul 2>nul
if errorlevel 1 goto no_node

if not exist node_modules goto install
goto run

:install
echo First-time setup: installing frontend dependencies (a few minutes)...
call npm install
goto run

:run
echo.
echo ============================================================
echo  Frontend starting at: http://localhost:5173
echo  Open that URL in your browser once it says "Local:".
echo  Do NOT close this window - closing it stops the app.
echo ============================================================
echo.
call npm run dev
goto end

:no_node
echo [ERROR] Node.js / npm was not found.
echo Install the "LTS" version from https://nodejs.org/ then restart the PC.

:end
echo.
pause
