#!/usr/bin/env node
/**
 * ============================================================
 * 职见未来 · 像素素材批量生成器（generate-assets.mjs）
 * ============================================================
 * 直连 Pixellab API（https://api.pixellab.ai/v1，Bearer 认证）批量生成像素素材。
 * API key 从 app/.env 的 VITE_PIXELLAB_API_KEY 读取（脚本不会打印 key）。
 *
 * 降级策略（已知账户余额可能为 $0）：
 *   每个素材先尝试 Pixellab（超时 180s，失败重试 1 次）；
 *   失败则统一调用 `python3 scripts/fallback-assets.py <key ...>` 程序化绘制兜底。
 *   降级也保证产出全部文件，manifest.json 如实标注来源（pixellab | fallback）。
 *   若遇到 401/402/403（鉴权/余额类错误），跳过后续素材的 API 尝试，直接全部兜底，节省时间。
 *
 * 用法：
 *   node scripts/generate-assets.mjs            # 生成全部素材
 *   node scripts/generate-assets.mjs ui/coin    # 只生成指定 key
 * ============================================================
 */

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(APP_ROOT, 'public', 'assets')
const ENV_PATH = path.join(APP_ROOT, '.env')
const FALLBACK_SCRIPT = path.join(__dirname, 'fallback-assets.py')

const API_BASE = 'https://api.pixellab.ai/v1'
const TIMEOUT_MS = 180_000 // 实测 64x64 pixflux ~24s，冷请求可能 >120s
const MAX_ATTEMPTS = 2 // 首次 + 重试 1 次
// 鉴权/余额类错误：继续重试无意义，直接全部降级
const FATAL_STATUSES = new Set([401, 402, 403])

/** @type {Array<{key:string, width:number, height:number, noBackground:boolean, prompt:string, postProcess?:string}>} */
const ASSETS = [
  {
    key: 'ui/coin',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a shiny round gold coin with a star emblem, 8-bit retro pixel art game icon, warm low-saturation palette',
  },
  {
    key: 'ui/chest',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a closed wooden treasure chest with gold trim and lock, 8-bit retro pixel art game icon, warm brown palette',
  },
  {
    key: 'ui/xp-star',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a glowing golden five-pointed experience star, 8-bit retro pixel art game icon, warm palette',
  },
  {
    key: 'bg/parchment',
    width: 256,
    height: 256,
    noBackground: false,
    prompt:
      'old parchment paper texture, seamless, warm beige with subtle stains and aged edges, pixel art style, low saturation, no text',
  },
  {
    key: 'bg/town',
    width: 320,
    height: 320,
    noBackground: false,
    prompt:
      'a cozy pixel art village town scene, small houses with warm brown roofs, green trees, grass and a dirt path, warm morning sky, 8-bit retro RPG background, low saturation warm colors, no blue or purple',
  },
  {
    key: 'avatar/placeholder',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'pixel art game character bust, a cute hooded adventurer wearing a moss green cloak, 16-bit retro RPG style, front view',
  },
  {
    key: 'decor/plant',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a small potted green plant in a terracotta pot, 8-bit retro pixel art home decoration, warm palette',
  },
  {
    key: 'decor/bookshelf',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a wooden bookshelf filled with colorful books, 8-bit retro pixel art home decoration, warm palette',
  },
  {
    key: 'decor/lamp',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a standing floor lamp with a warm glowing lampshade, 8-bit retro pixel art home decoration, warm palette',
  },
  {
    key: 'decor/trophy',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a golden trophy cup on a wooden base, 8-bit retro pixel art home decoration, warm palette',
  },
  {
    key: 'decor/cat',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a cute sitting ginger cat, 8-bit retro pixel art pet, warm palette',
  },
  // ---------------- 第二轮：导航图标 48x48 ----------------
  {
    key: 'nav/home',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a tiny cozy house icon with a warm berry-red roof, 8-bit retro pixel art game UI icon, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'nav/quests',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a rolled parchment quest scroll tied with a red ribbon, 8-bit retro pixel art game UI icon, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'nav/town',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a tiny stone castle town icon with battlements and a wooden gate, 8-bit retro pixel art game UI icon, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'nav/diary',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a closed diary book with a berry-red cover and a ribbon bookmark, 8-bit retro pixel art game UI icon, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'nav/resume',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a parchment resume sheet with a feather quill pen, 8-bit retro pixel art game UI icon, warm low-saturation palette, no blue or purple',
  },
  // ---------------- 第二轮：小镇地块 64x64 俯视 ----------------
  {
    key: 'tiles/grass',
    width: 64,
    height: 64,
    noBackground: false,
    postProcess: '生成图带暗角时：采样调色板经 PIL 程序化环绕重建无缝地面 (scripts/seamless-tiles.py)',
    prompt:
      'an extremely subtle top-down grass ground tile, almost flat uniform muted moss green, only very sparse faint low-contrast pixel speckles, no large patterns, no flowers, no shapes, no direction, flat uniform lighting, no vignette, no darker edges, uniform brightness all the way to the edges, minimal detail, edge-to-edge seamless tileable, 8-bit retro pixel art RPG map tile, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/path',
    width: 64,
    height: 64,
    noBackground: false,
    postProcess: '生成带苔藓绿底时：改用全局暖色调色板经 PIL 程序化无缝重建 (scripts/seamless-tiles.py)',
    prompt:
      'a top-down cobblestone path tile, small rounded warm beige stones on warm sand, evenly distributed all the way to the edges of the canvas, uniform density, low contrast, no grass, no moss, no leaves, no border, no vignette, flat uniform lighting, no large centerpiece, edge-to-edge seamless tileable, 8-bit retro pixel art RPG map tile, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/flower',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a lush hand-painted bush of small warm red and golden flowers with layered green leaves and tiny highlights, 8-bit retro pixel art RPG map decoration, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/house',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a cute cozy hand-painted pixel cottage, warm berry-red gabled roof with shading, wooden door with a knob, glowing windows with cross panes, a small chimney, 8-bit retro pixel art RPG building, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/tree',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a plump round moss green pixel tree with a full layered canopy, soft top-left highlights, a few tiny red berries, wooden trunk, 8-bit retro pixel art RPG map decoration, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/water',
    width: 64,
    height: 64,
    noBackground: false,
    prompt:
      'a hand-painted top-down water surface tile, only calm water filling the entire canvas, muted sage green-teal water with soft cream ripple highlights, no rocks, no border, no grass, full-bleed seamless, 8-bit retro pixel art RPG map tile, warm low-saturation palette, strictly no purple no magenta no saturated blue',
  },
  {
    key: 'tiles/fence',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a cute hand-painted wooden fence with two horizontal rails and two posts, warm brown wood with soft shading, 8-bit retro pixel art RPG map decoration, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/lamp',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a cute hand-painted village street lamp, dark wooden post with a warm golden glowing lantern on top, 8-bit retro pixel art RPG map decoration, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/field',
    width: 64,
    height: 64,
    noBackground: false,
    postProcess: 'seamless edge-blend + detail reduction via PIL (scripts/seamless-tiles.py)',
    prompt:
      'a top-down farmland soil tile, tilled warm brown earth with thin subtle parallel ridges evenly spaced across the whole canvas, uniform low detail, no plants, no border, edge-to-edge seamless tileable, 8-bit retro pixel art RPG farming map tile, warm low-saturation palette, no blue or purple',
  },
  // ---------------- 第二轮：NPC 立绘 64x64 正面 ----------------
  {
    key: 'npc/elder',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'hand-painted pixel art game character, a kind old elder with a long white beard wearing a berry-red robe with subtle folds and shading, warm gentle smile, front view, detailed 8-bit retro RPG style, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'npc/merchant',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'hand-painted pixel art game character, a friendly merchant wearing a brown wide-brim hat and moss green apron with a gold coin pouch, warm smile, soft shading, front view, detailed 8-bit retro RPG style, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'npc/artist',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'hand-painted pixel art game character, a cheerful artist wearing a berry-red beret and a parchment apron holding a paint brush, warm smile, soft shading, front view, detailed 8-bit retro RPG style, warm low-saturation palette, no blue or purple',
  },
  // ---------------- 第二轮：作物阶段 48x48 ----------------
  {
    key: 'crop/seed',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a few small golden seeds on a mound of warm brown soil, 8-bit retro pixel art farming game sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'crop/sprout',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a small green sprout seedling growing from warm brown soil, 8-bit retro pixel art farming game sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'crop/ripe',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a ripe orange carrot with green leaves, 8-bit retro pixel art farming game sprite, warm low-saturation palette, no blue or purple',
  },
  // ---------------- 第三轮：草地变体 + 多格建筑 + 钓鱼/作物 ----------------
  {
    key: 'tiles/grass2',
    width: 64,
    height: 64,
    noBackground: false,
    postProcess: '沿用 grass 采样调色板经 PIL 程序化环绕重建并加野花点缀 (scripts/seamless-tiles.py)',
    prompt:
      'a top-down grass ground tile, almost flat uniform muted moss green base, with only two or three tiny sparse wildflower dots and small grass tufts, mostly empty plain grass, minimal detail, no large patterns, flat uniform lighting, no vignette, no radial shading, uniform brightness all the way to the edges, edge-to-edge seamless tileable, 8-bit retro pixel art RPG map tile, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'buildings/house-red',
    width: 128,
    height: 128,
    noBackground: true,
    prompt:
      'a cute cozy pixel cottage seen from the front, warm berry-red gabled roof, cream parchment walls, wooden door centered at the bottom, two glowing windows with cross panes, a small chimney, base at the bottom edge, centered, 8-bit retro pixel art RPG building sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'buildings/house-wood',
    width: 128,
    height: 128,
    noBackground: true,
    prompt:
      'a pixel art wooden general store seen from the front, warm brown timber walls, dark wooden gabled roof, a small hanging wooden shop sign above the door, a display window with goods, base at the bottom edge, centered, 8-bit retro RPG building sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'buildings/house-tall',
    width: 128,
    height: 192,
    noBackground: true,
    prompt:
      'a tall two-story pixel art studio tower seen from the front, narrow cozy house with a warm berry-red pointed roof, cream walls, wooden door at the bottom, stacked glowing windows on both floors, a small attic window, base at the bottom edge, centered, 8-bit retro RPG building sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'buildings/well',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a small pixel art stone water well, round stone base with a little wooden gabled roof on two posts and a hanging bucket, centered, 8-bit retro RPG village decoration sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/tree-big',
    width: 64,
    height: 128,
    noBackground: true,
    prompt:
      'a big tall pixel art tree, full round layered moss green canopy filling the upper two thirds, a short sturdy warm brown wooden trunk at the bottom, a few tiny warm red berries, centered, 8-bit retro RPG map sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'tiles/dock',
    width: 64,
    height: 64,
    noBackground: true,
    prompt:
      'a small wooden fishing dock platform, warm brown planks with visible gaps and two short support posts, compact square platform viewed from above at a slight angle, centered, 8-bit retro RPG map sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'ui/fish',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a small cute pixel fish, warm orange-gold body with soft shading, simple tail fin and one eye, side view, 8-bit retro pixel art game reward icon, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'crop/pumpkin-ripe',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a ripe round orange pumpkin with a green stem sitting on a small mound of warm brown soil, 8-bit retro pixel art farming game sprite, warm low-saturation palette, no blue or purple',
  },
  {
    key: 'crop/wheat-ripe',
    width: 48,
    height: 48,
    noBackground: true,
    prompt:
      'a small bundle of ripe golden wheat stalks with grain heads growing from a mound of warm brown soil, 8-bit retro pixel art farming game sprite, warm low-saturation palette, no blue or purple',
  },
]

/** 从 app/.env 解析 VITE_PIXELLAB_API_KEY（不打印内容） */
async function loadApiKey() {
  try {
    const raw = await readFile(ENV_PATH, 'utf8')
    const m = raw.match(/^\s*VITE_PIXELLAB_API_KEY\s*=\s*(.+?)\s*$/m)
    if (!m) return null
    const value = m[1].replace(/^["']|["']$/g, '')
    if (!value || value === 'your-pixellab-api-key') return null
    return value
  } catch {
    return null
  }
}

class PixellabHttpError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/** 调用 pixflux 生成，返回 base64；失败抛错 */
async function generateViaPixellab(apiKey, asset) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/generate-image-pixflux`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        description: asset.prompt,
        image_size: { width: asset.width, height: asset.height },
        no_background: asset.noBackground,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new PixellabHttpError(
        `HTTP ${res.status} ${text.slice(0, 160)}`,
        res.status,
      )
    }
    const data = await res.json()
    const b64 = data?.image?.base64
    if (!b64) throw new Error('响应缺少 image.base64')
    return b64.replace(/^data:image\/\w+;base64,/, '')
  } finally {
    clearTimeout(timer)
  }
}

async function saveBase64Png(b64, outPath) {
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, Buffer.from(b64, 'base64'))
}

/** 调用兜底脚本，为给定 key 列表程序化绘制 PNG；返回成功生成的 key 集合 */
function runFallback(keys) {
  if (keys.length === 0) return new Set()
  console.log(`\n[fallback] 启动兜底绘制: ${keys.join(', ')}`)
  const result = spawnSync('python3', [FALLBACK_SCRIPT, ...keys], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    timeout: 120_000,
  })
  if (result.error) {
    console.error(`[fallback] 调用失败: ${result.error.message}`)
    return new Set()
  }
  if (result.status !== 0) {
    console.error(`[fallback] 脚本退出码 ${result.status}`)
    // 部分文件可能已生成，逐一校验
  }
  return new Set(keys) // 由后续文件存在性校验兜底确认
}

async function fileExists(p) {
  try {
    const { access } = await import('node:fs/promises')
    await access(p)
    return true
  } catch {
    return false
  }
}

async function main() {
  const onlyKeys = process.argv.slice(2)
  const targets =
    onlyKeys.length > 0
      ? ASSETS.filter((a) => onlyKeys.includes(a.key))
      : ASSETS
  if (targets.length === 0) {
    console.error(`没有匹配的素材 key。可用: ${ASSETS.map((a) => a.key).join(', ')}`)
    process.exit(2)
  }

  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('[pixellab] 未找到有效 VITE_PIXELLAB_API_KEY，全部素材直接走兜底绘制')
  }

  /** @type {Record<string, 'pixellab'|'fallback'>} */
  const sources = {}
  const needFallback = []
  let apiDead = !apiKey // 401/402/403 后置为 true，跳过后续 API 尝试

  for (const asset of targets) {
    const outPath = path.join(OUT_ROOT, `${asset.key}.png`)
    if (apiDead) {
      needFallback.push(asset.key)
      continue
    }
    let ok = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try {
        console.log(
          `[pixellab] ${asset.key} 生成中（第 ${attempt}/${MAX_ATTEMPTS} 次，最长 ${TIMEOUT_MS / 1000}s）…`,
        )
        const b64 = await generateViaPixellab(apiKey, asset)
        await saveBase64Png(b64, outPath)
        sources[asset.key] = 'pixellab'
        ok = true
        console.log(`[pixellab] ${asset.key} ✓ -> ${outPath}`)
      } catch (err) {
        const status = err instanceof PixellabHttpError ? err.status : undefined
        console.warn(
          `[pixellab] ${asset.key} 第 ${attempt} 次失败: ${err.message}`,
        )
        if (status && FATAL_STATUSES.has(status)) {
          console.warn(
            `[pixellab] 检测到 ${status}（鉴权/余额问题），后续素材全部改用兜底绘制`,
          )
          apiDead = true
          break
        }
      }
    }
    if (!ok) needFallback.push(asset.key)
  }

  if (needFallback.length > 0) {
    runFallback(needFallback)
    for (const key of needFallback) sources[key] = 'fallback'
  }

  // 校验所有文件存在
  const missing = []
  for (const asset of targets) {
    const outPath = path.join(OUT_ROOT, `${asset.key}.png`)
    if (!(await fileExists(outPath))) missing.push(asset.key)
  }
  if (missing.length > 0) {
    console.error(`\n✗ 以下素材生成失败（文件缺失）: ${missing.join(', ')}`)
    process.exit(1)
  }

  // 写 manifest（若已存在则合并，保证多次分批运行后清单完整）
  const manifestPath = path.join(OUT_ROOT, 'manifest.json')
  /** @type {Record<string, unknown>} */
  let existingAssets = {}
  try {
    const prev = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (prev && typeof prev === 'object' && prev.assets) existingAssets = prev.assets
  } catch {
    // 首次运行或清单损坏，忽略
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'app/scripts/generate-assets.mjs',
    assets: {
      ...existingAssets,
      ...Object.fromEntries(
        targets.map((a) => [
          a.key,
          {
            path: `/assets/${a.key}.png`,
            source: sources[a.key] ?? 'fallback',
            size: [a.width, a.height],
            transparent: a.noBackground,
            prompt: a.prompt,
            ...(a.postProcess ? { postProcess: a.postProcess } : {}),
          },
        ]),
      ),
    },
  }
  await mkdir(OUT_ROOT, { recursive: true })
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  const byPixellab = targets.filter((a) => sources[a.key] === 'pixellab').length
  const byFallback = targets.length - byPixellab
  console.log(`\n✓ 完成: ${byPixellab} 张来自 Pixellab，${byFallback} 张来自兜底绘制`)
  console.log(`✓ manifest -> ${manifestPath}`)
}

main().catch((err) => {
  console.error(`✗ 生成器异常: ${err.stack || err.message}`)
  process.exit(1)
})
