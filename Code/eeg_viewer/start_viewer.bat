@echo off
setlocal
pushd "%~dp0"

rem Install Electron on first run (or if the previous install did not finish)
if not exist "node_modules\electron\path.txt" (
    echo Installing dependencies...
    call npm install
)

call npm start
set "RC=%ERRORLEVEL%"

popd
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
