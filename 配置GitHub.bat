@echo off
rem 育人帮 - 配置 GitHub 远端并首次推送
rem 用法一：双击运行，按提示粘贴仓库地址
rem 用法二：命令行传参 配置GitHub.bat https://github.com/用户名/yurenbang.git
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
cd /d "%~dp0"
title 育人帮 - 配置 GitHub 远端

echo ============================================
echo   育人帮 - 配置 GitHub 远端并首次推送
echo   目录: %CD%
echo ============================================
echo.

rem ---------- 0. 找到 git（系统版或 WorkBuddy 便携版） ----------
where git >nul 2>nul
if not errorlevel 1 goto githave

set "GITBIN="
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\*") do (
  if not defined GITBIN if exist "%%d\cmd\git.exe" set "GITBIN=%%d\cmd"
  if not defined GITBIN if exist "%%d\bin\git.exe" set "GITBIN=%%d\bin"
  if not defined GITBIN if exist "%%d\mingw64\bin\git.exe" set "GITBIN=%%d\mingw64\bin"
)
if not defined GITBIN if exist "E:\app_workbuddy\resources\vendor\PortableGit\cmd\git.exe" set "GITBIN=E:\app_workbuddy\resources\vendor\PortableGit\cmd"
if not defined GITBIN if exist "E:\app_workbuddy\resources\vendor\PortableGit\mingw64\bin\git.exe" set "GITBIN=E:\app_workbuddy\resources\vendor\PortableGit\mingw64\bin"
if not defined GITBIN if exist "%ProgramFiles%\Git\cmd\git.exe" set "GITBIN=%ProgramFiles%\Git\cmd"
if not defined GITBIN if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GITBIN=%ProgramFiles(x86)%\Git\cmd"

if not defined GITBIN (
  echo [错误] 电脑上找不到 git。
  echo 已自动尝试过：系统 PATH、WorkBuddy 便携版、Program Files 安装版。
  echo.
  echo 如果电脑确实没装过 git，下载安装后重跑本脚本：
  echo     https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

set "PATH=%GITBIN%;%PATH%"
echo [提示] 使用便携版 git：%GITBIN%

:githave
git rev-parse --git-dir >nul 2>nul
if errorlevel 1 (
  echo [错误] 当前目录不是 git 仓库，请把本脚本放在 E:\育人帮 根目录下运行。
  echo.
  pause
  exit /b 1
)

set "REPOURL=%~1"
if "%REPOURL%"=="" (
  echo 请先在浏览器打开  https://github.com/new  建一个【空】仓库：
  echo.
  echo     仓库名 Repository name : yurenbang
  echo     可见性                  : 选 Private 私有
  echo     初始化选项              : README、.gitignore、license 三个都不要勾
  echo.
  echo 为什么不勾：一旦远端已有提交，本地历史就推不上去，得先删仓库重来。
  echo.
  echo 建好后复制仓库地址粘贴到这里，形如：
  echo     https://github.com/你的用户名/yurenbang.git
  echo.
  set /p REPOURL=仓库地址:
)

if "%REPOURL%"=="" (
  echo.
  echo [中止] 没有输入仓库地址，未做任何改动。
  echo.
  pause
  exit /b 1
)

set "REPOURL=%REPOURL: =%"
set "REPOURL=%REPOURL:"=%"

echo.
echo 目标仓库: %REPOURL%
echo.

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REPOURL%"
  if errorlevel 1 (
    echo [错误] 添加远端失败，请检查地址是否正确。
    echo.
    pause
    exit /b 1
  )
  echo [1/3] 已添加远端 origin
) else (
  git remote set-url origin "%REPOURL%"
  echo [1/3] 已更新远端 origin 地址
)

echo [2/3] 检查远端状态...
set "REMOTEHEADS=%TEMP%\yrb_remote_heads.txt"
del "%REMOTEHEADS%" >nul 2>nul
git ls-remote --heads origin > "%REMOTEHEADS%" 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 连不上远端仓库。常见原因：
  echo   1. 仓库地址打错，或仓库还没建好
  echo   2. 私有仓库需要登录，稍后推送时会弹窗，可以先重试
  echo   3. 网络问题：国内访问 GitHub 有时不通，可改用 Gitee
  echo.
  echo 地址: %REPOURL%
  echo.
  pause
  exit /b 1
)

set "HASHEADS="
set "PUSHARGS="
for /f "usebackq tokens=1" %%a in ("%REMOTEHEADS%") do set "HASHEADS=1"
del "%REMOTEHEADS%" >nul 2>nul

if defined HASHEADS (
  echo.
  echo [注意] 远端仓库里已经有分支了。
  echo 说明建仓库时勾选了 README 或 .gitignore 或 license 之一。
  echo.
  echo 推荐做法：到 GitHub 上把这个仓库删掉，重新建一个完全空的，再运行本脚本。
  echo.
  echo 如果不想删，可以继续，但本地会强制覆盖远端那几条初始提交。
  echo.
  set /p FORCEIT=仍要强制推送吗？输入 y 继续，其它任意键退出:
  if /i not "%FORCEIT%"=="y" (
    echo.
    echo 已退出，未做任何改动。
    echo.
    pause
    exit /b 1
  )
  set "PUSHARGS=--force"
) else (
  set "PUSHARGS="
)

echo [3/3] 开始推送 main 分支。
echo       首次推送会弹出 GitHub 登录窗口，请选 Sign in with your browser 授权。
echo       仓库约 23MB，慢一点属正常。
echo.
git push -u origin main %PUSHARGS%
if errorlevel 1 (
  echo.
  echo [错误] 推送失败。逐条排查：
  echo   认证失败   -- 到 Windows 凭据管理器删掉旧的 github 条目后重试
  echo   连接超时   -- 国内网络问题，建议改用 Gitee 镜像
  echo   仓库不存在 -- 回 GitHub 确认仓库名与用户名
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   推送成功
echo ============================================
echo.
git rev-list --count HEAD > "%TEMP%\yrb_c1.txt"
git rev-list --count origin/main > "%TEMP%\yrb_c2.txt"
set /p N1=<"%TEMP%\yrb_c1.txt"
set /p N2=<"%TEMP%\yrb_c2.txt"
del "%TEMP%\yrb_c1.txt" "%TEMP%\yrb_c2.txt" >nul 2>nul
echo   本地提交 %N1% 条，远端 %N2% 条
if "%N1%"=="%N2%" (echo   两边一致，校验通过) else (echo   两边不一致，请重跑本脚本)
echo.
echo 下一步：设置 main 分支保护
echo   打开  %REPOURL:.git=%/settings/branches
echo   点 Add branch protection rule，Branch name pattern 填 main
echo   勾选 Require a pull request before merging
echo   勾选 Require status checks to pass before merging
echo.
pause
