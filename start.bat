@echo off
REM ============================================================
REM  NAQC Parts/Purchases Request - start script (Windows)
REM  Put this file inside the "po-app" folder and double-click it.
REM ============================================================

REM Run from the folder this file lives in
cd /d "%~dp0"

REM Check that Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Download the "LTS" version from https://nodejs.org , install it,
  echo  then double-click this file again.
  echo.
  pause
  exit /b
)

REM Install dependencies the first time (only if not already installed)
if not exist "node_modules" (
  echo.
  echo  First-time setup: installing dependencies. This can take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed. Check your internet connection and try again.
    pause
    exit /b
  )
)

REM Open the app in the default browser after a short delay
start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000"

echo.
echo  Starting the NAQC PO app...
echo  Keep this window open while you use it.
echo  Close it (or press Ctrl+C) to stop the app.
echo.

call npm start

pause
