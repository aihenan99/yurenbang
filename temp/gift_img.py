# -*- coding: utf-8 -*-
"""把 9 张菜品图裁边、缩放并转成 WebP（透明通道保留），供移动端飞行动画使用。"""
import io, os
from PIL import Image

SRC = r"E:/育人帮/yurenbang-app/assets/gifts"
# 生成文件名 → 语义文件名
MAP = {
    "Professional_Chinese_food_phot_2026-10-18T11-58-33.png": "fish",
    "Professional_Chinese_food_phot_2026-10-18T11-59-00.png": "chicken",
    "Professional_Chinese_food_phot_2026-10-18T11-59-01.png": "duck",
    "Professional_Chinese_food_phot_2026-10-18T11-58-59.png": "knuckle",
    "Professional_food_photography__2026-10-18T11-59-03.png": "oyster",
    "Professional_food_photography__2026-10-18T11-59-27.png": "squid",
    "Professional_Chinese_food_phot_2026-10-18T11-59-23.png": "abalone",
    "Professional_Chinese_food_phot_2026-10-18T11-59-26.png": "crayfish",
    "Professional_seafood_photograp_2026-10-18T11-59-21.png": "crab",
}

def trim(im):
    """按 alpha 通道裁掉四周空白，让菜品在屏幕上更大更饱满。"""
    if im.mode != "RGBA":
        return im
    bbox = im.split()[3].getbbox()
    return im.crop(bbox) if bbox else im

for src, name in MAP.items():
    p = os.path.join(SRC, src)
    if not os.path.exists(p):
        print("missing", src)
        continue
    im = Image.open(p).convert("RGBA")
    im = trim(im)
    w, h = im.size
    scale = 640 / max(w, h)
    im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    out = os.path.join(SRC, name + ".webp")
    im.save(out, "WEBP", quality=82, method=6)
    print("%-9s %5dx%-5d %6.1fKB" % (name, im.size[0], im.size[1], os.path.getsize(out) / 1024))
