import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * ============================================================
 * 职见未来 · AI 目标拆解 API（vite dev 中间件）
 * ============================================================
 * POST /api/decompose
 * body: { goal: string, llm?: { baseURL: string, apiKey: string, model: string } }
 *
 * 流水线：
 *   1. 真实联网搜索（DuckDuckGo 免 key HTML 端点）提取标题/摘要作为参考资料
 *      （失败不阻断，LLM / 规则引擎均可无资料继续）
 *   2. LLM 拆解（仅当 body.llm 三字段齐备时尝试，服务端直连上游）：
 *        - system 要求严格 JSON（优先 response_format=json_object，
 *          上游 400 不支持时回退普通模式，从文本/```json 块中提取 JSON）
 *        - prompt 注入搜索摘要，要求 3-5 阶段、每阶段 2-4 节点；
 *          每个节点必须具体可执行：明确产出物 + 量化指标 + 可勾选验收标准，
 *          description 含推荐资源（优先来自搜索摘要）
 *        - 60s 超时；任何失败 / JSON 解析失败 / 结构校验失败 → 回退规则引擎
 *   3. 规则引擎兜底：按目标关键词匹配类别模板，产出 3-5 阶段成就树。
 *      所有模板节点均带产出物与验收标准，禁止「学习/了解 xx」式无产出表述。
 *   4. Deadline：以服务器当天为锚点，按阶段周期（周）逐阶段累计，
 *      给每个节点/阶段计算 ISO deadline。
 *
 * 响应结构：{ goal, source, references, phases, nodes, anchorDate, generatedAt }
 *   source 取值：
 *     'llm+search'       = LLM 拆解成功且注入了联网资料
 *     'llm-only'         = LLM 拆解成功但无联网资料
 *     'duckduckgo+rules' = LLM 未启用/失败，规则引擎 + 联网资料
 *     'rules-only'       = 纯规则引擎（搜索也失败）
 * ============================================================
 */

// ---------- 类型（与前端 store 的 QuestNode 结构保持一致） ----------

type NodeStatus = 'locked' | 'available' | 'done'

interface ApiQuestNode {
  id: string
  title: string
  description: string
  status: NodeStatus
  rewardXp: number
  rewardCoins: number
  deadline?: string
  phase?: string
  children?: ApiQuestNode[]
}

interface SearchReference {
  title: string
  snippet: string
}

interface PhasePlan {
  name: string
  weeks: number
  deadline: string
}

interface DecomposeResponse {
  goal: string
  /** 拆解来源：llm+search / llm-only / duckduckgo+rules / rules-only */
  source: 'llm+search' | 'llm-only' | 'duckduckgo+rules' | 'rules-only'
  references: SearchReference[]
  phases: PhasePlan[]
  nodes: ApiQuestNode[]
  /** 服务器锚点日期（ISO），所有 deadline 由此累计 */
  anchorDate: string
  generatedAt: string
}

// ---------- 1. 联网搜索（DuckDuckGo 免 key，10s 超时，失败不阻断） ----------

const SEARCH_TIMEOUT_MS = 10_000
const SEARCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 正则提取 DuckDuckGo HTML 结果的标题与摘要 */
function parseDuckDuckGoHtml(html: string, limit = 5): SearchReference[] {
  const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => stripHtml(m[1]),
  )
  const snippets = [
    ...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g),
  ].map((m) => stripHtml(m[1]))
  const refs: SearchReference[] = []
  for (let i = 0; i < Math.min(titles.length, limit); i++) {
    if (!titles[i]) continue
    refs.push({ title: titles[i], snippet: snippets[i] ?? '' })
  }
  return refs
}

async function searchOnce(query: string): Promise<SearchReference[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': SEARCH_UA, Accept: 'text/html' },
      },
    )
    if (!res.ok) return []
    const html = await res.text()
    return parseDuckDuckGoHtml(html)
  } catch {
    // 超时 / 网络失败：返回空，不阻断拆解流程
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** 主 query + 1-2 个相关 query，合并去重 */
async function searchReferences(goal: string): Promise<SearchReference[]> {
  const queries = [
    `${goal} 职业规划 学习路径`,
    `${goal} 入门 路线图`,
    `如何成为${goal} 技能要求`,
  ]
  const results = await Promise.all(queries.map(searchOnce))
  const seen = new Set<string>()
  const merged: SearchReference[] = []
  for (const list of results) {
    for (const r of list) {
      if (seen.has(r.title)) continue
      seen.add(r.title)
      merged.push(r)
      if (merged.length >= 6) return merged
    }
  }
  return merged
}

// ---------- 2. LLM 拆解（服务端直连 OpenAI 兼容上游，60s 超时） ----------

/** 前端随 goal 一起 POST 的 LLM 配置（仅本次请求使用，不落库） */
interface LlmRequestConfig {
  baseURL: string
  apiKey: string
  model: string
}

const LLM_TIMEOUT_MS = 60_000

/** LLM 原始输出中的单个节点（宽容解析，服务端再校验/裁剪） */
interface RawLlmNode {
  title: string
  description: string
  children?: RawLlmNode[]
}

const SYSTEM_PROMPT = `你是一名资深职业规划教练，擅长把人生/职业目标拆解为「游戏成就树」式的行动计划。
你必须只输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释文字），结构如下：
{"phases":[{"name":"阶段名（8字以内）","weeks":2,"nodes":[{"title":"节点标题","description":"节点描述","children":[{"title":"支线标题","description":"支线描述"}]}]}]}

硬性要求（违反任何一条都视为失败）：
1. 3-5 个 phase，按时间先后递进；weeks 为该阶段建议周数（1-8 的整数）。
2. 每个 phase 含 2-4 个 node；node 可带 0-2 个 children 作为支线任务（难点拆解用）。
3. title 必须是「动词 + 具体产出物」，直接可见交付结果，例如「完成一个含路由+状态管理的 React Todo 项目并部署上线」「输出一份 1500 字竞品调研报告」；
   严禁以「学习」「了解」「熟悉」「掌握」「研究」等无产出动词开头，严禁「打基础」「提升自己」式空泛标题。
4. description 60-160 字，必须包含：
   ① 量化指标与验收标准（时长/数量/质量，达到即可勾选完成，例如「连续 7 天，每天 1 小时」「3 套模拟卷均分 ≥ 80」）；
   ② 推荐资源（具体书名/课程/网站/工具名，优先使用用户提示中给出的搜索资料原文标题）；
   ③ 预估投入小时数。
5. title 不超过 30 字；全部使用简体中文；不推荐高价付费资源。`

/** 组装 user prompt：目标 + 搜索摘要 + 结构约束 */
function buildUserPrompt(goal: string, refs: SearchReference[]): string {
  const refSection = refs.length
    ? `以下是联网搜索到的参考资料（推荐资源时优先引用这些真实标题）：\n${refs
        .map((r, i) => `${i + 1}. 《${r.title}》${r.snippet ? ` — ${r.snippet.slice(0, 80)}` : ''}`)
        .join('\n')
        .slice(0, 2400)}`
    : '（本次未获取到联网搜索资料，请依据通用优质资源推荐。）'
  return `用户的人生/职业目标：「${goal}」

${refSection}

请把该目标拆解为 3-5 个阶段的成就树：每阶段 2-4 个节点，每个节点都必须具体可执行（明确产出物 + 量化指标 + 可勾选的验收标准 + 推荐资源），并严格按 system 指定的 JSON 结构输出。`
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[]
  error?: { message?: unknown }
}

/**
 * 调上游 /chat/completions。
 * 成功返回 content 文本；非 2xx 抛错（400 时标记 badRequest，供调用方换模式重试）。
 */
async function callChatCompletions(
  llm: LlmRequestConfig,
  messages: { role: string; content: string }[],
  jsonMode: boolean,
): Promise<string> {
  const baseURL = llm.baseURL.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const upstreamBody: Record<string, unknown> = {
      model: llm.model,
      messages,
      temperature: 0.5,
      max_tokens: 2000,
    }
    if (jsonMode) upstreamBody.response_format = { type: 'json_object' }
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    })
    if (!res.ok) {
      const errText = (await res.text().catch(() => '')).slice(0, 200)
      const err = new Error(`LLM upstream ${res.status}: ${errText}`) as Error & {
        badRequest?: boolean
      }
      if (res.status === 400) err.badRequest = true
      throw err
    }
    const data = (await res.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('LLM 返回内容为空或结构异常')
    }
    return content
  } finally {
    clearTimeout(timer)
  }
}

/** 从模型输出文本中提取 JSON：直接解析 → ```json 代码块 → 首尾大括号截取 */
function extractJsonText(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // 继续尝试代码块 / 大括号截取
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim())
    } catch {
      // 继续尝试大括号截取
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // 放弃
    }
  }
  return null
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 清洗单个节点：标题/描述裁剪、最多 2 个有效子节点 */
function sanitizeNode(raw: unknown): RawLlmNode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.title !== 'string' || !r.title.trim()) return null
  const title = r.title.trim().slice(0, 40)
  const description =
    typeof r.description === 'string' && r.description.trim()
      ? r.description.trim().slice(0, 320)
      : `产出「${title}」，达到可验收标准后勾选完成。`
  const node: RawLlmNode = { title, description }
  if (Array.isArray(r.children)) {
    const children = r.children
      .map(sanitizeNode)
      .filter((c): c is RawLlmNode => c !== null)
      .slice(0, 2)
    if (children.length > 0) node.children = children
  }
  return node
}

/**
 * 把 LLM 原始 JSON 校验/规范化为 { phases, nodes }：
 * 3-5 阶段、每阶段 2-4 节点、weeks 钳制 1-8；结构不合格返回 null（触发规则引擎兜底）。
 */
function finalizeLlmResult(
  raw: unknown,
  anchor: Date,
): { phases: PhasePlan[]; nodes: ApiQuestNode[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const phasesRaw = (raw as Record<string, unknown>).phases
  if (!Array.isArray(phasesRaw)) return null

  const sanitized: { name: string; weeks: number; nodes: RawLlmNode[] }[] = []
  for (const p of phasesRaw) {
    if (!p || typeof p !== 'object') continue
    const pr = p as Record<string, unknown>
    const name =
      typeof pr.name === 'string' && pr.name.trim()
        ? pr.name.trim().slice(0, 20)
        : `阶段 ${sanitized.length + 1}`
    const weeks = clampNumber(
      Math.round(typeof pr.weeks === 'number' && Number.isFinite(pr.weeks) ? pr.weeks : 2),
      1,
      8,
    )
    const nodes = (Array.isArray(pr.nodes) ? pr.nodes : [])
      .map(sanitizeNode)
      .filter((n): n is RawLlmNode => n !== null)
      .slice(0, 4)
    if (nodes.length >= 2) sanitized.push({ name, weeks, nodes })
    if (sanitized.length >= 5) break
  }
  if (sanitized.length < 3) return null

  // 计算阶段 deadline（周数累计）
  const phases: PhasePlan[] = []
  let cursor = new Date(anchor)
  for (const p of sanitized) {
    cursor = addWeeks(cursor, p.weeks)
    phases.push({ name: p.name, weeks: p.weeks, deadline: cursor.toISOString() })
  }

  // 实例化节点树（id / status / 奖励由服务端统一生成，不信任 LLM 输出）
  const firstAvailable = { used: false }
  const nodes: ApiQuestNode[] = []
  sanitized.forEach((p, pi) => {
    const deadline = phases[pi].deadline
    for (const n of p.nodes) {
      const status: NodeStatus = !firstAvailable.used ? 'available' : 'locked'
      if (!firstAvailable.used) firstAvailable.used = true
      const depthBonus = n.children?.length ?? 0
      const node: ApiQuestNode = {
        id: nextId(),
        title: n.title,
        description: n.description,
        status,
        rewardXp: 25 + pi * 10 + depthBonus * 5,
        rewardCoins: 10 + pi * 5 + depthBonus * 5,
        deadline,
        phase: p.name,
      }
      if (n.children?.length) {
        node.children = n.children.map((c) => ({
          id: nextId(),
          title: c.title,
          description: c.description,
          status: 'locked' as const,
          rewardXp: 12 + pi * 10,
          rewardCoins: 6 + pi * 5,
          deadline,
          phase: p.name,
        }))
      }
      nodes.push(node)
    }
  })

  return { phases, nodes }
}

/**
 * LLM 拆解主入口：
 *   1) 优先 response_format=json_object 模式；
 *   2) 上游 400（多半不支持该参数）→ 回退普通模式重试一次，
 *      从返回文本中提取 ```json 代码块 / 首尾大括号内容；
 *   3) 任何网络/超时/解析/结构失败 → 返回 null（调用方回退规则引擎）。
 */
async function decomposeWithLlm(
  goal: string,
  refs: SearchReference[],
  llm: LlmRequestConfig,
): Promise<{ phases: PhasePlan[]; nodes: ApiQuestNode[] } | null> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(goal, refs) },
  ]
  try {
    let text: string
    try {
      text = await callChatCompletions(llm, messages, true)
    } catch (err) {
      // 仅当上游 400（疑似不支持 json_object）时用普通模式重试一次
      if (!(err as { badRequest?: boolean } | null)?.badRequest) throw err
      text = await callChatCompletions(llm, messages, false)
    }
    const raw = extractJsonText(text)
    return finalizeLlmResult(raw, new Date())
  } catch {
    // 超时 / 断网 / 上游 5xx / JSON 解析失败：静默回退规则引擎
    return null
  }
}

// ---------- 3. 规则拆解引擎（兜底：模板全部带产出物与验收标准） ----------

interface NodeTemplate {
  /** 用目标与参考资料生成标题 */
  title: (goal: string, refHint: string) => string
  desc: (goal: string, refHint: string) => string
  children?: NodeTemplate[]
}

interface PhaseTemplate {
  name: string
  weeks: number
  nodes: NodeTemplate[]
}

interface CategoryRule {
  match: RegExp
  /** 按类别微调的阶段周期（周） */
  phases: PhaseTemplate[]
}

/** 从参考资料里取一条提示语（无资料时给通用话术） */
function refHintOf(refs: SearchReference[], index: number): string {
  const r = refs[index % Math.max(refs.length, 1)]
  if (!r) return '业内公认的成长路径'
  return `参考资料「${r.title.slice(0, 24)}」`
}

/** 通用节点组：调研 / 筑基 / 进阶 / 实战 / 求职，各类别复用 */
function buildCategoryRules(): CategoryRule[] {
  const research = (planDesc: (g: string) => string): NodeTemplate[] => [
    {
      title: (g) => `完成一份「${g}」调研报告`,
      desc: (g, hint) =>
        `产出不少于 800 字的调研笔记：梳理 3 条「${g}」典型成长路线、5 项岗位核心要求与 3 个权威信息源（${hint}）。验收：报告含路线对比与结论，能向他人讲清来龙去脉。`,
    },
    {
      title: () => '制定可验收的总计划',
      desc: planDesc,
    },
  ]
  const foundation = (
    bookDesc: (g: string, hint: string) => string,
    cardsTitle: (g: string) => string,
    cardsDesc: (g: string) => string,
    extra?: NodeTemplate,
  ): NodeTemplate[] => {
    const list: NodeTemplate[] = [
      {
        title: (g) => `输出「${g}」核心知识笔记`,
        desc: bookDesc,
      },
      {
        title: cardsTitle,
        desc: cardsDesc,
      },
    ]
    if (extra) list.push(extra)
    return list
  }
  const advanced = (mainDesc: (g: string, hint: string) => string): NodeTemplate[] => [
    {
      title: (g) => `完成「${g}」专项练习作品集`,
      desc: mainDesc,
      children: [
        {
          title: () => '支线 · 模仿拆解 2 个优秀案例',
          desc: (g) =>
            `找 2 个「${g}」领域的优秀案例/前辈路径，各输出一份不少于 400 字的拆解笔记。验收：总结出至少 3 条可复用到自己练习中的方法。`,
        },
      ],
    },
    {
      title: () => '收集 3 条从业者实战建议',
      desc: (g) =>
        `向至少 1 位「${g}」从业者/前辈请教（社区提问亦可），整理 3 条关键建议并标注出处。验收：每条建议都转化为计划中的一条具体行动。`,
    },
  ]
  const practice = (): NodeTemplate[] => [
    {
      title: (g) => `交付「${g}」完整实战项目`,
      desc: (g, hint) =>
        `独立完成一个能对外展示「${g}」能力的完整项目（${hint}）。验收：产出物可公开访问/演示，附需求说明与复盘文档，全程独立完成为准。`,
      children: [
        {
          title: () => '支线 · 复盘卷轴',
          desc: () =>
            '记录实战中的 3 个坑与对应解法，形成不少于 500 字的复盘笔记。验收：每条含「现象-原因-解法」三段。',
        },
      ],
    },
    {
      title: () => '公开发布成果并收集反馈',
      desc: () =>
        '把实战成果发布到至少 1 个公开平台（作品集/社区/简历附件），收集至少 3 条真实反馈。验收：整理反馈清单，标注 2 条待改进项并排出时间。',
    },
  ]
  const jobSprint = (): PhaseTemplate => ({
    name: '终章 · 求职冲刺',
    weeks: 2,
    nodes: [
      {
        title: (g) => `产出对齐「${g}」JD 的简历与作品集`,
        desc: (g) =>
          `收集 3 份「${g}」目标岗位 JD，提炼高频要求并逐条改写简历与作品集。验收：每一条 JD 要求都有对应证据，并请 1 位他人通读挑出至少 3 处修改。`,
      },
      {
        title: () => '完成 3 轮模拟面试并复盘',
        desc: () =>
          '完成 3 轮模拟面试（含项目深挖与基础问答），全程录音。验收：输出复盘文档，整理 10 条高频问题的逐字稿回答。',
      },
    ],
  })

  return [
    // ----- 技术 / 工程 -----
    {
      match: /前端|后端|全栈|工程师|程序|编程|开发|代码|算法|AI|数据|测试|运维/i,
      phases: [
        {
          name: '启程 · 调研',
          weeks: 2,
          nodes: research(
            (g) =>
              `把「${g}」拆解为 4-6 个能力模块，为每个模块设定量化验收标准（如「独立完成 xx 并部署」），输出带周里程碑的总计划表。验收：每个模块都有可勾选的完成条件。`,
          ),
        },
        {
          name: '入门 · 筑基',
          weeks: 3,
          nodes: foundation(
            (g, hint) =>
              `精读 1 本/1 门「${g}」核心教材或系统课程（${hint}），输出不少于 15 条要点的结构化笔记与 1 张知识框架图。验收：笔记含自测问答且全部答对。`,
            () => '制作 30 条术语速查卡',
            (g) =>
              `整理「${g}」领域 30 个高频术语/概念，录入记忆卡工具完成首轮复习。验收：随机抽 10 条能复述定义与应用场景。`,
            {
              title: (g) => `部署「${g}」最小可运行项目`,
              desc: (g) =>
                `搭建「${g}」Hello-World 级最小项目并成功运行/部署，记录环境版本号与启动命令。验收：另起干净环境按 README 10 分钟内可复现。`,
            },
          ),
        },
        {
          name: '进阶 · 修炼',
          weeks: 4,
          nodes: advanced(
            (g, hint) =>
              `列出「${g}」最难的 3 个专项（${hint}），每个专项产出 1 份可运行练习作品（带注释/解题思路）。验收：3 份作品均可独立演示，讲清取舍与权衡。`,
          ),
        },
        {
          name: '实战 · 试炼',
          weeks: 6,
          nodes: [
            {
              title: (g) => `上线「${g}」完整实战项目`,
              desc: (g, _hint) =>
                `独立完成「${g}」实战项目（如含路由+状态管理+接口交互的完整应用），并部署到公网。验收：产出公网可访问链接、源码仓库与 README（含截图与本地运行步骤），核心流程无阻断性 bug。`,
              children: [
                {
                  title: () => '支线 · 复盘卷轴',
                  desc: () =>
                    '记录实战中的 3 个坑与对应解法，形成不少于 500 字的复盘笔记。验收：每条含「现象-原因-解法」三段。',
                },
              ],
            },
            {
              title: () => '把项目发布到社区收集反馈',
              desc: () =>
                '把项目链接与介绍发布到至少 1 个技术社区/作品集平台，收集至少 3 条真实反馈。验收：整理反馈清单并落实 2 处改进后更新版本。',
            },
          ],
        },
        jobSprint(),
      ],
    },
    // ----- 设计 / 视觉 -----
    {
      match: /设计|UI|UX|视觉|插画|绘画|原画|平面/i,
      phases: [
        {
          name: '启程 · 调研',
          weeks: 2,
          nodes: [
            {
              title: () => '完成一份竞品/风格调研报告',
              desc: (g, hint) =>
                `收集 20 个「${g}」优秀案例（${hint}），按风格归类并拆解 3 个代表作的构图/配色/版式。验收：输出带截图标注、不少于 800 字的调研报告。`,
            },
            {
              title: (g) => `摸清「${g}」岗位技能地图`,
              desc: (g) =>
                `收集 5 份「${g}」岗位招聘要求，统计高频技能并自评差距。验收：产出技能清单 + 带周里程碑的学习计划表。`,
            },
          ],
        },
        {
          name: '入门 · 筑基',
          weeks: 3,
          nodes: [
            {
              title: () => '通关主力设计软件 30 项核心功能',
              desc: (g) =>
                `选定「${g}」主力软件，完成官方/系统教程并逐项勾选 30 项核心功能通关清单。验收：输出 3 张临摹练习稿，能默写 20 个常用快捷键。`,
            },
            {
              title: () => '完成 14 天每日临摹挑战',
              desc: () =>
                '每天临摹 1 幅优秀作品，连续 14 天。验收：14 张作品按日期归档成册，附每幅临摹要点备注，无断档。',
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          weeks: 4,
          nodes: [
            {
              title: () => '完成 1 套 Redesign 改版方案',
              desc: () =>
                '选 1 个优秀产品/作品做 Redesign：输出高保真方案与不少于 400 字设计说明。验收：方案包含问题定义、改前改后对比与设计依据。',
            },
            {
              title: () => '产出个人设计规范手册',
              desc: (g) =>
                `整理「${g}」常用设计规范（栅格/字号/配色/组件）成个人手册。验收：手册不少于 10 条规范且每条附正误对照示例。`,
            },
          ],
        },
        {
          name: '实战 · 试炼',
          weeks: 6,
          nodes: [
            {
              title: () => '交付一套完整设计项目',
              desc: () =>
                '独立承接/自拟 1 个完整设计项目，产出需求分析、3 版方案迭代记录与最终稿。验收：最终稿达到可交付精度，整理成 1 页作品集条目。',
            },
            {
              title: () => '发布作品并收集 5 条反馈',
              desc: () =>
                '把作品发布到设计社区/作品集平台，收集至少 5 条真实反馈。验收：整理反馈表，落实 2 处修改并标注版本变化。',
            },
          ],
        },
      ],
    },
    // ----- 语言学习 -----
    {
      match: /英语|日语|韩语|外语|雅思|托福|语言/i,
      phases: [
        {
          name: '启程 · 调研',
          weeks: 1,
          nodes: [
            {
              title: () => '完成水平摸底并产出差距分析',
              desc: (g) =>
                `用 1 套标准化模考题摸底「${g}」当前水平，记录各单项得分。验收：产出差距分析，圈定 3 个最弱单项并设定目标分数。`,
            },
            {
              title: (g) => `锁定「${g}」核心备考资源清单`,
              desc: (_g, hint) =>
                `对比并锁定 1 套主教材 + 1 套词汇工具 + 1 个真题/语料来源（${hint}）。验收：产出资源清单与带周里程碑的备考计划表。`,
            },
          ],
        },
        {
          name: '入门 · 筑基',
          weeks: 4,
          nodes: [
            {
              title: (g) => `攻克「${g}」高频 2000 词`,
              desc: () =>
                '在记忆卡工具中建立高频 2000 词牌组并完成首轮学习。验收：随机抽测 100 词正确率 ≥ 90%，连续复习 7 天无断档。',
            },
            {
              title: () => '产出语法通关清单',
              desc: (g) =>
                `整理「${g}」20 个核心语法点，每个配 3 条例句。验收：20 个语法点全部自测过关（造句无错），清单可速查。`,
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          weeks: 6,
          nodes: [
            {
              title: () => '完成 21 天精听训练营',
              desc: () =>
                '每天精听 1 段真实语料（新闻/播客/影视），连续 21 天。验收：21 篇听写稿归档，平均每篇错误 ≤ 5 处，附跟读录音。',
            },
            {
              title: () => '建立个人语料库',
              desc: () =>
                '整理 50 条口语/写作高分表达与 10 个万能话题框架。验收：每条表达能口头造句，随机抽 10 条 3 秒内说出。',
            },
          ],
        },
        {
          name: '实战 · 试炼',
          weeks: 4,
          nodes: [
            {
              title: () => '完成 5 次真实对话/实战演练',
              desc: () =>
                '与母语者/考友完成 5 次真实对话或口语模考（每次 ≥ 15 分钟）。验收：5 次录音归档，自评 fluency 逐次提升并写出改进点。',
            },
            {
              title: () => '产出 1 篇被打分的完整作品',
              desc: () =>
                `独立完成 1 篇完整产出（作文/翻译/演讲视频），请他人或工具批改。验收：拿到具体评分与修改意见，重写 1 版并归档对比。`,
            },
            {
              title: () => '完成 3 套全真模考',
              desc: () =>
                '按真实考试时长完成 3 套全真模考。验收：3 套成绩记录成曲线，错题逐题归类，最后 1 套达到目标分数。',
            },
          ],
        },
      ],
    },
    // ----- 考试 / 证书 -----
    {
      match: /考研|考公|考证|考试|证书|公务员|教资/i,
      phases: [
        {
          name: '启程 · 调研',
          weeks: 1,
          nodes: [
            {
              title: () => '产出考情分析报告',
              desc: (g, hint) =>
                `收集「${g}」考纲、近三年真题与报录数据（${hint}）。验收：输出分析报告（题型分值分布 + 高频章节 Top10），制定带周里程碑的备考总计划。`,
            },
            {
              title: () => '锁定教材题库并搭建进度看板',
              desc: () =>
                '选定 1 套主教材 + 1 套题库，建立章节进度看板（未开始/进行中/已通关三态）。验收：看板覆盖全部章节，贴出第一周任务。',
            },
          ],
        },
        {
          name: '入门 · 筑基',
          weeks: 4,
          nodes: [
            {
              title: () => '通读教材并产出章节知识框架',
              desc: () =>
                '通读主教材一遍，每章产出 1 张思维导图。验收：全部章节导图归档，合上书能按框架复述每章要点。',
            },
            {
              title: () => '完成章节题首轮刷题',
              desc: () =>
                '按章节刷完对应题目。验收：每章正确率 ≥ 70%，全部错题录入错题本并标注知识点。',
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          weeks: 6,
          nodes: [
            {
              title: () => '攻克 3 个最弱模块',
              desc: () =>
                '统计错题分布，圈定 3 个最弱模块逐个专项训练（各 50 题以上）。验收：3 个模块专项正确率从基线提升到 ≥ 80%。',
            },
            {
              title: () => '产出高频考点清单',
              desc: () =>
                '整理 20 个高频考点，每个配典型例题与易错提醒。验收：能对他人讲透全部 20 个考点（模拟讲课一遍）。',
            },
          ],
        },
        {
          name: '实战 · 试炼',
          weeks: 4,
          nodes: [
            {
              title: () => '完成 3 套全真模拟卷',
              desc: () =>
                '按真实考试时间限时完成 3 套全真模拟卷。验收：得分曲线记录归档，每套逐题分析（会/蒙/错分类），最后 1 套达到目标分数线。',
            },
            {
              title: () => '清零错题本',
              desc: () =>
                '把所有错题按知识点归类逐条重做。验收：连续两轮重做全部做对，错题本标记「已封印」。',
            },
          ],
        },
        {
          name: '终章 · 冲刺押题',
          weeks: 2,
          nodes: [
            {
              title: () => '完成考前两周冲刺计划',
              desc: () =>
                '每天 1 套限时训练保持手感。验收：两周训练记录完整，最后 3 套得分稳定在目标线以上。',
            },
            {
              title: () => '备齐考前清单',
              desc: () =>
                '整理考试物品/路线/时间清单并完成 1 次踩点或全流程推演。验收：清单逐项打勾，无任何遗漏项。',
            },
          ],
        },
      ],
    },
    // ----- 产品 / 运营 / 商业 -----
    {
      match: /产品|运营|市场|销售|管理|创业|商业|咨询/i,
      phases: [
        {
          name: '启程 · 调研',
          weeks: 2,
          nodes: [
            {
              title: () => '完成一份竞品调研报告',
              desc: (g, hint) =>
                `深度体验 3 个「${g}」相关产品/案例（${hint}），从定位、核心功能、商业模式三维度对比。验收：输出不少于 1000 字调研报告，含截图与结论。`,
            },
            {
              title: (g) => `摸清「${g}」岗位技能地图`,
              desc: (g) =>
                `收集 5 份「${g}」岗位 JD，统计高频技能并自评差距。验收：产出技能清单 + 带周里程碑的学习计划表。`,
            },
          ],
        },
        {
          name: '入门 · 筑基',
          weeks: 2,
          nodes: [
            {
              title: () => '建立 30 条术语知识库',
              desc: (g) =>
                `整理「${g}」30 个高频术语/方法论，每个附 1 个真实案例。验收：随机抽 10 条能复述定义并举例。`,
            },
            {
              title: () => '拆解 1 个完整业务闭环',
              desc: () =>
                '选 1 个产品完整走一遍「拉新-激活-留存-转化」闭环。验收：输出闭环流程图 + 各环节关键指标表（不少于 8 个指标）。',
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          weeks: 4,
          nodes: [
            {
              title: () => '产出 1 份竞品功能对比矩阵',
              desc: () =>
                `选 3 个竞品，输出功能对比矩阵（不少于 15 个功能点）与差异分析。验收：矩阵标注每个功能的取舍逻辑，给出 3 条启示。`,
            },
            {
              title: () => '写出 1 份产品优化方案',
              desc: () =>
                `针对 1 个真实产品写出优化方案：问题定义、方案设计、预期指标。验收：方案不少于 800 字，请 1 位从业者/同伴评审并采纳至少 1 条意见。`,
            },
          ],
        },
        {
          name: '实战 · 试炼',
          weeks: 6,
          nodes: [
            {
              title: () => '从 0 到 1 操盘 1 个真实项目',
              desc: (g, hint) =>
                `主导/深度参与 1 个与「${g}」相关的真实项目（校园项目/副业/实习均可，${hint}），走完需求到上线全流程。验收：产出项目文档与 1 个可量化业务结果（用户数/成交额/转化率任一）。`,
              children: [
                {
                  title: () => '支线 · 数据复盘报告',
                  desc: () =>
                    '对项目数据做复盘：输出 1 份报告，含 3 条经验与 3 条教训，每条附数据佐证。',
                },
              ],
            },
          ],
        },
        jobSprint(),
      ],
    },
    // ----- 通用兜底类别 -----
    {
      match: /.*/,
      phases: [
        {
          name: '启程 · 调研',
          weeks: 2,
          nodes: research(
            (g) =>
              `访谈 1 位「${g}」从业者或精读 3 篇深度资料，写下达成该目标的 3 个关键成功因素与可衡量的验收标准，输出带周里程碑的总计划表。`,
          ),
        },
        {
          name: '入门 · 筑基',
          weeks: 2,
          nodes: foundation(
            (g, hint) =>
              `精读 1 本/1 门「${g}」核心教材或系统课程（${hint}），输出不少于 15 条要点的结构化笔记与 1 张知识框架图。验收：笔记含自测问答且全部答对。`,
            () => '制作 30 条术语速查卡',
            (g) =>
              `整理「${g}」领域 30 个高频术语/概念，录入记忆卡工具完成首轮复习。验收：随机抽 10 条能复述定义与应用场景。`,
          ),
        },
        {
          name: '进阶 · 修炼',
          weeks: 4,
          nodes: advanced(
            (g, hint) =>
              `列出「${g}」最难的 3 个专项（${hint}），每个专项产出 1 份完整练习作品。验收：3 份作品均可展示，能讲清思路与取舍。`,
          ),
        },
        { name: '实战 · 试炼', weeks: 6, nodes: practice() },
      ],
    },
  ]
}

const CATEGORY_RULES = buildCategoryRules()

function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + weeks * 7)
  return d
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `qnode-${Date.now().toString(36)}-${idCounter}`
}

function instantiateNode(
  tpl: NodeTemplate,
  goal: string,
  refs: SearchReference[],
  refIndex: number,
  phaseName: string,
  phaseIndex: number,
  deadline: string,
  firstAvailable: { used: boolean },
): ApiQuestNode {
  const hint = refHintOf(refs, refIndex)
  const status: NodeStatus = !firstAvailable.used ? 'available' : 'locked'
  if (!firstAvailable.used) firstAvailable.used = true
  const depthBonus = tpl.children?.length ?? 0
  const node: ApiQuestNode = {
    id: nextId(),
    title: tpl.title(goal, hint),
    description: tpl.desc(goal, hint),
    status,
    rewardXp: 20 + phaseIndex * 10 + depthBonus * 5,
    rewardCoins: 10 + phaseIndex * 5 + depthBonus * 5,
    deadline,
    phase: phaseName,
  }
  if (tpl.children?.length) {
    node.children = tpl.children.map((c) => ({
      id: nextId(),
      title: c.title(goal, hint),
      description: c.desc(goal, hint),
      status: 'locked' as const,
      rewardXp: 10 + phaseIndex * 10,
      rewardCoins: 5 + phaseIndex * 5,
      deadline,
      phase: phaseName,
    }))
  }
  return node
}

/**
 * 规则引擎拆解主入口（LLM 未配置或失败时的兜底）。
 * 所有模板节点均带明确产出物与验收标准，返回结构与 LLM 路径完全一致。
 */
function decomposeWithRuleEngine(
  goal: string,
  refs: SearchReference[],
): { phases: PhasePlan[]; nodes: ApiQuestNode[] } {
  const rule = CATEGORY_RULES.find((r) => r.match.test(goal))!
  const anchor = new Date() // 服务器当天锚点

  // 先计算各阶段 deadline（按阶段顺序累计周数）
  const phases: PhasePlan[] = []
  let cursor = new Date(anchor)
  for (const p of rule.phases) {
    cursor = addWeeks(cursor, p.weeks)
    phases.push({ name: p.name, weeks: p.weeks, deadline: cursor.toISOString() })
  }

  // 实例化节点树：每阶段 2-4 个节点（含 children 分支）
  const firstAvailable = { used: false }
  let refIndex = 0
  const nodes: ApiQuestNode[] = []
  rule.phases.forEach((p, pi) => {
    for (const tpl of p.nodes) {
      nodes.push(
        instantiateNode(
          tpl,
          goal,
          refs,
          refIndex++,
          p.name,
          pi,
          phases[pi].deadline,
          firstAvailable,
        ),
      )
    }
  })

  return { phases, nodes }
}

// ---------- 4. HTTP 处理 ----------

const MAX_BODY_BYTES = 256 * 1024

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

interface DecomposeRequestBody {
  goal?: unknown
  llm?: unknown
}

/** 解析并校验 body.llm：三字段齐备才返回配置，否则返回 null（走规则引擎） */
function parseLlmConfig(raw: unknown): LlmRequestConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const baseURL = typeof r.baseURL === 'string' ? r.baseURL.trim().replace(/\/+$/, '') : ''
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : ''
  const model = typeof r.model === 'string' ? r.model.trim() : ''
  if (!baseURL || !/^https?:\/\//i.test(baseURL) || !apiKey || !model) return null
  return { baseURL, apiKey, model }
}

async function handleDecompose(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed, use POST' })
    return
  }
  let goal = ''
  let llm: LlmRequestConfig | null = null
  try {
    const body = JSON.parse(await readBody(req)) as DecomposeRequestBody
    if (typeof body.goal === 'string') goal = body.goal.trim().slice(0, 80)
    llm = parseLlmConfig(body.llm)
  } catch {
    sendJson(res, 400, { error: '请求体必须是 JSON：{ "goal": "...", "llm"?: {...} }' })
    return
  }
  if (!goal) {
    sendJson(res, 400, { error: 'goal 不能为空' })
    return
  }

  // 1) 联网搜索（失败不阻断；LLM 与规则引擎都可无资料继续）
  const references = await searchReferences(goal)

  // 2) LLM 优先：仅在 llm 三字段齐备时尝试；任何失败静默回退规则引擎
  let phases: PhasePlan[]
  let nodes: ApiQuestNode[]
  let llmUsed = false
  if (llm) {
    const llmResult = await decomposeWithLlm(goal, references, llm)
    if (llmResult) {
      phases = llmResult.phases
      nodes = llmResult.nodes
      llmUsed = true
    } else {
      ;({ phases, nodes } = decomposeWithRuleEngine(goal, references))
    }
  } else {
    ;({ phases, nodes } = decomposeWithRuleEngine(goal, references))
  }

  const source: DecomposeResponse['source'] = llmUsed
    ? references.length > 0
      ? 'llm+search'
      : 'llm-only'
    : references.length > 0
      ? 'duckduckgo+rules'
      : 'rules-only'

  const payload: DecomposeResponse = {
    goal,
    source,
    references,
    phases,
    nodes,
    anchorDate: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
  }
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
