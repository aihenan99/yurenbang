@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
"%SystemRoot%\System32\chcp.com" 65001 >nul 2>&1

if not exist "%ROOT%.venv\Scripts\python.exe" (
  echo [X] Python venv not found: %ROOT%.venv\Scripts\python.exe
  echo     Create it first with:  python -m venv .venv
  echo.
  pause
  exit /b 1
)
if not exist "%ROOT%temp\cf_deploy.py" (
  echo [X] Deploy script not found: %ROOT%temp\cf_deploy.py
  echo.
  pause
  exit /b 1
)

"%ROOT%.venv\Scripts\python.exe" "%ROOT%temp\cf_deploy.py" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo ==== DONE / OK ====
) else (
  echo ==== STOPPED / exit code %RC% ====
)
echo.
pause
