@echo off
setlocal
cd /d "%~dp0"
title Oraforge eTIMS Local Worker Bridge (Cloud POS)

echo =====================================================================
echo    ORAFORGE eTIMS LOCAL FISCAL WORKER (WINDOWS BRIDGE)
echo =====================================================================
echo.
echo Listening for sales from Online POS...
echo Executing programmatic KRA fiscal signing via EtimsFastInvoiceGenerator.exe
echo.

if exist "%~dp0EtimsLocalWorker.exe" (
    "%~dp0EtimsLocalWorker.exe" %*
) else (
    echo [ERROR] EtimsLocalWorker.exe not found!
    pause
    exit /b 1
)

pause
