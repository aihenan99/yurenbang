# -*- coding: utf-8 -*-
"""查看 yurenbang-com-redirect 项目的自定义域校验状态（pages:write 权限即可）。"""
import io, json, os, re, sys, urllib.error, urllib.request
API = "https://api.cloudflare.com/client/v4"

def load_token():
    p = os.path.expanduser(r"~/.wrangler/config/default.toml")
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', io.open(p, encoding="utf-8").read())
    if not m:
        raise SystemExit("未找到本机 oauth_token")
    return m.group(1)

def call(tok, path):
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + tok})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"success": False, "errors": [{"message": raw[:300]}]}

sys.stdout.reconfigure(encoding="utf-8")
tok = load_token()
acct = "2f01132f2b99d6097fa8b297f6f71e14"
for proj in ["yurenbang", "yurenbang-com-redirect"]:
    r = call(tok, "/accounts/%s/pages/projects/%s/domains" % (acct, proj))
    print("### 项目 %s" % proj)
    if not r.get("success"):
        print("   [X]", r.get("errors"))
        continue
    for d in r["result"]:
        vd = d.get("verification_data") or {}
        print("   %-32s status=%-9s verification=%s" % (d.get("name"), d.get("status"), vd.get("status") or "-"))
        if vd.get("error_message"):
            print("        错误: %s" % vd["error_message"])
        if vd.get("validation_method"):
            print("        校验方式: %s" % vd["validation_method"])
    if not r["result"]:
        print("   (无自定义域)")
