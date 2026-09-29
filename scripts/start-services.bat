@echo off
REM freellmapi guarded launcher: catalog source (3099) + gateway (3001)
REM Safe to rerun anytime - already-running services are skipped.
REM Locate project root relative to this script (no hardcoded paths).

cd /d "%~dp0.."

echo [start-services] checking catalog source 3099 ...
netstat -ano | findstr ":3099" | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
  echo [start-services] starting catalog source...
  start "freellmapi-catalog" /min cmd /c "node tools\catalog-builder\serve.mjs 3099"
) else (
  echo [start-services] catalog source already running
)

echo [start-services] checking gateway 3001 ...
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
  echo [start-services] starting gateway...
  start "freellmapi-gateway" /min cmd /c "npm run dev -w server"
) else (
  echo [start-services] gateway already running
)

timeout /t 8 /nobreak >nul
netstat -ano | findstr ":3099 :3001" | findstr "LISTENING"
echo [start-services] done. Logs live in the minimized windows.
pause
