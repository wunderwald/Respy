@echo off
rem Run from this script's own folder (works from any drive / cwd), and pass
rem all arguments through, e.g.:  start_bridge.bat --host 192.168.10.12
cd /d "%~dp0"
if exist .venv\Scripts\python.exe (
    .venv\Scripts\python.exe lsl_to_videosync.py %*
) else (
    python lsl_to_videosync.py %*
)
if errorlevel 1 pause
