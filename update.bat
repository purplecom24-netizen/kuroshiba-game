@echo off
REM ===========================================================================
REM  Kuroshiba updater (Windows / double-click)
REM  Pulls the latest code from GitHub. Only works if you got the project via
REM  "git clone" (not a ZIP download). Keep this file ASCII-only.
REM ===========================================================================
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 goto no_git

echo Fetching the latest changes from GitHub...
git pull
goto end

:no_git
echo [ERROR] Git was not found.
echo Install "Git for Windows" from https://git-scm.com/download/win
echo and get the project with "git clone" to use this updater.

:end
echo.
echo Done. Restart start-backend.bat / start-frontend.bat to apply updates.
pause
