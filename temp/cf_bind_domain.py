"""用本机已登录的 Cloudflare 凭证直接调 API 绑定 Pages 自定义域名。
只读取本机 ~/.wrangler 的登录凭证，不打印令牌本身。
重定向接口对中文域名友好，统一用 punycode 提交。
"""
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"


def load_token():
    p = os.path.expanduser(r"~/.wrangler/config/default.toml")
    txt = io.open(p, encoding="utf-8").read()
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', txt)
    if not m:
        raise SystemExit("未找到本机 Cloudflare 登录凭证（oauth_token）")
    return m.group(1)


def call(tok, method, path, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + tok,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"success": False, "errors": [{"message": raw[:400]}]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tok = load_token()

    accounts = call(tok, "GET", "/accounts?per_page=50")
    if not accounts.get("success"):
        print("[X] 读取账户失败：", accounts.get("errors"))
        return 1
    acct = accounts["result"][0]["id"]
    print("[OK] 账户 ID: %s (%s)" % (acct, accounts["result"][0].get("name")))

    project = sys.argv[1] if len(sys.argv) > 1 else "yurenbang-com-redirect"
    domains = sys.argv[2:] if len(sys.argv) > 2 else ["xn--gmqq09al6z.com"]

    for d in domains:
        r = call(
            tok,
            "POST",
            "/accounts/%s/pages/projects/%s/domains" % (acct, project),
            {"name": d},
        )
        if r.get("success"):
            print("[OK] 已绑定 %s -> 项目 %s" % (d, project))
        else:
            errs = r.get("errors") or []
            msg = errs[0].get("message") if errs else str(r)[:200]
            code = errs[0].get("code") if errs else ""
            print("[!] 绑定 %s 失败（code=%s）：%s" % (d, code, msg))

    # 回读项目域名列表确认
    r = call(tok, "GET", "/accounts/%s/pages/projects/%s" % (acct, project))
    if r.get("success"):
        got = r["result"]
        print()
        print("项目 %s 现有域名：%s" % (project, ", ".join(got.get("domains", []) or ["(无)"])))
        for sub in got.get("domains", []) or []:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
