"""探测平台「设置/重置密码」接口是否支持手机号（token 故意无效，不会改动任何密码）。"""
import json
import urllib.request
import urllib.error

BASE = "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth"
KEY = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15"


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
    print("reset+phone ->", post("/v1/reset", {
        "phone_number": "+86 18037345855", "new_password": "zz123456", "verification_token": "invalid"}))
    print("reset+email ->", post("/v1/reset", {
        "email": "nobody@example.com", "new_password": "zz123456", "verification_token": "invalid"}))
