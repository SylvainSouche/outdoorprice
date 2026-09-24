@echo off
setlocal enabledelayedexpansion
set PORT=3000
cd /d "%~dp0"
echo.
echo ==========================================
echo   OutdoorPrice - Standalone Launcher
for /f "delims=" %%v in (VERSION) do set VERSION=%%v
echo   Version: !VERSION!
echo ==========================================
echo.
echo [1/4] Checking prerequisites...
where node >nul 2>nul || (echo   [X] Node.js not found. pause & exit /b 1)
for /f "delims=" %%n in ('node --version') do echo   [OK] Node.js: %%n
where bun >nul 2>nul && (set HAS_BUN=1) || (set HAS_BUN=0)
echo.
echo [2/4] Installing dependencies...
if not exist "node_modules" (
  if !HAS_BUN! equ 1 (bun install) else (npm install)
  echo   [OK] Installed
) else (echo   [OK] Already installed)
echo.
echo [3/4] Checking Playwright Chromium...
set PW_HOME=%USERPROFILE%\AppData\Local\ms-playwright
if not exist "%PW_HOME%\chromium*" (
  echo   Installing...
  if !HAS_BUN! equ 1 (bunx playwright install chromium) else (npx playwright install chromium)
  echo   [OK] Installed
) else (echo   [OK] Already installed)
echo.
echo [4/4] Starting server on port !PORT!...
if !HAS_BUN! equ 1 (set PORT=!PORT! && start /b bun run dev > "%TEMP%\outdoorprice.log" 2>&1) else (set PORT=!PORT! && start /b npm run dev > "%TEMP%\outdoorprice.log" 2>&1)
set WAITED=0
:waitloop
timeout /t 1 /nobreak >nul
set /a WAITED+=1
powershell -command "try{(Invoke-WebRequest -Uri 'http://localhost:!PORT!' -UseBasicParsing -TimeoutSec 2).StatusCode}catch{}" >nul 2>nul
if !errorlevel! equ 0 goto :ready
if !WAITED! geq 30 (echo   [X] Timeout. Check %TEMP%\outdoorprice.log & pause & exit /b 1)
goto :waitloop
:ready
echo   [OK] Server ready
start http://localhost:!PORT!
echo.
echo   Browser: http://localhost:!PORT!
echo   Close this window to stop.
echo.
pause
taskkill /f /im node.exe >nul 2>nul
