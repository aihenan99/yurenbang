#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
育人帮 · Cloudflare Pages 一键部署
------------------------------------------------------------------
用途：
  1) 定位承载 育人帮.cn（xn--gmqq09al6z.cn）的 Pages 项目
  2) 把 E:/育人帮/deploy-cn/ 的最新版推上去（生产环境）
  3) 确保 xn--gmqq09al6z.cn 已绑定在该项目上
  4) 可选：把 育人帮.com（xn--gmqq09al6z.com）作为第二个项目发布并绑定

只需要一个 Cloudflare API 令牌：
  · 有环境变量 CF_API_TOKEN 时直接使用；
  · 没有时脚本会当场提示你粘贴（输入不回显，只存在内存里，不落盘）。
  令牌权限：Account · Cloudflare Pages · Edit；建议再加 Zone · Zone · Read / Edit、DNS · Edit。
  CF_ACCOUNT_ID 可省略 —— 脚本会用令牌自动查出账户 ID。

可选环境变量：
  CF_ACCOUNT_ID  指定账户 ID（省略则自动识别）
  CF_PROJECT     .cn 的 Pages 项目名（省略则自动识别正在承载该域名的项目）
  CF_COM_DIR     .com 跳转项目目录（默认 temp/deploy-com-redirect）
  CF_BRANCH      分支（默认 main，即生产环境）

用法：
  python cf_deploy.py --dry-run     # 只探测账户/项目/域名，不上传
  python cf_deploy.py               # 部署 .cn（定位项目 → 推文件 → 绑定域名）
  python cf_deploy.py --add-com     # 把 育人帮.com 加入 Cloudflare 并打印两条 NS
  python cf_deploy.py --with-com    # 发布 .com 跳转项目并绑定（改完 NS 生效后跑）
  python cf_deploy.py --all         # 先查 .com 状态，再依次做上面三件事
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_DIR = os.path.join(ROOT, "deploy-cn")
COM_DIR = os.environ.get("CF_COM_DIR") or os.path.join(HERE, "deploy-com-redirect")
NODE = r"C:/Users/a/.workbuddy/binaries/node/versions/22.22.2-6"
WRANGLER = os.path.join(
    r"C:/Users/a/.workbuddy/binaries/node/workspace", "node_modules", "wrangler", "bin", "wrangler.js"
)

TOKEN = os.environ.get("CF_API_TOKEN", "").strip()
ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "").strip()
PROJECT = os.environ.get("CF_PROJECT", "").strip()
BRANCH = os.environ.get("CF_BRANCH", "main").strip()

CN = "xn--gmqq09al6z.cn"          # 育人帮.cn
COM = "xn--gmqq09al6z.com"        # 育人帮.com

DRY = "--dry-run" in sys.argv
WITH_COM = "--with-com" in sys.argv
ADD_COM = "--add-com" in sys.argv
ALL = "--all" in sys.argv
if ALL:
    WITH_COM = ADD_COM = True
COM_PROJECT = os.environ.get("CF_COM_PROJECT", "yurenbang-com-redirect")


def read_token():
    """令牌：优先环境变量，其次当场提示输入（不回显、不落盘）"""
    tok = os.environ.get("CF_API_TOKEN", "").strip()
    if tok:
        print("[i] 已从环境变量 CF_API_TOKEN 读取令牌（%s…）" % tok[:6])
        return tok
    print("─" * 62)
    print("请粘贴 Cloudflare API 令牌，然后按回车。")
    print("（输入不会显示在屏幕上，也不会写入任何文件；关掉窗口即消失。）")
    print("─" * 62)
    try:
        import getpass
        tok = getpass.getpass("CF token: ").strip()
    except Exception:
        tok = input("CF token: ").strip()
    return tok


def call(method, path, payload=None):
    """调用 Cloudflare REST API → (ok, result, errors)"""
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            return False, None, ["HTTP %s" % e.code]
    except Exception as e:
        return False, None, [str(e)]
    return bool(body.get("success")), body.get("result"), body.get("errors") or []


def hr(t=""):
    print("\n" + ("─" * 62))
    if t:
        print(t)
        print("─" * 62)


# ────────────────────────── 1. 令牌 & 账户 ──────────────────────────
def resolve_account():
    ok, me, err = call("GET", "/user/tokens/verify")
    if ok:
        print("[OK] 令牌有效（状态 %s）" % me.get("status"))
    else:
        # 有些令牌（如“账户令牌”/Account owned token）不支持 verify 端点，
        # 不能据此判定令牌无效 —— 再用 /accounts 实际探一次。
        print("[!] /user/tokens/verify 未通过：%s" % err)
        print("    可能是账户令牌（Account API token）不支持该端点，改用 /accounts 实测…")

    if ACCOUNT:
        print("[OK] 使用你指定的账户 ID：%s" % ACCOUNT)
        return ACCOUNT

    ok, accts, err = call("GET", "/accounts?per_page=50")
    if not ok:
        print("[X] 无法读取账户列表：%s" % err)
        if not me:
            print("    → 令牌校验与账户读取都失败，基本可判定令牌无效/权限不足/已过期。")
            print("      请重新创建令牌（权限至少含 Account · Cloudflare Pages · Edit）。")
        print("    也可改用环境变量 CF_ACCOUNT_ID 显式指定账户 ID。")
        return None
    if not accts:
        print("[X] 该令牌看不到任何账户，请检查 Account Resources 是否包含目标账户。")
        return None
    if len(accts) == 1:
        a = accts[0]
        print("[OK] 自动识别账户：%s  (%s)" % (a.get("name"), a.get("id")))
        return a["id"]

    print("[i] 该令牌可访问 %d 个账户，尝试定位含“育人帮.cn”的那个…" % len(accts))
    for a in accts:
        ok2, zones, _ = call("GET", "/zones?account.id=%s&per_page=50" % a["id"])
        names = [z.get("name", "") for z in (zones or [])]
        if CN in names or COM in names:
            print("[OK] 命中账户：%s  (%s)" % (a.get("name"), a.get("id")))
            return a["id"]
    print("[!] 未能自动判断（可能缺少 Zone:Read 权限），退回使用第一个账户：")
    for a in accts:
        print("      - %s  (%s)" % (a.get("name"), a.get("id")))
    print("    若不对，请用 CF_ACCOUNT_ID 明确指定。")
    return accts[0]["id"]


def report_zones(account):
    ok, zones, err = call("GET", "/zones?account.id=%s&per_page=100" % account)
    if not ok:
        print("[i] 跳过域名清单（令牌无 Zone:Read 权限）")
        return
    print("[i] 本账户下的域名 %d 个：" % len(zones or []))
    for z in zones or []:
        flag = ""
        if z.get("name") == CN:
            flag = "   <<< 育人帮.cn"
        elif z.get("name") == COM:
            flag = "   <<< 育人帮.com"
        print("      - %-32s status=%-10s ns=%s%s"
              % (z.get("name"), z.get("status"),
                 (z.get("name_servers") or ["?"])[0], flag))


# ────────────────────────── 1.5 接入 育人帮.com ──────────────────────────
def ensure_zone(account, domain, create=True):
    """把域名加入 Cloudflare 账户（或读取已有记录），返回 zone 对象"""
    ok, zs, _ = call("GET", "/zones?name=%s&account.id=%s" % (domain, account))
    if ok and zs:
        z = zs[0]
        print("[i] %s 已在本账户，状态：%s" % (domain, z.get("status")))
        nss = z.get("name_servers") or []
        if nss:
            print("    该域名应使用的 NS：")
            for ns in nss:
                print("      · %s" % ns)
        if z.get("status") == "active":
            print("[OK] NS 已生效，域名已在 Cloudflare 上托管")
        else:
            print("[!] 状态还不是 active —— 说明 NS 尚未切换或还没传播完")
        return z
    if not create:
        print("[!] %s 尚未加入本账户" % domain)
        return None
    if DRY:
        print("[dry-run] 准备把 %s 加入账户（已跳过）" % domain)
        return None
    ok, z, err = call("POST", "/zones", {"name": domain, "account": {"id": account}})
    if not ok:
        print("[X] 把 %s 加入账户失败：%s" % (domain, err))
        print("    常见原因：该域名已存在于**另一个** Cloudflare 账户 —— 需先在那边删除。")
        return None
    print("[OK] 已把 %s 加入本账户" % domain)
    nss = z.get("name_servers") or []
    if nss:
        print()
        print("    " + "─" * 52)
        print("    ★ 去华为云改 DNS：把这域名原有的 NS 换成下面两条")
        print("    " + "─" * 52)
        for ns in nss:
            print("      · %s" % ns)
        print("    " + "─" * 52)
    return z


# ────────────────────────── 2. 定位 .cn 项目 ──────────────────────────
def resolve_project(account):
    ok, projects, err = call("GET", "/accounts/%s/pages/projects?per_page=100" % account)
    if not ok:
        print("[X] 读取 Pages 项目失败：%s" % err)
        return None
    projects = projects or []
    print("[i] 现有 Pages 项目 %d 个：" % len(projects))
    hit = None
    for p in projects:
        doms = [d.get("name", "") for d in (p.get("domains") or [])]
        mark = ""
        if CN in doms:
            hit = p["name"]
            mark = "   <<< 承载 育人帮.cn"
        print("      - %-26s sub=%-26s domains=%s%s"
              % (p["name"], p.get("subdomain") or "-", doms or "[]", mark))
    if PROJECT:
        print("[OK] 使用指定项目：%s" % PROJECT)
        return PROJECT
    if hit:
        print("[OK] 自动识别目标项目：%s（复用，自定义域名与证书无需重配）" % hit)
        return hit
    print("[!] 没有任何项目绑定 %s。" % CN)
    print("    可能该域名由 Worker / 其他方式承载，或项目列表被截断。")
    print("    请用 CF_PROJECT 显式指定要覆盖的项目名。")
    return None


# ────────────────────────── 3. 部署 ──────────────────────────
def deploy(account, project, src, label):
    if not os.path.isdir(src):
        print("[X] 找不到目录：%s" % src)
        return False
    files = []
    for base, _dirs, fs in os.walk(src):
        for f in fs:
            files.append(os.path.join(base, f))
    print("[i] %s → 待上传 %d 个文件（%s）" % (label, len(files), src))
    if DRY:
        for f in sorted(files):
            print("      · %s" % os.path.relpath(f, src).replace("\\", "/"))
        print("[dry-run] 跳过真实上传")
        return True

    env = dict(os.environ)
    env["PATH"] = NODE + os.pathsep + env.get("PATH", "")
    env["CLOUDFLARE_API_TOKEN"] = TOKEN
    env["CLOUDFLARE_ACCOUNT_ID"] = account
    cmd = [os.path.join(NODE, "node.exe"), WRANGLER, "pages", "deploy", src,
           "--project-name", project, "--branch", BRANCH, "--commit-dirty=true"]
    print("[i] 执行 wrangler pages deploy … --project-name %s --branch %s" % (project, BRANCH))
    p = subprocess.run(cmd, env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = ((p.stdout or "") + (p.stderr or "")).strip()
    print(out[-3500:])
    if p.returncode != 0:
        print("[X] %s 部署失败，退出码 %s" % (label, p.returncode))
        return False
    print("[OK] %s 部署完成" % label)
    return True


def bind_domain(account, project, domain):
    ok, doms, _ = call("GET", "/accounts/%s/pages/projects/%s/domains" % (account, project))
    names = [d.get("name", "") for d in (doms or [])] if ok else []
    print("[i] 项目 %s 当前自定义域名：%s" % (project, names or "（无）"))
    if domain in names:
        print("[OK] %s 已绑定，无需重复添加" % domain)
        return True
    if DRY:
        print("[dry-run] 准备绑定 %s（已跳过）" % domain)
        return True
    ok, _res, err = call("POST", "/accounts/%s/pages/projects/%s/domains" % (account, project),
                         {"name": domain})
    if ok:
        print("[OK] 已提交绑定 %s —— Cloudflare 会自动签发证书，通常 1~5 分钟生效" % domain)
        return True
    print("[!] 绑定 %s 失败：%s" % (domain, err))
    print("    若提示域名已被占用：到旧项目里删掉该自定义域名后再重跑本脚本。")
    return False


# ────────────────────────── main ──────────────────────────
def main():
    global TOKEN
    print("=" * 62)
    print("育人帮 · Cloudflare Pages 部署%s" % ("（dry-run 预演）" if DRY else ""))
    print("=" * 62)
    TOKEN = read_token()
    if not TOKEN:
        print("[X] 没有拿到令牌，已退出。")
        return 1

    account = resolve_account()
    if not account:
        return 1
    hr("一、账户与域名")
    report_zones(account)

    only_add_com = ADD_COM and not WITH_COM and not ALL
    if ADD_COM or WITH_COM:
        hr("二、育人帮.com 接入 Cloudflare 的状态")
        z = ensure_zone(account, COM, create=ADD_COM)
        if z is None and not DRY:
            return 1
        if only_add_com:
            hr()
            print("下一步（你可能要等一会儿才能做）：")
            print("  1) 去华为云云解析，把 育人帮.com 的 DNS 服务器换成上面那两条 NS")
            print("  2) 等 10 分钟~2 小时传播（Cloudflare 上该域名状态变成 Active）")
            print("  3) 回来执行： python temp/cf_deploy.py --with-com")
            return 0

    hr("三、定位承载 育人帮.cn 的项目")
    project = resolve_project(account)
    if not project:
        return 1

    hr("四、上传最新版到 育人帮.cn")
    if not deploy(account, project, SRC_DIR, "育人帮.cn"):
        return 1
    bind_domain(account, project, CN)

    if WITH_COM:
        hr("五、育人帮.com → 育人帮.cn 跳转")
        if deploy(account, COM_PROJECT, COM_DIR, "育人帮.com(跳转)"):
            bind_domain(account, COM_PROJECT, COM)

    hr()
    print("完成。用手机打开检查：https://%s/" % CN)
    print("检查要点：顶部无天气 · 底部「首页/＋发布/消息/我的」· 登录页有协议勾选")
    return 0


if __name__ == "__main__":
    sys.exit(main())
