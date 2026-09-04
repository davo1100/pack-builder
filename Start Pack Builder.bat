@echo off
setlocal
cd /d "%~dp0"
title Pack Builder

set "PYCMD="
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
  if not errorlevel 1 set "PYCMD=py -3"
)

if not defined PYCMD call :find_python python
if not defined PYCMD call :find_python python3

if not defined PYCMD (
  echo Python 3 is required. Install it from https://www.python.org/downloads/
  echo On the first installer screen, tick "Add python.exe to PATH" at the bottom left,
  echo then click Install Now. After that, run this file again.
  echo.
  echo If Python is already installed, run the installer, choose Modify, and tick
  echo Add python.exe to PATH. Turn off the python.exe App execution alias in
  echo Windows Settings if the Microsoft Store opens instead of Pack Builder.
  pause
  exit /b 1
)

echo Starting pack builder...
echo Keep this window open while you work. Close it to stop.
echo.
if exist "%PYCMD%" (
  "%PYCMD%" studio.py
) else (
  %PYCMD% studio.py
)
if errorlevel 1 (
  echo.
  echo Pack builder did not start. The error is shown above.
  pause
  exit /b 1
)
goto :eof

:find_python
where %1 >nul 2>&1
if errorlevel 1 exit /b 1
for /f "delims=" %%I in ('where %1 2^>nul') do (
  echo %%I | find /i "\WindowsApps\" >nul
  if errorlevel 1 (
    "%%I" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
    if not errorlevel 1 (
      set "PYCMD=%%I"
      exit /b 0
    )
  )
)
exit /b 1
