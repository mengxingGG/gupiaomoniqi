@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

title Four Seas Stock Simulator - Domain Keepalive

set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "DEPLOY_ROOT=%~1"
if defined DEPLOY_ROOT goto root_ready

for %%I in ("%~dp0.") do set "LAUNCHER_DIRECTORY=%%~fI"
for %%I in ("%LAUNCHER_DIRECTORY%") do if /I "%%~nxI"=="current" goto use_parent_root

set "DEPLOY_ROOT=C:\ProgramData\gupiaomoniqi"
goto root_ready

:use_parent_root
for %%I in ("%~dp0..") do set "DEPLOY_ROOT=%%~fI"

:root_ready
for %%I in ("%DEPLOY_ROOT%") do set "DEPLOY_ROOT=%%~fI"
set "WINDOWS_SCRIPTS=%DEPLOY_ROOT%\current\deploy\windows"
set "INSTALL_CLOUDFLARED=%WINDOWS_SCRIPTS%\Install-Cloudflared.ps1"
set "INSTALL_TUNNEL=%WINDOWS_SCRIPTS%\Install-TunnelTask.ps1"

echo.
echo ========================================
echo   Cloudflare domain keepalive
echo   Deployment root: "%DEPLOY_ROOT%"
echo   This launcher never starts or stops the application.
echo ========================================
echo.

if not exist "%POWERSHELL_EXE%" (
  echo [ERROR] Windows PowerShell 5.1 was not found.
  exit /b 1
)

if not exist "%INSTALL_CLOUDFLARED%" (
  echo [ERROR] Deployment script was not found:
  echo         "%INSTALL_CLOUDFLARED%"
  echo [HINT] Run this launcher from the deployed current directory,
  echo        or pass the deployment root as the first argument.
  exit /b 1
)

if not exist "%INSTALL_TUNNEL%" (
  echo [ERROR] Deployment script was not found:
  echo         "%INSTALL_TUNNEL%"
  exit /b 1
)

"%POWERSHELL_EXE%" -NoProfile -NonInteractive -Command "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = New-Object Security.Principal.WindowsPrincipal($identity); if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please run this launcher from an Administrator command prompt.
  exit /b 1
)

"%POWERSHELL_EXE%" -NoProfile -NonInteractive -Command "foreach ($task in @(Get-ScheduledTask -TaskName 'Gupiaomoniqi-Cloudflare-Quick-Tunnel' -ErrorAction SilentlyContinue)) { if ([string]$task.State -eq 'Running') { exit 0 } }; exit 1" >nul 2>&1
if not errorlevel 1 goto install_tunnel

if exist "%DEPLOY_ROOT%\tools\cloudflared.exe" goto install_tunnel
where cloudflared.exe >nul 2>&1
if not errorlevel 1 goto install_tunnel

echo [SETUP] cloudflared is missing; installing the official Windows build...
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%INSTALL_CLOUDFLARED%" -Root "%DEPLOY_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] cloudflared installation failed.
  exit /b 1
)

:install_tunnel
echo [SETUP] Ensuring the independent tunnel keepalive task is running...
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%INSTALL_TUNNEL%" -Root "%DEPLOY_ROOT%" -PreserveRunningTunnel
set "TUNNEL_EXIT_CODE=%errorlevel%"
if not "%TUNNEL_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Domain keepalive startup failed with code %TUNNEL_EXIT_CODE%.
  echo [INFO] A previously running tunnel was not restarted or replaced.
  exit /b %TUNNEL_EXIT_CODE%
)

echo.
echo [OK] Domain keepalive is managed independently from the application.
echo [INFO] Closing this window will not stop the scheduled tunnel task.
echo [INFO] Current URL file: "%DEPLOY_ROOT%\runtime\cloudflare-quick-url.txt"
exit /b 0
