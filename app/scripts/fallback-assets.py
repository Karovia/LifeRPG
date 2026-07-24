#!/usr/bin/env python3
"""
============================================================
职见未来 · 像素素材兜底生成器（fallback-assets.py）
============================================================
当 Pixellab API 不可用（如余额不足 402）时，
用 Pillow 程序化绘制简洁可爱的像素 PNG，保证素材清单完整。

用法：
    python3 fallback-assets.py [key ...]
    - 不带参数：生成全部素材
    - 带参数：只生成指定 key，例如  python3 fallback-assets.py ui/coin decor/cat

输出目录：<app>/public/assets/
============================================================
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

APP_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = APP_ROOT / "public" / "assets"

# ------------------------------------------------------------
# 调色板（低饱和暖色，对齐 tailwind parchment/ink/wood/moss/berry/gold/stone）
# ------------------------------------------------------------
INK = (62, 44, 36, 255)          # 深棕描边
GOLD = (212, 160, 60, 255)       # 金
GOLD_LIGHT = (240, 204, 110, 255)
GOLD_DARK = (160, 116, 44, 255)
STAR = (232, 186, 76, 255)
WOOD = (150, 106, 66, 255)       # 木
WOOD_DARK = (110, 76, 48, 255)
MOSS = (122, 150, 88, 255)       # 苔绿
MOSS_DARK = (92, 118, 66, 255)
BERRY = (160, 84, 72, 255)       # 莓红
BERRY_DARK = (128, 64, 56, 255)
PARCHMENT = (232, 217, 181, 255)  # 羊皮纸
PARCHMENT_DARK = (205, 182, 140, 255)
PARCHMENT_LIGHT = (244, 232, 205, 255)
STONE = (154, 148, 138, 255)     # 石灰
SKIN = (238, 196, 154, 255)
TERRACOTTA = (178, 106, 74, 255)
TERRACOTTA_DARK = (140, 80, 56, 255)
GINGER = (206, 138, 78, 255)     # 橘猫
GINGER_DARK = (170, 108, 60, 255)
EYE_GREEN = (74, 104, 66, 255)
PINK = (214, 138, 128, 255)
SKY_TOP = (246, 234, 208, 255)
SKY_BOTTOM = (236, 210, 172, 255)
GRASS = (168, 172, 116, 255)
GRASS_DARK = (140, 146, 96, 255)
PATH = (214, 196, 150, 255)
CLOUD = (250, 244, 228, 255)

# ------------------------------------------------------------
# 16x16 像素画定义：'.' = 透明，其余字符查各自 palette
# ------------------------------------------------------------
PIXEL_ART: dict[str, tuple[dict[str, tuple[int, int, int, int]], list[str]]] = {
    "ui/coin": (
        {"K": GOLD_DARK, "G": GOLD, "L": GOLD_LIGHT},
        [
            "....KKKKKKK.....",
            "...KGGGGGGGK....",
            "..KGGLLGGGGGK...",
            ".KGGLLGGGGGGGK..",
            ".KGLGGGGGGGGGK..",
            ".KGGGGKKKKGGGK..",
            "KGGGGGKGGKGGGGK.",
            "KGGGGGKGGKGGGGK.",
            "KGGGGGKGGKGGGGK.",
            "KGGGGGKGGKGGGGK.",
            ".KGGGGKKKKGGGK..",
            ".KGGGGGGGGGGGK..",
            ".KGGGGGGGGGGGK..",
            "..KGGGGGGGGGK...",
            "...KGGGGGGGK....",
            "....KKKKKKK.....",
        ],
    ),
    "ui/xp-star": (
        {"O": GOLD_DARK, "S": STAR, "L": GOLD_LIGHT},
        [
            ".......O........",
            ".......OSO......",
            "......OSSO......",
            "......OSSSO.....",
            "..OOOOSSLSOOOO..",
            ".OSSSSLLLSSSSSO.",
            ".OSSSSLLSSSSSSO.",
            "..OSSSSSSSSSSO..",
            "...OSSSSSSSSO...",
            "...OSSSSOSSSO...",
            "..OSSSO..OSSSO..",
            "..OSSO....OSSO..",
            ".OSSO......OSSO.",
            ".OO..........OO.",
            "................",
            "................",
        ],
    ),
    "ui/chest": (
        {"K": INK, "G": GOLD, "W": WOOD, "D": WOOD_DARK, "T": GOLD_DARK},
        [
            "..KKKKKKKKKKKK..",
            ".KGGGGGGGGGGGGK.",
            ".KGWWWWWWWWWWGK.",
            ".KGWWWWWWWWWWGK.",
            ".KGWWWWKKWWWWGK.",
            ".KGGGGKTTKGGGGK.",
            ".KDDDDKTTKDDDDK.",
            ".KWWWWKKKKWWWWK.",
            ".KWWWWWWWWWWWWK.",
            ".KWDWWWWWWWWDWK.",
            ".KWWWWWWWWWWWWK.",
            ".KWDWWWWWWWWDWK.",
            ".KWWWWWWWWWWWWK.",
            "..KKKKKKKKKKKK..",
            "................",
            "................",
        ],
    ),
    "avatar/placeholder": (
        {"K": INK, "G": MOSS, "D": MOSS_DARK, "F": SKIN},
        [
            ".....KKKKKK.....",
            "....KGGGGGGK....",
            "...KGGGGGGGGK...",
            "..KGGGGGGGGGGK..",
            "..KGGFFFFFFGGK..",
            "..KGFFKFFKFFGK..",
            "..KGFFFFFFFFGK..",
            "..KGFFFKKFFFGK..",
            "...KFFFFFFFFK...",
            "..KKKFFFFFFKKK..",
            ".KGGKKFFFFKKGGK.",
            ".KGGGGKFFKGGGGK.",
            ".KGGGGGGGGGGGGK.",
            ".KGGDGGGGGGGDGK.",
            ".KGGGGGGGGGGGGK.",
            "..KKKKKKKKKKKK..",
        ],
    ),
    "decor/plant": (
        {"K": INK, "G": MOSS, "D": MOSS_DARK, "P": TERRACOTTA, "T": TERRACOTTA_DARK},
        [
            ".......GG.......",
            "......GGGG......",
            "..D...GGGG...G..",
            ".DG...GGGG...GD.",
            ".DGG.GGGGGG.GGD.",
            "..GGGGGGGGGGGG..",
            "..DGGGGGGGGGGD..",
            "...GGGGGGGGGG...",
            "....GGGGGGGG....",
            ".....GGGGGG.....",
            "...PPPPPPPPPP...",
            "...PPPPPPPPPP...",
            "....TPPPPPPT....",
            "....TPPPPPPT....",
            ".....TPPPPT.....",
            "................",
        ],
    ),
    "decor/bookshelf": (
        {"K": INK, "W": WOOD, "R": BERRY, "G": MOSS, "Y": GOLD, "P": PARCHMENT},
        [
            "KKKKKKKKKKKKKKKK",
            "KWRGYRPGYRGYRWWK",
            "KWRGYRPGYRGYRWWK",
            "KWRGYRPGYRGYRWWK",
            "KWRGYRPGYRGYRWWK",
            "KWRGYRPGYRGYRWWK",
            "KKKKKKKKKKKKKKKK",
            "KWGYRWGRPYRGPWWK",
            "KWGYRWGRPYRGPWWK",
            "KWGYRWGRPYRGPWWK",
            "KWGYRWGRPYRGPWWK",
            "KWGYRWGRPYRGPWWK",
            "KKKKKKKKKKKKKKKK",
            "KWWKKWWWWWWKKWWK",
            "KWWKKWWWWWWKKWWK",
            "KKKKKKKKKKKKKKKK",
        ],
    ),
    "decor/lamp": (
        {"K": INK, "L": GOLD_LIGHT, "W": PARCHMENT_LIGHT, "S": WOOD_DARK},
        [
            "....KKKKKKKK....",
            "...KLLLLLLLLK...",
            "..KLLWWWWLLLLK..",
            "..KLWLLLLLWWLK..",
            "..KLLLLLLLLLLK..",
            "...KLLLLLLLLK...",
            "....KKKKKKKK....",
            ".......SS.......",
            ".......SS.......",
            ".......SS.......",
            ".......SS.......",
            ".......SS.......",
            ".......SS.......",
            ".....SSSSSS.....",
            "....SSSSSSSS....",
            "................",
        ],
    ),
    "decor/trophy": (
        {"K": GOLD_DARK, "G": GOLD, "L": GOLD_LIGHT, "B": WOOD_DARK},
        [
            "....KKKKKKKK....",
            "...KGGGGGGGGK...",
            "KK.KGLGGGGGGK.KK",
            "KGGKKGGGGGGKKGGK",
            "KGGK.KGGGGK.KGGK",
            "KGGK.KGGGGK.KGGK",
            ".KK..KGGGGK..KK.",
            ".....KGGGGK.....",
            "......KGK.......",
            "......KGK.......",
            ".....KGGGGK.....",
            "....KBBBBBBK....",
            "....KBBBBBBK....",
            "...KKKKKKKKKK...",
            "................",
            "................",
        ],
    ),
    "decor/cat": (
        {"K": INK, "O": GINGER, "D": GINGER_DARK, "E": EYE_GREEN, "P": PINK},
        [
            "..K..........K..",
            "..KO........OK..",
            "..KOO......OOK..",
            "..KOODKKKKDOOK..",
            "..KOOOOOOOOOOK..",
            ".KOOOOOOOOOOOOK.",
            ".KOEEOOOOEOOK...",
            ".KOOOOOOPOOOOK..",
            ".KOOOOOOOOOOOK..",
            "..KOOOOOOOOOK...",
            "..KOOOOOOOOOK...",
            ".KOOOOOOOOOOOK..",
            ".KOOOOOOOOOOOK..",
            ".KOOKOOOOOOKOOK.",
            ".KKKKKKKKKKKKK..",
            "................",
        ],
    ),
    # ---------------- 第二轮：导航图标 ----------------
    "nav/home": (
        {"K": INK, "B": BERRY, "P": PARCHMENT, "W": GOLD_LIGHT, "D": WOOD_DARK},
        [
            "......KKKKK.....",
            ".....KBBBBBK....",
            "....KBBBBBBBK...",
            "...KBBBBBBBBBK..",
            "..KBBBBBBBBBBBK.",
            ".KBBBBBBBBBBBBBK",
            "..KKKKKKKKKKKK..",
            "..KPWWPPPPWWPK..",
            "..KPWWPPPPWWPK..",
            "..KPPPPDDPPPPK..",
            "..KPPPPDDPPPPK..",
            "..KPPPPDDPPPPK..",
            "..KKKKKKKKKKKK..",
            "................",
            "................",
            "................",
        ],
    ),
    "nav/quests": (
        {"K": INK, "W": WOOD, "D": WOOD_DARK, "P": PARCHMENT, "B": BERRY},
        [
            "...KKKKKKKKKK...",
            ".KKKPPPPPPPPKKK.",
            ".KWKPPPPPPPPKWK.",
            ".KWKPDDDDDPPKWK.",
            ".KWKPPPPPPPPKWK.",
            ".KWKPDDDDDDPPKWK",
            ".KWKPPPPPPPPKWK.",
            ".KWKPDDDDPPPKWK.",
            ".KWKPPPPPPPPKWK.",
            ".KWKPPBBPPPPKWK.",
            ".KWKPBBBBPPPKWK.",
            ".KKKPPBBPPPPKKK.",
            "...KKKKKKKKKK...",
            "......KBBK......",
            "......KBBK......",
            ".......KK.......",
        ],
    ),
    "nav/town": (
        {"K": INK, "S": STONE, "W": GOLD_LIGHT, "D": WOOD_DARK},
        [
            "..K..K..K..K..K.",
            "..KKKKKKKKKKKK..",
            "..KSWKSSSSKWSK..",
            "..KSWKSSSSKWSK..",
            "..KSSSSSSSSSSK..",
            "..KSSSKWWKSSSK..",
            "..KSSSSSSSSSSK..",
            "..KSSSSDDSSSSK..",
            "..KSSSSDDSSSSK..",
            "..KSSSSDDSSSSK..",
            "..KKKKKKKKKKKK..",
            "................",
            "................",
            "................",
            "................",
            "................",
        ],
    ),
    "nav/diary": (
        {"K": INK, "B": BERRY, "b": BERRY_DARK, "P": PARCHMENT, "L": GOLD},
        [
            "..KKKKKKKKKKKK..",
            "..KbBBBBBBBBbK..",
            "..KbBBBBBBBBbK..",
            "..KbBKKKKKKBbK..",
            "..KbBKPPPPKBbK..",
            "..KbBKKKKKKBbK..",
            "..KbBBBBBBBBbK..",
            "..KbBBBBBLBBbK..",
            "..KbBBBBBBBBbK..",
            "..KbBBBBBBBBbK..",
            "..KbBBBBBBBBbK..",
            "..KKKKKKKKKKKK..",
            "......KPPK......",
            "......KPPK......",
            ".......KK.......",
            "................",
        ],
    ),
    "nav/resume": (
        {"K": INK, "P": PARCHMENT, "D": WOOD_DARK, "B": BERRY, "Y": GOLD},
        [
            ".KKKKKKKK.......",
            ".KPPPPPPK...BB..",
            ".KPDDDDPK..BBBB.",
            ".KPPPPPPK.BBBBBB",
            ".KPDDDDDK..BBBB.",
            ".KPPPPPPK...BB..",
            ".KPDDDDPK...K...",
            ".KPPPPPPK...K...",
            ".KPDDDDPK...KY..",
            ".KPPPPPPK...KY..",
            ".KPPPPPPK....Y..",
            ".KKKKKKKK.......",
            "................",
            "................",
            "................",
            "................",
        ],
    ),
    # ---------------- 第二轮：小镇地块（俯视） ----------------
    "tiles/grass": (
        {"G": GRASS, "g": GRASS_DARK},
        [
            "................",
            "..GGGGGGGGGGGG..",
            ".GGGGGGGGGGGGGG.",
            ".GGgGGGGGGGGgGG.",
            "GGGGGGGGgGGGGGGG",
            "GGGgGGGGGGGGGgGG",
            "GGGGGGGGGGGGGGGG",
            "GgGGGGgGGGgGGGGG",
            "GGGGGGGGGGGGGGGG",
            "GGGGgGGGGGGgGGGG",
            "GgGGGGGGgGGGGGgG",
            "GGGGGGGGGGGGGGGG",
            ".GGgGGGGGGgGGGG.",
            ".GGGGGGGGGGGGGG.",
            "..GGGGGGGGGGGG..",
            "................",
        ],
    ),
    "tiles/path": (
        {"P": PATH, "S": STONE, "s": PARCHMENT_DARK},
        [
            "................",
            "..PPPPPPPPPPPP..",
            ".PSSSSsPPSSSSsP.",
            ".PSSSSsPPSSSSsP.",
            ".PPPPPPPPPPPPPP.",
            ".PsSSSSPPsSSSSP.",
            ".PsSSSSPPsSSSSP.",
            ".PPPPPPPPPPPPPP.",
            ".PSSSSsPPSSSSsP.",
            ".PSSSSsPPSSSSsP.",
            ".PPPPPPPPPPPPPP.",
            ".PsSSSSPPsSSSSP.",
            ".PsSSSSPPsSSSSP.",
            ".PPPPPPPPPPPPPP.",
            "..PPPPPPPPPPPP..",
            "................",
        ],
    ),
    "tiles/flower": (
        {"G": MOSS, "g": MOSS_DARK, "R": BERRY, "Y": GOLD, "L": GOLD_LIGHT},
        [
            "................",
            "................",
            ".....GGGGGG.....",
            "...GGGGGGGGGG...",
            "..GGgGGRGGGGgG..",
            ".GGGGGRYRGGGGGG.",
            ".GgGGGGRGGGgGGG.",
            "GGGGGGGGGGGGGGGG",
            "GgGLLGGGGGGGgGGG",
            "GGGLYLGGRYRGGGGG",
            "GGGGLLGGGRGGGgGG",
            ".GgGGGGGGGGGGGG.",
            ".GGGGGgGGGGgGGG.",
            "..GGGGGGGGGGGG..",
            "...GGGGGGGGGG...",
            "................",
        ],
    ),
    "tiles/house": (
        {"K": INK, "B": BERRY, "P": PARCHMENT, "W": GOLD_LIGHT, "D": WOOD_DARK},
        [
            "..........KK....",
            "..........KK....",
            "......KKKKK.....",
            ".....KBBBBBK....",
            "....KBBBBBBBK...",
            "...KBBBBBBBBBK..",
            "..KBBBBBBBBBBBK.",
            ".KBBBBBBBBBBBBBK",
            "..KKKKKKKKKKKK..",
            "..KPWWPPPPWWPK..",
            "..KPWWPPPPWWPK..",
            "..KPPPPDDPPPPK..",
            "..KPPPPDDPPPPK..",
            "..KPPPPDDPPPPK..",
            "..KKKKKKKKKKKK..",
            "................",
        ],
    ),
    "tiles/tree": (
        {"G": MOSS, "g": MOSS_DARK, "W": WOOD, "D": WOOD_DARK},
        [
            "......GGGG......",
            "....GGGGGGGG....",
            "..GGGGGGGGGGGG..",
            ".GGgGGGGGGGGgGG.",
            ".GGGGGGgGGGGGGG.",
            "GGGGGGGGGGGGGGGG",
            "GgGGGGGGGGGGgGGG",
            "GGGGGGgGGGGGGGGG",
            ".GGGGGGGGGGGGGG.",
            ".GgGGGGGGGGGgGG.",
            "..GGGGGGGGGGGG..",
            "....GGGGGGGG....",
            ".......WW.......",
            ".......WW.......",
            "......DWWWD.....",
            ".....DDWWWDD....",
        ],
    ),
    # ---------------- 第二轮：NPC 立绘（正面） ----------------
    "npc/elder": (
        {"K": INK, "W": PARCHMENT_LIGHT, "F": SKIN, "R": BERRY, "b": BERRY_DARK},
        [
            ".....KKKKKK.....",
            "....KWWWWWWK....",
            "...KWWWWWWWWK...",
            "..KWWFFFFFFWWK..",
            "..KWFKFFFFKFWK..",
            "..KWFFFFFFFFWK..",
            "..KWWFKKKFWWK...",
            "..KWWWWWWWWWWK..",
            "...KWWWWWWWWK...",
            "..KRKWWWWWWKRK..",
            ".KRRKWWWWWWKRRK.",
            ".KRRRKWWWWKRRRK.",
            ".KRRRRKWWKRRRRK.",
            ".KRRRRRKKRRRRRK.",
            ".KbRRRRRRRRRRbK.",
            "..KKKKKKKKKKKK..",
        ],
    ),
    "npc/merchant": (
        {"K": INK, "F": SKIN, "G": MOSS, "g": MOSS_DARK, "Y": GOLD, "D": WOOD_DARK},
        [
            "....KKKKKKKK....",
            "...KDDDDDDDDK...",
            "..KDDDDDDDDDDK..",
            "..KKKKKKKKKKKK..",
            "...KFFFFFFFFK...",
            "...KFKFFFFKFK...",
            "...KFFFFFFFFK...",
            "....KFFKKFFK....",
            "...KKFFFFFFKK...",
            "..KGGKFFFFKGGK..",
            ".KGGGGKFFKGGGGK.",
            ".KGGGGGGGGGGGGK.",
            ".KGgGGGYYGGGgGK.",
            ".KGGGGGYYGGGGGK.",
            ".KGGGGGGGGGGGGK.",
            "..KKKKKKKKKKKK..",
        ],
    ),
    "npc/artist": (
        {"K": INK, "F": SKIN, "B": BERRY, "P": PARCHMENT, "p": PARCHMENT_DARK, "W": WOOD},
        [
            ".....KKKKKKK....",
            "....KBBBBBBBK...",
            "...KBBBBBBBBBK..",
            "....KBBBBBBBK...",
            "...KFFFFFFFFK...",
            "...KFKFFFFKFK...",
            "...KFFFFFFFFK...",
            "....KFFKKFFK....",
            "...KKFFFFFFKK...",
            "..KPPKFFFFKPPK..",
            ".KPPPPKFFKPPPPK.",
            ".KPpPPPPPPPPpPK.",
            ".KPPPPWPPPPPPPK.",
            ".KPPPPWPPPPPPPK.",
            ".KPPPPKPPPPPPPK.",
            "..KKKKKKKKKKKK..",
        ],
    ),
    # ---------------- 第二轮：作物阶段 ----------------
    "crop/seed": (
        {"Y": GOLD, "D": WOOD_DARK, "T": TERRACOTTA},
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "................",
            "....Y..Y...Y....",
            "...DDDDDDDDDD...",
            "..DDDDDDDDDDDD..",
            "..DDTDDDTDDTDD..",
            "..DDDDDDDDDDDD..",
            "..DDDDDDDDDDDD..",
            "...DDDDDDDDDD...",
        ],
    ),
    "crop/sprout": (
        {"G": MOSS, "g": MOSS_DARK, "D": WOOD_DARK},
        [
            "................",
            "................",
            "................",
            "................",
            "................",
            ".......G........",
            "......GGG.......",
            "..G..GGGGG..G...",
            ".GGG.GGgGG.GGG..",
            "..G...GGG...G...",
            ".......GGG......",
            ".......GGG......",
            "...DDDDDDDDDD...",
            "..DDDDDDDDDDDD..",
            "..DDDDDDDDDDDD..",
            "...DDDDDDDDDD...",
        ],
    ),
    "crop/ripe": (
        {"G": MOSS, "O": GINGER, "o": GINGER_DARK},
        [
            "......G..G......",
            ".....GGGGGG.....",
            "....GGGGGGGG....",
            ".....GGGGGG.....",
            ".......GG.......",
            ".....OOOOOO.....",
            "....OOOOOOOO....",
            "....OOoOOOOO....",
            "....OOOOOOOO....",
            ".....OOOOOO.....",
            ".....OOoOOO.....",
            "......OOOO......",
            "......OOOO......",
            ".......OO.......",
            ".......OO.......",
            "........O.......",
        ],
    ),
}

# 生成尺寸（不含 parchment/town，二者单独程序化绘制）
ITEM_SIZES: dict[str, tuple[int, int]] = {
    "ui/coin": (64, 64),
    "ui/chest": (64, 64),
    "ui/xp-star": (64, 64),
    "avatar/placeholder": (64, 64),
    "decor/plant": (64, 64),
    "decor/bookshelf": (64, 64),
    "decor/lamp": (64, 64),
    "decor/trophy": (64, 64),
    "decor/cat": (64, 64),
    "nav/home": (48, 48),
    "nav/quests": (48, 48),
    "nav/town": (48, 48),
    "nav/diary": (48, 48),
    "nav/resume": (48, 48),
    "tiles/grass": (64, 64),
    "tiles/path": (64, 64),
    "tiles/flower": (64, 64),
    "tiles/house": (64, 64),
    "tiles/tree": (64, 64),
    "npc/elder": (64, 64),
    "npc/merchant": (64, 64),
    "npc/artist": (64, 64),
    "crop/seed": (48, 48),
    "crop/sprout": (48, 48),
    "crop/ripe": (48, 48),
}

ALL_KEYS = list(ITEM_SIZES) + ["bg/parchment", "bg/town"]


def render_pixel_map(key: str, out_path: Path, size: tuple[int, int]) -> None:
    palette, rows = PIXEL_ART[key]
    h, w = len(rows), len(rows[0])
    for row in rows:
        assert len(row) == w, f"{key}: 行宽不一致 {len(row)} != {w}: {row!r}"
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            color = palette.get(ch)
            if color is not None:
                px[x, y] = color
    img = img.resize(size, Image.NEAREST)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def render_parchment(out_path: Path, size: tuple[int, int] = (256, 256)) -> None:
    """羊皮纸纹理：暖米色底 + 噪点 + 深色斑渍 + 四周做旧暗边。"""
    rng = random.Random(20260724)
    w, h = size
    img = Image.new("RGB", size, PARCHMENT[:3])
    draw = ImageDraw.Draw(img)
    # 大块浅色云斑
    for _ in range(28):
        cx, cy = rng.randint(0, w), rng.randint(0, h)
        rw, rh = rng.randint(12, 48), rng.randint(8, 32)
        col = PARCHMENT_LIGHT[:3] if rng.random() < 0.6 else PARCHMENT_DARK[:3]
        draw.ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=col)
    # 细噪点
    px = img.load()
    for _ in range(w * h // 6):
        x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
        base = PARCHMENT_DARK if rng.random() < 0.5 else PARCHMENT_LIGHT
        px[x, y] = base[:3]
    # 四周暗边（做旧）
    edge = Image.new("L", size, 0)
    ed = ImageDraw.Draw(edge)
    ed.rectangle([0, 0, w - 1, h - 1], outline=90, width=10)
    ed.rectangle([4, 4, w - 5, h - 5], outline=50, width=6)
    dark = Image.new("RGB", size, (150, 124, 88))
    img = Image.composite(dark, img, edge.point(lambda v: min(v, 110)))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def render_town(out_path: Path, size: tuple[int, int] = (320, 320)) -> None:
    """像素小镇背景：暖色天空 + 太阳 + 远山 + 草地小路 + 三座小屋 + 树。"""
    grid = 80  # 80x80 画好后 4 倍 NEAREST 放大到 320
    g = Image.new("RGB", (grid, grid), SKY_TOP[:3])
    d = ImageDraw.Draw(g)
    horizon = 46
    # 天空渐变（暖奶油色，禁蓝紫）
    for y in range(horizon):
        t = y / horizon
        col = tuple(
            round(SKY_TOP[i] + (SKY_BOTTOM[i] - SKY_TOP[i]) * t) for i in range(3)
        )
        d.line([(0, y), (grid, y)], fill=col)
    # 太阳
    d.ellipse([58, 6, 70, 18], fill=GOLD_LIGHT[:3])
    d.ellipse([60, 8, 68, 16], fill=(248, 222, 140))
    # 云
    for cx, cy, cw in [(8, 10, 14), (30, 6, 10), (44, 16, 12)]:
        d.ellipse([cx, cy, cx + cw, cy + 5], fill=CLOUD[:3])
        d.ellipse([cx + 3, cy - 2, cx + cw - 3, cy + 4], fill=CLOUD[:3])
    # 远山
    d.polygon([(0, horizon), (14, 34), (30, horizon)], fill=MOSS_DARK[:3])
    d.polygon([(20, horizon), (40, 30), (62, horizon)], fill=MOSS[:3])
    d.polygon([(52, horizon), (68, 36), (80, horizon)], fill=MOSS_DARK[:3])
    # 草地
    d.rectangle([0, horizon, grid, grid], fill=GRASS[:3])
    rng = random.Random(7)
    for _ in range(120):
        x, y = rng.randint(0, grid - 1), rng.randint(horizon + 2, grid - 1)
        d.point((x, y), fill=GRASS_DARK[:3])
    # 小路（中央蜿蜒）
    for y in range(horizon, grid):
        cx = 40 + round(6 * (y - horizon) / (grid - horizon))
        half = 2 + (y - horizon) // 8
        d.line([(cx - half, y), (cx + half, y)], fill=PATH[:3])

    def house(x: int, y: int, w: int, h: int, wall, roof) -> None:
        d.rectangle([x, y, x + w, y + h], fill=wall[:3])
        d.polygon([(x - 2, y), (x + w // 2, y - h // 2 - 2), (x + w + 2, y)], fill=roof[:3])
        d.rectangle([x + w // 2 - 2, y + h - 6, x + w // 2 + 2, y + h], fill=WOOD_DARK[:3])
        d.rectangle([x + 2, y + 3, x + 5, y + 6], fill=GOLD_LIGHT[:3])
        d.rectangle([x + w - 5, y + 3, x + w - 2, y + 6], fill=GOLD_LIGHT[:3])

    house(6, 52, 14, 12, PARCHMENT, BERRY)
    house(28, 56, 12, 10, WOOD, BERRY_DARK)
    house(58, 50, 15, 13, PARCHMENT_DARK, BERRY)

    def tree(x: int, y: int) -> None:
        d.rectangle([x + 2, y + 4, x + 4, y + 9], fill=WOOD_DARK[:3])
        d.ellipse([x - 2, y - 4, x + 8, y + 5], fill=MOSS[:3])
        d.ellipse([x, y - 6, x + 6, y + 2], fill=MOSS_DARK[:3])

    tree(24, 60)
    tree(50, 62)
    tree(76, 58)
    tree(2, 66)

    img = g.resize(size, Image.NEAREST)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def generate(key: str) -> Path:
    out_path = OUT_ROOT / f"{key}.png"
    if key in PIXEL_ART:
        render_pixel_map(key, out_path, ITEM_SIZES[key])
    elif key == "bg/parchment":
        render_parchment(out_path)
    elif key == "bg/town":
        render_town(out_path)
    else:
        raise KeyError(f"未知素材 key: {key}")
    return out_path


def main() -> int:
    keys = sys.argv[1:] or ALL_KEYS
    unknown = [k for k in keys if k not in ALL_KEYS]
    if unknown:
        print(f"[fallback] 未知 key: {unknown}", file=sys.stderr)
        return 2
    for key in keys:
        path = generate(key)
        print(f"[fallback] 已生成 {key} -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
