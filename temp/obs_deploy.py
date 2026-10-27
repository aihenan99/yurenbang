#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
育人帮 · 一键部署到华为云 OBS（静态网站托管）
=====================================================
用法（密钥只从环境变量读，不落盘）：
  set OBS_AK=... & set OBS_SK=... & set OBS_REGION=cn-north-4 & set OBS_BUCKET=yurenbang
  .venv\\Scripts\\python.exe temp\\obs_deploy.py            # 正式上传
  .venv\\Scripts\\python.exe temp\\obs_deploy.py --dry-run   # 只检查不写入

做的事：
  1) 桶不存在则创建；2) 桶设为公共读（匿名可读，静态站必需）；
  3) 递归上传 deploy-cn/ 全部文件（按扩展名设置 Content-Type，单个对象也设 public-read）；
  4) 配置静态网站托管：首页 index.html、404 页 error.html；
  5) 打印静态网站访问地址，便于立刻验收。
"""
import os
import sys
import mimetypes
import urllib.request

from obs import ObsClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_DIR = os.path.join(ROOT, "deploy-cn")
DRY = "--dry-run" in sys.argv

AK = os.environ.get("OBS_AK", "").strip()
SK = os.environ.get("OBS_SK", "").strip()
REGION = os.environ.get("OBS_REGION", "cn-north-4").strip()
BUCKET = os.environ.get("OBS_BUCKET", "yurenbang").strip()

EXTRA_TYPES = {
    ".js": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def ctype(path):
    ext = os.path.splitext(path)[1].lower()
    return EXTRA_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def list_files():
    out = []
    for dp, _dn, fn in os.walk(LOCAL_DIR):
        for f in fn:
            p = os.path.join(dp, f)
            key = os.path.relpath(p, LOCAL_DIR).replace(os.sep, "/")
            out.append((p, key))
    return sorted(out, key=lambda x: x[1])


def main():
    if not DRY and (not AK or not SK):
        print("缺少 OBS_AK / OBS_SK，请先设置环境变量。")
        return 2
    files = list_files()
    if not files:
        print("deploy-cn 目录为空，请先生成部署包。")
        return 2

    print("区域 %s / 桶 %s / 服务器 %s" % (REGION, BUCKET, "obs.%s.myhuaweicloud.com" % REGION))
    print("待上传 %d 个文件：" % len(files))
    for _p, k in files:
        print("   ", k)
    if DRY:
        print("\n[dry-run] 只列出，不写入。")
        return 0

    client = ObsClient(access_key_id=AK, secret_access_key=SK,
                       server="obs.%s.myhuaweicloud.com" % REGION, timeout=30)

    # 1) 桶
    head = client.headBucket(BUCKET)
    if head.status >= 300:
        print("桶不存在，正在创建…")
        r = client.createBucket(BUCKET, location=REGION)
        print("  创建结果：", r.status, r.reason)
        if r.status >= 300:
            print("  创建失败（桶名全球唯一，可换一个，如 yurenbang-cn）")
            return 3
    else:
        print("桶已存在，直接复用。")

    # 2) 公共读（静态站必需；失败也继续，对象级 ACL 仍会生效）
    try:
        pol = '{"Statement":[{"Sid":"PublicRead","Effect":"Allow","Principal":{"ID":"*"},' \
              '"Action":["GetObject"],"Resource":["%s/*","%s"]}]}' % (BUCKET, BUCKET)
        r = client.setBucketPolicy(BUCKET, pol)
        print("  桶策略 public-read：", r.status, r.reason)
    except Exception as e:
        print("  桶策略设置异常（忽略）：", e)

    # 3) 上传
    ok = 0
    for p, key in files:
        try:
            r = client.putFile(BUCKET, key, p,
                               headers={"x-obs-acl": "public-read",
                                        "Content-Type": ctype(p)})
            if r.status < 300:
                ok += 1
            else:
                print("  失败", key, r.status, r.reason)
        except Exception as e:
            print("  异常", key, e)
    print("上传完成：%d/%d" % (ok, len(files)))

    # 4) 静态网站托管：首页 + 404
    try:
        r = client.setBucketWebsite(BUCKET, {
            "indexDocument": {"Suffix": "index.html", "Key": "index.html"},
            "errorDocument": {"Key": "error.html"},
        })
        print("静态网站托管配置：", r.status, r.reason)
    except Exception as e:
        print("静态网站托管配置异常：", e)

    # 5) 验收
    url = "http://%s.obs-website.%s.myhuaweicloud.com/" % (BUCKET, REGION)
    print("\n静态网站访问地址（验收用）：", url)
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            body = resp.read(400).decode("utf-8", "ignore")
        print("验收：HTTP", resp.status, "| 内容片段:", body.replace("\n", " ")[:120])
    except Exception as e:
        print("验收请求失败（不影响上传结果）：", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
