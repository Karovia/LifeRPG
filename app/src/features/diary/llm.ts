import type { LlmConfig } from '@/store/gameStore'

/**
 * ============================================================
 * 魔法日记本 · LLM 回复接入（/api/llm 代理）
 * ------------------------------------------------------------
 * 约定（与 gameStore.llmConfig 注释一致）：
 *   仅当 enabled && baseURL && model && apiKey 四者齐备才发请求；
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

/** 四者齐备才允许走 LLM */
export function isLlmReady(cfg: LlmConfig): boolean {
  return Boolean(cfg.enabled && cfg.baseURL && cfg.model && cfg.apiKey)
}

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
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model,
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
