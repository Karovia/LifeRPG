#!/usr/bin/env python3
"""
============================================================
职见未来 · 地面 tile 无缝化与降细节后处理（seamless-tiles.py）
============================================================
针对 pixellab 生成的 64x64 地面 tile：
  1. 降细节：可选 3x3 中值滤波压掉高频噪点 + 无抖动自适应调色板量化，
     让 tile 贴在一起时“不显眼”（解决棋盘式杂乱反馈）。
  2. 无缝化：对左右/上下边缘做 6px 对称交叉淡化，保证
     col[0]==col[w-1]、row[0]==row[h-1]，横竖拼接不断裂。
  3. 自检：输出处理前后的接缝误差 / 唯一色数 / 邻像素平均差，
     并生成 2x2 拼接预览图供人工抽查。

纯 Pillow 实现（托管运行时无 numpy）。
用法：
    python3 seamless-tiles.py                      # 处理全部地面 tile
    python3 seamless-tiles.py tiles/grass tiles/path
============================================================
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat

APP_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = APP_ROOT / "public" / "assets"

# 每个 tile 的后处理强度：
#   median = 中值滤波核（0 跳过），colors = 量化色数
#   flat_band / flat_strength = 边缘带向中位色收敛的带宽与强度（消除暗角/边缘杂物）
PRESETS: dict[str, dict[str, float]] = {
    "tiles/grass": {"median": 3, "colors": 10, "flat_band": 10, "flat_strength": 0.90},
    "tiles/grass2": {"median": 0, "colors": 14, "flat_band": 8, "flat_strength": 0.85},
    "tiles/path": {"median": 3, "colors": 14, "flat_band": 12, "flat_strength": 0.90},
    "tiles/field": {"median": 3, "colors": 10, "flat_band": 6, "flat_strength": 0.60},
}

BAND = 6  # 边缘交叉淡化带宽（px）

# pixellab pixflux 对地面 tile 反复生成仍带暗角/边缘花纹（拼贴呈“枕块”网格感），
# 这些 key 改为：从生成图抽取调色板 → 程序化环绕重建（无缝由构造保证）。
REBUILD_KEYS = {"tiles/grass", "tiles/grass2", "tiles/path"}

# grass2 点缀色（低饱和暖色，对齐全局调色板）
_ACCENT_BERRY = (160, 84, 72)
_ACCENT_GOLD = (212, 160, 60)

# path 两次生成均带大面积苔藓绿底（提示词约束无效），改用全局暖色调色板：
# 暖沙底 + 中性暖灰石 + 羊皮纸高光，对齐 fallback-assets.py / tailwind 主题。
_PATH_PAL = {
    "bg": (214, 196, 150),
    "stone": (154, 148, 138),
    "alt": (205, 182, 140),
    "hilite": (244, 232, 205),
}


def _shade(c: tuple, f: float) -> tuple:
    return tuple(min(255, max(0, round(v * f))) for v in c)


def palette_of(img: Image.Image, n: int = 8) -> list[tuple]:
    """按出现频次返回前 n 个主色（MEDIANCUT 量化后取调色板）。"""
    q = img.quantize(
        colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    )
    pal = q.getpalette()
    counts = sorted(q.getcolors(maxcolors=1 << 24), reverse=True)
    return [tuple(pal[i * 3 : i * 3 + 3]) for _, i in counts]


def rebuild_from_palette(
    key: str, img: Image.Image, grass_pal: tuple | None
) -> tuple[Image.Image, tuple | None]:
    """采样生成图调色板，程序化重建均匀无缝地面。返回 (图, 草地三色组)。"""
    import random

    rng = random.Random(f"rebuild-{key}-20260725")
    w, h = img.size
    colors = palette_of(img, 8)
    bg = colors[0]
    dark = colors[1] if len(colors) > 1 else _shade(bg, 0.88)
    light = colors[2] if len(colors) > 2 else _shade(bg, 1.08)
    if grass_pal is not None:
        bg, dark, light = grass_pal  # grass2 与 grass 同底色，混撒不显接缝
    out = Image.new("RGB", (w, h), bg)
    px = out.load()

    def plot(x: int, y: int, c: tuple) -> None:
        px[x % w, y % h] = c  # 环绕绘制：跨边元素两边都出现，天然无缝

    if key in ("tiles/grass", "tiles/grass2"):
        # 极淡双色噪点（无方向性）
        for _ in range(w * h // 10):
            x, y = rng.randrange(w), rng.randrange(h)
            plot(x, y, dark if rng.random() < 0.55 else light)
        # 零星 2px 小草簇
        for _ in range(w * h // 110):
            x, y = rng.randrange(w), rng.randrange(h)
            plot(x, y, dark)
            plot(x + 1, y, _mix(dark, bg, 0.5, 0.5))
        if key == "tiles/grass2":
            for _ in range(4):  # 三四朵小野花（1px 花 + 1px 叶）
                x, y = rng.randrange(w), rng.randrange(h)
                plot(x, y, _ACCENT_BERRY if rng.random() < 0.5 else _ACCENT_GOLD)
                plot(x, y + 1, dark)
            for _ in range(3):  # 两三簇草叶
                x, y = rng.randrange(w), rng.randrange(h)
                for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                    plot(x + dx, y + dy, dark)
    elif key == "tiles/path":
        bg = _PATH_PAL["bg"]
        stone = _PATH_PAL["stone"]
        alt = _PATH_PAL["alt"]
        hilite = _PATH_PAL["hilite"]
        shadow = _shade(stone, 0.82)
        out = Image.new("RGB", (w, h), bg)
        px = out.load()
        # 细沙噪点
        for _ in range(w * h // 16):
            x, y = rng.randrange(w), rng.randrange(h)
            plot(x, y, _mix(bg, shadow, 0.7, 0.3))
        # 鹅卵石：抖动网格均匀排布，环绕绘制（石块跨边不断裂）
        step = 8
        for gy in range(-step, h + step, step):
            for gx in range(-step, w + step, step):
                cx = gx + rng.randint(-1, 1) + 3
                cy = gy + rng.randint(-1, 1) + 3
                body = stone if rng.random() < 0.7 else alt
                for dx in range(3):
                    for dy in range(3):
                        if (dx, dy) in ((0, 0), (2, 0), (0, 2), (2, 2)):
                            continue  # 圆角
                        plot(cx + dx - 1, cy + dy - 1, body)
                plot(cx, cy - 1, hilite)       # 顶部高光
                plot(cx, cy + 1, _mix(body, shadow, 0.55, 0.45))  # 底部浅影
    else:
        raise KeyError(key)
    return out, (bg, dark, light) if key == "tiles/grass" else grass_pal


def process_rebuild(
    key: str, preview_dir: Path, grass_pal: tuple | None
) -> tuple:
    path = OUT_ROOT / f"{key}.png"
    if not path.exists():
        print(f"[rebuild] {key}: 文件缺失，跳过")
        return grass_pal
    img = Image.open(path).convert("RGB")
    before = seam_metrics(img)
    out, grass_pal = rebuild_from_palette(key, img, grass_pal)
    out.save(path)
    after = seam_metrics(out)
    tiled = Image.new("RGB", (img.width * 2, img.height * 2))
    for dy in range(2):
        for dx in range(2):
            tiled.paste(out, (dx * img.width, dy * img.height))
    preview = preview_dir / f"{key.replace('/', '_')}-2x2.png"
    tiled.save(preview)
    print(
        f"[rebuild] {key}: 接缝H {before[0]:6.2f}→{after[0]:5.2f} | "
        f"接缝V {before[1]:6.2f}→{after[1]:5.2f} | "
        f"唯一色 {before[2]:5d}→{after[2]:3d} | "
        f"邻像素差 {before[3]:5.2f}→{after[3]:5.2f} | 2x2预览 {preview}"
    )
    return grass_pal


def seam_metrics(img: Image.Image) -> tuple[float, float, int, float]:
    """返回 (横向接缝误差, 纵向接缝误差, 唯一色数, 邻像素平均差)。"""
    w, h = img.size
    diff_h = ImageChops.difference(img.crop((0, 0, 1, h)), img.crop((w - 1, 0, w, h)))
    seam_h = sum(ImageStat.Stat(diff_h).mean) / 3
    diff_v = ImageChops.difference(img.crop((0, 0, w, 1)), img.crop((0, h - 1, w, h)))
    seam_v = sum(ImageStat.Stat(diff_v).mean) / 3
    uniq = len(img.getcolors(maxcolors=1 << 24) or [])
    busy_h = ImageStat.Stat(
        ImageChops.difference(img, ImageChops.offset(img, 1, 0)).crop((1, 0, w, h))
    ).mean
    busy_v = ImageStat.Stat(
        ImageChops.difference(img, ImageChops.offset(img, 0, 1)).crop((0, 1, w, h))
    ).mean
    busy = (sum(busy_h) + sum(busy_v)) / 6
    return seam_h, seam_v, uniq, busy


def reduce_detail(img: Image.Image, median: int, colors: int) -> Image.Image:
    out = img.convert("RGB")
    if median >= 3:
        out = out.filter(ImageFilter.MedianFilter(median))
    if colors > 0:
        out = out.quantize(
            colors=colors,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.NONE,
        ).convert("RGB")
    return out


def _mix(a: tuple, b: tuple, wa: float, wb: float) -> tuple:
    return tuple(min(255, max(0, round(a[c] * wa + b[c] * wb))) for c in range(3))


def flatten_edges(img: Image.Image, band: int, strength: float) -> Image.Image:
    """把边缘带向整图中位色收敛，消除生成图常见的暗角、径向渐变与边缘杂物。"""
    if band <= 0 or strength <= 0:
        return img
    med = tuple(ImageStat.Stat(img).median[:3])
    out = img.copy()
    w, h = out.size
    px = out.load()
    src = img.load()
    for y in range(h):
        for x in range(w):
            d = min(x, y, w - 1 - x, h - 1 - y)
            if d >= band:
                continue
            s = strength * (1 - d / band)
            px[x, y] = _mix(src[x, y], med, 1 - s, s)
    return out


def blend_edges(img: Image.Image, band: int = BAND) -> Image.Image:
    """左右、上下边缘对称交叉淡化 → 拼接处严格连续。"""
    out = img.copy()
    w, h = out.size
    px = out.load()
    for i in range(min(band, w // 2)):
        t = 0.5 * (1.0 - i / band)  # i=0 → 0.5（两边取同值），i=band → 0
        for y in range(h):
            left, right = px[i, y], px[w - 1 - i, y]
            px[i, y] = _mix(left, right, 1 - t, t)
            px[w - 1 - i, y] = _mix(left, right, t, 1 - t)
    for i in range(min(band, h // 2)):
        t = 0.5 * (1.0 - i / band)
        for x in range(w):
            top, bottom = px[x, i], px[x, h - 1 - i]
            px[x, i] = _mix(top, bottom, 1 - t, t)
            px[x, h - 1 - i] = _mix(top, bottom, t, 1 - t)
    return out


def process(key: str, preview_dir: Path) -> bool:
    path = OUT_ROOT / f"{key}.png"
    if not path.exists():
        print(f"[seamless] {key}: 文件缺失，跳过")
        return False
    img = Image.open(path).convert("RGB")
    before = seam_metrics(img)
    preset = PRESETS.get(
        key, {"median": 3, "colors": 12, "flat_band": 8, "flat_strength": 0.8}
    )
    out = reduce_detail(img, int(preset["median"]), int(preset["colors"]))
    out = flatten_edges(
        out, int(preset["flat_band"]), float(preset["flat_strength"])
    )
    out = blend_edges(out)
    out.save(path)
    after = seam_metrics(out)

    tiled = Image.new("RGB", (img.width * 2, img.height * 2))
    for dy in range(2):
        for dx in range(2):
            tiled.paste(out, (dx * img.width, dy * img.height))
    preview = preview_dir / f"{key.replace('/', '_')}-2x2.png"
    tiled.save(preview)

    print(
        f"[seamless] {key}: 接缝H {before[0]:6.2f}→{after[0]:5.2f} | "
        f"接缝V {before[1]:6.2f}→{after[1]:5.2f} | "
        f"唯一色 {before[2]:5d}→{after[2]:3d} | "
        f"邻像素差 {before[3]:5.2f}→{after[3]:5.2f} | 2x2预览 {preview}"
    )
    return True


def main() -> int:
    keys = sys.argv[1:] or list(PRESETS)
    preview_dir = Path(tempfile.mkdtemp(prefix="seamcheck-"))
    grass_pal: tuple | None = None
    ok = True
    for k in keys:
        if k in REBUILD_KEYS:
            grass_pal = process_rebuild(k, preview_dir, grass_pal)
        else:
            ok = process(k, preview_dir) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
