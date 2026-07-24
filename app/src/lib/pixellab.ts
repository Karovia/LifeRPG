/**
 * ============================================================
 * Pixellab API 封装（像素图生成）
 * ============================================================
 * 探活结论（2026-07-24 实测）：
 * - Base URL : https://api.pixellab.ai/v1
 * - 认证     : HTTP Bearer —— `Authorization: Bearer <VITE_PIXELLAB_API_KEY>`
 * - 响应结构 : 同步返回 HTTP 200，非异步轮询：
 *   `{ "usage": { "type": "generations", "generations": 1 }, "image": { "type": "base64", "base64": "<原始base64，非 data URI>" } }`
 * - 64x64 pixflux 实测耗时 ~24s（冷请求可能 >120s），前端超时须放宽
 * - OpenAPI : https://api.pixellab.ai/v1/openapi.json
 *
 * 开发环境走 vite proxy：`/pixellab/*` → `https://api.pixellab.ai/v1/*`（绕 CORS）
 * ============================================================
 */

const API_KEY = import.meta.env.VITE_PIXELLAB_API_KEY as string | undefined

/** 开发环境走 vite proxy；生产环境直连（要求服务端允许 CORS 或自行反代） */
const BASE_URL = import.meta.env.DEV ? '/pixellab' : 'https://api.pixellab.ai/v1'

/** 生成请求较慢，默认 3 分钟超时 */
const DEFAULT_TIMEOUT_MS = 180_000

export class PixellabError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PixellabError'
    this.status = status
  }
}

export interface PixelImage {
  /** 可直接用于 <img src> 的 data URL（image/png） */
  dataUrl: string
  /** 原始 base64（无 data: 前缀） */
  base64: string
  /** 本次消耗（Pixellab 返回的 usage 对象，结构随接口而异） */
  usage?: Record<string, unknown>
}

interface PixellabImageResponse {
  usage?: Record<string, unknown>
  image: { type: string; base64: string }
}

async function post<TReq extends object>(
  path: string,
  body: TReq,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PixellabImageResponse> {
  if (!API_KEY) {
    throw new PixellabError(
      '缺少 VITE_PIXELLAB_API_KEY，请在 app/.env 中配置后重启 dev server',
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new PixellabError(
        `Pixellab ${path} 失败: HTTP ${res.status} ${text.slice(0, 200)}`,
        res.status,
      )
    }
    return (await res.json()) as PixellabImageResponse
  } finally {
    clearTimeout(timer)
  }
}

function toPixelImage(res: PixellabImageResponse): PixelImage {
  const raw = res.image.base64
  // 实测返回为纯 base64；兼容个别情况下带 data: 前缀
  const dataUrl = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
  return { dataUrl, base64: raw.replace(/^data:image\/\w+;base64,/, ''), usage: res.usage }
}

export interface ImageSize {
  width: number
  height: number
}

/**
 * 文生像素图（pixflux）。
 * @param description 画面描述（英文效果更佳）
 * @param size 32x32 ~ 400x400 之间
 * @param noBackground 透明背景（>200x200 区域不支持）
 */
export async function createImagePixflux(
  description: string,
  size: ImageSize = { width: 128, height: 128 },
  noBackground = true,
): Promise<PixelImage> {
  const res = await post('/generate-image-pixflux', {
    description,
    image_size: size,
    no_background: noBackground,
  })
  return toPixelImage(res)
}

/**
 * 创建像素角色形象（虚拟形象模块用）。
 * 基于 pixflux，强制方形 + 透明背景 + 像素角色提示词包装。
 * @param description 角色外观描述，如 "a young adventurer with brown hair and a green cloak"
 */
export async function createCharacter(
  description: string,
  size: ImageSize = { width: 128, height: 128 },
): Promise<PixelImage> {
  const prompt = `pixel art game character, full body, ${description}, 16-bit retro RPG style`
  const res = await post('/generate-image-pixflux', {
    description: prompt,
    image_size: size,
    no_background: true,
    view: 'side',
  })
  return toPixelImage(res)
}

/**
 * 文生动画（animate-with-text）：按动作描述生成 4 帧角色动画。
 * 返回帧数组（每张都是可用 data URL）。
 * @param description 角色描述
 * @param action 动作描述，如 "walking", "waving"
 * @param size 帧尺寸
 */
export async function animateWithText(
  description: string,
  action: string,
  size: ImageSize = { width: 128, height: 128 },
): Promise<PixelImage[]> {
  if (!API_KEY) {
    throw new PixellabError(
      '缺少 VITE_PIXELLAB_API_KEY，请在 app/.env 中配置后重启 dev server',
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}/animate-with-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        description,
        action,
        image_size: size,
        n_frames: 4,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new PixellabError(
        `Pixellab animate-with-text 失败: HTTP ${res.status} ${text.slice(0, 200)}`,
        res.status,
      )
    }
    const data = (await res.json()) as {
      usage?: Record<string, unknown>
      images?: { type: string; base64: string }[]
      image?: { type: string; base64: string }
    }
    const frames = data.images ?? (data.image ? [data.image] : [])
    return frames.map((f) =>
      toPixelImage({ image: f, usage: data.usage }),
    )
  } finally {
    clearTimeout(timer)
  }
}

/** 查询账户余额（USD） */
export async function getBalance(): Promise<number> {
  if (!API_KEY) {
    throw new PixellabError('缺少 VITE_PIXELLAB_API_KEY')
  }
  const res = await fetch(`${BASE_URL}/balance`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  if (!res.ok) throw new PixellabError(`查询余额失败: HTTP ${res.status}`, res.status)
  const data = (await res.json()) as { type: string; usd?: number }
  return data.usd ?? 0
}
