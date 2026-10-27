# -*- coding: utf-8 -*-
"""列出 zone 下全部 DNS 记录（只读，本机 wrangler 凭证）。"""
import io, json, os, re, sys, urllib.error, urllib.request

API = "https://api.cloudflare.com/client/v4"

def load_token():
    p = os.path.expanduser(r"~/.wrangler/config/default.toml")
    txt = io.open(p, encoding="utf-8").read()
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', txt)
    if not m:
        raise SystemExit("未找到本机 oauth_token")
    return m.group(1)

def call(tok, method, path):
    req = urllib.request.Request(API + path, method=method,
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
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

    z = call(tok, "GET", "/zones?per_page=50")
    if not z.get("success"):
        print("[X] 读取 zone 失败:", z.get("errors"))
        return 1
    want = sys.argv[1] if len(sys.argv) > 1 else "育人帮.com"
    target = None
    for zone in z["result"]:
        nm = zone["name"]
        try:
            nm_ascii = nm.encode("idna").decode("ascii")
        except Exception:
            nm_ascii = nm
        mark = " <== 目标" if nm == want or nm_ascii == want else ""
        print("[zone] %-20s (%s) status=%-8s id=%s%s" % (nm, nm_ascii, zone["status"], zone["id"], mark))
        if nm == want or nm_ascii == want:
            target = zone
    if not target:
        print("[X] 未找到 zone: %s" % want)
        return 1

    print()
    recs = call(tok, "GET", "/zones/%s/dns_records?per_page=100" % target["id"])
    if not recs.get("success"):
        print("[X] 读记录失败:", recs.get("errors"))
        return 1
    rows = recs["result"]
    print("[记录] 共 %d 条" % len(rows))
    if not rows:
        print("   (空)")
    for r in rows:
        print("   %-6s %-30s -> %-46s proxied=%s ttl=%s" % (
            r["type"], r["name"], r.get("content", ""), r.get("proxied"), r.get("ttl")))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
