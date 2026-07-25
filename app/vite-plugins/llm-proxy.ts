import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { readBody, sendJson } from '../api/_lib/http'
import { forwardLlmRequest } from '../api/_lib/llm-core'

/**
 * ============================================================
 * 职见未来 · 通用 LLM 代理（vite dev 中间件）
 * ============================================================
 * POST /api/llm
 * body: {
 *   baseURL?: string           // OpenAI 兼容 API 基础地址，如 https://api.openai.com/v1
 *   apiKey?: string            // Bearer 密钥（仅经本 dev server 转发，不进前端打包产物）
 *   model?: string             // 模型 ID，如 gpt-4o-mini
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
 * 实现：处理逻辑与生产 Vercel function（api/llm.ts）共用
 *   api/_lib/llm-core（body 缺省字段从进程 env LLM_* 注入 —— dev 下
 *   前端总是携带完整配置，不会触发该回退，行为与历史版本一致）。
 * 与 /pixellab 代理、/api/decompose 中间件共存，互不影响。
 * ============================================================
 */

// ---------- 常量 ----------

/** 请求体上限（日记/拆解 prompt 可能较长，给到 1MB） */
const MAX_BODY_BYTES = 1024 * 1024

// ---------- 主处理（薄壳：读 body → 共享核心 → 写回） ----------

async function handleLlm(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
