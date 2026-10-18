@echo off
title Oraforge Local eTIMS Fiscal Worker
color 0A
cls
echo ==============================================================================
echo           ORAFORGE LOCAL eTIMS FISCAL WORKER (WINDOWS PAYPOINT)
echo ==============================================================================
echo This worker connects your local Windows KRA eTIMS Paypoint generator
echo to the Online POS running on Vercel.
echo.
echo When sales are made on the online POS, this worker automatically signs
echo and registers the invoices locally via EtimsFastInvoiceGenerator.exe and
echo returns the official KRA CU Invoice number and QR code in real-time.
echo ==============================================================================
echo.

cd /d "%~dp0windows\etims-helper"

set PYTHON_EXE=python
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe" (
        set PYTHON_EXE="C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe"
    ) else (
        echo [ERROR] Python not found in PATH or standard directory!
        pause
        exit /b 1
    )
)

echo Starting Worker...
%PYTHON_EXE% local_etims_worker.py %*

echo.
echo ==============================================================================
echo Worker has stopped.
pause
