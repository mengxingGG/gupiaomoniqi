@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

title Four Seas Stock Simulator - Local Services

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"

if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"
if not exist "%NPM_CMD%" set "NPM_CMD=npm.cmd"

"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found. Install Node.js 22 or newer.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\concurrently.cmd" (
  echo.
  echo [SETUP] Installing project dependencies...
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed.
    echo.
    pause
    exit /b 1
  )
)

if not exist "logs" mkdir "logs"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "LOG_STAMP=%%i"
set "LOG_FILE=%CD%\logs\dev-app-%LOG_STAMP%.log"
set "GUPIAOMONIQI_START_ROOT=%CD%"
set "GUPIAOMONIQI_START_NPM=%NPM_CMD%"
set "GUPIAOMONIQI_START_LOG=%LOG_FILE%"

echo.
echo [INFO] This launcher manages local data preparation, backend, and frontend.
echo [INFO] It never starts, stops, or restarts the independent Cloudflare tunnel.

echo.
echo [SETUP] Cleaning previous local server processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$workspace = (Resolve-Path '.').Path; $patterns = @('server/src/index.ts','web/vite.config.ts','npm-cli.js run dev:server','npm-cli.js run dev:app','concurrently'); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine } | ForEach-Object { $commandLine = $_.CommandLine; if ($commandLine -like ('*' + $workspace + '*')) { $matched = $false; foreach ($pattern in $patterns) { if ($commandLine -like ('*' + $pattern + '*')) { $matched = $true; break } } if ($matched) { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ('[SETUP] Stopped stale process PID ' + $_.ProcessId) } catch {} } } }"

echo.
echo [SETUP] Preparing local databases...
echo [SETUP] If the virtual database and seed are missing, 1200 stocks will be fetched automatically.
call "%NPM_CMD%" run local:prepare
if errorlevel 1 (
  echo.
  echo [ERROR] Local database preparation failed.
  echo.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Local services are starting
echo   Includes: data + backend + frontend
echo   Excludes: Cloudflare tunnel / domain
echo   Web:    http://localhost:5173
echo   Server: http://localhost:3100
echo   Real market: Eastmoney full-universe sync to server\data\real-pgdata
echo   Log file: %LOG_FILE%
echo   Press Ctrl+C to stop both services
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath $env:GUPIAOMONIQI_START_ROOT; & $env:GUPIAOMONIQI_START_NPM run dev:app 2>&1 | Tee-Object -FilePath $env:GUPIAOMONIQI_START_LOG; exit $LASTEXITCODE"
set "APP_EXIT_CODE=%errorlevel%"

if not "%APP_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Development services exited with code %APP_EXIT_CODE%.
  echo.
  pause
)

exit /b %APP_EXIT_CODE%
