"""验证平台是否接受我们用 pgcrypto(bcrypt) 写入的密码。
只打印状态与字段名，不输出任何令牌内容。"""
import json
import urllib.request
import urllib.error

URL = "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth/v1/signin"
KEY = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15"


def post(body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(URL, data=data, method="POST", headers={
        "content-type": "application/json",
        "x-wb-webapp-access-key": KEY,
        "User-Agent": UA,
    })
    try:
        r = urllib.request.urlopen(req, timeout=30)
        raw = r.read()
        try:
            j = json.loads(raw)
        except Exception:
            return r.status, "non-json: " + raw[:120].decode("utf-8", "ignore")
        return r.status, list(j.keys())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            j = json.loads(raw)
            err = j.get("error_description") or j.get("error") or j
        except Exception:
            err = raw[:160].decode("utf-8", "ignore")
        return e.code, str(err)[:160]


if __name__ == "__main__":
    print("正确密码 ->", post({"username": "administrator", "password": "YrbCheck2026x"}))
    print("错误密码 ->", post({"username": "administrator", "password": "definitely-wrong-1"}))
