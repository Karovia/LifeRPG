import type { IncomingMessage, ServerResponse } from 'node:http'
import { readBody, sendJson } from './_lib/http.js'
import { resolveLlmConfig, runDecompose } from './_lib/decompose-core.js'

/**
 * ============================================================
 * POST /api/decompose —— Vercel serverless function（AI 目标拆解）
 * ============================================================
 * 与 vite dev 中间件（vite-plugins/decompose-api.ts）共用
 * api/_lib/decompose-core（搜索链 + LLM 拆解 + 规则引擎兜底），契约一致：
 *   body: { goal: string, llm?: { baseURL, apiKey, model } }
 *   - LLM 配置优先 body.llm（Admin 页自填），缺省用服务端 env LLM_*；
 *   - 响应：{ goal, source, references, phases, nodes, anchorDate, generatedAt }
 *
 * 时长预算：LLM 大树生成约 80-100s，maxDuration 给到 120s；
 * 内部软预算 105s —— 搜索完成后剩余 <10s 直接跳过 LLM、LLM 单次尝试
 * 钳制在预算内，任何路径都保证函数在平台强杀前以规则引擎结果返回。
 * （若平台 plan 的 maxDuration 上限 <120s 导致硬超时，前端 fetchDecompose
 *   失败后会走本地离线降级，仍可用。）
 * ============================================================
 */

export const config = { maxDuration: 120 }

const MAX_BODY_BYTES = 256 * 1024
/** 软预算：maxDuration 120s 预留 15s 安全余量（搜索+回包） */
const SOFT_BUDGET_MS = 105_000

interface DecomposeRequestBody {
  goal?: unknown
  llm?: unknown
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed, use POST' })
    return
  }
  let goal = ''
  let llmRaw: unknown
  try {
    // Vercel 默认 bodyParser 已消费请求流并挂到 req.body；优先使用，避免流事件不触发
    const preParsed = (req as IncomingMessage & { body?: unknown }).body
    const rawText =
      preParsed != null
        ? typeof preParsed === 'string'
          ? preParsed
          : JSON.stringify(preParsed)
        : await readBody(req, MAX_BODY_BYTES)
    const body = JSON.parse(rawText) as DecomposeRequestBody
    if (typeof body.goal === 'string') goal = body.goal.trim().slice(0, 80)
    llmRaw = body.llm
  } catch {
    sendJson(res, 400, { error: '请求体必须是 JSON：{ "goal": "...", "llm"?: {...} }' })
    return
  }
  if (!goal) {
    sendJson(res, 400, { error: 'goal 不能为空' })
    return
  }

  // LLM 配置：body.llm 优先，缺省回退服务端 env LLM_*；都没有 → 规则引擎
  const llm = resolveLlmConfig(llmRaw, process.env)
  const payload = await runDecompose(goal, llm, { deadlineMs: Date.now() + SOFT_BUDGET_MS })
  sendJson(res, 200, payload)
}
