# -*- coding: utf-8 -*-
"""把棋盘格背景转纯白：从图像边缘 BFS，匹配边带里检出的两种浅灰色调（容差小），染成纯白。
只处理与边带色调一致且与边界连通的区域，避免误伤盘内白色。"""
import io, os, sys
from PIL import Image, ImageChops
from collections import deque

SRC = r"E:/育人帮/yurenbang-app/assets/gifts"

def process(name, src_png, out_webp, max_px=640, q=84):
    im = Image.open(os.path.join(SRC, src_png)).convert("RGB")
    w, h = im.size
    px = im.load()
    # 1) 从边带采样主色调（棋盘格两种灰）
    band = []
    for x in range(0, w, 7):
        band.append(px[x, 0]); band.append(px[x, h - 1])
    for y in range(0, h, 7):
        band.append(px[0, y]); band.append(px[w - 1, y])
    tones = []
    for c in band:
        for t in tones:
            if abs(c[0]-t[0][0]) <= 8 and abs(c[1]-t[0][1]) <= 8 and abs(c[2]-t[0][2]) <= 8:
                t[1] += 1; break
        else:
            tones.append([c, 1])
    tones = [t[0] for t in sorted(tones, key=lambda x: -x[1])[:3]]
    def match(c):
        return any(abs(c[0]-t[0]) <= 7 and abs(c[1]-t[1]) <= 7 and abs(c[2]-t[2]) <= 7 for t in tones)
    # 2) 边界 BFS
    seen = bytearray(w * h)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if match(px[x, y]) and not seen[y*w+x]: seen[y*w+x] = 1; dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if match(px[x, y]) and not seen[y*w+x]: seen[y*w+x] = 1; dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        px[x, y] = (255, 255, 255)
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny*w+nx] and match(px[nx, ny]):
                seen[ny*w+nx] = 1; dq.append((nx, ny))
    # 3) 裁白边 + 缩放 + webp
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bbox = ImageChops.difference(im, bg).getbbox()
    if bbox: im = im.crop(bbox)
    w, h = im.size
    sc = max_px / max(w, h)
    if sc < 1: im = im.resize((round(w*sc), round(h*sc)), Image.LANCZOS)
    out = os.path.join(SRC, out_webp)
    im.save(out, "WEBP", quality=q, method=6)
    print("%-9s %5dx%-5d %6.1fKB  tones=%s" % (name, im.size[0], im.size[1], os.path.getsize(out)/1024, tones))

if __name__ == "__main__":
    name = sys.argv[1]; png = sys.argv[2]; out = sys.argv[3]
    process(name, png, out)
