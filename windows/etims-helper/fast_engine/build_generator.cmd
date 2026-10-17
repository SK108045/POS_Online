@echo off
setlocal

set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

set "BIN=%~dp0"
if not exist "%BIN%EBM2x.dll" if not "%~1"=="" set "BIN=%~1\"
if not exist "%BIN%EBM2x.dll" set "BIN=C:\eTIMS-Paypoint-Win\bin\"

set "NETSTD=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\netstandard.dll"
if not exist "%NETSTD%" set "NETSTD=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\netstandard.dll"

set "SRC=%~dp0EtimsFastInvoiceGenerator.cs"
set "OUT=%~dp0EtimsFastInvoiceGenerator.exe"

echo Compiling EtimsFastInvoiceGenerator.exe...
"%CSC%" /nologo /target:exe /out:"%OUT%" /r:"%BIN%EBM2x.dll" /r:"%BIN%System.Data.SQLite.dll" /r:"%BIN%Newtonsoft.Json.dll" /r:"%BIN%zxing.dll" /r:"%BIN%zxing.presentation.dll" /r:"%NETSTD%" /r:System.Web.dll /r:System.Drawing.dll /r:System.Data.dll "%SRC%"

if %ERRORLEVEL% equ 0 (
    echo Build succeeded: %OUT%
) else (
    echo Build failed with error %ERRORLEVEL%
)
exit /b %ERRORLEVEL%
