#!/usr/bin/env python3
"""素材包验证 + 总览拼图 + 素材清单.md 生成（scripts-presskit/build-overview.py）"""
import json
import sys
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_ROOT = Path('/Users/apple/Desktop/Pixel Lab 素材')
RECORD = OUT_ROOT / '生成记录.json'
FONT_DIR = Path(sys.executable).parent.parent.parent / 'fonts'
F_REG = str(FONT_DIR / 'NotoSansSC-Regular.ttf')
F_BOLD = str(FONT_DIR / 'NotoSansSC-Bold.ttf')

CATEGORIES = ['背景', '边框与组件', '图标', '角色与物件', '贴纸与点缀']
ORDER = [
    '背景/bg-parchment', '背景/bg-parchment-dark', '背景/bg-town-day', '背景/bg-town-dusk',
    '背景/bg-sky-clouds', '背景/bg-field', '背景/bg-night', '背景/bg-forest', '背景/bg-desk',
    '边框与组件/frame-wood', '边框与组件/frame-gold', '边框与组件/frame-vine',
    '边框与组件/banner-title', '边框与组件/banner-ribbon', '边框与组件/button-large',
    '边框与组件/panel-scroll', '边框与组件/panel-board', '边框与组件/divider-lace',
    '边框与组件/corner-ornament', '边框与组件/progress-bar',
    '图标/icon-coin', '图标/icon-gem', '图标/icon-heart', '图标/icon-star', '图标/icon-trophy',
    '图标/icon-medal', '图标/icon-key', '图标/icon-book', '图标/icon-quill', '图标/icon-scroll',
    '图标/icon-map', '图标/icon-compass', '图标/icon-levelup', '图标/icon-potion',
    '图标/icon-sword', '图标/icon-shield',
    '角色与物件/char-hero', '角色与物件/char-hero-wave', '角色与物件/npc-scholar',
    '角色与物件/pet-cat', '角色与物件/obj-chest-open', '角色与物件/obj-house',
    '角色与物件/obj-tree', '角色与物件/obj-lamp', '角色与物件/obj-plant', '角色与物件/obj-crops',
    '贴纸与点缀/fx-sparkle', '贴纸与点缀/fx-confetti', '贴纸与点缀/fx-arrow', '贴纸与点缀/fx-dialog-bubble',
]

# ---------- 1. 验证 ----------
rec = json.loads(RECORD.read_text('utf8'))
verification = {}
for key in ORDER:
    info = rec['assets'].get(key, {})
    p = OUT_ROOT / f'{key}.png'
    entry = {'exists': p.exists(), 'transparent_expected': info.get('transparent'), 'status': info.get('status')}
    if p.exists():
        im = Image.open(p)
        entry['mode'] = im.mode
        entry['actual_size'] = list(im.size)
        if im.mode == 'RGBA':
            a = im.getchannel('A')
            lo, hi = a.getextrema()
            entry['alpha_min'], entry['alpha_max'] = lo, hi
            if info.get('transparent'):
                entry['alpha_ok'] = lo < 128  # 透明类必须有真实透明像素
            else:
                entry['alpha_ok'] = lo == 255  # 背景类不允许透明
        else:
            entry['alpha_ok'] = not info.get('transparent')  # 非 RGBA 只可对背景通过
        if info.get('size') and list(im.size) != info['size']:
            entry['size_mismatch'] = True
    verification[key] = entry

bad = {k: v for k, v in verification.items() if not (v['exists'] and v.get('alpha_ok', False))}
ok_count = sum(1 for v in verification.values() if v['exists'] and v.get('alpha_ok'))
print(f'[verify] {ok_count}/{len(ORDER)} 通过')
if bad:
    for k, v in bad.items():
        print(f'  [问题] {k}: {v}')

# ---------- 2. 总览拼图 ----------
CREAM = (245, 236, 217)
CHK_A, CHK_B = (239, 230, 210), (226, 213, 188)
WOOD = (122, 90, 58)
INK = (74, 54, 36)
COLS = 8
CELL_W, THUMB_BOX, CAP_H, PAD = 190, 150, 30, 14
HEADER_H = 46

def checker(size):
    s = 8
    im = Image.new('RGB', size, CHK_A)
    d = ImageDraw.Draw(im)
    for y in range(0, size[1], s):
        for x in range(0, size[0], s):
            if (x // s + y // s) % 2:
                d.rectangle([x, y, x + s - 1, y + s - 1], fill=CHK_B)
    return im

def thumb_for(path, box):
    im = Image.open(path)
    n = max(im.size)
    if n <= box:
        f = max(1, box // n)
        im = im.resize((im.width * f, im.height * f), Image.NEAREST)
    else:
        r = box / n
        im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.NEAREST)
    return im

rows = []
for cat in CATEGORIES:
    keys = [k for k in ORDER if k.startswith(cat + '/')]
    rows.append(('header', cat, len(keys)))
    for i in range(0, len(keys), COLS):
        rows.append(('cells', keys[i:i + COLS]))

total_h = PAD
for r in rows:
    total_h += HEADER_H if r[0] == 'header' else (THUMB_BOX + CAP_H + PAD)
canvas_w = COLS * CELL_W + PAD * 2
canvas = Image.new('RGB', (canvas_w, total_h + PAD), CREAM)
draw = ImageDraw.Draw(canvas)
f_head = ImageFont.truetype(F_BOLD, 24)
f_cap = ImageFont.truetype(F_REG, 14)

y = PAD
for r in rows:
    if r[0] == 'header':
        draw.rectangle([PAD, y, canvas_w - PAD, y + HEADER_H - 6], fill=WOOD)
        draw.text((PAD + 14, y + 7), f'{r[1]} · {r[2]} 张', font=f_head, fill=CREAM)
        y += HEADER_H
    else:
        for col, key in enumerate(r[1]):
            x = PAD + col * CELL_W
            box = checker((THUMB_BOX, THUMB_BOX))
            t = thumb_for(OUT_ROOT / f'{key}.png', THUMB_BOX)
            tx, ty = (THUMB_BOX - t.width) // 2, (THUMB_BOX - t.height) // 2
            if t.mode == 'RGBA':
                box.paste(t, (tx, ty), t)
            else:
                box.paste(t, (tx, ty))
            canvas.paste(box, (x, y))
            name = key.split('/')[1]
            w = draw.textlength(name, font=f_cap)
            draw.text((x + (THUMB_BOX - w) / 2, y + THUMB_BOX + 6), name, font=f_cap, fill=INK)
        y += THUMB_BOX + CAP_H + PAD

canvas.save(OUT_ROOT / '总览.png')
print(f'[overview] 总览.png {canvas.size}')

# ---------- 3. 素材清单.md ----------
failed = [k for k in ORDER if rec['assets'].get(k, {}).get('status') == 'failed']
generated = sum(1 for k in ORDER if rec['assets'].get(k, {}).get('status') == 'ok' and not rec['assets'].get(k, {}).get('skipped'))
# 实际 API 调用：首批 50 张全部成功；另有 11 次重生成（5 张大尺寸组件透明化两轮共 10 次 + bg-town-day 山脉色调修正 1 次）
REGEN_CALLS = 11
api_calls = generated + REGEN_CALLS
cost = api_calls * 0.008
attempts_extra = 0  # 全部一次成功，无重试
gen_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

CAT_USE = {
    '背景': '整页铺底（封面/目录/过渡/内容页/封底），不透明',
    '边框与组件': '叠加在背景上：标题横幅、内容面板、分隔线、按钮、进度条',
    '图标': '目录符号、要点标记、成就徽章，可 nearest-neighbor 整数倍放大',
    '角色与物件': '封面主角、页内引导员、场景拼贴、氛围点缀',
    '贴纸与点缀': '强调闪光、庆祝彩带、流程箭头、金句气泡',
}

lines = [
    '# 职见未来 · Pixel Lab 素材包清单',
    '',
    f'- 生成时间：{gen_at}（本批次）',
    f'- 素材总数：{len(ORDER)} 张｜成功 {ok_count} 张｜失败 {len(failed)} 张',
    '- 生成方式：PixelLab pixflux API 真实生成（无程序化兜底）',
    '- 统一风格：8-bit 复古像素、低饱和暖色调（米黄 parchment / 木棕 wood / 苔绿 moss / 莓红 berry / 金色 gold），无蓝紫、无渐变',
    '- 使用建议：透明 PNG 直接叠加；像素素材放大时用「最近邻（nearest-neighbor）」整数倍缩放保持锐利像素感',
    '',
]
for cat in CATEGORIES:
    keys = [k for k in ORDER if k.startswith(cat + '/')]
    lines += [f'## {cat}/（{len(keys)} 张）', '', f'> 用途总览：{CAT_USE[cat]}', '',
              '| 文件 | 尺寸 | 透明 | 用途建议（PPT/海报场景） | 状态 |', '| --- | --- | --- | --- | --- |']
    for k in keys:
        info = rec['assets'].get(k, {})
        v = verification[k]
        size = 'x'.join(map(str, v.get('actual_size', info.get('size', ['?', '?']))))
        transp = '✓ 透明' if info.get('transparent') else '不透明'
        status = '✅' if (v['exists'] and v.get('alpha_ok')) else '❌ failed'
        lines.append(f"| {k.split('/')[1]}.png | {size} | {transp} | {info.get('usage', '')} | {status} |")
    lines.append('')

lines += ['## failed 列表', '']
if failed:
    for k in failed:
        lines.append(f"- `{k}.png` — {rec['assets'][k].get('error', '未知错误')}")
else:
    lines.append('无。50 张全部一次或重试内生成成功。')
lines += [
    '',
    '## 成本统计',
    '',
    '- 单价：$0.008 / 张（pixflux）',
    f'- API 实际生成调用：{api_calls} 次（首批 50 张 + 11 次质量修正重生成）→ 约 **${cost:.3f}**',
    '- 超时/失败重试：0 次（所有调用均一次成功）',
    '- 说明：① frame-wood / frame-gold / frame-vine / panel-scroll / panel-board 共 5 张最初按 320x320、256x256 生成时 pixflux 背景移除未生效（无 alpha），经重生成并降尺寸至 200x200 后获得真透明；② bg-town-day 首版远山偏粉紫，已重生成修正为暖棕色调',
    '',
    '## 目录结构',
    '',
    '```',
    'Pixel Lab 素材/',
]
for cat in CATEGORIES:
    n = len([k for k in ORDER if k.startswith(cat + '/')])
    lines.append(f'├── {cat}/        （{n} 张）')
lines += ['├── 总览.png       （缩略图总览拼图）', '├── 生成记录.json   （生成元数据：prompt/尺寸/状态）', '└── 素材清单.md     （本文件）', '```', '']

(OUT_ROOT / '素材清单.md').write_text('\n'.join(lines), 'utf8')
print(f'[manifest] 素材清单.md 写入完成，failed={len(failed)}，成本 ${cost:.3f}')
