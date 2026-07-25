#!/usr/bin/env node
/**
 * 职见未来 · PPT/海报像素素材包批量生成器（scripts-presskit/generate-presskit.mjs）
 * 直连 Pixellab API（pixflux），输出到 ~/Desktop/Pixel Lab 素材/
 * 用法: node generate-presskit.mjs batch1 ... | node generate-presskit.mjs --all
 * 已存在的文件自动跳过（断点续跑），结果写入 素材根目录/生成记录.json
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WS_ROOT = path.resolve(__dirname, '..')
const ENV_PATH = path.join(WS_ROOT, 'app', '.env')
const OUT_ROOT = '/Users/apple/Desktop/Pixel Lab 素材'
const RECORD_PATH = path.join(OUT_ROOT, '生成记录.json')

const API_BASE = 'https://api.pixellab.ai/v1'
const TIMEOUT_MS = 180_000
const MAX_ATTEMPTS = 2
const CONCURRENCY = 4
const COST_PER_IMAGE = 0.008

const STYLE = '8-bit retro pixel art, warm low-saturation palette, clean lines, flat color blocks, no gradient, strictly no blue no purple'

/** key: '<分类文件夹>/<文件名>' */
const ASSETS = [
  // ================= 背景（不透明） =================
  { key: '背景/bg-parchment', w: 320, h: 320, noBg: false,
    usage: 'PPT 内容页/目录页通用浅色底',
    prompt: `old parchment paper texture background, warm beige cream with subtle aged stains and slightly darker worn edges, low detail, clean flat empty surface suitable as a presentation slide background, no text, ${STYLE}` },
  { key: '背景/bg-parchment-dark', w: 320, h: 320, noBg: false,
    usage: '封面/封底深色底、章节过渡页',
    prompt: `dark aged parchment paper texture background, deep warm brown tan with subtle stains and worn darker edges, low detail, clean flat empty surface suitable as a presentation slide background, no text, ${STYLE}` },
  { key: '背景/bg-town-day', w: 400, h: 400, noBg: false,
    usage: '封面主视觉、开场页',
    prompt: `a cozy pixel art village town panorama, small houses with warm berry-red and brown roofs, moss green trees, dirt paths, distant mountains in warm tan and soft brown tones with cream highlights, warm morning sunlight sky with soft cream clouds, 8-bit retro RPG background, ${STYLE}, no pink no mauve` },
  { key: '背景/bg-town-dusk', w: 400, h: 400, noBg: false,
    usage: '章节过渡页、结尾氛围页',
    prompt: `a cozy pixel art village town at dusk, warm orange and amber sunset sky, small houses with glowing golden windows, silhouettes of moss green trees, 8-bit retro RPG background, ${STYLE}` },
  { key: '背景/bg-sky-clouds', w: 400, h: 400, noBg: false,
    usage: '目录页/过渡页轻盈背景',
    prompt: `warm pixel art sky filled with soft cream and golden clouds, gentle warm morning light, pale gold and soft peach sky tones, 8-bit retro pixel art background, ${STYLE}` },
  { key: '背景/bg-field', w: 400, h: 400, noBg: false,
    usage: '内容页底图、愿景页',
    prompt: `pixel art grassland horizon, rolling moss green meadows meeting a warm pale golden sky, a few tiny warm wildflowers and distant trees on the horizon line, 8-bit retro RPG background, ${STYLE}` },
  { key: '背景/bg-night', w: 400, h: 400, noBg: false,
    usage: '封底、致谢页、彩蛋页',
    prompt: `warm-toned pixel art night sky, deep warm dark brown sky filled with many small warm golden yellow stars, a soft glowing warm cream moon, sleepy village silhouette at the bottom edge, stars must be warm yellow, 8-bit retro RPG background, ${STYLE}` },
  { key: '背景/bg-forest', w: 400, h: 400, noBg: false,
    usage: '章节过渡页、探索主题页',
    prompt: `a cozy pixel art forest scene, moss green tree canopy, warm brown trunks, dappled warm sunlight on grass, a small dirt path leading into the woods, 8-bit retro RPG background, ${STYLE}` },
  { key: '背景/bg-desk', w: 400, h: 400, noBg: false,
    usage: '日记/复盘/方法主题内容页',
    prompt: `top-down view of a cozy wooden writer desk, an open diary journal with blank parchment pages, a feather quill pen, a small warm glowing oil lamp, warm wood grain table surface filling the whole canvas, no text, 8-bit retro pixel art, ${STYLE}` },

  // ================= 边框与组件（透明） =================
  { key: '边框与组件/frame-wood', w: 200, h: 200, noBg: true,
    usage: '封面标题框、重点内容装裱',
    prompt: `a square wooden picture frame border only, warm brown wood planks with visible grain and joined corners, the center area completely empty hollow and transparent, isolated object on a fully transparent background, no backdrop no fill, rustic style, 8-bit retro pixel art frame, ${STYLE}` },
  { key: '边框与组件/frame-gold', w: 200, h: 200, noBg: true,
    usage: '荣誉页、成就页装裱',
    prompt: `an ornate square golden picture frame border only, elegant warm gold trim with small decorative corner flourishes, the center area completely empty hollow and transparent, isolated object on a fully transparent background, no backdrop no fill, 8-bit retro pixel art frame, ${STYLE}` },
  { key: '边框与组件/frame-vine', w: 200, h: 200, noBg: true,
    usage: '目录页、柔和过渡装饰框',
    prompt: `a square decorative border made of moss green vines with small leaves and tiny warm red berries wrapping around the four edges, the center area completely empty hollow and transparent, isolated object on a fully transparent background, no backdrop no fill, 8-bit retro pixel art frame, ${STYLE}` },
  { key: '边框与组件/banner-title', w: 200, h: 200, noBg: true,
    usage: '页面标题横幅',
    prompt: `a horizontal title banner ribbon, wide parchment scroll banner with curled ends and berry-red trim, small and compact, centered horizontally in the middle of the canvas, empty banner surface, no text, 8-bit retro pixel art game UI, ${STYLE}` },
  { key: '边框与组件/banner-ribbon', w: 200, h: 200, noBg: true,
    usage: '小标题/标签缎带',
    prompt: `a folded ribbon banner, berry-red ribbon with elegant folds and notched swallowtail ends, horizontal, small and compact, centered in the middle of the canvas, empty ribbon surface, no text, 8-bit retro pixel art game UI, ${STYLE}` },
  { key: '边框与组件/button-large', w: 200, h: 200, noBg: true,
    usage: '互动页、CTA 按钮',
    prompt: `a chunky pixel art game button with 3d depth effect, warm wood brown rectangular button with golden border, lighter top edge highlight and darker bottom shadow edge, centered, empty button surface, no text, 8-bit retro game UI, ${STYLE}` },
  { key: '边框与组件/panel-scroll', w: 200, h: 200, noBg: true,
    usage: '任务/公告/引文内容面板',
    prompt: `an unrolled parchment scroll panel, old paper with curled top and bottom wooden rods, warm beige parchment center area large and empty for text, isolated object on a fully transparent background, no backdrop, no text, 8-bit retro pixel art game UI panel, ${STYLE}` },
  { key: '边框与组件/panel-board', w: 200, h: 200, noBg: true,
    usage: '告示牌式内容块、要点面板',
    prompt: `a wooden notice board sign, warm brown wooden planks panel on a short post, large empty board center for text, isolated object on a fully transparent background, no backdrop, rustic village style, no text, 8-bit retro pixel art game UI, ${STYLE}` },
  { key: '边框与组件/divider-lace', w: 256, h: 64, noBg: true,
    usage: '内容页分隔线',
    prompt: `a single long thin horizontal decorative divider strip, pixel lace pattern with small diamond and wave ornaments in warm gold and cream, one thin horizontal line ornament centered, 8-bit retro pixel art, ${STYLE}` },
  { key: '边框与组件/corner-ornament', w: 200, h: 200, noBg: true,
    usage: '封面/封底四角装饰',
    prompt: `four decorative corner flourish ornaments placed at the four corners of the canvas, elegant pixel filigree curls in warm gold, each ornament pointing inward, the center area completely empty, 8-bit retro pixel art, ${STYLE}` },
  { key: '边框与组件/progress-bar', w: 256, h: 64, noBg: true,
    usage: '进度展示、成长条、数据页',
    prompt: `a single long thin horizontal pixel art game progress bar, fully filled with warm gold and berry-red flat segmented fill, ornate wooden frame border with golden end caps, centered, no gradient, 8-bit retro game UI, ${STYLE}` },

  // ================= 图标（64x64 透明） =================
  { key: '图标/icon-coin', w: 64, h: 64, noBg: true, usage: '积分/收益/激励符号',
    prompt: `a shiny round gold coin with a star emblem, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-gem', w: 64, h: 64, noBg: true, usage: '珍贵成果/稀有徽章',
    prompt: `a faceted warm red-orange ruby gemstone with sparkles, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-heart', w: 64, h: 64, noBg: true, usage: '热爱/价值观/能量符号',
    prompt: `a glossy pixel heart, warm berry-red with a small cream highlight, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-star', w: 64, h: 64, noBg: true, usage: '亮点/收藏/重点标记',
    prompt: `a glowing golden five-pointed star with small sparkles, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-trophy', w: 64, h: 64, noBg: true, usage: '成就页、奖项符号',
    prompt: `a golden trophy cup with two handles on a wooden base, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-medal', w: 64, h: 64, noBg: true, usage: '荣誉/里程碑徽章',
    prompt: `a round golden medal hanging on a berry-red ribbon, star emblem in the center, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-key', w: 64, h: 64, noBg: true, usage: '关键能力/解锁符号',
    prompt: `an antique brass golden key with an ornate bow handle, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-book', w: 64, h: 64, noBg: true, usage: '知识/学习/技能符号',
    prompt: `a closed magic book with a berry-red cover, golden corners and a star clasp, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-quill', w: 64, h: 64, noBg: true, usage: '写作/表达/创作符号',
    prompt: `a warm cream feather quill pen with an ink-dipped tip, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-scroll', w: 64, h: 64, noBg: true, usage: '任务/计划/清单符号',
    prompt: `a rolled parchment scroll tied with a berry-red ribbon, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-map', w: 64, h: 64, noBg: true, usage: '规划/路线图符号',
    prompt: `an old folded treasure map with a dotted path and a berry-red X mark, parchment corners, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-compass', w: 64, h: 64, noBg: true, usage: '方向/职业定位符号',
    prompt: `a brass pocket compass with a warm red needle and golden case, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-levelup', w: 64, h: 64, noBg: true, usage: '成长/升级符号',
    prompt: `a bold upward level-up arrow, warm gold arrow with small sparkles around it, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-potion', w: 64, h: 64, noBg: true, usage: '能量/恢复/状态符号',
    prompt: `a round glass potion bottle filled with warm red liquid and a cork stopper, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-sword', w: 64, h: 64, noBg: true, usage: '战斗力/技能攻击符号',
    prompt: `a pixel art sword with a warm cream-silver blade, golden crossguard and brown leather grip, pointing up diagonally, 8-bit retro pixel art game icon, ${STYLE}` },
  { key: '图标/icon-shield', w: 64, h: 64, noBg: true, usage: '防御/抗压力/保障符号',
    prompt: `a wooden knight shield with a golden rim and a berry-red star emblem, 8-bit retro pixel art game icon, ${STYLE}` },

  // ================= 角色与物件（64x64 透明） =================
  { key: '角色与物件/char-hero', w: 64, h: 64, noBg: true, usage: '封面主角、页内引导员',
    prompt: `a full-body pixel art adventurer character, front view standing, wearing a moss green tunic and brown boots with a small leather satchel, warm friendly face, 8-bit retro RPG sprite, ${STYLE}` },
  { key: '角色与物件/char-hero-wave', w: 64, h: 64, noBg: true, usage: '开场/结尾致意、互动页',
    prompt: `a full-body pixel art adventurer character waving one hand in greeting, front view, moss green tunic and brown boots, warm happy smile, 8-bit retro RPG sprite, ${STYLE}` },
  { key: '角色与物件/npc-scholar', w: 64, h: 64, noBg: true, usage: '导师/方法论讲解页角色',
    prompt: `a pixel art scholar character, front view, round glasses, wearing a warm brown robe and holding a small book, gentle smile, 8-bit retro RPG sprite, ${STYLE}` },
  { key: '角色与物件/pet-cat', w: 64, h: 64, noBg: true, usage: '氛围点缀、彩蛋贴纸',
    prompt: `a cute sitting ginger orange cat with a curled tail and warm cream belly, 8-bit retro pixel art pet sprite, ${STYLE}` },
  { key: '角色与物件/obj-chest-open', w: 64, h: 64, noBg: true, usage: '奖励/成果展示页',
    prompt: `an open wooden treasure chest with gold trim, overflowing with gold coins and a warm red gem, lid flipped open, 8-bit retro pixel art game sprite, ${STYLE}` },
  { key: '角色与物件/obj-house', w: 64, h: 64, noBg: true, usage: '场景拼贴、家/归属主题',
    prompt: `a cute cozy pixel cottage, warm berry-red gabled roof, cream parchment walls, wooden door, glowing windows, a small chimney, 8-bit retro RPG building sprite, ${STYLE}` },
  { key: '角色与物件/obj-tree', w: 64, h: 64, noBg: true, usage: '场景拼贴、成长主题',
    prompt: `a big plump pixel tree with a full layered moss green canopy and a sturdy warm brown trunk, a few tiny red berries, 8-bit retro RPG sprite, ${STYLE}` },
  { key: '角色与物件/obj-lamp', w: 64, h: 64, noBg: true, usage: '场景拼贴、指引主题',
    prompt: `a village street lamp, dark wooden post with a warm golden glowing lantern on top, 8-bit retro pixel art sprite, ${STYLE}` },
  { key: '角色与物件/obj-plant', w: 64, h: 64, noBg: true, usage: '页角点缀、生机主题',
    prompt: `a small potted green plant in a terracotta pot, 8-bit retro pixel art decoration sprite, ${STYLE}` },
  { key: '角色与物件/obj-crops', w: 64, h: 64, noBg: true, usage: '收获/成果主题点缀',
    prompt: `a harvest bundle of pixel crops, an orange carrot, a round orange pumpkin and golden wheat stalks arranged together, 8-bit retro pixel art farming sprite, ${STYLE}` },

  // ================= 贴纸与点缀（48x48 透明） =================
  { key: '贴纸与点缀/fx-sparkle', w: 48, h: 48, noBg: true, usage: '强调闪光、标题点缀',
    prompt: `a cluster of small warm golden sparkle stars and glints, four-pointed sparkles of different sizes, 8-bit retro pixel art effect, ${STYLE}` },
  { key: '贴纸与点缀/fx-confetti', w: 48, h: 48, noBg: true, usage: '庆祝页、成就页点缀',
    prompt: `small pixel confetti pieces, tiny warm red, gold, cream and moss green paper squares and short ribbons floating, 8-bit retro pixel art effect, ${STYLE}` },
  { key: '贴纸与点缀/fx-arrow', w: 48, h: 48, noBg: true, usage: '流程指引、重点指向',
    prompt: `a hand-drawn style chunky pixel arrow pointing to the right, warm berry-red with a darker outline, slightly bouncy cute curve, 8-bit retro pixel art sticker, ${STYLE}` },
  { key: '贴纸与点缀/fx-dialog-bubble', w: 48, h: 48, noBg: true, usage: '金句/对话/旁白气泡',
    prompt: `a pixel art speech dialog bubble, rounded rectangle parchment bubble with a small tail at the bottom left, warm cream fill with brown outline, empty inside, no text, 8-bit retro pixel art, ${STYLE}` },
]

const BATCHES = {
  batch1: ['背景/bg-parchment', '背景/bg-parchment-dark', '背景/bg-town-day', '背景/bg-town-dusk', '背景/bg-sky-clouds', '背景/bg-field', '背景/bg-night', '背景/bg-forest'],
  batch2: ['背景/bg-desk', '边框与组件/frame-wood', '边框与组件/frame-gold', '边框与组件/frame-vine', '边框与组件/banner-title', '边框与组件/banner-ribbon', '边框与组件/button-large', '边框与组件/panel-scroll'],
  batch3: ['边框与组件/panel-board', '边框与组件/divider-lace', '边框与组件/corner-ornament', '边框与组件/progress-bar', '图标/icon-coin', '图标/icon-gem', '图标/icon-heart', '图标/icon-star'],
  batch4: ['图标/icon-trophy', '图标/icon-medal', '图标/icon-key', '图标/icon-book', '图标/icon-quill', '图标/icon-scroll', '图标/icon-map', '图标/icon-compass'],
  batch5: ['图标/icon-levelup', '图标/icon-potion', '图标/icon-sword', '图标/icon-shield', '角色与物件/char-hero', '角色与物件/char-hero-wave', '角色与物件/npc-scholar', '角色与物件/pet-cat'],
  batch6: ['角色与物件/obj-chest-open', '角色与物件/obj-house', '角色与物件/obj-tree', '角色与物件/obj-lamp', '角色与物件/obj-plant', '角色与物件/obj-crops', '贴纸与点缀/fx-sparkle', '贴纸与点缀/fx-confetti'],
  batch7: ['贴纸与点缀/fx-arrow', '贴纸与点缀/fx-dialog-bubble'],
}

async function loadApiKey() {
  const raw = await readFile(ENV_PATH, 'utf8')
  const m = raw.match(/^\s*VITE_PIXELLAB_API_KEY\s*=\s*(.+?)\s*$/m)
  if (!m) throw new Error('app/.env 缺少 VITE_PIXELLAB_API_KEY')
  return m[1].replace(/^["']|["']$/g, '')
}

class HttpError extends Error {
  constructor(msg, status) { super(msg); this.status = status }
}

async function generate(apiKey, asset) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/generate-image-pixflux`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        description: asset.prompt,
        image_size: { width: asset.w, height: asset.h },
        no_background: asset.noBg,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(`HTTP ${res.status} ${text.slice(0, 140)}`, res.status)
    }
    const data = await res.json()
    const b64 = data?.image?.base64
    if (!b64) throw new Error('响应缺少 image.base64')
    return b64.replace(/^data:image\/\w+;base64,/, '')
  } finally {
    clearTimeout(timer)
  }
}

async function loadRecord() {
  try { return JSON.parse(await readFile(RECORD_PATH, 'utf8')) } catch { return { assets: {}, updatedAt: null } }
}

async function saveRecord(rec) {
  rec.updatedAt = new Date().toISOString()
  await mkdir(OUT_ROOT, { recursive: true })
  await writeFile(RECORD_PATH, JSON.stringify(rec, null, 2) + '\n')
}

async function exists(p) { try { await access(p); return true } catch { return false } }

async function processOne(apiKey, asset, rec) {
  const outPath = path.join(OUT_ROOT, `${asset.key}.png`)
  if (await exists(outPath)) {
    rec.assets[asset.key] = { status: 'ok', skipped: true, size: [asset.w, asset.h], transparent: asset.noBg, usage: asset.usage, prompt: asset.prompt }
    await saveRecord(rec)
    console.log(`[skip] ${asset.key} 已存在`)
    return
  }
  let lastErr = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[gen] ${asset.key} (${asset.w}x${asset.h}) 第 ${attempt}/${MAX_ATTEMPTS} 次…`)
      const b64 = await generate(apiKey, asset)
      await mkdir(path.dirname(outPath), { recursive: true })
      await writeFile(outPath, Buffer.from(b64, 'base64'))
      rec.assets[asset.key] = { status: 'ok', attempts: attempt, size: [asset.w, asset.h], transparent: asset.noBg, usage: asset.usage, prompt: asset.prompt }
      await saveRecord(rec)
      console.log(`[ok] ${asset.key} ✓`)
      return
    } catch (err) {
      lastErr = err.message
      console.warn(`[warn] ${asset.key} 第 ${attempt} 次失败: ${lastErr}`)
    }
  }
  rec.assets[asset.key] = { status: 'failed', error: lastErr, attempts: MAX_ATTEMPTS, size: [asset.w, asset.h], transparent: asset.noBg, usage: asset.usage, prompt: asset.prompt }
  await saveRecord(rec)
  console.error(`[fail] ${asset.key} 已记录 failed`)
}

async function main() {
  const args = process.argv.slice(2)
  let keys
  if (args.includes('--all')) keys = ASSETS.map((a) => a.key)
  else if (args.length > 0) {
    keys = []
    for (const arg of args) {
      if (BATCHES[arg]) keys.push(...BATCHES[arg])
      else if (ASSETS.some((a) => a.key === arg)) keys.push(arg)
      else { console.error(`未知批次/素材: ${arg}。可用: ${Object.keys(BATCHES).join(', ')}`); process.exit(2) }
    }
  } else { console.error(`用法: node generate-presskit.mjs <${Object.keys(BATCHES).join('|')}> | --all`); process.exit(2) }

  const targets = ASSETS.filter((a) => keys.includes(a.key))
  const apiKey = await loadApiKey()
  const rec = await loadRecord()
  rec.meta = { generator: 'scripts-presskit/generate-presskit.mjs', outRoot: OUT_ROOT, costPerImage: COST_PER_IMAGE, batches: Object.keys(BATCHES) }
  await saveRecord(rec)

  // 简单并发池
  let idx = 0
  async function worker() {
    while (idx < targets.length) {
      const asset = targets[idx++]
      await processOne(apiKey, asset, rec)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))

  const ok = targets.filter((a) => rec.assets[a.key]?.status === 'ok').length
  const failed = targets.filter((a) => rec.assets[a.key]?.status === 'failed')
  const freshCost = targets.filter((a) => rec.assets[a.key]?.status === 'ok' && !rec.assets[a.key]?.skipped).length * COST_PER_IMAGE
  console.log(`\n== 本批完成: ${ok}/${targets.length} 成功, ${failed.length} 失败, 新增成本 ~$${freshCost.toFixed(3)} ==`)
  if (failed.length > 0) console.log(`failed: ${failed.map((a) => a.key).join(', ')}`)
}

main().catch((err) => { console.error(`✗ 异常: ${err.stack || err.message}`); process.exit(1) })
