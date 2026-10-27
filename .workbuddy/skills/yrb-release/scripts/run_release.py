# -*- coding: utf-8 -*-
"""育人帮发布守卫封装 —— 任意 Python 解释器都能跑。

作用：统一 UTF-8 环境（Windows 下中文输出不乱码 / 不因 GBK 报错），
并转发全部参数给 temp/release.py。

用法：
    python .workbuddy/skills/yrb-release/scripts/run_release.py
    python .workbuddy/skills/yrb-release/scripts/run_release.py --check
"""
import os
import subprocess
import sys

ROOT = r"E:/育人帮"
VENV_PY = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
RELEASE = os.path.join(ROOT, "temp", "release.py")


def main():
    if not os.path.exists(VENV_PY):
        print("[X] 未找到虚拟环境：%s" % VENV_PY)
        print("    请先在项目根目录创建： python -m venv .venv")
        return 1
    if not os.path.exists(RELEASE):
        print("[X] 未找到发布守卫：%s" % RELEASE)
        return 1

    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    cmd = [VENV_PY, "-u", RELEASE] + sys.argv[1:]
    print("$ " + " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=ROOT, env=env)


if __name__ == "__main__":
    sys.exit(main())
