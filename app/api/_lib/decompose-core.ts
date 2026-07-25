/**
 * ============================================================
 * 职见未来 · AI 目标拆解核心逻辑（双宿主共用）
 * ============================================================
 * POST /api/decompose 的处理核心，vite dev 中间件
 * （vite-plugins/decompose-api.ts）与 Vercel serverless function
 * （api/decompose.ts）共用，保证两端行为一致。
 *
 * body: { goal: string, llm?: { baseURL: string, apiKey: string, model: string } }
 * LLM 配置：优先 body.llm（Admin 页自填），缺省回退服务端环境变量
 * LLM_BASE_URL / LLM_API_KEY / LLM_MODEL（resolveLlmConfig）。
 *
 * 流水线：
 *   1. 真实联网搜索（三层回退，失败不阻断）：
 *        主力 Bing（cn.bing.com/search，b_algo 解析标题/URL/摘要）
 *        → 失败/为空回退搜狗（sogou.com/web，vrwrap 解析）
 *        → 再失败回退 DuckDuckGo 免 key HTML 端点；
 *      三层全挂返回空数组，LLM / 规则引擎均可无资料继续。
 *      查询策略：主 query（「<goal> 学习路线 规划」）+ 2 个按 goal 类别
 *      派生的子 query（技能树/入门教程/求职要求等），合并去重取 ≤10 条。
 *   2. LLM 拆解（仅当 llm 三字段齐备时尝试，服务端直连上游）：
 *        - system 要求严格 JSON（优先 response_format=json_object，
 *          上游 400 不支持时回退普通模式，从文本/```json 块中提取 JSON）
 *        - prompt 注入搜索摘要，要求 4-6 阶段、每阶段 4-7 节点（总 20-35 个）；
 *          每个节点必须是 0.5-3 天可完成的小步任务：动词 + 具体产出物，
 *          description 含量化验收标准 + 推荐资源（优先引用搜索摘要真实标题）
 *          + 预估小时数（hours 字段）；相邻节点难度坡度平缓；
 *          难点节点允许 1-2 层 children 支线细化
 *        - 120s 超时；任何失败 / JSON 解析失败 / 结构校验失败 → 回退规则引擎
 *        - serverless 宿主可传 deadlineMs 软超时：剩余预算不足时跳过/截断
 *          LLM 尝试，保证函数在平台强杀前以规则引擎结果返回
 *   3. 规则引擎兜底：按目标关键词匹配类别模板，产出细化成就树
 *      （各类别 16-22 个节点，每节点 ≤3 天工作量）。
 *      所有模板节点均带产出物与验收标准，禁止「学习/了解 xx」式无产出表述。
 *   4. Deadline：以服务器当天为锚点，按节点预估小时数累计（4 小时 = 1 天），
 *      每个节点有独立 deadline；阶段 deadline = 其节点累计后的日期。
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
  url: string
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

// ---------- 1. 联网搜索（Bing 主力 → 搜狗 → DuckDuckGo，12s 超时，失败不阻断） ----------

const SEARCH_TIMEOUT_MS = 12_000
const SEARCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** HTML 实体解码（含命名实体与数字实体，如 &ensp; &#0183;） */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
      const code = Number.parseInt(h, 16)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
    .replace(/&#(\d+);/g, (_, d: string) => {
      const code = Number(d)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 正则提取 Bing（cn.bing.com）结果的标题 / URL / 摘要（b_algo 块） */
function parseBingHtml(html: string, limit = 10): SearchReference[] {
  const blocks = html.split(/<li class="b_algo"/).slice(1)
  const refs: SearchReference[] = []
  for (const block of blocks) {
    const m = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!m) continue
    const url = decodeEntities(m[1])
    const title = stripHtml(m[2])
    if (!title || !/^https?:\/\//i.test(url)) continue
    const snipMatch =
      block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ??
      block.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)
    const snippet = snipMatch ? stripHtml(snipMatch[1]).slice(0, 200) : ''
    refs.push({ title, snippet, url })
    if (refs.length >= limit) break
  }
  return refs
}

/** 正则提取搜狗（sogou.com/web）结果的标题 / URL / 摘要（vrwrap 块） */
function parseSogouHtml(html: string, limit = 10): SearchReference[] {
  const blocks = html.split(/<div class="vrwrap/).slice(1)
  const refs: SearchReference[] = []
  for (const block of blocks) {
    const m = block.match(
      /<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    )
    if (!m) continue
    let url = decodeEntities(m[1])
    if (url.startsWith('/')) url = `https://www.sogou.com${url}`
    const title = stripHtml(m[2])
    if (!title) continue
    const snipMatch = block.match(/<div[^>]*class="[^"]*text-layout[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    const snippet = snipMatch ? stripHtml(snipMatch[1]).slice(0, 200) : ''
    refs.push({ title, snippet, url })
    if (refs.length >= limit) break
  }
  return refs
}

/** 正则提取 DuckDuckGo HTML 结果的标题 / URL（uddg 解码）/ 摘要（兜底路径） */
function parseDuckDuckGoHtml(html: string, limit = 5): SearchReference[] {
  const anchors = [
    ...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
  ]
  const snippets = [
    ...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g),
  ].map((m) => stripHtml(m[1]))
  const refs: SearchReference[] = []
  for (let i = 0; i < Math.min(anchors.length, limit); i++) {
    const title = stripHtml(anchors[i][2])
    if (!title) continue
    let url = ''
    const href = decodeEntities(anchors[i][1])
    const uddg = href.match(/[?&]uddg=([^&]+)/)
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1])
      } catch {
        url = ''
      }
    } else if (/^https?:\/\//i.test(href)) {
      url = href
    }
    refs.push({ title, snippet: snippets[i] ?? '', url })
  }
  return refs
}

/** 带超时的搜索 HTML 抓取：失败/非 2xx 返回 null，不阻断拆解流程 */
async function fetchSearchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': SEARCH_UA, Accept: 'text/html' },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    // 超时 / 网络失败：返回 null，交给下一层回退
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 单条查询三层回退：Bing → 搜狗 → DuckDuckGo；全挂返回空数组 */
async function searchWithFallback(query: string): Promise<SearchReference[]> {
  const bing = await fetchSearchHtml(
    `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=10`,
  )
  if (bing) {
    const refs = parseBingHtml(bing)
    if (refs.length > 0) return refs
  }
  const sogou = await fetchSearchHtml(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`)
  if (sogou) {
    const refs = parseSogouHtml(sogou)
    if (refs.length > 0) return refs
  }
  const ddg = await fetchSearchHtml(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  )
  if (ddg) return parseDuckDuckGoHtml(ddg)
  return []
}

/**
 * 从目标中提取核心领域词：去掉「成为/如何/我想」等功能词前缀。
 * Bing 对功能词开头的查询会做逐词精确匹配（搜「成为前端工程师」只会返回
 * 「成为」词条结果），以领域名词开头的查询结果质量显著更好。
 */
function extractCoreTerm(goal: string): string {
  let core = goal.trim()
  const prefix =
    /^(如何成为|怎么成为|怎样成为|我想成为|我要成为|想成为|希望成为|转型成为|转行成为|成为|转型做|转行做|如何做|怎么做|怎样做|我想做|我要做|想做|转型|转行|如何|怎么|怎样|我想|我要|希望|当一名|当一位|当一个|做一名|做一位|做一个|做|当|考取|考上|通过|学习|学会)/
  let prev = ''
  while (prev !== core) {
    prev = core
    core = core.replace(prefix, '').replace(/^一[名个位]/, '').trim()
  }
  return core.length >= 2 ? core : goal.trim()
}

/** 主 query + 2 个按 goal 类别派生的子 query（技能树/入门教程/求职要求等） */
function buildSearchQueries(goal: string): string[] {
  const core = extractCoreTerm(goal)
  const main = `${core} 学习路线 规划`
  if (/前端|后端|全栈|工程师|程序|编程|开发|代码|算法|AI|数据|测试|运维/i.test(core)) {
    return [main, `${core} 技能树`, `${core} 入门教程`]
  }
  if (/设计|UI|UX|视觉|插画|绘画|原画|平面/i.test(core)) {
    return [main, `${core} 自学 技能树`, `${core} 作品集 要求`]
  }
  if (/英语|日语|韩语|外语|雅思|托福|语言/i.test(core)) {
    return [main, `${core} 备考攻略`, `${core} 自学 方法`]
  }
  if (/考研|考公|考证|考试|证书|公务员|教资/i.test(core)) {
    return [main, `${core} 备考经验`, `${core} 资料推荐`]
  }
  if (/产品|运营|市场|销售|管理|创业|商业|咨询/i.test(core)) {
    return [main, `${core} 技能树`, `${core} 求职要求`]
  }
  return [main, `${core} 入门教程`, `${core} 求职要求 技能`]
}

/** 多 query 并行搜索，轮询取结果按标题去重（保证各 query 均有贡献），取 ≤10 条（均含 url） */
async function searchReferences(goal: string): Promise<SearchReference[]> {
  const queries = buildSearchQueries(goal)
  const results = await Promise.all(queries.map(searchWithFallback))
  const seen = new Set<string>()
  const merged: SearchReference[] = []
  let index = 0
  while (merged.length < 10) {
    let anyLeft = false
    for (const list of results) {
      if (index >= list.length) continue
      anyLeft = true
      const r = list[index]
      if (seen.has(r.title)) continue
      seen.add(r.title)
      merged.push(r)
      if (merged.length >= 10) break
    }
    if (!anyLeft) break
    index++
  }
  return merged
}

// ---------- 2. LLM 拆解（服务端直连 OpenAI 兼容上游，120s 超时） ----------

/** 前端随 goal 一起 POST 的 LLM 配置（仅本次请求使用，不落库） */
interface LlmRequestConfig {
  baseURL: string
  apiKey: string
  model: string
}

// 细化后的成就树（20-35 节点）LLM 输出约 5-9k token，推理型模型整链可能超过 60s，给到 120s
const LLM_TIMEOUT_MS = 120_000

/** LLM 原始输出中的单个节点（宽容解析，服务端再校验/裁剪） */
interface RawLlmNode {
  title: string
  description: string
  /** 预估投入小时数（服务端用于 deadline 累计） */
  hours: number
  children?: RawLlmNode[]
}

const SYSTEM_PROMPT = `你是一名资深职业规划教练，擅长把人生/职业目标拆解为「游戏成就树」式的微步行动计划。
你必须只输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释文字），结构如下：
{"phases":[{"name":"阶段名（8字以内）","nodes":[{"title":"节点标题","description":"节点描述","hours":6,"children":[{"title":"支线标题","description":"支线描述","hours":3}]}]}]}

硬性要求（违反任何一条都视为失败）：
1. 4-6 个 phase，按时间先后递进；每个 phase 含 4-7 个 node；全树 node 总数 20-35 个。
2. 每个 node 必须是 0.5-3 天可完成的小步任务：hours 为预估投入小时数（2-12 的整数，按每天可专注约 4 小时折算）。
   相邻节点难度坡度必须平缓，严禁「第一周学语法、第二周做完整项目」式大跳跃：大目标必须拆成一串连续小步。
3. title 必须是「动词 + 具体产出物」，直接可见交付结果，例如「完成 30 道 JS 数组专项练习并记录错题」「输出一份 1500 字竞品调研报告」；
   严禁以「学习」「了解」「熟悉」「掌握」「研究」等无产出动词开头，严禁「打基础」「提升自己」式空泛标题；title 不超过 30 字。
4. description 80-200 字，必须包含：
   ① 量化验收标准（时长/数量/质量，达到即可勾选完成，例如「连续 3 天每天 2 小时」「3 套模拟卷均分 ≥ 80」）；
   ② 推荐资源（具体书名/课程/网站/工具名，优先引用用户提示中给出的搜索资料原文标题与站点）；
   ③ 预估投入小时数（与 hours 字段数值一致）。
5. 难点 node 可带 1-2 个 children 作为支线细化；children 同样遵守第 2-4 条规则，hours 为 2-8 的整数。
6. 全部使用简体中文；不推荐高价付费资源。`

/** 组装 user prompt：目标 + 搜索摘要 + 结构约束 */
function buildUserPrompt(goal: string, refs: SearchReference[]): string {
  const refSection = refs.length
    ? `以下是联网搜索到的参考资料（推荐资源时优先引用这些真实标题与站点）：\n${refs
        .map(
          (r, i) =>
            `${i + 1}. 《${r.title}》${r.snippet ? ` — ${r.snippet.slice(0, 80)}` : ''}（${r.url}）`,
        )
        .join('\n')
        .slice(0, 2400)}`
    : '（本次未获取到联网搜索资料，请依据通用优质资源推荐。）'
  return `用户的人生/职业目标：「${goal}」

${refSection}

请把该目标拆解为 4-6 个阶段的成就树：每阶段 4-7 个节点（全树 20-35 个），每个节点都是 0.5-3 天可完成的小步任务（明确产出物 + 量化验收标准 + 推荐资源 + 预估小时数），相邻节点坡度平缓，并严格按 system 指定的 JSON 结构输出。`
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[]
  error?: { message?: unknown }
}

/**
 * 调上游 /chat/completions。
 * 成功返回 content 文本；非 2xx 抛错（400 时标记 badRequest，供调用方换模式重试）。
 * timeoutMs：单次尝试超时，默认 120s；serverless 软预算场景由调用方钳制。
 */
async function callChatCompletions(
  llm: LlmRequestConfig,
  messages: { role: string; content: string }[],
  jsonMode: boolean,
  timeoutMs: number = LLM_TIMEOUT_MS,
): Promise<string> {
  const baseURL = llm.baseURL.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const upstreamBody: Record<string, unknown> = {
      model: llm.model,
      messages,
      temperature: 0.5,
      // 推理型模型（如 step-3.5-flash）会先消耗大量 reasoning token 再输出 content；
      // 细化后的成就树（20-35 节点、长 description）JSON 本身约 4-6k token，
      // 8000 会被推理+输出耗尽导致 content 为空/截断，给到 16000 保证完整输出
      max_tokens: 16000,
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

/** 每天可专注小时数：deadline 按节点估时折算天数（0.5-3 天/节点） */
const FOCUS_HOURS_PER_DAY = 4

/** 节点估时（小时）→ 折算天数（钳制 1-3 天） */
function hoursToDays(hours: number): number {
  return clampNumber(Math.ceil(hours / FOCUS_HOURS_PER_DAY), 1, 3)
}

/** 清洗单个节点：标题/描述裁剪、hours 钳制、最多 2 个有效子节点 */
function sanitizeNode(raw: unknown, isChild = false): RawLlmNode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.title !== 'string' || !r.title.trim()) return null
  const title = r.title.trim().slice(0, 40)
  const description =
    typeof r.description === 'string' && r.description.trim()
      ? r.description.trim().slice(0, 320)
      : `产出「${title}」，达到可验收标准后勾选完成。`
  const rawHours = typeof r.hours === 'number' && Number.isFinite(r.hours) ? r.hours : 6
  const hours = clampNumber(Math.round(rawHours), 2, isChild ? 8 : 12)
  const node: RawLlmNode = { title, description, hours }
  if (!isChild && Array.isArray(r.children)) {
    const children = r.children
      .map((c) => sanitizeNode(c, true))
      .filter((c): c is RawLlmNode => c !== null)
      .slice(0, 2)
    if (children.length > 0) node.children = children
  }
  return node
}

/**
 * 把 LLM 原始 JSON 校验/规范化为 { phases, nodes }：
 * 4-6 阶段（宽容下限 3）、每阶段 4-7 节点（宽容下限 2，上限裁剪 7）；
 * deadline 按节点估时（hours→天）顺序累计；结构不合格返回 null（触发规则引擎兜底）。
 */
function finalizeLlmResult(
  raw: unknown,
  anchor: Date,
): { phases: PhasePlan[]; nodes: ApiQuestNode[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const phasesRaw = (raw as Record<string, unknown>).phases
  if (!Array.isArray(phasesRaw)) return null

  const sanitized: { name: string; nodes: RawLlmNode[] }[] = []
  for (const p of phasesRaw) {
    if (!p || typeof p !== 'object') continue
    const pr = p as Record<string, unknown>
    const name =
      typeof pr.name === 'string' && pr.name.trim()
        ? pr.name.trim().slice(0, 20)
        : `阶段 ${sanitized.length + 1}`
    const nodes = (Array.isArray(pr.nodes) ? pr.nodes : [])
      .map((n) => sanitizeNode(n))
      .filter((n): n is RawLlmNode => n !== null)
      .slice(0, 7)
    if (nodes.length >= 2) sanitized.push({ name, nodes })
    if (sanitized.length >= 6) break
  }
  if (sanitized.length < 3) return null

  // 按节点估时累计 deadline：每个节点有独立 deadline，阶段 deadline = 其节点累计
  const phases: PhasePlan[] = []
  const nodes: ApiQuestNode[] = []
  const firstAvailable = { used: false }
  const cursor = new Date(anchor)
  sanitized.forEach((p, pi) => {
    let phaseDays = 0
    for (const n of p.nodes) {
      const days = hoursToDays(n.hours)
      phaseDays += days
      cursor.setDate(cursor.getDate() + days)
      const deadline = cursor.toISOString()
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
    phases.push({
      name: p.name,
      weeks: Math.max(1, Math.ceil(phaseDays / 7)),
      deadline: cursor.toISOString(),
    })
  })

  return { phases, nodes }
}

/**
 * LLM 拆解主入口：
 *   1) 优先 response_format=json_object 模式；
 *   2) 上游 400（多半不支持该参数）→ 回退普通模式重试一次，
 *      从返回文本中提取 ```json 代码块 / 首尾大括号内容；
 *   3) 任何网络/超时/解析/结构失败 → 返回 null（调用方回退规则引擎）。
 * deadlineMs（serverless 软预算）：缺省时每次尝试独立 120s（dev 原行为）；
 *   传入后单次尝试钳制到剩余预算内，重试前剩余 <10s 时直接放弃。
 */
async function decomposeWithLlm(
  goal: string,
  refs: SearchReference[],
  llm: LlmRequestConfig,
  deadlineMs?: number,
): Promise<{ phases: PhasePlan[]; nodes: ApiQuestNode[] } | null> {
  // 单次尝试超时：dev 独立 120s；有软预算时钳制到剩余时间
  const attemptTimeout = (): number => {
    if (!deadlineMs) return LLM_TIMEOUT_MS
    return Math.min(LLM_TIMEOUT_MS, Math.max(0, deadlineMs - Date.now()))
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(goal, refs) },
  ]
  try {
    let text: string
    try {
      text = await callChatCompletions(llm, messages, true, attemptTimeout())
    } catch (err) {
      // 仅当上游 400（疑似不支持 json_object）时用普通模式重试一次
      if (!(err as { badRequest?: boolean } | null)?.badRequest) throw err
      const retryMs = attemptTimeout()
      if (retryMs < 10_000) return null // 剩余预算不足，放弃重试（规则引擎兜底）
      text = await callChatCompletions(llm, messages, false, retryMs)
    }
    const raw = extractJsonText(text)
    return finalizeLlmResult(raw, new Date())
  } catch {
    // 超时 / 断网 / 上游 5xx / JSON 解析失败：静默回退规则引擎
    return null
  }
}

// ---------- 3. 规则拆解引擎（兜底：节点细化翻倍，每节点 ≤3 天工作量） ----------

interface NodeTemplate {
  /** 预估投入小时数（≤12，即 ≤3 天 × 4 小时） */
  hours: number
  /** 用目标与参考资料生成标题 */
  title: (goal: string, refHint: string) => string
  desc: (goal: string, refHint: string) => string
  children?: NodeTemplate[]
}

interface PhaseTemplate {
  name: string
  nodes: NodeTemplate[]
}

interface CategoryRule {
  match: RegExp
  phases: PhaseTemplate[]
}

/** 从参考资料里取一条提示语（无资料时给通用话术） */
function refHintOf(refs: SearchReference[], index: number): string {
  const r = refs[index % Math.max(refs.length, 1)]
  if (!r) return '业内公认的成长路径'
  return `参考资料「${r.title.slice(0, 24)}」`
}

/** 求职冲刺阶段（技术/商业类别复用） */
function jobSprintPhase(): PhaseTemplate {
  return {
    name: '终章 · 求职冲刺',
    nodes: [
      {
        hours: 8,
        title: (g) => `产出对齐「${g}」JD 的简历`,
        desc: (g) =>
          `收集 3 份「${g}」目标岗位 JD，提炼高频要求并逐条改写简历。验收：每一条 JD 要求都有对应证据，请 1 位他人通读挑出至少 3 处修改。预估 8 小时。`,
      },
      {
        hours: 6,
        title: () => '整理 10 条高频面试题逐字稿',
        desc: () =>
          '整理目标岗位 10 条高频面试问题，写出逐字稿回答并录音自答一遍。验收：10 条逐字稿归档，录音回听后标注 3 处改进点。预估 6 小时。',
      },
      {
        hours: 8,
        title: () => '完成 3 轮模拟面试并复盘',
        desc: () =>
          '完成 3 轮模拟面试（含项目深挖与基础问答），全程录音。验收：输出复盘文档，每轮整理 3 条改进点并落实到下一轮。预估 8 小时。',
      },
      {
        hours: 4,
        title: (g) => `投递 10 个「${g}」目标岗位`,
        desc: (g) =>
          `筛选并投递 10 个「${g}」目标岗位，建立投递跟进表（公司/岗位/日期/状态）。验收：跟进表 10 行完整，每条附岗位 JD 存档链接。预估 4 小时。`,
      },
    ],
  }
}

/** 通用小步节点组：各类别复用 */
function buildCategoryRules(): CategoryRule[] {
  const research = (planDesc: (g: string) => string): NodeTemplate[] => [
    {
      hours: 6,
      title: (g) => `完成一份「${g}」调研报告`,
      desc: (g, hint) =>
        `产出不少于 800 字的调研笔记：梳理 3 条「${g}」典型成长路线、5 项岗位核心要求与 3 个权威信息源（${hint}）。验收：报告含路线对比与结论，能向他人讲清来龙去脉。预估 6 小时。`,
    },
    {
      hours: 4,
      title: (g) => `收集 5 份「${g}」岗位/案例要求`,
      desc: (g) =>
        `收集 5 份「${g}」岗位 JD 或优秀案例要求，统计高频技能词并自评差距（会/不会/模糊三档）。验收：产出技能差距清单，圈定 3 个优先补齐项。预估 4 小时。`,
    },
    {
      hours: 4,
      title: () => '制定可验收的总计划',
      desc: planDesc,
    },
  ]
  const foundation = (
    bookDesc: (g: string, hint: string) => string,
    cardsTitle: (g: string) => string,
    cardsDesc: (g: string) => string,
    extra: NodeTemplate[],
  ): NodeTemplate[] => [
    { hours: 10, title: (g) => `输出「${g}」核心知识笔记`, desc: bookDesc },
    { hours: 6, title: cardsTitle, desc: cardsDesc },
    ...extra,
  ]
  const advanced = (mainDesc: (g: string, hint: string) => string): NodeTemplate[] => [
    {
      hours: 12,
      title: (g) => `完成「${g}」专项练习作品集`,
      desc: mainDesc,
      children: [
        {
          hours: 5,
          title: () => '支线 · 模仿拆解 2 个优秀案例',
          desc: (g) =>
            `找 2 个「${g}」领域的优秀案例/前辈路径，各输出一份不少于 400 字的拆解笔记。验收：总结出至少 3 条可复用到自己练习中的方法。预估 5 小时。`,
        },
      ],
    },
    {
      hours: 4,
      title: () => '收集 3 条从业者实战建议',
      desc: (g) =>
        `向至少 1 位「${g}」从业者/前辈请教（社区提问亦可），整理 3 条关键建议并标注出处。验收：每条建议都转化为计划中的一条具体行动。预估 4 小时。`,
    },
    {
      hours: 10,
      title: (g) => `攻克「${g}」1 个难点专项并产出 Demo`,
      desc: (g) =>
        `从自评差距清单中选 1 个「${g}」最难点，完成 1 个可演示的小 Demo/作品。验收：Demo 可独立展示，附 300 字思路说明（为什么这么做）。预估 10 小时。`,
    },
    {
      hours: 4,
      title: () => '输出难点攻坚笔记',
      desc: () =>
        '把难点攻坚过程写成不少于 500 字笔记：卡在哪、查了哪些资料、如何验证结果。验收：笔记含「问题-尝试-结论」三段，可供他人复现。预估 4 小时。',
    },
  ]
  const practice = (): NodeTemplate[] => [
    {
      hours: 12,
      title: (g) => `交付「${g}」完整实战项目`,
      desc: (g, hint) =>
        `独立完成一个能对外展示「${g}」能力的完整项目（${hint}）。验收：产出物可公开访问/演示，附需求说明与复盘文档，全程独立完成为准。预估 12 小时。`,
      children: [
        {
          hours: 4,
          title: () => '支线 · 复盘卷轴',
          desc: () =>
            '记录实战中的 3 个坑与对应解法，形成不少于 500 字的复盘笔记。验收：每条含「现象-原因-解法」三段。预估 4 小时。',
        },
      ],
    },
    {
      hours: 4,
      title: () => '公开发布成果并收集反馈',
      desc: () =>
        '把实战成果发布到至少 1 个公开平台（作品集/社区/简历附件），收集至少 3 条真实反馈。验收：整理反馈清单，标注 2 条待改进项并排出时间。预估 4 小时。',
    },
    {
      hours: 6,
      title: () => '落实反馈并迭代 1 个版本',
      desc: () =>
        '按反馈清单完成 2 处改进并发布新版本。验收：输出版本对比说明（改前/改后截图或数据），剩余反馈排入后续计划。预估 6 小时。',
    },
    {
      hours: 4,
      title: () => '输出全流程复盘报告',
      desc: () =>
        '把整个实战过程写成不少于 800 字复盘：目标达成度、时间管理、最有效与最无效的做法。验收：报告含 3 条可迁移到下一阶段的经验。预估 4 小时。',
    },
  ]

  return [
    // ----- 技术 / 工程 -----
    {
      match: /前端|后端|全栈|工程师|程序|编程|开发|代码|算法|AI|数据|测试|运维/i,
      phases: [
        {
          name: '启程 · 调研',
          nodes: [
            ...research(
              (g) =>
                `把「${g}」拆解为 4-6 个能力模块，为每个模块设定量化验收标准（如「独立完成 xx 并部署」），输出带里程碑的总计划表。验收：每个模块都有可勾选的完成条件。预估 4 小时。`,
            ),
            {
              hours: 4,
              title: (g) => `搭好「${g}」开发环境与工具链`,
              desc: (g) =>
                `安装并跑通「${g}」所需开发环境（编辑器/运行时/版本管理），记录版本号与验证命令。验收：在终端/编辑器完成一次 Hello-World 级验证并截图存档。预估 4 小时。`,
            },
          ],
        },
        {
          name: '入门 · 筑基',
          nodes: foundation(
            (g, hint) =>
              `精读 1 本/1 门「${g}」核心教材或系统课程（${hint}），输出不少于 15 条要点的结构化笔记与 1 张知识框架图。验收：笔记含自测问答且全部答对。预估 10 小时。`,
            () => '制作 30 条术语速查卡',
            (g) =>
              `整理「${g}」领域 30 个高频术语/概念，录入记忆卡工具完成首轮复习。验收：随机抽 10 条能复述定义与应用场景。预估 6 小时。`,
            [
              {
                hours: 8,
                title: (g) => `部署「${g}」最小可运行项目`,
                desc: (g) =>
                  `搭建「${g}」Hello-World 级最小项目并成功运行/部署，记录环境版本号与启动命令。验收：另起干净环境按 README 10 分钟内可复现。预估 8 小时。`,
              },
              {
                hours: 8,
                title: (g) => `完成 20 道「${g}」基础练习`,
                desc: (g) =>
                  `完成 20 道「${g}」基础练习题（官方教程习题/题库入门区均可），错题记录原因。验收：20 题全部通过，错题本标注知识点并隔天重做全对。预估 8 小时。`,
              },
              {
                hours: 6,
                title: () => '复现 1 个官方示例教程',
                desc: () =>
                  '跟着官方文档/示例教程完整复现 1 个 demo，不看答案独立补全 2 处留空。验收：demo 运行成功，代码逐行能讲清作用。预估 6 小时。',
              },
              {
                hours: 3,
                title: () => '输出筑基阶段复盘笔记',
                desc: () =>
                  '复盘筑基阶段：哪些概念最易错、练习正确率、下周重点。验收：不少于 400 字复盘笔记，列出 3 条针对性改进动作。预估 3 小时。',
              },
            ],
          ),
        },
        {
          name: '进阶 · 修炼',
          nodes: advanced(
            (g, hint) =>
              `列出「${g}」最难的 3 个专项（${hint}），每个专项产出 1 份可运行练习作品（带注释/解题思路）。验收：3 份作品均可独立演示，讲清取舍与权衡。预估 12 小时。`,
          ),
        },
        {
          name: '实战 · 试炼',
          nodes: [
            {
              hours: 12,
              title: (g) => `上线「${g}」完整实战项目`,
              desc: (g) =>
                `独立完成「${g}」实战项目（如含路由+状态管理+接口交互的完整应用），并部署到公网。验收：产出公网可访问链接、源码仓库与 README（含截图与本地运行步骤），核心流程无阻断性 bug。预估 12 小时。`,
              children: [
                {
                  hours: 4,
                  title: () => '支线 · 复盘卷轴',
                  desc: () =>
                    '记录实战中的 3 个坑与对应解法，形成不少于 500 字的复盘笔记。验收：每条含「现象-原因-解法」三段。预估 4 小时。',
                },
              ],
            },
            {
              hours: 4,
              title: () => '编写项目 README 与演示稿',
              desc: () =>
                '为实战项目编写完整 README（功能列表/技术栈/截图/本地运行步骤）与 1 分钟演示稿。验收：他人按 README 可本地跑通，演示稿讲完核心亮点。预估 4 小时。',
            },
            {
              hours: 4,
              title: () => '把项目发布到社区收集反馈',
              desc: () =>
                '把项目链接与介绍发布到至少 1 个技术社区/作品集平台，收集至少 3 条真实反馈。验收：整理反馈清单并标注 2 处待改进项。预估 4 小时。',
            },
            {
              hours: 6,
              title: () => '落实反馈并迭代 1 个版本',
              desc: () =>
                '按反馈清单完成 2 处改进并发布新版本（git tag/更新日志）。验收：版本对比说明归档，README 同步更新。预估 6 小时。',
            },
          ],
        },
        jobSprintPhase(),
      ],
    },
    // ----- 设计 / 视觉 -----
    {
      match: /设计|UI|UX|视觉|插画|绘画|原画|平面/i,
      phases: [
        {
          name: '启程 · 调研',
          nodes: [
            {
              hours: 6,
              title: () => '完成一份竞品/风格调研报告',
              desc: (g, hint) =>
                `收集 20 个「${g}」优秀案例（${hint}），按风格归类并拆解 3 个代表作的构图/配色/版式。验收：输出带截图标注、不少于 800 字的调研报告。预估 6 小时。`,
            },
            {
              hours: 4,
              title: (g) => `摸清「${g}」岗位技能地图`,
              desc: (g) =>
                `收集 5 份「${g}」岗位招聘要求，统计高频技能并自评差距。验收：产出技能清单 + 圈定 3 个优先补齐项。预估 4 小时。`,
            },
            {
              hours: 3,
              title: (g) => `锁定「${g}」主力软件与教程清单`,
              desc: (g) =>
                `选定 1 款「${g}」主力设计软件与 1 套系统教程（官方/高口碑均可），完成安装与界面熟悉。验收：产出资源清单，软件新建/保存/导出全流程走通。预估 3 小时。`,
            },
            {
              hours: 3,
              title: () => '制定带里程碑的总学习计划',
              desc: () =>
                '把技能差距清单转为带周里程碑的学习计划表，每个里程碑配可勾选的验收标准。验收：计划表覆盖全部优先补齐项。预估 3 小时。',
            },
          ],
        },
        {
          name: '入门 · 筑基',
          nodes: [
            {
              hours: 10,
              title: () => '通关主力设计软件 30 项核心功能',
              desc: (g) =>
                `完成「${g}」主力软件官方/系统教程，逐项勾选 30 项核心功能通关清单。验收：能默写 20 个常用快捷键，清单全部打勾。预估 10 小时。`,
            },
            {
              hours: 10,
              title: () => '完成 7 天每日临摹挑战',
              desc: () =>
                '每天临摹 1 幅优秀作品，连续 7 天。验收：7 张作品按日期归档成册，附每幅临摹要点备注，无断档。预估 10 小时。',
            },
            {
              hours: 8,
              title: () => '输出 3 张完整临摹练习稿',
              desc: () =>
                '选 3 个不同风格的代表作各完成 1 张高精度临摹。验收：3 张练习稿与原图并排对比，差异点逐条标注说明。预估 8 小时。',
            },
            {
              hours: 4,
              title: () => '制作设计规范速查卡',
              desc: (g) =>
                `整理「${g}」常用规范（栅格/字号/配色/间距）成 20 条速查卡。验收：随机抽 5 条能说出数值与适用场景。预估 4 小时。`,
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          nodes: [
            {
              hours: 10,
              title: () => '完成 1 套 Redesign 改版方案',
              desc: () =>
                '选 1 个优秀产品/作品做 Redesign：输出高保真方案与不少于 400 字设计说明。验收：方案包含问题定义、改前改后对比与设计依据。预估 10 小时。',
            },
            {
              hours: 8,
              title: () => '产出个人设计规范手册',
              desc: (g) =>
                `整理「${g}」常用设计规范（栅格/字号/配色/组件）成个人手册。验收：手册不少于 10 条规范且每条附正误对照示例。预估 8 小时。`,
            },
            {
              hours: 6,
              title: () => '拆解 3 个代表作并输出笔记',
              desc: () =>
                '选 3 个公认优秀代表作，各输出 1 份拆解笔记（构图/配色/信息层级）。验收：每份不少于 300 字，总结出 5 条可复用手法。预估 6 小时。',
            },
            {
              hours: 4,
              title: () => '收集 3 条从业者实战建议',
              desc: (g) =>
                `向至少 1 位「${g}」从业者请教（社区提问亦可），整理 3 条关键建议。验收：每条建议转化为计划中的一条具体行动。预估 4 小时。`,
            },
          ],
        },
        {
          name: '实战 · 试炼',
          nodes: [
            {
              hours: 12,
              title: () => '交付一套完整设计项目',
              desc: () =>
                '独立承接/自拟 1 个完整设计项目，产出需求分析、3 版方案迭代记录与最终稿。验收：最终稿达到可交付精度，整理成 1 页作品集条目。预估 12 小时。',
              children: [
                {
                  hours: 4,
                  title: () => '支线 · 设计决策复盘',
                  desc: () =>
                    '记录项目中的 3 个关键设计决策与取舍理由，形成不少于 400 字复盘。验收：每条含「选项-理由-结果」三段。预估 4 小时。',
                },
              ],
            },
            {
              hours: 4,
              title: () => '整理作品集页面与项目说明',
              desc: () =>
                '把最终稿整理成作品集条目：封面图、项目背景、过程稿、最终稿、设计说明。验收：条目可公开访问，说明不少于 300 字。预估 4 小时。',
            },
            {
              hours: 4,
              title: () => '发布作品并收集 5 条反馈',
              desc: () =>
                '把作品发布到设计社区/作品集平台，收集至少 5 条真实反馈。验收：整理反馈表，标注 2 处待修改项。预估 4 小时。',
            },
            {
              hours: 4,
              title: () => '落实 2 处修改并迭代版本',
              desc: () =>
                '按反馈完成 2 处修改并更新作品集。验收：输出改前/改后对比图，版本变化写入项目说明。预估 4 小时。',
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
          nodes: [
            {
              hours: 4,
              title: () => '完成水平摸底并产出差距分析',
              desc: (g) =>
                `用 1 套标准化模考题摸底「${g}」当前水平，记录各单项得分。验收：产出差距分析，圈定 3 个最弱单项并设定目标分数。预估 4 小时。`,
            },
            {
              hours: 3,
              title: (g) => `锁定「${g}」核心备考资源清单`,
              desc: (_g, hint) =>
                `对比并锁定 1 套主教材 + 1 套词汇工具 + 1 个真题/语料来源（${hint}）。验收：产出资源清单与获取方式（链接/书目）。预估 3 小时。`,
            },
            {
              hours: 3,
              title: () => '制定带里程碑的备考总计划',
              desc: () =>
                '按差距分析制定备考计划表：每周任务 + 可勾选验收标准 + 目标分数节点。验收：计划覆盖全部最弱单项。预估 3 小时。',
            },
            {
              hours: 3,
              title: () => '建好记忆卡工具与首个牌组',
              desc: (g) =>
                `安装记忆卡工具并建立「${g}」首个牌组（≥ 50 张），完成首次学习。验收：牌组可正常复习，当日新卡全部清零。预估 3 小时。`,
            },
          ],
        },
        {
          name: '入门 · 筑基',
          nodes: [
            {
              hours: 12,
              title: (g) => `攻克「${g}」高频 1000 词`,
              desc: () =>
                '在记忆卡工具中建立高频 1000 词牌组并完成首轮学习。验收：随机抽测 100 词正确率 ≥ 90%，连续复习 5 天无断档。预估 12 小时。',
            },
            {
              hours: 10,
              title: () => '产出语法通关清单',
              desc: (g) =>
                `整理「${g}」20 个核心语法点，每个配 3 条例句。验收：20 个语法点全部自测过关（造句无错），清单可速查。预估 10 小时。`,
            },
            {
              hours: 8,
              title: () => '完成 7 天每日跟读训练',
              desc: () =>
                '每天跟读 1 段真实语料（≥ 3 分钟）并录音，连续 7 天。验收：7 段录音归档，自评流畅度逐日提升并标注改进点。预估 8 小时。',
            },
            {
              hours: 6,
              title: () => '整理 50 条高频表达',
              desc: () =>
                '整理 50 条口语/写作高频表达，每条配 1 个例句。验收：随机抽 10 条能 3 秒内口头造句。预估 6 小时。',
            },
            {
              hours: 3,
              title: () => '完成首周复习测评',
              desc: () =>
                '对第一周内容做综合自测（词汇 100 + 语法 20 + 跟读 1 段）。验收：正确率 ≥ 85%，错题逐条标注原因。预估 3 小时。',
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          nodes: [
            {
              hours: 10,
              title: () => '完成 7 天精听训练营',
              desc: () =>
                '每天精听 1 段真实语料（新闻/播客/影视）并听写，连续 7 天。验收：7 篇听写稿归档，平均每篇错误 ≤ 5 处。预估 10 小时。',
            },
            {
              hours: 8,
              title: () => '建立个人语料库',
              desc: () =>
                '整理 50 条口语/写作高分表达与 10 个万能话题框架。验收：每条表达能口头造句，随机抽 10 条 3 秒内说出。预估 8 小时。',
            },
            {
              hours: 8,
              title: () => '完成 5 篇精听+影子跟读',
              desc: () =>
                '选 5 段中等难度语料，每篇完成精听听写 + 影子跟读 3 遍。验收：5 篇听写稿与跟读录音归档，错误逐篇减少。预估 8 小时。',
            },
            {
              hours: 4,
              title: () => '输出弱项清单与强化计划',
              desc: () =>
                '统计近期练习错题/卡壳点，圈定 3 个最弱项并排定强化顺序。验收：输出弱项清单，每项配 1 条具体强化动作。预估 4 小时。',
            },
            {
              hours: 3,
              title: () => '收集 3 条高分备考建议',
              desc: (g) =>
                `向高分过来人/老师请教或整理 3 篇经验帖，提炼 3 条「${g}」备考关键建议。验收：每条转化为计划中的具体行动。预估 3 小时。`,
            },
          ],
        },
        {
          name: '实战 · 试炼',
          nodes: [
            {
              hours: 9,
              title: () => '完成 3 次真实对话/实战演练',
              desc: () =>
                '与母语者/考友完成 3 次真实对话或口语模考（每次 ≥ 15 分钟）。验收：3 次录音归档，自评 fluency 逐次提升并写出改进点。预估 9 小时。',
            },
            {
              hours: 6,
              title: () => '产出 1 篇被打分的完整作品',
              desc: () =>
                '独立完成 1 篇完整产出（作文/翻译/演讲视频），请他人或工具批改。验收：拿到具体评分与修改意见，重写 1 版并归档对比。预估 6 小时。',
            },
            {
              hours: 10,
              title: () => '完成 2 套全真模考',
              desc: () =>
                '按真实考试时长完成 2 套全真模考。验收：成绩记录成曲线，错题逐题归类，最后 1 套接近目标分数。预估 10 小时。',
            },
            {
              hours: 6,
              title: () => '清零模考错题',
              desc: () =>
                '把 2 套模考全部错题按知识点归类逐条重做。验收：重做全部做对，易错点整理成考前速查单。预估 6 小时。',
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
          nodes: [
            {
              hours: 6,
              title: () => '产出考情分析报告',
              desc: (g, hint) =>
                `收集「${g}」考纲、近三年真题与报录数据（${hint}）。验收：输出分析报告（题型分值分布 + 高频章节 Top10）。预估 6 小时。`,
            },
            {
              hours: 3,
              title: () => '锁定教材与题库',
              desc: () =>
                '选定 1 套主教材 + 1 套题库（对比 2 套以上后决策）。验收：产出选型理由与资料清单，教材第一章可立即开始。预估 3 小时。',
            },
            {
              hours: 3,
              title: () => '搭建章节进度看板',
              desc: () =>
                '建立章节进度看板（未开始/进行中/已通关三态），覆盖全部章节。验收：看板贴出第一周任务并全部排入日历。预估 3 小时。',
            },
            {
              hours: 3,
              title: () => '制定带里程碑的备考总计划',
              desc: () =>
                '按考情分析制定备考总计划：阶段划分 + 每周任务 + 可勾选验收标准。验收：计划覆盖全部高频章节 Top10。预估 3 小时。',
            },
          ],
        },
        {
          name: '入门 · 筑基',
          nodes: [
            {
              hours: 12,
              title: () => '通读教材并产出章节知识框架',
              desc: () =>
                '通读主教材核心章节，每章产出 1 张思维导图。验收：导图全部归档，合上书能按框架复述每章要点。预估 12 小时。',
            },
            {
              hours: 10,
              title: () => '完成章节题首轮刷题',
              desc: () =>
                '按章节刷完对应题目。验收：每章正确率 ≥ 70%，全部错题录入错题本并标注知识点。预估 10 小时。',
            },
            {
              hours: 4,
              title: () => '整理错题本并按知识点归类',
              desc: () =>
                '把首轮错题按知识点归类，标注「会/蒙/错」。验收：错题本每条含错因与正确思路，高频错点 Top5 圈出。预估 4 小时。',
            },
            {
              hours: 3,
              title: () => '完成 1 次章节自测',
              desc: () =>
                '对已学章节做 1 次限时自测（50 题）。验收：正确率 ≥ 75%，错题当晚弄懂并录入错题本。预估 3 小时。',
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          nodes: [
            {
              hours: 12,
              title: () => '攻克 3 个最弱模块',
              desc: () =>
                '统计错题分布，圈定 3 个最弱模块逐个专项训练（各 50 题以上）。验收：3 个模块专项正确率从基线提升到 ≥ 80%。预估 12 小时。',
            },
            {
              hours: 8,
              title: () => '产出高频考点清单',
              desc: () =>
                '整理 20 个高频考点，每个配典型例题与易错提醒。验收：能对他人讲透全部 20 个考点（模拟讲课一遍）。预估 8 小时。',
            },
            {
              hours: 8,
              title: () => '完成 1 轮专项限时训练',
              desc: () =>
                '对最弱模块做 1 轮限时专项训练（100 题，正确率目标 ≥ 80%）。验收：成绩记录归档，未达标部分当日二刷。预估 8 小时。',
            },
            {
              hours: 4,
              title: () => '输出易混易错对比表',
              desc: () =>
                '整理 10 组易混知识点对比表（定义/区别/例题）。验收：随机抽 5 组能讲清区别并各举 1 例。预估 4 小时。',
            },
          ],
        },
        {
          name: '实战 · 试炼',
          nodes: [
            {
              hours: 12,
              title: () => '完成 3 套全真模拟卷',
              desc: () =>
                '按真实考试时间限时完成 3 套全真模拟卷。验收：得分曲线记录归档，最后 1 套达到目标分数线。预估 12 小时。',
            },
            {
              hours: 6,
              title: () => '逐题分析 3 套模拟卷',
              desc: () =>
                '对 3 套模拟卷逐题分析（会/蒙/错分类），错题标注知识点。验收：每套输出 1 份分析表，高频错点 Top5 排入强化。预估 6 小时。',
            },
            {
              hours: 8,
              title: () => '清零错题本',
              desc: () =>
                '把所有错题按知识点归类逐条重做。验收：连续两轮重做全部做对，错题本标记「已封印」。预估 8 小时。',
            },
            {
              hours: 3,
              title: () => '输出得分曲线复盘',
              desc: () =>
                '汇总各套成绩与正确率变化，写 1 份复盘：提分点、失分点、最后阶段策略。验收：复盘不少于 400 字，策略可执行。预估 3 小时。',
            },
          ],
        },
        {
          name: '终章 · 冲刺押题',
          nodes: [
            {
              hours: 10,
              title: () => '完成考前两周冲刺计划',
              desc: () =>
                '每天 1 套限时训练保持手感。验收：两周训练记录完整，最后 3 套得分稳定在目标线以上。预估 10 小时。',
            },
            {
              hours: 6,
              title: () => '完成高频考点最后一轮回顾',
              desc: () =>
                '把 20 个高频考点与易混对比表快速过最后一轮。验收：每个考点能默写要点，抽测全对。预估 6 小时。',
            },
            {
              hours: 3,
              title: () => '备齐考前清单',
              desc: () =>
                '整理考试物品/路线/时间清单并完成 1 次踩点或全流程推演。验收：清单逐项打勾，无任何遗漏项。预估 3 小时。',
            },
            {
              hours: 3,
              title: () => '完成 1 次考前全流程演练',
              desc: () =>
                '按考试日时间作息完整演练 1 次（起床-出发-入场-答题节奏）。验收：输出时间轴与注意事项清单，无卡点。预估 3 小时。',
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
          nodes: [
            {
              hours: 8,
              title: () => '完成一份竞品调研报告',
              desc: (g, hint) =>
                `深度体验 3 个「${g}」相关产品/案例（${hint}），从定位、核心功能、商业模式三维度对比。验收：输出不少于 1000 字调研报告，含截图与结论。预估 8 小时。`,
            },
            {
              hours: 4,
              title: (g) => `摸清「${g}」岗位技能地图`,
              desc: (g) =>
                `收集 5 份「${g}」岗位 JD，统计高频技能并自评差距。验收：产出技能清单，圈定 3 个优先补齐项。预估 4 小时。`,
            },
            {
              hours: 4,
              title: () => '访谈 1 位从业者并整理纪要',
              desc: (g) =>
                `访谈 1 位「${g}」从业者（或精读 2 篇深度访谈），整理不少于 600 字纪要。验收：提炼 3 条关键成功因素与 1 条避坑建议。预估 4 小时。`,
            },
            {
              hours: 3,
              title: () => '制定带里程碑的总学习计划',
              desc: () =>
                '把技能差距清单转为带周里程碑的学习计划表，每项配可勾选验收标准。验收：计划覆盖全部优先补齐项。预估 3 小时。',
            },
          ],
        },
        {
          name: '入门 · 筑基',
          nodes: [
            {
              hours: 8,
              title: () => '建立 30 条术语知识库',
              desc: (g) =>
                `整理「${g}」30 个高频术语/方法论，每个附 1 个真实案例。验收：随机抽 10 条能复述定义并举例。预估 8 小时。`,
            },
            {
              hours: 8,
              title: () => '拆解 1 个完整业务闭环',
              desc: () =>
                '选 1 个产品完整走一遍「拉新-激活-留存-转化」闭环。验收：输出闭环流程图 + 各环节关键指标表（不少于 8 个指标）。预估 8 小时。',
            },
            {
              hours: 10,
              title: (g) => `精读 1 本「${g}」入门书并输出笔记`,
              desc: (g, hint) =>
                `精读 1 本「${g}」经典入门书（${hint}），输出不少于 15 条要点的结构化笔记。验收：笔记含自测问答且全部答对。预估 10 小时。`,
            },
            {
              hours: 4,
              title: () => '输出 1 张核心业务流程图',
              desc: (g) =>
                `把「${g}」核心业务全流程画成 1 张流程图（角色/动作/产物）。验收：能按图向他人完整讲解一遍业务。预估 4 小时。`,
            },
          ],
        },
        {
          name: '进阶 · 修炼',
          nodes: [
            {
              hours: 8,
              title: () => '产出 1 份竞品功能对比矩阵',
              desc: () =>
                '选 3 个竞品，输出功能对比矩阵（不少于 15 个功能点）与差异分析。验收：矩阵标注每个功能的取舍逻辑，给出 3 条启示。预估 8 小时。',
            },
            {
              hours: 10,
              title: () => '写出 1 份产品优化方案',
              desc: () =>
                '针对 1 个真实产品写出优化方案：问题定义、方案设计、预期指标。验收：方案不少于 800 字，逻辑自洽可被追问。预估 10 小时。',
            },
            {
              hours: 4,
              title: () => '请 1 位从业者评审方案',
              desc: () =>
                '把优化方案发给 1 位从业者/同伴评审，收集意见并修订。验收：采纳至少 1 条意见，输出修订记录（改前/改后）。预估 4 小时。',
            },
            {
              hours: 6,
              title: () => '拆解 2 个增长/运营案例',
              desc: () =>
                '拆解 2 个公开的增长/运营案例（背景-动作-数据结果）。验收：每个输出 400 字拆解笔记，总结 3 条可复用打法。预估 6 小时。',
            },
          ],
        },
        {
          name: '实战 · 试炼',
          nodes: [
            {
              hours: 12,
              title: () => '从 0 到 1 操盘 1 个真实项目',
              desc: (g, hint) =>
                `主导/深度参与 1 个与「${g}」相关的真实项目（校园项目/副业/实习均可，${hint}），走完需求到上线全流程。验收：产出项目文档与 1 个可量化业务结果（用户数/成交额/转化率任一）。预估 12 小时。`,
              children: [
                {
                  hours: 5,
                  title: () => '支线 · 数据复盘报告',
                  desc: () =>
                    '对项目数据做复盘：输出 1 份报告，含 3 条经验与 3 条教训，每条附数据佐证。预估 5 小时。',
                },
              ],
            },
            {
              hours: 6,
              title: () => '输出完整项目文档',
              desc: () =>
                '整理项目全流程文档：需求、方案、数据看板、复盘。验收：文档结构完整，他人读完能接手该项目。预估 6 小时。',
            },
            {
              hours: 6,
              title: () => '产出 1 份数据分析报告',
              desc: () =>
                '对项目关键数据做 1 次完整分析（漏斗/留存/转化任选）。验收：报告含图表与 3 条结论，每条附行动建议。预估 6 小时。',
            },
            {
              hours: 4,
              title: () => '收集 3 条真实用户反馈并迭代',
              desc: () =>
                '收集 3 条真实用户/同事反馈，落实 1 处改进。验收：输出反馈清单与改进记录（改前/改后）。预估 4 小时。',
            },
          ],
        },
        jobSprintPhase(),
      ],
    },
    // ----- 通用兜底类别 -----
    {
      match: /.*/,
      phases: [
        {
          name: '启程 · 调研',
          nodes: [
            ...research(
              (g) =>
                `访谈 1 位「${g}」从业者或精读 3 篇深度资料，写下达成该目标的 3 个关键成功因素与可衡量的验收标准，输出带里程碑的总计划表。预估 4 小时。`,
            ),
            {
              hours: 3,
              title: (g) => `锁定「${g}」核心资源清单`,
              desc: (_g, hint) =>
                `对比并锁定 1 套主教材/课程 + 1 个练习渠道 + 1 个交流社区（${hint}）。验收：产出资源清单与获取方式，可立即开始第一步。预估 3 小时。`,
            },
          ],
        },
        {
          name: '入门 · 筑基',
          nodes: foundation(
            (g, hint) =>
              `精读 1 本/1 门「${g}」核心教材或系统课程（${hint}），输出不少于 15 条要点的结构化笔记与 1 张知识框架图。验收：笔记含自测问答且全部答对。预估 10 小时。`,
            () => '制作 30 条术语速查卡',
            (g) =>
              `整理「${g}」领域 30 个高频术语/概念，录入记忆卡工具完成首轮复习。验收：随机抽 10 条能复述定义与应用场景。预估 6 小时。`,
            [
              {
                hours: 8,
                title: () => '完成 7 天每日小练习',
                desc: (g) =>
                  `每天完成 1 个「${g}」30-60 分钟小练习并记录结果，连续 7 天。验收：7 条练习记录归档，无断档，标注 3 个卡壳点。预估 8 小时。`,
              },
              {
                hours: 3,
                title: () => '输出筑基阶段复盘笔记',
                desc: () =>
                  '复盘筑基阶段：掌握了什么、卡在哪、下阶段重点。验收：不少于 400 字复盘，列出 3 条改进动作。预估 3 小时。',
              },
            ],
          ),
        },
        {
          name: '进阶 · 修炼',
          nodes: advanced(
            (g, hint) =>
              `列出「${g}」最难的 3 个专项（${hint}），每个专项产出 1 份完整练习作品。验收：3 份作品均可展示，能讲清思路与取舍。预估 12 小时。`,
          ),
        },
        { name: '实战 · 试炼', nodes: practice() },
      ],
    },
  ]
}

const CATEGORY_RULES = buildCategoryRules()

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
 * 所有模板节点均带明确产出物与验收标准（每节点 ≤3 天工作量），
 * deadline 按节点估时累计，返回结构与 LLM 路径完全一致。
 */
function decomposeWithRuleEngine(
  goal: string,
  refs: SearchReference[],
): { phases: PhasePlan[]; nodes: ApiQuestNode[] } {
  const rule = CATEGORY_RULES.find((r) => r.match.test(goal))!
  // 模板文案用核心领域词（去掉「成为/如何」等前缀），避免「『成为前端工程师』调研报告」式拗口标题
  const core = extractCoreTerm(goal)
  const anchor = new Date() // 服务器当天锚点

  // 按节点估时累计 deadline：每节点独立 deadline，阶段 deadline = 其节点累计
  const phases: PhasePlan[] = []
  const nodes: ApiQuestNode[] = []
  const firstAvailable = { used: false }
  let refIndex = 0
  const cursor = new Date(anchor)
  rule.phases.forEach((p, pi) => {
    let phaseDays = 0
    for (const tpl of p.nodes) {
      const days = hoursToDays(tpl.hours)
      phaseDays += days
      cursor.setDate(cursor.getDate() + days)
      nodes.push(
        instantiateNode(
          tpl,
          core,
          refs,
          refIndex++,
          p.name,
          pi,
          cursor.toISOString(),
          firstAvailable,
        ),
      )
    }
    phases.push({
      name: p.name,
      weeks: Math.max(1, Math.ceil(phaseDays / 7)),
      deadline: cursor.toISOString(),
    })
  })

  return { phases, nodes }
}

// ---------- 4. 对外入口（配置解析 + 主流水线，双宿主共用） ----------

/** 解析并校验 llm 配置：三字段齐备才返回配置，否则返回 null（走规则引擎） */
export function parseLlmConfig(raw: unknown): LlmRequestConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const baseURL = typeof r.baseURL === 'string' ? r.baseURL.trim().replace(/\/+$/, '') : ''
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : ''
  const model = typeof r.model === 'string' ? r.model.trim() : ''
  if (!baseURL || !/^https?:\/\//i.test(baseURL) || !apiKey || !model) return null
  return { baseURL, apiKey, model }
}

/**
 * 解析 LLM 配置：优先 body.llm（Admin 页自填，原样透传），缺省回退服务端
 * 环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL（三件套齐备才生效）。
 * dev 中间件与 Vercel function 行为一致；均未配置时返回 null → 规则引擎。
 */
export function resolveLlmConfig(raw: unknown, env: NodeJS.ProcessEnv): LlmRequestConfig | null {
  return (
    parseLlmConfig(raw) ??
    parseLlmConfig({
      baseURL: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
    })
  )
}

export interface RunDecomposeOptions {
  /**
   * 软超时截止时刻（epoch ms，serverless 宿主用）：
   * 搜索完成后剩余预算 <10s 时直接跳过 LLM（规则引擎兜底）；
   * LLM 单次尝试时间也会被钳制在该时刻内，且普通模式重试前
   * 剩余 <10s 时放弃重试 —— 保证 function 在平台强杀前返回可用结果。
   * dev 中间件不传（保持原行为：每次 LLM 尝试独立 120s 超时）。
   */
  deadlineMs?: number
}

/**
 * 拆解主流水线：联网搜索（Bing → 搜狗 → DDG 三层回退，失败不阻断）
 * → LLM 拆解（配置齐备时）→ 规则引擎兜底；返回完整 DecomposeResponse。
 */
export async function runDecompose(
  goal: string,
  llm: LlmRequestConfig | null,
  options?: RunDecomposeOptions,
): Promise<DecomposeResponse> {
  // 1) 联网搜索（失败不阻断，LLM 与规则引擎都可无资料继续）
  const references = await searchReferences(goal)

  // 2) LLM 优先：仅在配置齐备且剩余预算充足时尝试；任何失败静默回退规则引擎
  let phases: PhasePlan[]
  let nodes: ApiQuestNode[]
  let llmUsed = false
  const remaining = options?.deadlineMs
    ? options.deadlineMs - Date.now()
    : Number.POSITIVE_INFINITY
  if (llm && remaining >= 10_000) {
    const llmResult = await decomposeWithLlm(goal, references, llm, options?.deadlineMs)
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

  return {
    goal,
    source,
    references,
    phases,
    nodes,
    anchorDate: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
  }
}

// 响应/节点类型对外导出（供宿主与前端契约对齐）
export type {
  ApiQuestNode,
  DecomposeResponse,
  LlmRequestConfig,
  NodeStatus,
  PhasePlan,
  SearchReference,
}
