#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
育人帮 · 浏览器登录版部署（不需要创建任何 API 令牌）
==================================================================
思路：用 wrangler 的 OAuth 登录 —— 它会自己打开浏览器，
      你只需在弹出的 Cloudflare 页面点一下「允许 / Allow」。
      登录后 wrangler 自带 Pages 权限，直接部署即可。

流程：
  1) wrangler whoami        → 看是否已登录；未登录则 wrangler login（打开浏览器）
  2) wrangler pages project list → 自动认出「承载 育人帮.cn 的那个项目」
  3) wrangler pages deploy deploy-cn → 推到生产环境

用法：
  python cf_browser_deploy.py --dry-run   # 只登录+列项目，不上传
  python cf_browser_deploy.py             # 真部署
  python cf_browser_deploy.py --logout    # 部署完顺手退出登录（可选）
"""
import os
import re
import subprocess
import sys

NODE = r"C:/Users/a/.workbuddy/binaries/node/versions/22.22.2-6"
WRANGLER = os.path.join(
    r"C:/Users/a/.workbuddy/binaries/node/workspace", "node_modules", "wrangler", "bin", "wrangler.js"
)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "deploy-cn")
CN = "xn--gmqq09al6z.cn"          # 育人帮.cn
COM = "xn--gmqq09al6z.com"        # 育人帮.com
DRY = "--dry-run" in sys.argv
DO_LOGOUT = "--logout" in sys.argv
PROJECT = os.environ.get("CF_PROJECT", "").strip()
BRANCH = os.environ.get("CF_BRANCH", "main").strip()

ENV = dict(os.environ)
ENV["PATH"] = NODE + os.pathsep + ENV.get("PATH", "")
ENV["PYTHONUTF8"] = "1"
ENV["PYTHONIOENCODING"] = "utf-8"
ENV.pop("CF_API_TOKEN", None)          # 不依赖令牌，避免误用


def hr(t=""):
    print("\n" + ("─" * 62))
    if t:
        print(t)
        print("─" * 62)


def wr(*args, timeout=900):
    cmd = [os.path.join(NODE, "node.exe"), WRANGLER] + list(args)
    print("  $ wrangler " + " ".join(args), flush=True)
    try:
        p = subprocess.run(cmd, env=ENV, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return 1, "[超时] wrangler 命令超过 %s 秒未返回" % timeout
    return p.returncode, ((p.stdout or "") + (p.stderr or ""))


# ───────────────────────── 1. 登录 ─────────────────────────
def is_logged_in():
    rc, out = wr("whoami", timeout=120)
    low = out.lower()
    bad = ("not authenticated" in low or "not logged in" in low
           or "please run `wrangler login`" in low or "you are not authenticated" in low)
    return (rc == 0 and not bad), out


def parse_account_id(out):
    """从 whoami 输出里抠出 32 位账户 ID"""
    ids = re.findall(r"\b[0-9a-f]{32}\b", out.lower())
    return ids[0] if ids else ""


def ensure_login():
    ok, out = is_logged_in()
    if ok:
        print("[OK] 已是登录状态，跳过登录步骤")
        acc = parse_account_id(out)
        if acc:
            print("     账户 ID：%s" % acc)
            ENV["CLOUDFLARE_ACCOUNT_ID"] = acc
        return True

    hr("需要登录 Cloudflare（浏览器里点一下「允许」即可）")
    print("接下来会自动打开浏览器：")
    print("  1) 如果没登录 Cloudflare，先登录（你自己输账号密码，我看不到）")
    print("  2) 页面会问「是否允许 Wrangler 访问你的账户」→ 点【允许 / Allow】")
    print("  3) 本窗口会自动继续，不用手动操作")
    print()
    input("按回车开始登录…")

    rc, out = wr("login", timeout=900)
    print(out[-2000:])
    if rc != 0:
        print("[X] 登录失败（退出码 %s）" % rc)
        print("    可重试；或改用带令牌的老脚本 部署到Cloudflare.bat")
        return False

    ok, out2 = is_logged_in()
    if not ok:
        print("[X] 登录后仍无法确认登录状态：")
        print(out2[-1200:])
        return False
    print("[OK] 登录成功")
    acc = parse_account_id(out2)
    if acc:
        print("     账户 ID：%s" % acc)
        ENV["CLOUDFLARE_ACCOUNT_ID"] = acc
    return True


# ───────────────────────── 2. 找项目 ─────────────────────────
def list_projects():
    """返回 [(项目名, 域名字符串), ...]"""
    rc, out = wr("pages", "project", "list", timeout=180)
    print(out)
    if rc != 0:
        print("[X] 无法列出 Pages 项目（退出码 %s）" % rc)
        print("    如果报权限不足，请把下面这行发我，我调整登录时申请的权限范围。")
        return []
    rows = []
    for line in out.splitlines():
        if "│" not in line:
            continue
        cells = [c.strip() for c in line.strip().strip("│").split("│")]
        if len(cells) < 2:
            continue
        name, domains = cells[0], cells[1]
        if not name or name.lower() in ("project name",):
            continue
        if set(name) <= set("─ "):
            continue
        rows.append((name, domains))
    return rows


def resolve_project(rows):
    if PROJECT:
        print("[OK] 使用你指定的项目：%s" % PROJECT)
        return PROJECT
    for name, domains in rows:
        if CN in domains:
            print("[OK] 自动识别：项目「%s」正在承载 育人帮.cn" % name)
            print("     （复用该项目，自定义域名与已签发的 HTTPS 证书都不用重配）")
            return name
    print("[!] 没能自动认出承载 %s 的项目。" % CN)
    print("    上面表格里哪个项目是育人帮的？请把项目名告诉我，或运行：")
    print("      set CF_PROJECT=项目名  再跑一次")
    return None


# ───────────────────────── 3. 部署 ─────────────────────────
def deploy(project):
    if not os.path.isdir(SRC):
        print("[X] 找不到目录：%s" % SRC)
        return False
    n = sum(len(fs) for _b, _d, fs in os.walk(SRC))
    print("[i] 待上传 %d 个文件（%s）" % (n, SRC))
    if DRY:
        print("[dry-run] 跳过真实上传")
        return True
    rc, out = wr("pages", "deploy", SRC,
                 "--project-name", project, "--branch", BRANCH,
                 "--commit-dirty=true", timeout=900)
    print(out[-3500:])
    if rc != 0:
        print("[X] 部署失败（退出码 %s）" % rc)
        return False
    print("[OK] 部署完成")
    return True


def main():
    print("=" * 62)
    print("育人帮 · 浏览器登录版部署%s" % ("（dry-run 预演）" if DRY else ""))
    print("=" * 62)

    if not ensure_login():
        return 1

    hr("一、现有 Pages 项目")
    rows = list_projects()
    if not rows:
        return 1

    hr("二、定位承载 育人帮.cn 的项目")
    project = resolve_project(rows)
    if not project:
        return 1

    hr("三、上传最新版")
    if not deploy(project):
        return 1

    if DO_LOGOUT:
        hr("四、退出登录")
        rc, out = wr("logout", timeout=120)
        print(out[-600:])
        if rc == 0:
            print("[OK] 已退出登录")
        else:
            print("[!] 退出登录未成功，可忽略（也可以以后手动 wrangler logout）")

    hr()
    print("完成。手机打开检查：https://%s/" % CN)
    print("检查要点：")
    print("  1) 顶部没有「☀️ 26° 北京」天气")
    print("  2) 底部是「首页 / ＋发布 / 消息 / 我的」四项")
    print("  3) 登录页验证码下面有协议勾选")
    print("  4) 发布面板点「图片」后才出现拍照/相册按钮")
    return 0


if __name__ == "__main__":
    sys.exit(main())
