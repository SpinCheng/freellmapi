@echo off
REM freellmapi guarded launcher: catalog source (3099) + gateway (3001)
REM Safe to rerun anytime - already-running services are skipped.
REM Locate project root relative to this script (no hardcoded paths).
REM Boot-window race guard: the port check passes only AFTER the server binds,
REM and npm+tsx watch take ~5-10s to get there. A rerun inside that window used
REM to launch a duplicate; tsx watch survives the EADDRINUSE crash and leaves a
REM zombie console behind. A 90s lock file now absorbs those reruns. Locks are
REM cleared once the port is confirmed LISTENING.

cd /d "%~dp0.."

call :start_locked catalog 3099 "node tools\catalog-builder\serve.mjs 3099"
call :start_locked gateway 3001 "npm run dev -w server"

timeout /t 8 /nobreak >nul
netstat -ano | findstr ":3099 :3001" | findstr "LISTENING"
call :clear_lock_if_up catalog 3099
call :clear_lock_if_up gateway 3001
echo [start-services] done. Logs live in the minimized windows.
pause
goto :eof

:start_locked
set LOCK=%TEMP%\freellmapi-%1.lock
netstat -ano | findstr ":%2 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
  echo [start-services] %1 already running on %2
  del "%LOCK%" 2>nul
  goto :eof
)
powershell -NoProfile -Command "exit [int]((Test-Path '%LOCK%') -and (((Get-Date) - (Get-Item '%LOCK%').LastWriteTime).TotalSeconds -lt 90))" >nul 2>&1
if %errorlevel% equ 1 (
  echo [start-services] %1 start already in progress - skipping duplicate
  goto :eof
)
echo [start-services] starting %1 on %2 ...
type nul > "%LOCK%"
start "freellmapi-%1" /min cmd /c "%~3"
goto :eof

:clear_lock_if_up
netstat -ano | findstr ":%2 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 del "%TEMP%\freellmapi-%1.lock" 2>nul
goto :eof
