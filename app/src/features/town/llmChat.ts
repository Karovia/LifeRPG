import type { LlmConfig, TownNpc } from '@/store/gameStore'

/**
 * ============================================================
 * 小镇 NPC 对话 · LLM 接入（/api/llm 代理）
 * ------------------------------------------------------------
 * 约定（与 diary/llm.ts 一致）：
 *   仅当 enabled && baseURL && model && apiKey 四者齐备才发请求；
 *   任何非 2xx、网络错误、超时（60s）、空内容一律抛错，
 *   由调用方静默回退本地回复池，不阻断对话交互。
 * ============================================================
 */

/** LLM 请求超时（ms） */
const LLM_TIMEOUT = 60_000

/** 带入上下文的最大历史消息条数（约最近 4 轮对话） */
const HISTORY_LIMIT = 8

/** 对话历史条目（与 NpcDialog 的 ChatMsg 对齐，仅玩家与 NPC 两类） */
export interface ChatHistoryItem {
  from: 'npc' | 'me'
  text: string
}

export interface FetchNpcReplyParams {
  llmConfig: LlmConfig
  npc: TownNpc
  /** 最近几轮对话（不含玩家当前输入，越新越靠后） */
  history: ChatHistoryItem[]
  /** 玩家当前输入 */
  playerMessage: string
  /** 当前好感度（决定生疏 / 热情的语气阶段） */
  favorability: number
}

/** 四者齐备才允许走 LLM */
export function isLlmReady(cfg: LlmConfig): boolean {
  return Boolean(cfg.enabled && cfg.baseURL && cfg.model && cfg.apiKey)
}

/** 好感度阶段语气描述：低则生疏客气，高则热情亲近 */
function favorStageText(favorability: number): string {
  if (favorability < 30) {
    return '你们还不太熟（好感度低），保持生疏、客气、略带距离感，别一下子掏心窝子。'
  }
  if (favorability < 70) {
    return '你们渐渐熟络（好感度中等），语气自然放松，可以聊得更具体一些。'
  }
  return '你们已经很亲近（好感度高），语气热情、像老朋友一样，可以多些关心与玩笑。'
}

/** 按 NPC 人格与好感度阶段拼装 system 提示词 */
function buildSystemPrompt(npc: TownNpc, favorability: number): string {
  return (
    `你在一款像素风成长 RPG 的小镇里扮演居民「${npc.name}」。` +
    `你的性格设定：${npc.personality}。` +
    '请全程用中文、口语化地角色扮演，回复 1-3 句短话，符合小镇居民的身份与日常口吻。' +
    favorStageText(favorability) +
    '对方是一个正在努力成长的年轻人；可以自然提及委托、目标、近况等话题，' +
    '但不要生硬推销。绝不暴露你是 AI、模型或程序，也不要跳出角色说话。'
  )
}

/**
 * 请求 LLM 生成 NPC 回复。
 * 成功返回回复文本；任何失败（非 2xx / 网络错误 / 超时 / 空内容）均抛错，
 * 由调用方捕获后静默回退本地回复池。
 */
export async function fetchNpcReply({
  llmConfig,
  npc,
  history,
  playerMessage,
  favorability,
}: FetchNpcReplyParams): Promise<string> {
  const historyMessages = history
    .slice(-HISTORY_LIMIT)
    .map((m) => ({
      role: m.from === 'npc' ? ('assistant' as const) : ('user' as const),
      content: m.text,
    }))

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), LLM_TIMEOUT)
  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseURL: llmConfig.baseURL,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(npc, favorability) },
          ...historyMessages,
          { role: 'user', content: playerMessage },
        ],
        temperature: 0.85,
        maxTokens: 200,
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
