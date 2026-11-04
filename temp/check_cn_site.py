#!/usr/bin/env python3
"""
育人帮 · 境内站点巡检（2026-11-04）

为什么有这份脚本：
  11-04 部署到腾讯云轻量后，验收是照清单手工敲了一串 curl。手工验收的问题和
  当年「安全带很多但没人系」一样：下次更新部署时没人愿意再敲一遍，于是
  「部署完了」变成一句口头承诺。这个脚本把那套验收变成一条命令。

检查内容（只读，不改服务器）：
  1. 首页 200，且 cache-control 是 no-cache（防微信 WebView 长期缓存旧版页面）
  2. 首页引用的资源（部署包是 bundle.js + 若干 css）全部可下载
  3. 静态资源带缓存头（部署包用 max-age=0,must-revalidate + ?v= 版本化，合格）
  4. 构建号与本地 deploy-cn/build.json 一致（不一致说明线上不是这份产物）
  5. /yrbtts 真能出声（200 + audio/mpeg + 有字节）
  6. /sbapi 同源校验：带 Referer 200、不带 Referer 403（不能被当成开放代理）
  7. /sbapi 数据可读（真实帖子数 > 0）
  8. 未知路径 404 且落到站内 error.html
  9. /index.html 可达（CF 版是 308 跳首页，nginx 版直接 200，两种都算正常）

用法：
  python temp/check_cn_site.py                    # 默认 http://118.89.185.37
  python temp/check_cn_site.py --base http://...  # 换机器/域名
  python temp/check_cn_site.py --skip-tts         # 不想消耗 TTS 时跳过
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BASE = "http://118.89.185.37"
UA = ("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36")
TIMEOUT = 20

results = []


def http(url, headers=None, method="GET", follow=True):
    """返回 (status, headers_lowercase, body)。headers 统一小写，避免大小写陷阱。"""
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, headers=h, method=method)
    if not follow:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        opener = urllib.request.build_opener(NoRedirect)
    else:
        opener = urllib.request.build_opener()
    try:
        with opener.open(r, timeout=TIMEOUT) as resp:
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def sb_key():
    """publishable key 从源码唯一出处读，不在脚本里再抄一份。"""
    env = os.environ.get("YRB_SB_KEY")
    if env:
        return env.strip()
    src = os.path.join(ROOT, "yurenbang-app", "assets", "cloud.js")
    try:
        with open(src, encoding="utf-8") as f:
            m = re.search(r'sbKey\s*:\s*"([^"]+)"', f.read())
        if m:
            return m.group(1)
    except OSError:
        pass
    return ""


def check(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, f"{type(e).__name__}: {str(e)[:80]}"
    results.append((ok, name, detail))
    print(("  ✓ " if ok else "  ✗ ") + name + ("   " + detail if detail else ""))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--skip-tts", action="store_true")
    a = ap.parse_args()
    base = a.base.rstrip("/")
    home = {"html": ""}

    print(f"\n境内站点巡检  {base}\n")

    def c_home():
        st, hd, body = http(base + "/")
        home["html"] = body.decode("utf-8", "replace")
        if st != 200:
            return False, f"HTTP {st}"
        cc = hd.get("cache-control", "")
        if not re.search(r"no-cache|no-store", cc, re.I):
            return False, f"cache-control={cc!r}（应为 no-cache，防微信 WebView 缓存旧版页面）"
        return True, f"{len(body)} 字节 / {cc}"

    check("首页可访问且不被强缓存", c_home)

    def c_build():
        with open(os.path.join(ROOT, "deploy-cn", "build.json"), encoding="utf-8") as f:
            local = json.load(f)["build"]
        m = re.search(r"\?v=(\d{14})", home["html"])
        if not m:
            return False, "页面里没有 ?v=<14 位构建号>，无法核对版本"
        remote = m.group(1)
        if remote != local:
            return False, f"本地 {local} / 线上 {remote} ← 线上不是这份产物，需重新部署"
        return True, f"本地与线上同为 {local}"

    check("构建号与 deploy-cn 一致", c_build)

    # 首页引用的资源（部署包是 bundle.js，源码线才是 30 个分层脚本）
    refs = re.findall(r'(?:src|href)="(assets/[A-Za-z0-9._-]+\.(?:js|css))(?:\?[^"]*)?"', home["html"])

    def c_assets():
        if not refs:
            return False, "首页一个 assets 引用都没解析到（页面结构变了？）"
        bad = []

        def one(rel):
            st, _, body = http(f"{base}/{rel}")
            if st != 200:
                return f"{rel} → {st}"
            if len(body) < 200:
                return f"{rel} → 200 但只有 {len(body)} 字节（疑似错误页）"
            return None

        with ThreadPoolExecutor(max_workers=6) as ex:
            for r in ex.map(one, refs):
                if r:
                    bad.append(r)
        if bad:
            return False, f"{len(bad)}/{len(refs)} 个取不到：" + "; ".join(bad[:4])
        return True, f"{len(refs)} 个资源全部 200：" + ", ".join(refs[:3]) + ("…" if len(refs) > 3 else "")

    check("首页引用的资源全部可下载", c_assets)

    def c_cache():
        st, hd, _ = http(base + "/assets/bundle.js")
        cc = hd.get("cache-control", "")
        if st != 200:
            return False, f"HTTP {st}"
        if not cc:
            return False, "没有 cache-control（依赖 ?v= 版本化，至少要声明可缓存性）"
        return True, cc

    check("静态资源带缓存头", c_cache)

    if a.skip_tts:
        print("  · 跳过 TTS（--skip-tts）")
    else:
        def c_tts():
            st, hd, body = http(f"{base}/yrbtts?t=%E4%BD%A0%E5%A5%BD&r=norm",
                                {"Referer": base + "/"})
            if st != 200:
                return False, f"HTTP {st} ← /yrbtts 回源 CF，检查 CF 边缘是否还活着"
            ct = hd.get("content-type", "")
            if "audio" not in ct:
                return False, f"content-type={ct!r}（应为 audio/mpeg）"
            if len(body) < 1000:
                return False, f"只有 {len(body)} 字节，不像有效音频"
            return True, f"audio/mpeg {len(body)} 字节"

        check("TTS 真能合成音频", c_tts)

    key = sb_key()

    def c_sameorigin():
        url = base + "/sbapi/rest/v1/yb_posts?select=id&limit=1"
        hdr = {"apikey": key, "Authorization": "Bearer " + key}
        st_ok, _, _ = http(url, {**hdr, "Referer": base + "/"})
        if st_ok != 200:
            return False, f"带 Referer 应 200，实际 {st_ok}"
        st_bad, _, _ = http(url, hdr)           # 无 Referer / 无 Origin
        if st_bad != 403:
            return False, f"无 Referer 应 403，实际 {st_bad} ← 代理可能被当开放代理用"
        return True, "带 Referer 200 / 无 Referer 403"

    check("代理同源校验生效", c_sameorigin)

    def c_data():
        st, hd, body = http(base + "/sbapi/rest/v1/yb_posts?select=id&limit=100",
                            {"apikey": key, "Authorization": "Bearer " + key,
                             "Referer": base + "/"})
        if st != 200:
            return False, f"HTTP {st}"
        rows = json.loads(body.decode("utf-8"))
        if not rows:
            return False, "帖子数为 0（数据没迁过来，或 RLS 挡了）"
        return True, f"{len(rows)} 条帖子可读，最大 id {max(r['id'] for r in rows)}"

    check("云端数据可读", c_data)

    def c_404():
        st, _, body = http(base + "/this-page-should-not-exist-12345")
        text = body.decode("utf-8", "replace")
        if st != 404:
            return False, f"HTTP {st}（应为 404）"
        if not re.search(r"育人帮|回到首页|404", text):
            return False, "是 404，但返回的不像站内 error.html"
        return True, f"{len(body)} 字节"

    check("未知路径返回站内 404 页", c_404)

    def c_index():
        st, hd, body = http(base + "/index.html", follow=False)
        loc = hd.get("location", "")
        if st == 200:
            return True, "200 直接返回内容（nginx 行为；CF 版是 308 跳首页，都正常）"
        if st in (301, 302, 307, 308):
            return True, f"{st} → {loc}"
        return False, f"HTTP {st}"

    check("/index.html 可达", c_index)

    bad = [r for r in results if not r[0]]
    print(f"\n{len(results) - len(bad)}/{len(results)} 通过" + ("，站点状态正常" if not bad else "") + "\n")
    if bad:
        for _, name, detail in bad:
            print(f"  需处理：{name} —— {detail}")
        print()
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
