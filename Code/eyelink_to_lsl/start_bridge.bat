@echo off
rem Run from this script's own folder (works from any drive / cwd), and pass
rem all arguments through, e.g.:  start_bridge.bat --edf-filename sub01
cd /d "%~dp0"
.venv\Scripts\python.exe run_bridge.py %*
if errorlevel 1 pause
