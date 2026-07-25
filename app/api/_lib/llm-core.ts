/**
 * ============================================================
 * 职见未来 · 通用 LLM 代理核心逻辑（双宿主共用）
 * ============================================================
 * POST /api/llm 的处理核心，vite dev 中间件（vite-plugins/llm-proxy.ts）
 * 与 Vercel serverless function（api/llm.ts）共用，保证两端契约一致：
 *
 * body: {
 *   baseURL?: string           // OpenAI 兼容 API 基础地址；缺省时从服务端
 *                              //   环境变量 LLM_BASE_URL 注入（server mode）
 *   apiKey?: string            // Bearer 密钥；缺省时从 LLM_API_KEY 注入
 *   model?: string             // 模型 ID；缺省时从 LLM_MODEL 注入
 *   messages: ChatMessage[]    // OpenAI chat 消息数组 [{ role, content }]
 *   temperature?: number
 *   maxTokens?: number         // → 转发为上游 max_tokens
 *   responseFormat?: 'json' | ResponseFormat  // 'json' → { type: 'json_object' }
 * }
 *
 * 配置解析规则（字段级回退）：
 *   请求体每字段独立判断，缺省/空白时回退到对应服务端环境变量 ——
 *   生产 server mode 下前端不带三件套，全部由 env 注入；
 *   Admin 页用户自填配置时原样透传（body 优先于 env）。
 *
 * 上游错误：状态码与 body 原样透传；超时/断网等无上游响应的情况
 * 返回 504/502 + JSON error，前端据此走本地降级。
 * ============================================================
 */

// ---------- 常量 ----------

/** 上游请求超时（大模型长回复可能较慢，给足 60s） */
const UPSTREAM_TIMEOUT_MS = 60_000

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

// ---------- 结果类型（宿主只负责把它写到 res） ----------

export interface LlmProxyResult {
  status: number
  contentType: string
  body: string
}

function jsonResult(status: number, payload: unknown): LlmProxyResult {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 字段级回退：body 字段非空字符串时优先，否则用服务端 env 值 */
function resolveField(bodyValue: unknown, envValue: string | undefined): string {
  const fromBody = typeof bodyValue === 'string' ? bodyValue.trim() : ''
  return fromBody || (envValue ?? '').trim()
}

// ---------- 主处理 ----------

/**
 * 处理一次 /api/llm 请求（纯逻辑，不碰 req/res，方便双宿主复用与单测）。
 * @param rawBody 请求体原文（JSON 字符串）
 * @param env     服务端环境变量（缺省字段的注入来源）
 */
export async function forwardLlmRequest(
  rawBody: string,
  env: NodeJS.ProcessEnv,
): Promise<LlmProxyResult> {
  // 1) 解析与校验请求体
  let body: LlmProxyBody
  try {
    body = JSON.parse(rawBody) as LlmProxyBody
  } catch {
    return jsonResult(400, {
      error: '请求体必须是 JSON：{ baseURL?, apiKey?, model?, messages, ... }',
    })
  }

  // 2) 连接配置：body 优先，缺省字段由服务端 env 注入（server mode）
  const baseURL = resolveField(body.baseURL, env.LLM_BASE_URL).replace(/\/+$/, '')
  const apiKey = resolveField(body.apiKey, env.LLM_API_KEY)
  const model = resolveField(body.model, env.LLM_MODEL)
  const messages = Array.isArray(body.messages) ? body.messages : null

  if (!baseURL || !/^https?:\/\//i.test(baseURL)) {
    return jsonResult(400, {
      error: 'baseURL 缺失或不是合法的 http(s) 地址（请求未携带且服务端未配置 LLM_BASE_URL）',
    })
  }
  if (!apiKey) {
    return jsonResult(400, {
      error: 'apiKey 不能为空（请求未携带且服务端未配置 LLM_API_KEY）',
    })
  }
  if (!model) {
    return jsonResult(400, {
      error: 'model 不能为空（请求未携带且服务端未配置 LLM_MODEL）',
    })
  }
  if (!messages || messages.length === 0) {
    return jsonResult(400, { error: 'messages 必须是非空数组' })
  }

  // 3) 组装 OpenAI 兼容的上游请求体（camelCase → snake_case）
  const upstreamBody: Record<string, unknown> = { model, messages }
  if (typeof body.temperature === 'number') upstreamBody.temperature = body.temperature
  if (typeof body.maxTokens === 'number') upstreamBody.max_tokens = body.maxTokens
  if (body.responseFormat === 'json') {
    upstreamBody.response_format = { type: 'json_object' }
  } else if (body.responseFormat && typeof body.responseFormat === 'object') {
    upstreamBody.response_format = body.responseFormat
  }

  // 4) 转发上游（60s AbortController 超时）
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

    // 5) 透传：上游状态码 + body 原样回给前端（成功为上游 JSON，失败为上游错误详情）
    const text = await upstream.text()
    return {
      status: upstream.status,
      contentType: upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      body: text,
    }
  } catch (err) {
    // 无上游响应：超时 → 504；断网/DNS 等连接失败 → 502
    const aborted = (err as { name?: string } | null)?.name === 'AbortError'
    return jsonResult(aborted ? 504 : 502, {
      error: aborted
        ? 'LLM 上游请求超时（60s），请检查网络或服务地址'
        : `LLM 上游连接失败：${errorMessage(err)}`,
    })
  } finally {
    clearTimeout(timer)
  }
}
