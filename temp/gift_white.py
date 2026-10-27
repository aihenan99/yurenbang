# -*- coding: utf-8 -*-
"""4 张白底修复图：裁边缩放转 webp。"""
import os
from PIL import Image, ImageChops

SRC = r"E:/育人帮/yurenbang-app/assets/gifts"
MAP = {
    "Remove_the_gray_and_white_chec_2026-10-18T12-24-09.png": "oyster",
    "Remove_the_gray_and_white_chec_2026-10-18T12-24-26.png": "squid",
    "Remove_the_gray_and_white_chec_2026-10-18T12-23-22.png": "crayfish",
    "Remove_the_gray_and_white_chec_2026-10-18T12-23-24.png": "crab",
}
for src, name in MAP.items():
    im = Image.open(os.path.join(SRC, src)).convert("RGB")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bbox = ImageChops.difference(im, bg).getbbox()
    if bbox: im = im.crop(bbox)
    w, h = im.size
    sc = 640 / max(w, h)
    if sc < 1: im = im.resize((round(w*sc), round(h*sc)), Image.LANCZOS)
    out = os.path.join(SRC, name + ".webp")
    im.save(out, "WEBP", quality=84, method=6)
    print("%-9s %5dx%-5d %6.1fKB" % (name, im.size[0], im.size[1], os.path.getsize(out)/1024))
