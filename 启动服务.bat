@echo off
rem 无论当前 PATH 是否被精简，都先补回系统目录，保证 chcp/netstat/where/start 可用
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
chcp 65001 >nul
cd /d "%~dp0"
title 育人帮静态服务

echo ============================================
echo   育人帮 · 本地静态服务
echo   目录: %CD%
echo ============================================
echo.

netstat -ano -p tcp | findstr "LISTENING" | findstr ":8765 " >nul 2>nul
if not errorlevel 1 (
  echo [提示] 8765 端口已有服务在运行，直接打开浏览器...
  start "" "http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html"
  echo.
  pause
  exit /b 0
)

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 python。请先运行同目录下的「修复PATH.bat」，或自行安装 Python 3。
  echo.
  pause
  exit /b 1
)

echo [1/2] 2 秒后自动打开浏览器，请勿关闭本窗口（关闭即停止服务）...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html'"
echo [2/2] 服务已启动：http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html
echo.
python -m http.server 8765 --bind 127.0.0.1
echo.
echo 服务已停止。
pause
