# -*- coding: utf-8 -*-
"""职见未来 海报合成:底图 + 标题/副标/5功能图标行/slogan/像素边框"""
from PIL import Image, ImageDraw, ImageFont

WS = "/Users/apple/Documents/Kimi/Workspaces/职见未来"
ASSET = "/Users/apple/Desktop/Pixel Lab 素材"
FONTS_RT = "/Users/apple/Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/python/fonts"

CJK_B = f"{FONTS_RT}/NotoSansSC-Bold.ttf"
CJK_R = f"{FONTS_RT}/NotoSansSC-Regular.ttf"
PIX = f"{WS}/fonts/PressStart2P-Regular.ttf"

# 色板
PARCH = (0xF2, 0xE8, 0xD5)
INK = (0x4A, 0x3B, 0x2A)      # 墨棕
WOOD = (0x8B, 0x6B, 0x4A)     # 木棕
MOSS = (0x7F, 0xA3, 0x93)     # 苔绿
BERRY = (0xB5, 0x54, 0x4A)    # 莓红
GOLD = (0xD9, 0xA4, 0x41)     # 金币金

W, H = 1024, 1536

img = Image.open(f"{WS}/poster/base.png").convert("RGB")
assert img.size == (W, H)
dr = ImageDraw.Draw(img)

# ---------- 0. 遮盖左下角「AI生成」水印(用右侧干净面板区翻贴) ----------
patch = img.crop((820, 1450, 990, 1516)).transpose(Image.FLIP_LEFT_RIGHT)
img.paste(patch, (8, 1450))

# ---------- 字体 ----------
def F(path, size):
    return ImageFont.truetype(path, size)

def text_w(font, s):
    return font.getbbox(s)[2] - font.getbbox(s)[0]

def draw_center(draw, cx, y, s, font, fill, shadow=None, soff=(0, 0)):
    w = text_w(font, s)
    x = cx - w // 2
    if shadow:
        draw.text((x + soff[0], y + soff[1]), s, font=font, fill=shadow)
    draw.text((x, y), s, font=font, fill=fill)
    return w

# ---------- 1. 顶部面板:大标题 + 像素副标 ----------
# 顶部羊皮纸面板内部约 y 55~285
title_font = F(CJK_B, 104)
# 阶梯像素阴影:金 -> 木棕
tw = text_w(title_font, "职见未来")
tx, ty = W // 2 - tw // 2, 78
for dx, dy, c in [(8, 8, WOOD), (5, 5, GOLD)]:
    dr.text((tx + dx, ty + dy), "职见未来", font=title_font, fill=c)
dr.text((tx, ty), "职见未来", font=title_font, fill=INK)

sub_font = F(PIX, 30)
sy = ty + 128
sw = draw_center(dr, W // 2, sy, "LIFE RPG", sub_font, BERRY)
# 副标两侧像素小星
def pix_star(d, cx, cy, s, c):
    d.rectangle([cx - s // 2, cy - s // 8, cx + s // 2, cy + s // 8], fill=c)
    d.rectangle([cx - s // 8, cy - s // 2, cx + s // 8, cy + s // 2], fill=c)
pix_star(dr, W // 2 - sw // 2 - 36, sy + 15, 22, GOLD)
pix_star(dr, W // 2 + sw // 2 + 36, sy + 15, 22, GOLD)

# ---------- 2. 底部面板:5 功能图标行 ----------
icons = [
    (f"{ASSET}/图标/icon-star.png", "AI 成就树"),
    (f"{ASSET}/图标/icon-book.png", "魔法日记本"),
    (f"{ASSET}/角色与物件/obj-house.png", "职见小镇"),
    (f"{ASSET}/图标/icon-map.png", "首页冒险面板"),
    (f"{ASSET}/图标/icon-scroll.png", "自动化简历"),
]
label_font = F(CJK_B, 24)
n = len(icons)
margin = 52
pitch = (W - 2 * margin) / n
icon_size = 64
iy = 1306
for i, (path, label) in enumerate(icons):
    cx = margin + pitch * (i + 0.5)
    ic = Image.open(path).convert("RGBA").resize((icon_size, icon_size), Image.NEAREST)
    img.paste(ic, (int(cx - icon_size / 2), iy), ic)
    lw = text_w(label_font, label)
    dr.text((cx - lw / 2, iy + icon_size + 4), label, font=label_font, fill=INK)

# ---------- 3. 底部面板:slogan 两行(中英混排) ----------
# slogan1: 把人生，变成一场 RPG
cjk_part = "把人生，变成一场 "
pix_part = "RPG"
f1_cjk = F(CJK_B, 42)
f1_pix = F(PIX, 30)
w1a, w1b = text_w(f1_cjk, cjk_part), text_w(f1_pix, pix_part)
total1 = w1a + w1b
x0 = W / 2 - total1 / 2
y1 = 1414
dr.text((x0 + 4, y1 + 4), cjk_part, font=f1_cjk, fill=GOLD)
dr.text((x0, y1), cjk_part, font=f1_cjk, fill=INK)
# Press Start 2P 基线较低,微调对齐
dr.text((x0 + w1a + 4, y1 + 11), pix_part, font=f1_pix, fill=BERRY)

# slogan2: AI 时代的青少年成长伙伴
p2a, p2b = "AI", " 时代的青少年成长伙伴"
f2_pix = F(PIX, 20)
f2_cjk = F(CJK_R, 26)
w2a, w2b = text_w(f2_pix, p2a), text_w(f2_cjk, p2b)
x1 = W / 2 - (w2a + w2b) / 2
y2 = 1470
dr.text((x1, y2 + 5), p2a, font=f2_pix, fill=BERRY)
dr.text((x1 + w2a, y2), p2b, font=f2_cjk, fill=WOOD)

# ---------- 4. 外圈像素阶梯边框 ----------
def pixel_border(d, w, h):
    # 外层 6px 墨棕
    t = 6
    d.rectangle([0, 0, w - 1, t - 1], fill=INK)
    d.rectangle([0, h - t, w - 1, h - 1], fill=INK)
    d.rectangle([0, 0, t - 1, h - 1], fill=INK)
    d.rectangle([w - t, 0, w - 1, h - 1], fill=INK)
    # 内层 3px 金
    t2, o = 3, 9
    d.rectangle([o, o, w - o - 1, o + t2 - 1], fill=GOLD)
    d.rectangle([o, h - o - t2, w - o - 1, h - o - 1], fill=GOLD)
    d.rectangle([o, o, o + t2 - 1, h - o - 1], fill=GOLD)
    d.rectangle([w - o - t2, o, w - o - 1, h - o - 1], fill=GOLD)
    # 四角阶梯缺口(切出像素阶梯感)
    step = [(0, 22), (22, 0)]
    for cx, cy, sx, sy in [(0, 0, 1, 1), (w - 1, 0, -1, 1), (0, h - 1, 1, -1), (w - 1, h - 1, -1, -1)]:
        for i in range(3):
            d.rectangle([cx if sx > 0 else cx - 10 - i * 8,
                         cy if sy > 0 else cy - 10 - i * 8,
                         cx + 10 + i * 8 if sx > 0 else cx,
                         cy + 10 + i * 8 if sy > 0 else cy], fill=INK)
pixel_border(dr, W, H)

out = f"{WS}/poster/职见未来-海报.png"
img.save(out)
print("saved:", out)
