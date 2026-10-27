# -*- coding: utf-8 -*-
"""把 sitemap 里的全部 URL 推送给必应（IndexNow 即时推送）。

前置条件：站点根目录存在 /<key>.txt 且内容等于 key，否则必应返回 403
SiteVerificationNotPassed（脚本会先自检，不通过就直接报错停止）。

用法： python temp/indexnow_push.py            # 推送 sitemap 全部 URL
      python temp/indexnow_push.py --dry      # 只打印将要推送的 URL
      python temp/indexnow_push.py --urls https://a/ https://b/
"""
import io
import json
import os
import re
import sys
import urllib.request
import urllib.error

ROOT = r"E:/育人帮"
# 优先读部署包里的 sitemap（域名已换成 .cn），主应用的 sitemap 用的是开发域名
SITEMAPS = [os.path.join(ROOT, "deploy-cn", "sitemap.xml"),
            os.path.join(ROOT, "yurenbang-app", "sitemap.xml")]
HOST = "xn--gmqq09al6z.cn"                  # IndexNow 的 host 用 punycode，不带协议
KEY = "8f3c2a7d94b14e6f9a0c5d2e7b3f18a6"
KEY_LOCATION = "https://%s/%s.txt" % (HOST, KEY)
ENDPOINTS = [
    "https://api.indexnow.org/indexnow",     # 通用入口（转发给必应/其它引擎）
    "https://www.bing.com/indexnow",         # 必应直连
]
UA = "Mozilla/5.0 (compatible; YurenbangIndexNow/1.0)"


def sitemap_urls():
    xml = ""
    for p in SITEMAPS:
        if os.path.exists(p):
            xml = io.open(p, encoding="utf-8").read()
            break
    urls, seen = [], set()
    for u in re.findall(r"<loc>(.*?)</loc>", xml):
        u = u.strip()
        # 统一改成生产域名：IndexNow 要求 URL 与已验证的 host 完全一致
        u = re.sub(r"^https?://[^/]+", "https://" + HOST, u)
        if u not in seen:
            seen.add(u)
            urls.append(u)
    return urls


def post(endpoint, urls):
    body = json.dumps({"host": HOST, "key": KEY, "keyLocation": KEY_LOCATION,
                       "urlList": urls}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, method="POST", headers={
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, r.read().decode("utf-8", "ignore")[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")[:300]
    except Exception as e:
        return 0, str(e)


def check_key():
    """推送前自检：key 文件必须可公网访问且内容一致。"""
    url = KEY_LOCATION
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode("utf-8", "ignore").strip()
    except Exception as e:
        return False, "取不到 %s（%s）——先部署再推送" % (url, e)
    if txt != KEY:
        return False, "key 文件内容不匹配：期望 %s，实际 %r" % (KEY, txt[:40])
    return True, url


def live_filter(urls):
    """推送前先探活：只提交返回 200 的 URL。
    IndexNow 对「不可访问/不属于本站」的 URL 会整批 422，一条坏的拖累全部。"""
    good, bad = [], []
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                (good if r.status == 200 else bad).append((u, r.status))
        except urllib.error.HTTPError as e:
            bad.append((u, e.code))
        except Exception as e:
            bad.append((u, "ERR %s" % e))
    return [u for u, _ in good], bad


def main():
    args = sys.argv[1:]
    if "--urls" in args:
        i = args.index("--urls")
        urls = [u for u in args[i + 1:] if u.startswith("http")]
    else:
        urls = sitemap_urls()

    if not urls:
        print("没有可推送的 URL（sitemap 为空？）")
        return 1
    print("sitemap 共 %d 条 URL：host=%s" % (len(urls), HOST))
    if "--dry" in args:
        for u in urls:
            print("  · " + u)
        return 0

    ok, msg = check_key()
    print("[自检] " + ("通过 → " + msg if ok else "失败 → " + msg))
    if not ok:
        return 2

    urls, bad = live_filter(urls)
    if bad:
        print("[探活] %d 条不可用，已剔除：" % len(bad))
        for u, s in bad:
            print("   ✗ %s → %s" % (u, s))
    print("[探活] 可推送 %d 条" % len(urls))
    if not urls:
        return 4

    good = 0
    for ep in ENDPOINTS:
        code, body = post(ep, urls)
        # 200 已接收 / 202 已接受待处理，都算成功
        state = "成功" if code in (200, 202) else "未成功"
        print("[推送] %-38s HTTP %s %s %s" % (ep, code or "-", state, body.replace("\n", " ")[:160]))
        if code in (200, 202):
            good += 1
    print("\n结果：%d/%d 个入口接收成功，共提交 %d 条 URL" % (good, len(ENDPOINTS), len(urls)))
    return 0 if good else 3


if __name__ == "__main__":
    sys.exit(main())
