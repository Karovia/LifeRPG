import type { IncomingMessage, ServerResponse } from 'node:http'
import { readBody, sendJson } from './_lib/http'
import { forwardLlmRequest } from './_lib/llm-core'

/**
 * ============================================================
 * POST /api/llm —— Vercel serverless function（通用 LLM 代理）
 * ============================================================
 * 与 vite dev 中间件（vite-plugins/llm-proxy.ts）共用 api/_lib/llm-core，
 * 契约完全一致：
 *   body: { baseURL?, apiKey?, model?, messages, temperature?, maxTokens?, responseFormat? }
 *   - 生产 server mode：前端不带 baseURL/apiKey/model，由本函数从
 *     服务端环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 注入；
 *   - Admin 页用户自填配置：body 字段原样透传（body 优先于 env）。
 * 上游 60s 超时；上游状态码与 body 原样透传（错误透传），
 * 无上游响应时返回 504/502 + JSON error。
 * ============================================================
 */

// 上游自带 60s AbortController 超时；maxDuration 给平台侧同样 60s 上限
export const config = { maxDuration: 60 }

/** 请求体上限（日记/拆解 prompt 可能较长，给到 1MB） */
const MAX_BODY_BYTES = 1024 * 1024

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed, use POST' })
    return
  }
  let rawBody: string
  try {
    rawBody = await readBody(req, MAX_BODY_BYTES)
  } catch {
    sendJson(res, 413, { error: '请求体过大（上限 1MB）' })
    return
  }
  const result = await forwardLlmRequest(rawBody, process.env)
  res.statusCode = result.status
  res.setHeader('Content-Type', result.contentType)
  res.end(result.body)
}
