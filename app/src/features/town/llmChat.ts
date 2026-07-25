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
        // 推理模型（如 step-3.5-flash）会先消耗 reasoning token，额度太小会导致 content 为空
        maxTokens: 1536,
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

// ---------- NPC 委托生成（严格 JSON，带玩家状态感知） ----------

/** LLM 委托生成结果（前端校验后写入 commission，key 同时作为 commission.id 进入历史去重） */
export interface CommissionLlmDraft {
  key: string
  title: string
  description: string
  rewardCoins: number
}

export interface FetchCommissionParams {
  llmConfig: LlmConfig
  npc: TownNpc
  /** 玩家等级 */
  playerLevel: number
  /** 当前目标概览：「目标标题（待完成节点：节点A、节点B）」每目标一条 */
  questLines: string[]
  /** 最近 3 条日记摘要（已截断） */
  diaryLines: string[]
  /** 当前好感度 */
  favorability: number
  /** 已完成委托历史：「key：title」每委托一条，要求 LLM 避开 */
  historyLines: string[]
}

/** 从模型输出中提取首个 JSON 对象并解析（容忍代码围栏 / 前后杂谈） */
function extractJson(content: string): unknown {
  const cleaned = content.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no json object in llm output')
  return JSON.parse(cleaned.slice(start, end + 1))
}

/**
 * 请求 LLM 生成一条 NPC 委托。
 * 成功返回校验过的 draft；任何失败（非 2xx / 超时 / 空内容 / JSON 非法 / 字段缺失）均抛错，
 * 由调用方静默回退本地模板池。rewardCoins 钳制到 20-60。
 */
export async function fetchCommission(params: FetchCommissionParams): Promise<CommissionLlmDraft> {
  const { llmConfig, npc } = params

  const systemPrompt =
    `你在一款像素风成长 RPG 的小镇里扮演居民「${npc.name}」，为玩家发布一个委托任务。` +
    `你的性格设定：${npc.personality}。` +
    '你必须只输出一个严格的 JSON 对象，不要输出任何其他文字、解释或代码围栏。'

  const userPrompt =
    '根据玩家当前状态生成一条委托。要求：\n' +
    '1. 委托必须与玩家当前目标或近况相关（例如玩家正在学前端，就请他「用新技术帮你画张招牌」）。\n' +
    '2. 委托的完成方式统一为：玩家去实践/体验，然后回来认真汇报感受（20 字以上），description 里要写明这一点。\n' +
    '3. 输出 JSON 结构：{"key":"...","title":"...","description":"...","rewardCoins":数字}。\n' +
    `4. key 必须以「${npc.id}-」开头并保证唯一（如 ${npc.id}-7），不得与历史委托重复。\n` +
    '5. title 格式「<NPC名>的委托 · <短主题>」，10 字以内主题；description 50-90 字，中文、口语、符合你的性格。\n' +
    '6. rewardCoins 为 20 到 60 之间的整数，难度/用心程度越高报酬越高。\n' +
    '7. 不得与下列历史委托的 key 或主题重复：\n' +
    (params.historyLines.length > 0 ? params.historyLines.join('\n') : '（暂无历史委托）') +
    '\n\n玩家状态：\n' +
    `- 等级：LV.${params.playerLevel}，与${npc.name}的好感度：${params.favorability}/100\n` +
    '- 当前目标与待完成节点：\n' +
    (params.questLines.length > 0 ? params.questLines.join('\n') : '（还没有目标）') +
    '\n- 最近日记摘要：\n' +
    (params.diaryLines.length > 0 ? params.diaryLines.join('\n') : '（暂无日记）')

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        // 推理模型会先消耗 reasoning token，额度太小会导致 content 为空
        maxTokens: 2048,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`llm proxy responded ${res.status}`)
    const data: unknown = await res.json()
    const text = (
      data as { choices?: { message?: { content?: unknown } }[] }
    )?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) throw new Error('llm reply empty')

    const parsed = extractJson(text) as Record<string, unknown>
    const key = typeof parsed.key === 'string' ? parsed.key.trim() : ''
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
    const reward = typeof parsed.rewardCoins === 'number' ? parsed.rewardCoins : Number(parsed.rewardCoins)
    if (!key || !title || !description || !Number.isFinite(reward)) {
      throw new Error('llm commission fields invalid')
    }
    return {
      key,
      title,
      description,
      rewardCoins: Math.min(60, Math.max(20, Math.round(reward))),
    }
  } finally {
    window.clearTimeout(timer)
  }
}
