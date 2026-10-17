@echo off
setlocal enabledelayedexpansion
title Update SQLite Database from Supabase
cd /d "%~dp0"

echo ===================================================================
echo     UPDATING LOCAL SQLITE DATABASE FROM SUPABASE
echo ===================================================================
echo.

set SCRIPT=
if exist "%~dp0tools\sync_from_supabase.py" set SCRIPT="%~dp0tools\sync_from_supabase.py"
if not defined SCRIPT if exist "%~dp0Programmatic-Fix\tools\sync_from_supabase.py" set SCRIPT="%~dp0Programmatic-Fix\tools\sync_from_supabase.py"
if not defined SCRIPT if exist "C:\eTIMS-Analysis\tools\sync_from_supabase.py" set SCRIPT="C:\eTIMS-Analysis\tools\sync_from_supabase.py"
if not defined SCRIPT if exist "C:\eTIMS-Analysis\Programmatic-Fix\POS-Invoice-Prgrammatic\Programmatic-Fix\tools\sync_from_supabase.py" set SCRIPT="C:\eTIMS-Analysis\Programmatic-Fix\POS-Invoice-Prgrammatic\Programmatic-Fix\tools\sync_from_supabase.py"

if defined SCRIPT (
    python !SCRIPT!
) else (
    echo Error: Could not locate sync_from_supabase.py!
)

echo.
echo ===================================================================
echo Update finished! Press any key to close this window.
pause >nul
