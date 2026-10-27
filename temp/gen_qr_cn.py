# -*- coding: utf-8 -*-
"""重新生成分享二维码 qr-share.png：指向 https://xn--gmqq09al6z.cn/
样式与旧版一致：红→橙渐变模块 + 白底 + 中央「育」字橙色渐变圆角方块 logo
"""
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers.pil import RoundedModuleDrawer
from PIL import Image, ImageDraw, ImageFont, ImageFilter

URL = "https://xn--gmqq09al6z.cn/"
OUT = "yurenbang-app/assets/qr-share.png"
SIZE = 640  # 与旧图一致

# ---------- 1. 基础二维码（纠错 H，给中央 logo 留空间） ----------
qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_H,
                   box_size=20, border=2)
qr.add_data(URL)
qr.make(fit=True)
print("QR version:", qr.version)

# 顶部红 #E8404C → 底部橙 #F0803C 垂直渐变
from qrcode.image.styles.colormasks import VerticalGradiantColorMask
GRAD = VerticalGradiantColorMask(back_color=(255, 255, 255),
                                 top_color=(232, 64, 76),
                                 bottom_color=(240, 128, 60))
img = qr.make_image(image_factory=StyledPilImage,
                    module_drawer=RoundedModuleDrawer(),
                    color_mask=GRAD).convert("RGBA")
img = img.resize((SIZE, SIZE), Image.NEAREST)

# ---------- 2. 中央 logo：橙色渐变圆角方块 + 白色「育」字 ----------
logo_s = 200  # logo 方块尺寸（H 纠错可容纳）
logo = Image.new("RGBA", (logo_s, logo_s), (0, 0, 0, 0))
d = ImageDraw.Draw(logo)
pad = 14
r0 = 52
for i in range(logo_s - 2 * pad):
    t = i / max(1, logo_s - 2 * pad - 1)
    r = int(248 + (238 - 248) * t)
    g = int(122 + (70 - 122) * t)
    b = int(70 + (46 - 70) * t)
    d.line([(pad, pad + i), (logo_s - pad, pad + i)], fill=(r, g, b, 255))
# 圆角遮罩
mask = Image.new("L", (logo_s, logo_s), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([pad, pad, logo_s - pad, logo_s - pad], radius=r0, fill=255)
logo.putalpha(mask)

# 「育」字
font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 108)
fd = ImageDraw.Draw(logo)
bbox = fd.textbbox((0, 0), "育", font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
fd.text(((logo_s - tw) / 2 - bbox[0], (logo_s - th) / 2 - bbox[1] + 4),
        "育", font=font, fill=(255, 255, 255, 255))

# 白色描边光环（贴在二维码上更清晰）
ring = Image.new("RGBA", (logo_s + 28, logo_s + 28), (0, 0, 0, 0))
rd = ImageDraw.Draw(ring)
rd.rounded_rectangle([2, 2, logo_s + 26, logo_s + 26], radius=r0 + 12,
                     fill=(255, 255, 255, 255))
ring.paste(logo, (14, 14), logo)

# 白色柔和投影 halo，扫除周围模块干扰
halo = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(halo)
cx = (SIZE - logo_s) // 2 - 14
hd.rounded_rectangle([cx - 10, cx - 10, cx + logo_s + 28 + 10, cx + logo_s + 28 + 10],
                     radius=r0 + 22, fill=(255, 255, 255, 255))
halo = halo.filter(ImageFilter.GaussianBlur(6))
img = Image.alpha_composite(img, halo)
img.paste(ring, ((SIZE - ring.width) // 2, (SIZE - ring.height) // 2), ring)

img.save(OUT, "PNG")
print("saved:", OUT, img.size)

# ---------- 3. 自验：解码确认 ----------
try:
    import cv2
except ImportError:
    cv2 = None
if cv2:
    import numpy as np
    data, _, _ = cv2.QRCodeDetector().detectAndDecode(
        cv2.imread(OUT.replace("yurenbang-app/", "../yurenbang-app/")) or cv2.imread(OUT))
    print("decoded:", data)
    assert data == URL, "QR 内容不符！"
    print("DECODE OK ->", URL)
else:
    print("(无 cv2，跳过解码自验)")
