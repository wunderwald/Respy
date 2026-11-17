@echo off
setlocal

rem --- SETTINGS ---------------------------------------------------------------

rem Folder with the .xdf recordings (searched recursively)
set "INPUT_DIR=C:\Users\a47_nb_admin\Desktop\RespFishData\LSL"

rem Folder for the processed data
set "OUTPUT_DIR=C:\Users\a47_nb_admin\Desktop\RespFishData\CSV_PLACEHOLDER"

rem Folder the .xdf files are copied to
set "BACKUP_DIR=C:\Users\a47_nb_admin\Desktop\RespFishData\BACKUP_PLACEHOLDER"

rem 1 = reprocess recordings that already have an output folder, 0 = skip them
set "OVERWRITE=0"

rem 1 = do not copy the .xdf files to BACKUP_DIR, 0 = back them up
set "DISABLE_BACKUP=0"

rem 1 = keep this window open at the end, 0 = close it
set "PAUSE_AT_END=1"

rem ----------------------------------------------------------------------------

if "%INPUT_DIR:~-1%"=="\" set "INPUT_DIR=%INPUT_DIR%."
if "%OUTPUT_DIR:~-1%"=="\" set "OUTPUT_DIR=%OUTPUT_DIR%."
if "%BACKUP_DIR:~-1%"=="\" set "BACKUP_DIR=%BACKUP_DIR%."

set ARGS=--input "%INPUT_DIR%" --output "%OUTPUT_DIR%" --backup "%BACKUP_DIR%"
if "%OVERWRITE%"=="1" set ARGS=%ARGS% --overwrite
if "%DISABLE_BACKUP%"=="1" set ARGS=%ARGS% --disable_backup

pushd "%~dp0"
python process_xdfs.py %ARGS% %*
set "RC=%ERRORLEVEL%"
popd

echo.
if "%RC%"=="0" (echo Finished without errors.) else (echo Finished with errors, see above.)
if "%PAUSE_AT_END%"=="1" pause

endlocal & exit /b %RC%
