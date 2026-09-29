@echo off
REM freellmapi 服务守护启动：目录源(3099) + 网关(3001)
REM 已在运行的服务不会被重复启动；服务挂掉后重跑本脚本即可恢复
REM 用法：双击运行，或计划任务开机调用

chcp 65001 >nul
cd /d "C:\Users\Administrator\Desktop\项目\freellmapi"

echo [start-services] 检查目录源 3099 ...
netstat -ano | findstr ":3099" | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
  echo [start-services] 启动目录源...
  start "freellmapi-catalog" /min cmd /c "node tools\catalog-builder\serve.mjs 3099"
) else (
  echo [start-services] 目录源已在运行
)

echo [start-services] 检查网关 3001 ...
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
  echo [start-services] 启动网关...
  start "freellmapi-gateway" /min cmd /c "npm run dev -w server"
) else (
  echo [start-services] 网关已在运行
)

REM 仪表盘（可选，需要时取消注释）
REM netstat -ano | findstr ":5173" | findstr "LISTENING" >nul 2>&1
REM if %errorlevel% neq 0 (
REM   start "freellmapi-dashboard" /min cmd /c "npm run dev -w client -- --host"
REM )

timeout /t 8 /nobreak >nul
netstat -ano | findstr ":3099 :3001" | findstr "LISTENING"
echo [start-services] 完成。日志在各自窗口（最小化）。
pause
