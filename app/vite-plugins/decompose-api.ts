import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { readBody, sendJson } from '../api/_lib/http'
import { resolveLlmConfig, runDecompose } from '../api/_lib/decompose-core'

/**
 * ============================================================
 * 职见未来 · AI 目标拆解 API（vite dev 中间件）
 * ============================================================
 * POST /api/decompose
 * body: { goal: string, llm?: { baseURL: string, apiKey: string, model: string } }
 *
 * 流水线（实现位于 api/_lib/decompose-core，与生产 Vercel function
 * api/decompose.ts 共用，两端行为一致；详细说明见该文件头注释）：
 *   1. 联网搜索三层回退：Bing → 搜狗 → DuckDuckGo（失败不阻断）；
 *   2. LLM 拆解（llm 三字段齐备时尝试，120s 超时，失败静默回退）；
 *      LLM 配置优先 body.llm，缺省回退进程 env LLM_*（dev 下前端总是
 *      携带完整配置，不会触发该回退，行为与历史版本一致）；
 *   3. 规则引擎兜底（类别模板，节点带产出物与验收标准）；
 *   4. Deadline 以服务器当天为锚点按节点估时累计。
 *
 * 响应结构：{ goal, source, references, phases, nodes, anchorDate, generatedAt }
 *   source：'llm+search' / 'llm-only' / 'duckduckgo+rules' / 'rules-only'
 * ============================================================
 */

const MAX_BODY_BYTES = 256 * 1024

interface DecomposeRequestBody {
  goal?: unknown
  llm?: unknown
}

async function handleDecompose(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed, use POST' })
    return
  }
  let goal = ''
  let llmRaw: unknown
  try {
    const body = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as DecomposeRequestBody
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

  // LLM 配置：body.llm 优先，缺省回退进程 env LLM_*；都没有 → 规则引擎
  const llm = resolveLlmConfig(llmRaw, process.env)
  const payload = await runDecompose(goal, llm)
  sendJson(res, 200, payload)
}

// ---------- vite 插件入口 ----------

/**
 * 注册 POST /api/decompose 开发中间件。
 * 与 vite.config.ts 中的 /pixellab 代理、/api/llm 代理共存：本中间件只拦截 /api/decompose。
 * LLM 调用全部在本中间件服务端完成，前端不直接请求 /api/llm。
 */
export function decomposeApi(): Plugin {
  return {
    name: 'zhijian-decompose-api',
    configureServer(server) {
      server.middlewares.use('/api/decompose', (req, res, next) => {
        handleDecompose(req, res).catch(next)
      })
    },
  }
}
