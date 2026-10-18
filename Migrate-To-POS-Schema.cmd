@echo off
setlocal
cd /d "%~dp0"
title Oraforge POS - Migration Pipeline to Dedicated 'pos' Schema

echo =====================================================================
echo    ORAFORGE POS: DATA MIGRATION PIPELINE (PUBLIC -> POS SCHEMA)
echo =====================================================================
echo.
echo This tool transfers all catalog, inventory, suppliers, and orders
echo from the client's existing Supabase tables into your new 'pos' schema.
echo.
echo Existing public tables (public.menu_items, public.nicoo_*, etc.)
echo will remain completely UNTOUCHED.
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH.
    pause
    exit /b 1
)

python tools\migrate_to_pos_schema.py

echo.
pause
