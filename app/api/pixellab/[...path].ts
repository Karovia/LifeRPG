import type { IncomingMessage, ServerResponse } from 'node:http'
import { errorMessage, readRawBody, sendJson } from '../_lib/http'

/**
 * ============================================================
 * /api/pixellab/* —— Vercel serverless 代理（像素图生成）
 * ============================================================
 * 转发 /api/pixellab/<endpoint> → https://api.pixellab.ai/v1/<endpoint>：
 *   - 方法 / 查询串 / 请求体原样透传（bodyParser 关闭，读原始流）；
 *   - Authorization 由服务端环境变量 PIXELLAB_API_KEY 注入（覆盖客户端头），
 *     生产前端不持有任何密钥；
 *   - 上游状态码 / Content-Type / body 透传；超时 504、连接失败 502。
 *
 * 对应 dev 环境 vite.config.ts 中的 /pixellab proxy（行为一致）。
 * pixflux 冷请求可能 >120s，maxDuration 180s（受平台 plan 上限约束，
 * 见 DEPLOY.md）；内部上游超时 170s，保证早于平台强杀返回。
 * ============================================================
 */

export const config = {
  maxDuration: 180,
  api: { bodyParser: false },
}

/** 默认上游 base（PIXELLAB_UPSTREAM_BASE_URL 仅为本地测试钩子，生产勿配置；请求时读取） */
const DEFAULT_UPSTREAM_BASE = 'https://api.pixellab.ai/v1'
/** 上游超时（前端超时 180s，预留 10s 回包余量） */
const UPSTREAM_TIMEOUT_MS = 170_000
/** 请求体上限（图生图类接口可能带 base64 图片，给到 4MB） */
const MAX_BODY_BYTES = 4 * 1024 * 1024

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const apiKey = (process.env.PIXELLAB_API_KEY ?? '').trim()
  if (!apiKey) {
    sendJson(res, 500, { error: '服务端未配置 PIXELLAB_API_KEY，无法代理 Pixellab 请求' })
    return
  }

  const method = (req.method ?? 'GET').toUpperCase()
  // 同域调用不会触发预检；防御性直接放行
  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  // 解析子路径：/api/pixellab/<endpoint>?<query> → <endpoint>?<query>
  const upstreamBase = (
    process.env.PIXELLAB_UPSTREAM_BASE_URL ?? DEFAULT_UPSTREAM_BASE
  ).replace(/\/+$/, '')
  const url = new URL(req.url ?? '/', 'http://localhost')
  const subPath = url.pathname.replace(/^\/api\/pixellab\/?/, '').replace(/^\/+/, '')
  if (!subPath) {
    sendJson(res, 404, { error: 'Pixellab 路径缺失：/api/pixellab/<endpoint>' })
    return
  }

  const hasBody = method !== 'GET' && method !== 'HEAD'
  let body: Buffer | undefined
  if (hasBody) {
    try {
      body = await readRawBody(req, MAX_BODY_BYTES)
    } catch {
      sendJson(res, 413, { error: '请求体过大（上限 4MB）' })
      return
    }
  }

  // 透传 Content-Type；Authorization 一律以服务端 env 为准
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  const contentType = req.headers['content-type']
  if (typeof contentType === 'string' && contentType) headers['Content-Type'] = contentType

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const upstream = await fetch(`${upstreamBase}/${subPath}${url.search}`, {
      method,
      headers,
      body: hasBody && body && body.length > 0 ? new Uint8Array(body) : undefined,
      signal: controller.signal,
    })
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.statusCode = upstream.status
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    )
    res.end(buf)
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === 'AbortError'
    sendJson(res, aborted ? 504 : 502, {
      error: aborted
        ? 'Pixellab 上游请求超时（170s），请稍后重试'
        : `Pixellab 上游连接失败：${errorMessage(err)}`,
    })
  } finally {
    clearTimeout(timer)
  }
}
