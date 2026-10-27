# -*- coding: utf-8 -*-
"""生成「育人帮」分享二维码（带中心 logo、品牌配色），并输出 base64 供页面内嵌。"""
import base64, io, os
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers.pil import RoundedModuleDrawer
from qrcode.image.styles.colormasks import RadialGradiantColorMask
from PIL import Image, ImageDraw

URL = "https://yurenbang.app.workbuddy.host/"
OUT = "E:/育人帮/yurenbang-app/assets"
os.makedirs(OUT, exist_ok=True)

qr = qrcode.QRCode(
    version=None,
    error_correction=qrcode.constants.ERROR_CORRECT_H,   # 30% 冗余，容得下中心 logo
    box_size=16,
    border=3,
)
qr.add_data(URL)
qr.make(fit=True)

img = qr.make_image(
    image_factory=StyledPilImage,
    module_drawer=RoundedModuleDrawer(radius_ratio=0.86),
    color_mask=RadialGradiantColorMask(
        back_color=(255, 255, 255),
        center_color=(240, 84, 60),      # 品牌主色（中心）
        edge_color=(214, 74, 128),       # 偏玫红（边缘），与玫瑰主题呼应
    ),
).convert("RGB")

W, H = img.size

# 中心留白 + 「育」字 logo
logo = Image.open(f"{OUT}/icon-512.png").convert("RGB")
pad = int(W * 0.20)                      # logo 占整体 20%（<30% 冗余上限）
box = int(W * 0.26)                      # 白底圆角方块略大于 logo
logo = logo.resize((pad, pad), Image.LANCZOS)

# 圆角遮罩
mask = Image.new("L", (pad, pad), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, pad - 1, pad - 1], radius=int(pad * 0.26), fill=255)
cx, cy = (W - pad) // 2, (H - pad) // 2

plate = Image.new("RGB", (box, box), (255, 255, 255))
pmask = Image.new("L", (box, box), 0)
ImageDraw.Draw(pmask).rounded_rectangle([0, 0, box - 1, box - 1], radius=int(box * 0.28), fill=255)
img.paste(plate, ((W - box) // 2, (H - box) // 2), pmask)
img.paste(logo, (cx, cy), mask)

# 圆角白底 + 一行说明
outer = Image.new("RGB", (W + 60, H + 60), (255, 255, 255))
outer.paste(img, (30, 30))
d = ImageDraw.Draw(outer)
outer = outer.resize((640, 640), Image.LANCZOS)

p1 = f"{OUT}/qr-share.png"
outer.save(p1, "PNG", optimize=True)
print("saved", p1, os.path.getsize(p1))

# 供 share.html / 应用内分享层内嵌的 base64
buf = io.BytesIO()
outer.save(buf, "PNG", optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode("ascii")
p2 = "E:/育人帮/temp/qr-base64.txt"
open(p2, "w", encoding="ascii").write(b64)
print("saved", p2, len(b64), "chars")
