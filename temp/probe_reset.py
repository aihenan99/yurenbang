"""探测平台「设置/重置密码」接口是否支持手机号（token 故意无效，不会改动任何密码）。

手机号不再硬编码在本文件（脚本入库 = 号公开）。取自 config/admin.local.json，
与 deploy 时注入 window.YRB_ADMIN 的同一处；读不到就跳过那一条探测。"""
import json
import os
import urllib.request
import urllib.error

BASE = "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth"
KEY = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def admin_phone():
    """管理员手机号：环境变量优先，其次 config/admin.local.json（不入库）。"""
    env = os.environ.get("YRB_ADMIN_PHONE", "")
    if env:
        return "+86 " + "".join(ch for ch in env if ch.isdigit())
    try:
        with open(os.path.join(ROOT, "config", "admin.local.json"), encoding="utf-8") as f:
            phones = json.load(f).get("phones") or []
        return ("+86 " + "".join(ch for ch in str(phones[0]) if ch.isdigit())) if phones else ""
    except (OSError, ValueError):
        return ""


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST", headers={
        "content-type": "application/json",
        "x-wb-webapp-access-key": KEY,
        "User-Agent": UA,
    })
    try:
        r = urllib.request.urlopen(req, timeout=30)
        return r.status, r.read()[:200].decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            j = json.loads(raw)
            return e.code, str(j.get("error_description") or j.get("error") or j)[:200]
        except Exception:
            return e.code, raw[:200].decode("utf-8", "ignore")


if __name__ == "__main__":
    ph = admin_phone()
    if ph:
        print("reset+phone ->", post("/v1/reset", {
            "phone_number": ph, "new_password": "zz123456", "verification_token": "invalid"}))
    else:
        print("reset+phone -> 跳过（config/admin.local.json 里没有手机号）")
    print("reset+email ->", post("/v1/reset", {
        "email": "nobody@example.com", "new_password": "zz123456", "verification_token": "invalid"}))
