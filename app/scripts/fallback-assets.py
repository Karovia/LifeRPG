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
MOSS_LIGHT = (158, 182, 120, 255)   # 树冠高光
WATER = (110, 152, 156, 255)        # 低饱和暖青水面
WATER_DARK = (84, 122, 128, 255)
WATER_LIGHT = (150, 184, 182, 255)
STONE_DARK = (118, 112, 102, 255)   # 石缝阴影
FIELD_LIGHT = (198, 132, 96, 255)   # 田垄高光

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
    # 注：tiles/grass、tiles/grass2、tiles/path、tiles/field 已改为
    # 程序化无缝生成（见 SEAMLESS_GROUND / render_seamless_ground），
    # 目标是低细节、横竖拼接不显眼。
    "tiles/water": (
        {"W": WATER, "w": WATER_DARK, "L": WATER_LIGHT},
        [
            "WWWWWWWWWWWWWWWW",
            "WWLLWWWWWWLLWWWW",
            "WLLLWWWWWLLLWWWW",
            "WWLLWWWWWWLLWWWW",
            "WWWWWWWWWWWWWWWW",
            "WWWWWWLLWWWWWWWL",
            "WWWWWLLLWWWWWLLW",
            "WWWWWWLLWWWWWWWW",
            "WWWWWWWWWWWWWWWW",
            "WWLLWWWWWWLLWWWW",
            "WLLLWWWWWLLLWWWW",
            "WWLLWWWWWWLLWWWW",
            "wWWWWWWWWWWWWWWw",
            "wWWWWwWWWWWwWWww",
            "wwWWWWWWWWWWWwww",
            "wwwwwwwwwwwwwwww",
        ],
    ),
    "tiles/flower": (
        {"G": MOSS, "g": MOSS_DARK, "R": BERRY, "Y": GOLD, "L": GOLD_LIGHT, "W": PARCHMENT_LIGHT},
        [
            "................",
            "....GGGGGGG.....",
            "..GGGGgGGGGGG...",
            ".GGgGGGGGGGgGG..",
            ".GGGGRWGRGGGGG..",
            "GGGGRRRRGGgGgGG.",
            "GgGGRRRGGGGGGGG.",
            "GGGGGGGGWYWGgGG.",
            "GGGgGGGYLGYGGGG.",
            "GGRYRGGGWYGGGGG.",
            "GGRRRGGGGGGRYRG.",
            "GGGYRGGgGGGRRRG.",
            ".GGGGGGGGGGRYR..",
            "..GGgGGgGGGGGG..",
            "....GGGGGGG.....",
            "................",
        ],
    ),
    "tiles/house": (
        {"K": INK, "B": BERRY, "b": BERRY_DARK, "P": PARCHMENT, "p": PARCHMENT_DARK,
         "W": GOLD_LIGHT, "D": WOOD_DARK, "S": STONE},
        [
            ".........KK.....",
            ".........KKb....",
            "......KKKKKK....",
            ".....KBBBbBK....",
            "....KBBBBBbBK...",
            "...KBBBBBBBbBK..",
            "..KBBBBBBBBBbBK.",
            ".KBBBBBBBBBBBbK.",
            "..KKKKKKKKKKKK..",
            "..KPKKPPPKKPK...",
            "..KPWKPpKPWPK...",
            "..KPWKPpKPWPK...",
            "..KPPPPDDPPPK...",
            "..KPPPDDDPPDK...",
            "..KSSDDDDSSK....",
            "...KKKKKKKK.....",
        ],
    ),
    "tiles/tree": (
        {"G": MOSS, "g": MOSS_DARK, "L": MOSS_LIGHT, "R": BERRY, "W": WOOD, "D": WOOD_DARK},
        [
            ".....GGGGGG.....",
            "...GGLLGGGGG....",
            "..GGLGGGGGGGg...",
            ".GGLGGGGGGGGGG..",
            ".GGGGGGgGGGgGG..",
            "GGGGgGGGGGGGGGG.",
            "GGGGGGGGRGGGgGG.",
            "GgGGRGGGGGGGGGg.",
            "GGGGGGGGGRGGGGG.",
            "GGgGGGgGGGGGgGG.",
            ".GGGGGGgGRGGGG..",
            ".GgGGGGGGGGGGg..",
            "..GGGGgGGGGGG...",
            "....GDDDDDG.....",
            "......DWWWD.....",
            ".....DDWWWDD....",
        ],
    ),
    "tiles/fence": (
        {"K": INK, "W": WOOD, "D": WOOD_DARK},
        [
            "................",
            "..K.........K...",
            ".KWK.......KWK..",
            ".KWK.......KWK..",
            "KWWKKKKKKKKKWWK.",
            "KWWWWWWWWWWWWWK.",
            "KKKKKKKKKKKKKKK.",
            ".KWK.......KWK..",
            ".KWK.......KWK..",
            "KWWKKKKKKKKKWWK.",
            "KWWWWWWWWWWWWWK.",
            "KKKKKKKKKKKKKKK.",
            ".KWK.......KWK..",
            ".KDK.......KDK..",
            "..K.........K...",
            "................",
        ],
    ),
    "tiles/lamp": (
        {"K": INK, "D": WOOD_DARK, "Y": GOLD, "L": GOLD_LIGHT},
        [
            "......KKKK......",
            ".....KLLLLK.....",
            "....KLYYYLLK....",
            "....KLYYYLLK....",
            "....KLYYYLLK....",
            ".....KYYYK......",
            "......KKK.......",
            "......KDK.......",
            "......KDK.......",
            "......KDK.......",
            "......KDK.......",
            "......KDK.......",
            "......KDK.......",
            ".....KKDKK......",
            "....KKDDDKK.....",
            "................",
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
    # ---------------- 第三轮：多格建筑精灵（32x32→128 / 32x48→128x192） ----------------
    "buildings/house-red": (
        {"K": INK, "B": BERRY, "b": BERRY_DARK, "P": PARCHMENT, "p": PARCHMENT_DARK,
         "W": GOLD_LIGHT, "D": WOOD_DARK, "S": STONE, "Y": GOLD},
        [
            "................................",
            ".......................KSK......",
            ".......................KSK......",
            ".......................KSK......",
            "..............KKKK.....KSK......",
            ".............KBBBBK....KSK......",
            "............KBBBBBBK...KSK......",
            "...........KBBBBBBBbK..KSK......",
            "..........KBBBBBBBBbK.KSK.......",
            ".........KBBBBBBBBBbbKKSK.......",
            "........KBBBBBBBBBBBBBBbbK......",
            ".......KBBBBBBBBBBBBBBBbbbK.....",
            "......KBBBBBBBBBBBBBBBBBbbbK....",
            ".....KBBBBBBBBBBBBBBBBBBbbbbK...",
            "....KKKKKKKKKKKKKKKKKKKKKKKKKK..",
            "......KPPPPPPPPPPPPPPPPPPK......",
            "......KPPPPPPPPPPPPPPPPPPK......",
            "......KPKWWKPPPPPPPPKWWKPK......",
            "......KPKWWKPPPPPPPPKWWKPK......",
            "......KPKKKKPPKKKKPPKKKKPK......",
            "......KPPPPPPPKDDKPPPPPPPK......",
            "......KPPPPPPPKDDKPPPPPPPK......",
            "......KPPPPPPPKDDKPPPPPPPK......",
            "......KPPPPPPPKDYKPPPPPPPK......",
            "......KPPPPPPPKDDKPPPPPPPK......",
            "......KPPPPPPPKDDKPPPPPPPK......",
            "......KPPPPPPPKDDKPPPPPPPK......",
            "......KPPPPPPPKDDKPPPPPPPK......",
            "......KSSSSSSSSSSSSSSSSSSK......",
            "......KKKKKKKKKKKKKKKKKKKK......",
            "................................",
            "................................",
        ],
    ),
    "buildings/house-wood": (
        {"K": INK, "W": WOOD, "D": WOOD_DARK, "P": PARCHMENT, "Y": GOLD, "L": GOLD_LIGHT},
        [
            "................................",
            "................................",
            "................................",
            "...............KK...............",
            "..............KDDK..............",
            ".............KDDDDK.............",
            "............KDDDDDDK............",
            "...........KDDDDDDDDK...........",
            "..........KDDDDDDDDDDK..........",
            ".........KDDDDDDDDDDDDK.........",
            ".....KKKKKKKKKKKKKKKKKKKKKKK....",
            ".......KWDWDWDWDWDWDWDWDWK......",
            ".......KWDWDWKKKKKKKWDWDWK......",
            ".......KWDWDWKPPPPPKWDWDWK......",
            ".......KWDWDWKPYPYPKWDWDWK......",
            ".......KWDWDWKKKKKKKWDWDWK......",
            ".......KKLLKWDWDWDWDKLLKWK......",
            ".......KKLLKWDWDWDWDKLLKWK......",
            ".......KKLLKWDWDWDWDKLLKWK......",
            ".......KKKKKWDWDWDWDKKKKWK......",
            ".......KWDWDWDWKKKKDWDWDWK......",
            ".......KWDWDWDWKDDKDWDWDWK......",
            ".......KWDWDWDWKDDKDWDWDWK......",
            ".......KWDWDWDWKDDKDWDWDWK......",
            ".......KWDWDWDWKDYKDWDWDWK......",
            ".......KWDWDWDWKDDKDWDWDWK......",
            ".......KWDWDWDWKDDKDWDWDWK......",
            ".......KWDWDWDWKDDKDWDWDWK......",
            ".......KKKKKKKKKKKKKKKKKKK......",
            "................................",
            "................................",
            "................................",
        ],
    ),
    "buildings/house-tall": (
        {"K": INK, "B": BERRY, "b": BERRY_DARK, "P": PARCHMENT, "W": GOLD_LIGHT,
         "D": WOOD_DARK, "S": STONE, "Y": GOLD},
        [
            "................................",
            "...............KK...............",
            "..............KBBK..............",
            "..............KBBK..............",
            ".............KBBBBK.............",
            ".............KBBBbK.............",
            "............KBBBBBbK............",
            "............KBBBBBbK............",
            "...........KBBBBBBBbK...........",
            "...........KBBBBBBBbK...........",
            "..........KBBBBBBBBBbK..........",
            "..........KBBBBBBBBBbK..........",
            ".........KBBBBBBBBBBBbK.........",
            "........KKKKKKKKKKKKKKKK........",
            ".........KPPPPPPPPPPPPK.........",
            ".........KPPPPKWWKPPPPK.........",
            ".........KPPPPKWWKPPPPK.........",
            ".........KPPPPKKKKPPPPK.........",
            ".........KPPPPPPPPPPPPK.........",
            ".........KPKWKPPPPKWKPK.........",
            ".........KPKWKPPPPKWKPK.........",
            ".........KPKWKPPPPKWKPK.........",
            ".........KPKKKPPPPKKKPK.........",
            ".........KPPPPPPPPPPPPK.........",
            ".........KPPPPPPPPPPPPK.........",
            "........KKKKKKKKKKKKKKKK........",
            ".........KPPPPPPPPPPPPK.........",
            ".........KPKKKPPPPPPPPK.........",
            ".........KPKWKPPPPPPPPK.........",
            ".........KPKKKPPPPPPPPK.........",
            ".........KPPPPPPPPPPPPK.........",
            ".........KPPPPPKKKKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDYKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPPKDDKPPPK.........",
            ".........KPPPPSSSSSSPPK.........",
            ".........KSSSSSSSSSSSSK.........",
            ".........KKKKKKKKKKKKKK.........",
            "................................",
            "................................",
            "................................",
        ],
    ),
    "buildings/well": (
        {"K": INK, "B": BERRY, "D": WOOD_DARK, "W": WOOD, "S": STONE, "s": STONE_DARK},
        [
            "................",
            ".....KKKKKK.....",
            "....KBBBBBBK....",
            "...KBBBBBBBBK...",
            "..KKKKKKKKKKKK..",
            "....KD....KD....",
            "....KD.WW.KD....",
            "....KD.WW.KD....",
            "....KKKKKKKK....",
            "..KSSSSSSSSSSK..",
            "..KSSsSSSSsSSK..",
            "..KSsSSSSSSsSK..",
            "..KSSSsSSsSSSK..",
            "..KKKKKKKKKKKK..",
            "................",
            "................",
        ],
    ),
    "tiles/tree-big": (
        {"G": MOSS, "g": MOSS_DARK, "L": MOSS_LIGHT, "R": BERRY, "W": WOOD, "D": WOOD_DARK},
        [
            "................",
            ".....GGGGGG.....",
            "...GGGLLGGGGG...",
            "..GGLLGGGGGGGg..",
            "..GLGGGGGGGGGGg.",
            ".GGLGGGGgGGGGGGg",
            ".GGGGGGGGGgGGGGg",
            "GGGGGgGGGGGGGGGG",
            "GGGGGGGGGRGGGGGg",
            "GgGGGGgGGGGGGGGG",
            "GGGgGGGGGGGGgGGG",
            "GGGGGGGRGGGGGGGg",
            "gGGGGgGGGGgGGGGG",
            "GGGGGGGGGGGGGgGg",
            "GgGgGGGGgGGGGGGg",
            "GGGGGGGGGRGGGGGg",
            ".GGGGgGGGGGGGGG.",
            ".GgGGGGGGgGGgGg.",
            "..GGGGGgGGGGGg..",
            "...GgGGGGGGGg...",
            "....GgGgGGgG....",
            "......DWWWD.....",
            "......DWWWD.....",
            "......DWWWD.....",
            "......DWWWD.....",
            "......DWWWD.....",
            "......DWWWD.....",
            "......DWWWD.....",
            "......DWWWD.....",
            ".....DDWWWDD....",
            ".....DDDDDDD....",
            "................",
        ],
    ),
    # ---------------- 第三轮：钓鱼与作物 ----------------
    "tiles/dock": (
        {"K": INK, "W": WOOD, "D": WOOD_DARK},
        [
            "................",
            ".KKKKKKKKKKKKKK.",
            ".KWWWDWWWDWWWDK.",
            ".KWWWDWWWDWWWDK.",
            ".KWWWDWWWDWWWDK.",
            ".KDDDDDDDDDDDDK.",
            ".KWWWDWWWDWWWDK.",
            ".KWWWDWWWDWWWDK.",
            ".KWWWDWWWDWWWDK.",
            ".KDDDDDDDDDDDDK.",
            ".KWWWDWWWDWWWDK.",
            ".KWWWDWWWDWWWDK.",
            ".KWWWDWWWDWWWDK.",
            ".KKKKKKKKKKKKKK.",
            "..KDK......KDK..",
            "..KDK......KDK..",
        ],
    ),
    "ui/fish": (
        {"K": INK, "O": GINGER, "L": GOLD_LIGHT, "D": GINGER_DARK},
        [
            "................",
            "................",
            ".....KKK........",
            "...KKOOOK...KK..",
            "..KOOLOOOK.KOOK.",
            ".KOOLOOOOOKOOOK.",
            ".KOLOOOOOOOOKK..",
            "KOKOOOOOOOOOKK..",
            "KOOOOOOOOOOOOK..",
            ".KOOOOOOOOOOK...",
            "..KOOOOOOOOOK...",
            "...KOOOOOOK.....",
            "....KKKKK.......",
            "................",
            "................",
            "................",
        ],
    ),
    "crop/pumpkin-ripe": (
        {"K": INK, "O": GINGER, "D": GINGER_DARK, "G": MOSS, "g": MOSS_DARK, "T": WOOD_DARK},
        [
            "................",
            ".......G........",
            "......Gg........",
            "......GG.G......",
            "....KKKKKKK.....",
            "..KKOOOOOOKK....",
            ".KOODOOOODOOK...",
            ".KODOOOOOODOK...",
            "KOODOOOOOODOOK..",
            "KODOOOOOOOODOK..",
            "KOODOOOOOODOOK..",
            ".KODOOOOOODOK...",
            ".KOODOOOODOOK...",
            "..KKOOOOOOKK....",
            "...TTTTTTTTT....",
            "....TTTTTTT.....",
        ],
    ),
    "crop/wheat-ripe": (
        {"Y": GOLD, "L": GOLD_LIGHT, "T": WOOD_DARK},
        [
            "..Y...Y...Y.....",
            ".YYY.YYY.YYY....",
            ".YLY.YLY.YLY....",
            ".YYY.YYY.YYY....",
            "..Y...Y...Y.....",
            "..Y..YYY..Y.....",
            "..Y...Y...Y.....",
            "..Y...Y...Y.....",
            "..YY..Y..YY.....",
            "...Y..Y..Y......",
            "...Y..Y..Y......",
            "...Y..Y..Y......",
            "....Y.Y.Y.......",
            "....Y.Y.Y.......",
            "...TTTTTTTTT....",
            "....TTTTTTT.....",
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
    "tiles/water": (64, 64),
    "tiles/flower": (64, 64),
    "tiles/house": (64, 64),
    "tiles/tree": (64, 64),
    "tiles/fence": (64, 64),
    "tiles/lamp": (64, 64),
    "tiles/field": (64, 64),
    "npc/elder": (64, 64),
    "npc/merchant": (64, 64),
    "npc/artist": (64, 64),
    "crop/seed": (48, 48),
    "crop/sprout": (48, 48),
    "crop/ripe": (48, 48),
    # ---------------- 第三轮：草地变体 + 多格建筑 + 钓鱼/作物 ----------------
    "tiles/grass2": (64, 64),
    "buildings/house-red": (128, 128),
    "buildings/house-wood": (128, 128),
    "buildings/house-tall": (128, 192),
    "buildings/well": (64, 64),
    "tiles/tree-big": (64, 128),
    "tiles/dock": (64, 64),
    "ui/fish": (48, 48),
    "crop/pumpkin-ripe": (48, 48),
    "crop/wheat-ripe": (48, 48),
}

ANIM_KEYS = [
    "anim/cat-walk",
    "anim/elder-idle",
    "anim/merchant-idle",
    "anim/artist-idle",
    "anim/water",
]

ALL_KEYS = list(ITEM_SIZES) + ["bg/parchment", "bg/town"] + ANIM_KEYS


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


# ------------------------------------------------------------
# 第三轮：程序化无缝地面（低细节，横竖拼接不显眼）
# 所有绘制通过 _plot_wrap 环绕取模，保证左右/上下边缘严格连续。
# ------------------------------------------------------------
SEAMLESS_GROUND = {"tiles/grass", "tiles/grass2", "tiles/path", "tiles/field"}


def _plot_wrap(px, w: int, h: int, x: int, y: int, color) -> None:
    px[x % w, y % h] = color


def render_seamless_ground(key: str, out_path: Path, size: tuple[int, int]) -> None:
    w, h = size
    rng = random.Random(f"zjwl-{key}-20260725")
    if key in ("tiles/grass", "tiles/grass2"):
        img = Image.new("RGB", size, GRASS[:3])
        px = img.load()
        # 极淡双色噪点（低对比、无方向性），环绕绘制保证无缝
        for _ in range(w * h // 9):
            x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
            col = GRASS_DARK[:3] if rng.random() < 0.55 else MOSS_LIGHT[:3]
            _plot_wrap(px, w, h, x, y, col)
        # 零星 2px 小草簇
        for _ in range(w * h // 90):
            x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
            _plot_wrap(px, w, h, x, y, MOSS_DARK[:3])
            _plot_wrap(px, w, h, x + 1, y, GRASS_DARK[:3])
        if key == "tiles/grass2":
            # 点缀变体：两三朵小野花 + 两簇草叶（打破满图重复感用）
            for _ in range(3):
                x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
                petal = BERRY[:3] if rng.random() < 0.6 else GOLD[:3]
                _plot_wrap(px, w, h, x, y, petal)
                _plot_wrap(px, w, h, x, y + 1, MOSS_DARK[:3])
            for _ in range(2):
                x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
                for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                    _plot_wrap(px, w, h, x + dx, y + dy, MOSS[:3])
    elif key == "tiles/path":
        img = Image.new("RGB", size, PATH[:3])
        px = img.load()
        # 鹅卵石：抖动网格均匀排布到边缘，石块环绕绘制（跨边石块两边都出现）
        step = 8
        for gy in range(-step, h + step, step):
            for gx in range(-step, w + step, step):
                cx = gx + rng.randint(-1, 1) + 3
                cy = gy + rng.randint(-1, 1) + 3
                for dx in range(3):
                    for dy in range(3):
                        if (dx, dy) in ((0, 0), (2, 0), (0, 2), (2, 2)):
                            continue  # 圆角
                        col = STONE[:3] if rng.random() < 0.8 else PARCHMENT_DARK[:3]
                        _plot_wrap(px, w, h, cx + dx - 1, cy + dy - 1, col)
                _plot_wrap(px, w, h, cx, cy - 1, PARCHMENT_LIGHT[:3])  # 顶部高光
    elif key == "tiles/field":
        img = Image.new("RGB", size, TERRACOTTA[:3])
        px = img.load()
        # 垄沟：每 8px 一条 2px 暗沟 + 1px 亮脊，周期整除 64 → 纵向天然无缝
        for y in range(h):
            band = y % 8
            if band in (0, 1):
                row = TERRACOTTA_DARK[:3]
            elif band == 5:
                row = FIELD_LIGHT[:3]
            else:
                continue
            for x in range(w):
                px[x, y] = row
        # 稀疏土块噪点（避开暗沟行）
        for _ in range(w * h // 14):
            x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
            if y % 8 in (0, 1):
                continue
            _plot_wrap(px, w, h, x, y, WOOD_DARK[:3])
    else:
        raise KeyError(key)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def _shift_frame(src: Image.Image, dx: int, dy: int) -> Image.Image:
    """透明画布上整体位移一帧（伪动画用）。"""
    frame = Image.new("RGBA", src.size, (0, 0, 0, 0))
    frame.paste(src, (dx, dy), src)
    return frame


def _load_base(rel: str) -> Image.Image:
    return Image.open(OUT_ROOT / rel).convert("RGBA")


def render_water_anim(out_dir: Path, n_frames: int = 4) -> list[Path]:
    """水波荡漾兜底：基于 tiles/water 像素图，每帧把高光波纹水平错相。"""
    palette, rows = PIXEL_ART["tiles/water"]
    base = {ch: col for ch, col in palette.items() if ch != "L"}
    size = ITEM_SIZES["tiles/water"]
    paths: list[Path] = []
    for phase in range(n_frames):
        img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = img.load()
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch == "L":
                    continue
                px[x, y] = base[ch]
        # 高光波相位平移（2 像素一组，随帧漂移）
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != "L":
                    continue
                if (y // 2 + phase) % 2 == 0:
                    nx = (x + phase) % 16
                else:
                    nx = (x - phase) % 16
                px[nx, y] = palette["L"]
        img = img.resize(size, Image.NEAREST)
        p = out_dir / f"frame-{phase}.png"
        img.save(p)
        paths.append(p)
    return paths


def render_sprite_anim(key: str, out_dir: Path) -> list[Path]:
    """NPC/猫兜底伪动画：单帧图轻微位移成 2~4 帧。"""
    spec = {
        "anim/cat-walk": ("decor/cat.png", [(0, 0), (0, -1), (0, 0), (0, -1)]),
        "anim/elder-idle": ("npc/elder.png", [(0, 0), (0, -1)]),
        "anim/merchant-idle": ("npc/merchant.png", [(0, 0), (0, -1)]),
        "anim/artist-idle": ("npc/artist.png", [(0, 0), (0, -1)]),
    }
    rel, offsets = spec[key]
    base = _load_base(rel)
    paths: list[Path] = []
    for i, (dx, dy) in enumerate(offsets):
        p = out_dir / f"frame-{i}.png"
        _shift_frame(base, dx, dy).save(p)
        paths.append(p)
    return paths


def generate_anim(key: str) -> Path:
    name = key.split("/", 1)[1]
    out_dir = OUT_ROOT / "anim" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    if key == "anim/water":
        paths = render_water_anim(out_dir)
    else:
        paths = render_sprite_anim(key, out_dir)
    for p in paths:
        print(f"[fallback]   帧 -> {p}")
    return out_dir


def generate(key: str) -> Path:
    out_path = OUT_ROOT / f"{key}.png"
    if key in ANIM_KEYS:
        return generate_anim(key)
    if key in SEAMLESS_GROUND:
        render_seamless_ground(key, out_path, ITEM_SIZES[key])
    elif key in PIXEL_ART:
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
