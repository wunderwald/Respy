@echo off
rem Run from this script's own folder (works from any drive / cwd), and pass
rem all arguments through, e.g.:  start_bridge.bat --port 5000
cd /d "%~dp0"
if exist .venv\Scripts\python.exe (
    .venv\Scripts\python.exe videosync_to_lsl.py %*
) else (
    python videosync_to_lsl.py %*
)
if errorlevel 1 pause
