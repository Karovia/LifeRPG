import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * ============================================================
 * 职见未来 · AI 目标拆解 API（vite dev 中间件）
 * ============================================================
 * POST /api/decompose  body: { goal: string }
 *
 * 流水线：
 *   1. 真实联网搜索（DuckDuckGo 免 key HTML 端点）提取标题/摘要作为参考资料
 *   2. 规则引擎：按目标关键词匹配类别模板，产出 3-5 阶段成就树
 *   3. Deadline：以服务器当天为锚点，按阶段周期（入门 2w / 进阶 4w / 实战 6w…）
 *      逐阶段累计，给每个节点/阶段计算 ISO deadline
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │ TODO(LLM 接入点)：未来接入真实大模型时，仅需替换          │
 * │ `decomposeWithRuleEngine()` 内部实现为 LLM 调用（或在     │
 * │ 其前增加 LLM 优先、规则兜底的策略），保持请求/响应 JSON   │
 * │ 结构不变，前端与 store 无需任何改动。                     │
 * └─────────────────────────────────────────────────────────┘
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
  /** duckduckgo+rules = 联网搜索成功；rules-only = 搜索失败仅规则引擎 */
  source: 'duckduckgo+rules' | 'rules-only'
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

// ---------- 2. 规则拆解引擎 ----------

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

function buildCategoryRules(): CategoryRule[] {
  const research = (): NodeTemplate[] => [
    {
      title: () => '情报收集 · 摸清地图',
      desc: (g, hint) => `搜索并整理「${g}」的岗位要求、成长路线与行业现状（${hint}），输出一页调研笔记`,
    },
    {
      title: () => '锚定方向 · 立下冒险契约',
      desc: (g) => `基于调研结果，写下「${g}」的阶段性验收标准与预计投入时间`,
    },
  ]
  const foundation = (): NodeTemplate[] => [
    {
      title: () => '筑基修炼 · 核心知识',
      desc: (g, hint) => `系统学习「${g}」的核心基础知识（${hint}），完成笔记与自测`,
      children: [
        {
          title: () => '支线 · 术语图鉴',
          desc: (g) => `整理「${g}」领域 30 个高频术语/概念，制作自己的速查表`,
        },
      ],
    },
    {
      title: () => '每日修行 · 习惯回路',
      desc: () => '建立每日固定学习时段，连续打卡 7 天不断档',
    },
  ]
  const advanced = (): NodeTemplate[] => [
    {
      title: () => '进阶试炼 · 专项突破',
      desc: (g, hint) => `针对「${g}」的进阶技能点逐一专项练习（${hint}），补齐短板`,
      children: [
        {
          title: () => '支线 · 模仿名作',
          desc: (g) => `找 1-2 个「${g}」领域的优秀案例/前辈路径，拆解并模仿一遍`,
        },
        {
          title: () => '支线 · 请教前辈',
          desc: (g) => `向 1 位「${g}」从业者/前辈请教，记录 3 条关键建议`,
        },
      ],
    },
  ]
  const practice = (): NodeTemplate[] => [
    {
      title: () => '实战副本 · 完整作品',
      desc: (g, hint) => `独立完成一个能展示「${g}」能力的完整作品/项目（${hint}）`,
      children: [
        {
          title: () => '支线 · 复盘卷轴',
          desc: () => '记录实战过程中的 3 个坑与对应解法，形成复盘笔记',
        },
      ],
    },
    {
      title: () => '展示战利品 · 对外发布',
      desc: () => `把实战成果发布/投递出去（作品集、简历、社区分享），收集真实反馈`,
    },
  ]

  return [
    {
      match: /前端|后端|全栈|工程师|程序|编程|开发|代码|算法|AI|数据|测试|运维/i,
      phases: [
        { name: '启程 · 调研', weeks: 2, nodes: research() },
        { name: '入门 · 筑基', weeks: 2, nodes: foundation() },
        { name: '进阶 · 修炼', weeks: 4, nodes: advanced() },
        { name: '实战 · 试炼', weeks: 6, nodes: practice() },
        {
          name: '终章 · 求职冲刺',
          weeks: 2,
          nodes: [
            {
              title: () => '打磨武器 · 简历与作品集',
              desc: (g) => `围绕「${g}」岗位 JD 打磨简历与作品集，突出实战项目`,
            },
            {
              title: () => 'BOSS 战 · 模拟面试',
              desc: () => '完成 3 轮模拟面试（含八股/项目深挖），复盘话术',
            },
          ],
        },
      ],
    },
    {
      match: /设计|UI|UX|视觉|插画|绘画|原画|平面/i,
      phases: [
        { name: '启程 · 调研', weeks: 2, nodes: research() },
        { name: '入门 · 筑基', weeks: 3, nodes: foundation() },
        { name: '进阶 · 修炼', weeks: 4, nodes: advanced() },
        { name: '实战 · 试炼', weeks: 6, nodes: practice() },
      ],
    },
    {
      match: /英语|日语|韩语|外语|雅思|托福|语言/i,
      phases: [
        { name: '启程 · 调研', weeks: 1, nodes: research() },
        { name: '入门 · 筑基', weeks: 4, nodes: foundation() },
        { name: '进阶 · 修炼', weeks: 6, nodes: advanced() },
        { name: '实战 · 试炼', weeks: 4, nodes: practice() },
      ],
    },
    {
      match: /考研|考公|考证|考试|证书|公务员|教资/i,
      phases: [
        { name: '启程 · 调研', weeks: 1, nodes: research() },
        { name: '入门 · 筑基', weeks: 4, nodes: foundation() },
        { name: '进阶 · 修炼', weeks: 6, nodes: advanced() },
        { name: '实战 · 试炼', weeks: 4, nodes: practice() },
        {
          name: '终章 · 冲刺押题',
          weeks: 2,
          nodes: [
            {
              title: () => '全真模拟 · 限时演练',
              desc: () => '按真实考试时间完成 3 套全真模拟卷，统计得分曲线',
            },
            {
              title: () => '错题封印 · 查漏补缺',
              desc: () => '把所有错题按知识点归类，逐条重做直至全对',
            },
          ],
        },
      ],
    },
    {
      match: /产品|运营|市场|销售|管理|创业|商业|咨询/i,
      phases: [
        { name: '启程 · 调研', weeks: 2, nodes: research() },
        { name: '入门 · 筑基', weeks: 2, nodes: foundation() },
        { name: '进阶 · 修炼', weeks: 4, nodes: advanced() },
        { name: '实战 · 试炼', weeks: 6, nodes: practice() },
      ],
    },
    {
      // 通用兜底类别
      match: /.*/,
      phases: [
        { name: '启程 · 调研', weeks: 2, nodes: research() },
        { name: '入门 · 筑基', weeks: 2, nodes: foundation() },
        { name: '进阶 · 修炼', weeks: 4, nodes: advanced() },
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
 * 规则引擎拆解主入口。
 * TODO(LLM 接入点)：替换为真实大模型调用时，请保持返回 { phases, nodes }
 * 的结构与字段（含 deadline/phase ISO 字符串）完全不变。
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

// ---------- 3. HTTP 处理 ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
      if (data.length > 64 * 1024) reject(new Error('body too large'))
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

async function handleDecompose(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed, use POST' })
    return
  }
  let goal = ''
  try {
    const body = JSON.parse(await readBody(req)) as { goal?: unknown }
    if (typeof body.goal === 'string') goal = body.goal.trim().slice(0, 80)
  } catch {
    sendJson(res, 400, { error: '请求体必须是 JSON：{ "goal": "..." }' })
    return
  }
  if (!goal) {
    sendJson(res, 400, { error: 'goal 不能为空' })
    return
  }

  // 1) 联网搜索（失败不阻断，降级为 rules-only）
  const references = await searchReferences(goal)

  // 2) 规则引擎拆解（LLM 接入点见函数注释）
  const { phases, nodes } = decomposeWithRuleEngine(goal, references)

  const payload: DecomposeResponse = {
    goal,
    source: references.length > 0 ? 'duckduckgo+rules' : 'rules-only',
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
 * 与 vite.config.ts 中的 /pixellab 代理共存：本中间件只拦截 /api/decompose。
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
