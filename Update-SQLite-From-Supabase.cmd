@echo off
setlocal
title Update SQLite Database from Supabase
cd /d "%~dp0.."

echo ===================================================================
echo     UPDATING LOCAL SQLITE DATABASE FROM SUPABASE
echo ===================================================================
echo.
python tools\sync_from_supabase.py
echo.
echo ===================================================================
echo Update finished! Press any key to close this window.
pause >nul
