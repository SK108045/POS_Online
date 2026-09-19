@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%capacitor" (
    cd /d "%SCRIPT_DIR%capacitor"
) else if exist "%SCRIPT_DIR%POS_APK\capacitor" (
    cd /d "%SCRIPT_DIR%POS_APK\capacitor"
) else (
    echo Error: Could not locate capacitor directory.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing required npm dependencies...
    call npm install
)

if not exist "www\sqlite-bridge.js" (
    echo Building SQLite bridge bundle...
    call npm run build:bridge
)

call npm run dev
