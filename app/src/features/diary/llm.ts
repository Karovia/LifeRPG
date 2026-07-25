import type { LlmConfig } from '@/store/gameStore'
import { llmConnectionPayload } from '@/lib/llmServerMode'

/**
 * ============================================================
 * 魔法日记本 · LLM 回复接入（/api/llm 代理）
 * ------------------------------------------------------------
 * 约定（与 gameStore.llmConfig 注释一致）：
 *   就绪判定：server mode（VITE_LLM_SERVER_MODE=true）直将就绪，
 *   否则 enabled && baseURL && model && apiKey 四者齐备才发请求；
 *   server mode 下请求不携带连接三件套，由服务端 function 注入 env。
 *   /api/llm 任何非 2xx、网络错误、超时（90s）一律视为失败，
 *   由调用方静默回退到本地 diaryReply，不阻断交互。
 * ============================================================
 */

/** LLM 请求超时（ms） */
const LLM_TIMEOUT = 90_000

/** 系统人格：有灵性的魔法日记本（汤姆·里德尔式「我」自称） */
const SYSTEM_PROMPT =
  '你是一本有灵性的魔法日记本，住在年轻人的成长 RPG 里，' +
  '用温暖、睿智、略带神秘的口吻回应书写者；' +
  '像汤姆·里德尔日记本一样以“我”自称；' +
  '回复 2-4 句，中文，先共情用户写的内容，' +
  '再给出一个具体可行的小建议或引发思考的提问。'

/** 就绪判定（server mode 或四件套齐备，见 @/lib/llmServerMode） */
export { isLlmReady } from '@/lib/llmServerMode'

/**
 * 请求 LLM 生成日记回复。
 * 成功返回回复文本；任何失败（非 2xx / 网络错误 / 超时 / 空内容）均抛错，
 * 由调用方捕获后回退本地回复。
 */
export async function fetchLlmDiaryReply(
  content: string,
  cfg: LlmConfig,
): Promise<string> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), LLM_TIMEOUT)
  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // server mode 下为空对象（服务端注入 env）；用户自填四件套时原样上送
        ...llmConnectionPayload(cfg),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        temperature: 0.8,
        // 推理模型（如 step-3.5-flash）会先消耗 reasoning token，额度太小会导致 content 为空
        maxTokens: 2048,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`llm proxy responded ${res.status}`)
    const data: unknown = await res.json()
    const text = (
      data as {
        choices?: { message?: { content?: unknown } }[]
      }
    )?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('llm reply empty')
    }
    return text.trim()
  } finally {
    window.clearTimeout(timer)
  }
}
