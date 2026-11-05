#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
用 Supabase Management API 在指定项目上执行 SQL 文件。

凭据只从环境变量读，绝不落盘、绝不写进仓库：
    SB_ACCESS_TOKEN   Supabase 个人访问令牌（sbp_ 开头），
                      控制台 → 右上头像 → Account Settings → Access Tokens
用法：
    SB_ACCESS_TOKEN=sbp_xxx python temp/sb_sql.py db/supabase/04-reacts.sql [...]
可选：
    SB_PROJECT_REF    默认 nyqpovygnwinjsjoiadw（育人帮独立云项目）
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = os.environ.get("SB_PROJECT_REF", "nyqpovygnwinjsjoiadw")
TOKEN = os.environ.get("SB_ACCESS_TOKEN", "").strip()
URL = "https://api.supabase.com/v1/projects/%s/database/query" % REF


def run(sql):
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + TOKEN,
        "Content-Type": "application/json",
        "User-Agent": "yrb-migrate/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            txt = r.read().decode("utf-8", "ignore")
            return r.status, txt
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")
    except Exception as e:  # 网络层
        return 0, "NETWORK ERROR: %s" % e


def main():
    if not TOKEN:
        print("缺少 SB_ACCESS_TOKEN")
        return 2
    files = sys.argv[1:]
    if not files:
        print("用法: SB_ACCESS_TOKEN=sbp_xxx python temp/sb_sql.py <sql 文件> ...")
        return 2

    bad = 0
    for f in files:
        sql = open(f, encoding="utf-8").read()
        print("\n=== 执行 %s (%d 字符) ===" % (f, len(sql)))
        code, txt = run(sql)
        print("HTTP", code)
        print(txt[:1200])
        if code != 200 and code != 201:
            bad += 1
            print("!! 该文件执行失败，后续文件不再执行")
            break
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
