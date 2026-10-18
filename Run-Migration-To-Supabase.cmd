@echo off
title Oraforge POS - SQLite to Supabase Migration Tool
color 0B
cls
echo ==============================================================================
echo             ORAFORGE POS: SQLITE TO SUPABASE DATABASE MIGRATION
echo ==============================================================================
echo Transfers products, categories, suppliers, and sales history from local
echo SQLite database (data/pos.sqlite3) into your Supabase PostgreSQL cloud database.
echo ==============================================================================
echo.

cd /d "%~dp0tools"

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

%PYTHON_EXE% migrate_sqlite_to_supabase.py %*

echo.
echo ==============================================================================
echo Migration completed! Press any key to close this window.
echo ==============================================================================
pause >nul
