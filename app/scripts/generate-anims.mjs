#!/usr/bin/env node
/**
 * ============================================================
 * 职见未来 · 像素动画帧生成器（generate-anims.mjs）
 * ============================================================
 * 直连 Pixellab API（https://api.pixellab.ai/v1/animate-with-text，Bearer 认证）
 * 为小镇对象生成 64x64 逐帧动画，落盘为帧序列：
 *   public/assets/anim/<name>/frame-0.png ... frame-N.png
 * API key 从 app/.env 的 VITE_PIXELLAB_API_KEY 读取（脚本不会打印 key）。
 *
 * 请求结构（v1 探活实测）：
 *   POST /v1/animate-with-text
 *   { description, action, reference_image: { type:'base64', base64 },
 *     image_size: { width, height }, n_frames }
 *   必填：action、reference_image（缺省返回 422 并列出缺字段）
 * 响应结构（实测）：
 *   { usage: {...}, images: [ { type:'base64', base64 }, ... ] }
 *   images 每项是一帧完整 PNG（64x64）；若未来返回单张横向 spritesheet，
 *   本脚本会按 64px 宽自动切片（调用 python3/Pillow）。
 *
 * 降级策略：
 *   每个动画失败重试 1 次；仍失败（或 401/402/403 鉴权/余额类错误）则
 *   调用 `python3 scripts/fallback-assets.py anim/<name>` 程序化生成
 *   伪动画帧（单帧位移 / 水波错相），manifest 如实标注 source: fallback。
 *
 * 成本（官方文档估价，64x64 x 4 帧 ≈ $0.01565 / 次）：脚本末尾打印估算总额。
 *
 * 用法：
 *   node scripts/generate-anims.mjs                # 生成全部动画
 *   node scripts/generate-anims.mjs anim/cat-walk  # 只生成指定动画
 * ============================================================
 */

import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(APP_ROOT, 'public', 'assets')
const ENV_PATH = path.join(APP_ROOT, '.env')
const FALLBACK_SCRIPT = path.join(__dirname, 'fallback-assets.py')

const API_BASE = 'https://api.pixellab.ai/v1'
const TIMEOUT_MS = 180_000
const MAX_ATTEMPTS = 2 // 首次 + 重试 1 次
const FATAL_STATUSES = new Set([401, 402, 403])
const EST_COST_PER_ANIM = 0.01565 // 官方文档：64x64 x 4 frames

/** @type {Array<{key:string, ref:string, description:string, action:string, frames:number}>} */
const ANIMS = [
  {
    key: 'anim/cat-walk',
    ref: 'decor/cat.png',
    description:
      'a cute ginger cat, 8-bit retro pixel art pet, warm low-saturation palette, no blue or purple',
    action: 'walking loop, four-legged walk cycle, subtle bobbing, side view',
    frames: 4,
  },
  {
    key: 'anim/elder-idle',
    ref: 'npc/elder.png',
    description:
      'pixel art game character, a kind old elder with a long white beard wearing a berry-red robe, front view, 8-bit retro RPG style, warm low-saturation palette, no blue or purple',
    action: 'idle breathing loop, gentle vertical sway, front view, subtle motion',
    frames: 4,
  },
  {
    key: 'anim/merchant-idle',
    ref: 'npc/merchant.png',
    description:
      'pixel art game character, a friendly merchant wearing a brown wide-brim hat and moss green apron, front view, 8-bit retro RPG style, warm low-saturation palette, no blue or purple',
    action: 'idle breathing loop, gentle vertical sway, front view, subtle motion',
    frames: 4,
  },
  {
    key: 'anim/artist-idle',
    ref: 'npc/artist.png',
    description:
      'pixel art game character, a cheerful artist wearing a berry-red beret and a parchment apron holding a paint brush, front view, 8-bit retro RPG style, warm low-saturation palette, no blue or purple',
    action: 'idle breathing loop, gentle vertical sway, front view, subtle motion',
    frames: 4,
  },
  {
    key: 'anim/water',
    ref: 'tiles/water.png',
    description:
      'a hand-painted top-down water surface, only calm water, muted sage green-teal with soft cream ripple highlights, no rocks, no border, 8-bit retro pixel art, warm low-saturation palette, strictly no purple no magenta no saturated blue',
    action: 'gentle water ripples looping, calm pond surface shimmer',
    frames: 4,
  },
]

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

/** 调用 animate-with-text，返回 base64 帧数组；失败抛错 */
async function animateViaPixellab(apiKey, anim) {
  const refB64 = (await readFile(path.join(OUT_ROOT, anim.ref))).toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/animate-with-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        description: anim.description,
        action: anim.action,
        reference_image: { type: 'base64', base64: refB64 },
        image_size: { width: 64, height: 64 },
        n_frames: anim.frames,
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
    // 实测响应：{ images: [ { type:'base64', base64 }, ... ] }，每项一帧
    const images = Array.isArray(data?.images) ? data.images : []
    const frames = images
      .map((img) => (typeof img === 'string' ? img : img?.base64))
      .filter(Boolean)
      .map((b64) => b64.replace(/^data:image\/\w+;base64,/, ''))
    if (frames.length === 0) throw new Error('响应缺少 images[].base64 帧列表')
    return frames
  } finally {
    clearTimeout(timer)
  }
}

/** 读取 PNG IHDR 尺寸（不依赖第三方库） */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
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

/** 保存帧序列；单张宽图视为横向 spritesheet 自动切片（Pillow） */
async function saveFrames(frameB64List, anim, outDir) {
  await mkdir(outDir, { recursive: true })
  const buffers = frameB64List.map((b64) => Buffer.from(b64, 'base64'))
  if (buffers.length === 1) {
    const size = pngSize(buffers[0])
    if (size && size.width > size.height && size.width % 64 === 0) {
      const tmp = path.join(outDir, '_spritesheet.png')
      await writeFile(tmp, buffers[0])
      const py =
        `from PIL import Image;import sys;` +
        `img=Image.open(sys.argv[1]);n=img.width//64;` +
        `[img.crop((i*64,0,(i+1)*64,img.height)).save(f"{sys.argv[2]}/frame-{i}.png") for i in range(n)]`
      const r = spawnSync('python3', ['-c', py, tmp, outDir], { stdio: 'inherit' })
      await unlink(tmp).catch(() => {})
      if (r.status !== 0) throw new Error('spritesheet 切片失败')
      const names = (await readdir(outDir)).filter((n) => /^frame-\d+\.png$/.test(n)).sort()
      return names.map((n) => path.join(outDir, n))
    }
  }
  const outPaths = []
  for (let i = 0; i < buffers.length; i++) {
    const p = path.join(outDir, `frame-${i}.png`)
    await writeFile(p, buffers[i])
    outPaths.push(p)
  }
  return outPaths
}

/** 兜底：程序化生成伪动画帧；返回帧文件列表 */
function runFallback(anim, outDir) {
  console.log(`[fallback] ${anim.key} 启动兜底伪动画`)
  const result = spawnSync('python3', [FALLBACK_SCRIPT, anim.key], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    timeout: 120_000,
  })
  if (result.error || result.status !== 0) {
    console.error(`[fallback] ${anim.key} 兜底异常: ${result.error?.message ?? `退出码 ${result.status}`}`)
    return []
  }
  return readdir(outDir)
    .then((names) =>
      names
        .filter((n) => /^frame-\d+\.png$/.test(n))
        .sort()
        .map((n) => path.join(outDir, n)),
    )
    .catch(() => [])
}

async function main() {
  const onlyKeys = process.argv.slice(2)
  const targets =
    onlyKeys.length > 0 ? ANIMS.filter((a) => onlyKeys.includes(a.key)) : ANIMS
  if (targets.length === 0) {
    console.error(`没有匹配的动画 key。可用: ${ANIMS.map((a) => a.key).join(', ')}`)
    process.exit(2)
  }

  const apiKey = await loadApiKey()
  if (!apiKey) {
    console.log('[pixellab] 未找到有效 VITE_PIXELLAB_API_KEY，全部动画直接走兜底')
  }

  /** @type {Record<string, {source:'pixellab'|'fallback', frames:string[]}>} */
  const results = {}
  let apiDead = !apiKey
  let pixellabCalls = 0

  for (const anim of targets) {
    const name = anim.key.split('/')[1]
    const outDir = path.join(OUT_ROOT, 'anim', name)
    if (apiDead) {
      const frames = await runFallback(anim, outDir)
      results[anim.key] = { source: 'fallback', frames }
      continue
    }
    let ok = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try {
        console.log(
          `[pixellab] ${anim.key} 动画生成中（第 ${attempt}/${MAX_ATTEMPTS} 次，最长 ${TIMEOUT_MS / 1000}s）…`,
        )
        const frameB64 = await animateViaPixellab(apiKey, anim)
        pixellabCalls++
        const saved = await saveFrames(frameB64, anim, outDir)
        results[anim.key] = { source: 'pixellab', frames: saved }
        ok = true
        console.log(`[pixellab] ${anim.key} ✓ ${saved.length} 帧 -> ${outDir}`)
      } catch (err) {
        const status = err instanceof PixellabHttpError ? err.status : undefined
        console.warn(`[pixellab] ${anim.key} 第 ${attempt} 次失败: ${err.message}`)
        if (status && FATAL_STATUSES.has(status)) {
          console.warn(`[pixellab] 检测到 ${status}（鉴权/余额问题），后续动画全部改用兜底`)
          apiDead = true
          break
        }
      }
    }
    if (!ok) {
      const frames = await runFallback(anim, outDir)
      results[anim.key] = { source: 'fallback', frames }
    }
  }

  // 校验：每个动画至少 1 帧
  const missing = targets.filter((a) => (results[a.key]?.frames?.length ?? 0) === 0)
  if (missing.length > 0) {
    console.error(`\n✗ 以下动画生成失败（无帧文件）: ${missing.map((a) => a.key).join(', ')}`)
    process.exit(1)
  }

  // 合并写 manifest
  const manifestPath = path.join(OUT_ROOT, 'manifest.json')
  let manifest = { generatedAt: new Date().toISOString(), generator: 'app/scripts/generate-assets.mjs', assets: {} }
  try {
    const prev = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (prev && typeof prev === 'object') manifest = { ...manifest, ...prev, assets: prev.assets ?? {} }
  } catch {
    // 首次运行或清单损坏，忽略
  }
  for (const anim of targets) {
    const name = anim.key.split('/')[1]
    const r = results[anim.key]
    manifest.assets[anim.key] = {
      path: `/assets/anim/${name}/`,
      frames: r.frames.map((_, i) => `/assets/anim/${name}/frame-${i}.png`),
      frameCount: r.frames.length,
      size: [64, 64],
      loop: true,
      source: r.source,
      fallback: r.source === 'fallback',
      prompt: anim.description,
      action: anim.action,
      reference: `/assets/${anim.ref}`,
    }
  }
  manifest.generatedAt = new Date().toISOString()
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  const byPixellab = targets.filter((a) => results[a.key].source === 'pixellab').length
  const byFallback = targets.length - byPixellab
  console.log(`\n✓ 完成: ${byPixellab} 组动画来自 Pixellab，${byFallback} 组来自兜底伪动画`)
  console.log(`✓ manifest -> ${manifestPath}`)
  console.log(`$ 估算成本: ${pixellabCalls} 次 animate-with-text ≈ $${(pixellabCalls * EST_COST_PER_ANIM).toFixed(5)}（官方估价）`)
}

main().catch((err) => {
  console.error(`✗ 动画生成器异常: ${err.stack || err.message}`)
  process.exit(1)
})
