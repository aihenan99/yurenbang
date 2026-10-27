@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
"%SystemRoot%\System32\chcp.com" 65001 >nul 2>&1

title 育人帮 · 一键发布

if not exist "%ROOT%.venv\Scripts\python.exe" (
  echo [X] 未找到 Python 虚拟环境：%ROOT%.venv\Scripts\python.exe
  echo     请先创建： python -m venv .venv
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   育人帮 · 一键发布
echo   流程：备份 -^> 校验 -^> 部署 -^> 生产自检 -^> 异常自动回滚
echo ============================================================
echo.

"%ROOT%.venv\Scripts\python.exe" -u "%ROOT%temp\release.py" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo ==== 发布成功，线上已更新 ====
) else (
  echo ==== 未完成 ^(exit code %RC%^)：请看上面的提示，必要时已自动回滚 ====
)
echo.
pause
