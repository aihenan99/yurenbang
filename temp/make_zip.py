#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 deploy-cn/ 重新打包成 deploy-cn.zip（用于 Cloudflare 后台拖拽上传）"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "deploy-cn")
OUT = os.path.join(ROOT, "deploy-cn.zip")

files = []
for base, _dirs, fs in os.walk(SRC):
    for f in fs:
        p = os.path.join(base, f)
        files.append((p, os.path.relpath(p, SRC).replace("\\", "/")))
files.sort(key=lambda x: x[1])

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p, rel in files:
        z.write(p, rel)

size = os.path.getsize(OUT)
print("打包完成：%s" % OUT)
print("文件数：%d    大小：%d 字节 (%.1f KB)" % (len(files), size, size / 1024.0))
print("-" * 46)
for _p, rel in files:
    print("  " + rel)
