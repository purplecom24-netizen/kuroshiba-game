@echo off
rem Phase 2 日次スキャン起動用(タスクスケジューラから呼ぶ)
cd /d %~dp0
if not exist forward mkdir forward
py daily_scan.py >> forward\scan_log.txt 2>&1
