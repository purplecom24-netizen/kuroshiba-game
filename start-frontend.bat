@echo off
REM ===========================================================================
REM  Kuroshiba フロントエンド起動（Windows / ダブルクリックでOK）
REM  初回は自動で必要なものをインストールします。
REM  事前に Node.js (LTS) がインストールされている必要があります。
REM ===========================================================================
cd /d "%~dp0frontend"

where npm >nul 2>nul
if errorlevel 1 (
  echo [エラー] Node.js / npm が見つかりません。
  echo https://nodejs.org/ から "LTS" 版をインストールしてください。
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 初回セットアップ: フロントエンドの依存をインストール中（数分かかります）...
  call npm install
)

echo.
echo ============================================================
echo  フロントエンド起動: http://localhost:5173
echo  起動後、ブラウザで上のURLを開いてください
echo  この黒い画面は閉じないでください（閉じると停止します）
echo ============================================================
echo.
call npm run dev

pause
