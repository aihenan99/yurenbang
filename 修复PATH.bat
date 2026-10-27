@echo off
rem 无论当前 PATH 是否被精简，都先补回系统目录，保证 chcp/where/powershell 可用
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
chcp 65001 >nul
title 修复 Python PATH

echo ============================================
echo   修复 Python PATH（仅修改当前用户环境变量）
echo ============================================
echo.

where python >nul 2>nul
if not errorlevel 1 (
  echo [正常] Python 已在 PATH 中：
  where python
  goto :done
)

echo [检测] PATH 中未找到 Python，扫描常见安装目录...
set "PYDIR="

for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
  if not defined PYDIR if exist "%%D\python.exe" set "PYDIR=%%D"
)
if not defined PYDIR for /d %%D in ("C:\Python3*" "C:\Program Files\Python3*" "C:\Program Files (x86)\Python3*") do (
  if not defined PYDIR if exist "%%D\python.exe" set "PYDIR=%%D"
)

if not defined PYDIR (
  echo [失败] 未在常见位置找到 Python 3。
  echo        请先安装 Python 3（https://www.python.org/downloads/），
  echo        安装时勾选 "Add python.exe to PATH"，再运行本脚本。
  goto :done
)

echo [找到] %PYDIR%
echo.
echo [写入] 正在追加到【用户级 PATH】（不覆盖已有内容，自动去重）...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$d=$env:PYDIR.TrimEnd('\'); $cur=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $cur){$cur=''}; $parts=@($cur -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }); if($parts -contains $d){ Write-Host '该目录已在用户 PATH 中，无需重复添加。' } else { $new=($parts + $d) -join ';'; [Environment]::SetEnvironmentVariable('Path',$new,'User'); Write-Host ('已添加：'+$d) }"
echo.
echo [完成] 请【重新打开】一个新的命令行窗口，再运行「启动服务.bat」。

:done
echo.
pause
