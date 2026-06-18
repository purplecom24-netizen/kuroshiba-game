@echo off
REM ===========================================================================
REM  Kuroshiba バックエンド起動（Windows / ダブルクリックでOK）
REM  初回は自動でPython仮想環境を作り、必要なものをインストールします。
REM  事前に Python 3.11+ がインストールされている必要があります。
REM ===========================================================================
cd /d "%~dp0backend"

where python >nul 2>nul
if errorlevel 1 (
  echo [エラー] Python が見つかりません。
  echo https://www.python.org/downloads/ からインストールし、
  echo インストール時に "Add Python to PATH" にチェックを入れてください。
  echo.
  pause
  exit /b 1
)

if not exist .venv (
  echo 初回セットアップ: Python仮想環境を作成中...
  python -m venv .venv
)

echo 依存ライブラリを確認中（初回は少し時間がかかります）...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt

echo.
echo ============================================================
echo  バックエンド起動: http://localhost:8000
echo  この黒い画面は閉じないでください（閉じると停止します）
echo ============================================================
echo.
.venv\Scripts\python.exe -m uvicorn app.main:app --reload

pause
