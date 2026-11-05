# -*- coding: utf-8 -*-
"""把 sitemap 里的全部 URL 主动推送给百度（普通收录 API）。

用法：
    BAIDU_TOKEN=xxxx python temp/baidu_push.py          # 推送 sitemap 全部 URL
    BAIDU_TOKEN=xxxx python temp/baidu_push.py --dry    # 只看要推什么

token 从哪来：百度搜索资源平台 https://ziyuan.baidu.com/ → 用户中心 → 站点管理 →
点进站点 → 左侧「普通收录」→「API 提交」→ 复制 token= 后面那串。
token 只经环境变量传入，不写盘、不入库（与 temp/sb_sql.py 同一约定）。

注意：百度要求被推送的 URL 与站点验证的域名一致，且每天有配额（普通站 10 条/天起，
      有备案/优质内容会更高）。超配额会返回 over quota，第二天再推即可。
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error

ROOT = r"E:/育人帮"
SITEMAPS = [os.path.join(ROOT, "deploy-cn", "sitemap.xml"),
            os.path.join(ROOT, "yurenbang-app", "sitemap.xml")]
HOST = "xn--gmqq09al6z.cn"
ENDPOINT = "https://data.zz.baidu.com/urls?site=https://%s&token=%s"
UA = "curl/8.0"


def sitemap_urls():
    xml = ""
    for p in SITEMAPS:
        if os.path.exists(p):
            xml = io.open(p, encoding="utf-8").read()
            break
    urls, seen = [], set()
    for u in re.findall(r"<loc>(.*?)</loc>", xml):
        u = re.sub(r"^https?://[^/]+", "https://" + HOST, u.strip())
        if u not in seen:
            seen.add(u)
            urls.append(u)
    return urls


def main():
    token = os.environ.get("BAIDU_TOKEN", "").strip()
    urls = sitemap_urls()
    if not urls:
        print("sitemap 里没读到 URL", file=sys.stderr)
        return 1
    dry = "--dry" in sys.argv
    print("sitemap 共 %d 条 URL，host=%s" % (len(urls), HOST))
    for u in urls:
        print("  ·", u)
    if dry:
        print("[dry] 未推送")
        return 0
    if not token:
        print("缺少 BAIDU_TOKEN 环境变量（站点详情页 → 普通收录 → API 提交）", file=sys.stderr)
        return 2
    body = "\n".join(urls).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT % (HOST, token), data=body, method="POST",
        headers={"Content-Type": "text/plain", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        print("[推送] HTTP 200", json.dumps(data, ensure_ascii=False))
        ok = int(data.get("success", 0))
        print("成功 %d 条 / 剩余配额 %s" % (ok, data.get("remain", "?")))
        return 0 if ok else 3
    except urllib.error.HTTPError as e:
        print("[推送] HTTP %s %s" % (e.code, e.read().decode("utf-8", "ignore")[:300]), file=sys.stderr)
        return 4


if __name__ == "__main__":
    sys.exit(main())
