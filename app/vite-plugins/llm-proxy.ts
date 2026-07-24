import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * ============================================================
 * 职见未来 · 通用 LLM 代理（vite dev 中间件）
 * ============================================================
 * POST /api/llm
 * body: {
 *   baseURL: string            // OpenAI 兼容 API 基础地址，如 https://api.openai.com/v1
 *   apiKey: string             // Bearer 密钥（仅经本 dev server 转发，不进前端打包产物）
 *   model: string              // 模型 ID，如 gpt-4o-mini
 *   messages: ChatMessage[]    // OpenAI chat 消息数组 [{ role, content }]
 *   temperature?: number
 *   maxTokens?: number         // → 转发为上游 max_tokens
 *   responseFormat?: 'json' | ResponseFormat  // 'json' → { type: 'json_object' }
 * }
 *
 * 为什么需要它（CORS / 密钥中转）：
 *   浏览器直连用户自配的第三方 LLM 服务会被 CORS 拦截（大多数
 *   OpenAI 兼容端点不放行 localhost 跨域），且 apiKey 也不适合由
 *   前端直接拼进跨域请求。本中间件在 dev server 内代为转发：
 *     前端 fetch('/api/llm') → 本中间件 → POST ${baseURL}/chat/completions
 *   上游 HTTP 错误状态码与响应 body 原样透传，前端据此展示真实失败原因；
 *   超时/断网等无上游响应的情况返回 504/502 + JSON error，前端据此走本地降级。
 *
 * 与 /pixellab 代理、/api/decompose 中间件共存，互不影响。
 * ============================================================
 */

// ---------- 常量 ----------

/** 上游请求超时（大模型长回复可能较慢，给足 60s） */
const UPSTREAM_TIMEOUT_MS = 60_000
/** 请求体上限（日记/拆解 prompt 可能较长，给到 1MB） */
const MAX_BODY_BYTES = 1024 * 1024

// ---------- 请求体类型（字段全部 unknown，运行时逐一校验） ----------

interface LlmProxyBody {
  baseURL?: unknown
  apiKey?: unknown
  model?: unknown
  messages?: unknown
  temperature?: unknown
  maxTokens?: unknown
  responseFormat?: unknown
}

// ---------- HTTP 工具（与 decompose-api 同一套约定） ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
      if (data.length > MAX_BODY_BYTES) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------- 主处理 ----------

async function handleLlm(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed, use POST' })
    return
  }

  // 1) 解析与校验请求体
  let body: LlmProxyBody
  try {
    body = JSON.parse(await readBody(req)) as LlmProxyBody
  } catch {
    sendJson(res, 400, {
      error: '请求体必须是 JSON：{ baseURL, apiKey, model, messages, ... }',
    })
    return
  }

  const baseURL =
    typeof body.baseURL === 'string' ? body.baseURL.trim().replace(/\/+$/, '') : ''
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  const messages = Array.isArray(body.messages) ? body.messages : null

  if (!baseURL || !/^https?:\/\//i.test(baseURL)) {
    sendJson(res, 400, { error: 'baseURL 缺失或不是合法的 http(s) 地址' })
    return
  }
  if (!apiKey) {
    sendJson(res, 400, { error: 'apiKey 不能为空' })
    return
  }
  if (!model) {
    sendJson(res, 400, { error: 'model 不能为空' })
    return
  }
  if (!messages || messages.length === 0) {
    sendJson(res, 400, { error: 'messages 必须是非空数组' })
    return
  }

  // 2) 组装 OpenAI 兼容的上游请求体（camelCase → snake_case）
  const upstreamBody: Record<string, unknown> = { model, messages }
  if (typeof body.temperature === 'number') upstreamBody.temperature = body.temperature
  if (typeof body.maxTokens === 'number') upstreamBody.max_tokens = body.maxTokens
  if (body.responseFormat === 'json') {
    upstreamBody.response_format = { type: 'json_object' }
  } else if (body.responseFormat && typeof body.responseFormat === 'object') {
    upstreamBody.response_format = body.responseFormat
  }

  // 3) 转发上游（60s AbortController 超时）
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const upstream = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    })

    // 4) 透传：上游状态码 + body 原样回给前端（成功为上游 JSON，失败为上游错误详情）
    const text = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    )
    res.end(text)
  } catch (err) {
    // 无上游响应：超时 → 504；断网/DNS 等连接失败 → 502
    const aborted = (err as { name?: string } | null)?.name === 'AbortError'
    sendJson(res, aborted ? 504 : 502, {
      error: aborted
        ? 'LLM 上游请求超时（60s），请检查网络或服务地址'
        : `LLM 上游连接失败：${errorMessage(err)}`,
    })
  } finally {
    clearTimeout(timer)
  }
}

// ---------- vite 插件入口 ----------

/**
 * 注册 POST /api/llm 开发中间件。
 * 只拦截 /api/llm 路径，与 /pixellab 代理及 /api/decompose 共存。
 */
export function llmProxy(): Plugin {
  return {
    name: 'zhijian-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm', (req, res, next) => {
        handleLlm(req, res).catch(next)
      })
    },
  }
}
