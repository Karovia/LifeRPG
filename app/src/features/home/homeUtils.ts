import type { DiaryEntry, Quest, QuestNode } from '@/store/gameStore'

/**
 * ============================================================
 * 首页数据派生工具（纯函数，不直接读 store）
 * ============================================================
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 递归拍平节点树（含所有 children） */
export function flattenNodes(nodes: QuestNode[]): QuestNode[] {
  const out: QuestNode[] = []
  const walk = (list: QuestNode[]) => {
    for (const n of list) {
      out.push(n)
      if (n.children && n.children.length > 0) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** 递归统计已完成节点数（status==='done'，含 children） */
export function countDoneNodes(quests: Quest[]): number {
  return quests.reduce(
    (sum, q) =>
      sum + flattenNodes(q.nodes).filter((n) => n.status === 'done').length,
    0,
  )
}

/** 递归统计节点总数 */
export function countTotalNodes(quests: Quest[]): number {
  return quests.reduce((sum, q) => sum + flattenNodes(q.nodes).length, 0)
}

/** Date → YYYY-MM-DD（本地时区） */
function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * 连续日记天数：从今天（或昨天，若今天还没写）往前数连续有记录的日期数。
 * 最新记录早于昨天则归零。
 */
export function computeDiaryStreak(entries: DiaryEntry[]): number {
  const days = new Set(entries.map((e) => e.date))
  if (days.size === 0) return 0

  const cursor = startOfToday()
  if (!days.has(dateKey(cursor))) {
    // 今天没写：看昨天是否还有火苗
    cursor.setDate(cursor.getDate() - 1)
    if (!days.has(dateKey(cursor))) return 0
  }
  let streak = 0
  while (days.has(dateKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export interface DeadlineInfo {
  /** 人性化文案：今天截止 / 明天截止 / 还剩 N 天 / 已逾期 N 天 */
  label: string
  overdue: boolean
  /** 相对今天的偏移天数（负数为已逾期） */
  diffDays: number
}

/** 解析 deadline（ISO 日期/时间戳）并给出人性化显示 */
export function getDeadlineInfo(deadline?: string): DeadlineInfo | null {
  if (!deadline) return null
  const d = new Date(deadline)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d.getTime() - startOfToday().getTime()) / DAY_MS)
  if (diffDays < 0)
    return { label: `已逾期 ${-diffDays} 天`, overdue: true, diffDays }
  if (diffDays === 0) return { label: '今天截止', overdue: false, diffDays }
  if (diffDays === 1) return { label: '明天截止', overdue: false, diffDays }
  return { label: `还剩 ${diffDays} 天`, overdue: false, diffDays }
}

/** deadline 排序用的权重：无 deadline 排最后 */
function deadlineWeight(deadline?: string): number {
  if (!deadline) return Number.POSITIVE_INFINITY
  const t = new Date(deadline).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

export interface AvailableNodeItem {
  node: QuestNode
  questId: string
  questTitle: string
}

/** 汇总所有 quest 中 status==='available' 的节点，按 deadline 升序（无期限在后） */
export function collectAvailableNodes(quests: Quest[]): AvailableNodeItem[] {
  const items: AvailableNodeItem[] = []
  for (const q of quests) {
    for (const n of flattenNodes(q.nodes)) {
      if (n.status === 'available') {
        items.push({ node: n, questId: q.id, questTitle: q.title })
      }
    }
  }
  return items.sort(
    (a, b) => deadlineWeight(a.node.deadline) - deadlineWeight(b.node.deadline),
  )
}

export interface PhaseGroup {
  /** 分组 key：有 phase 用 questId::phase，否则用 questId */
  key: string
  /** 显示名：phase 名或 quest 名 */
  name: string
  /** 来源 quest（无 phase 分组时与 name 相同） */
  questTitle: string
  /** 是否按 quest 兜底分组（无 phase） */
  fromQuest: boolean
  total: number
  done: number
  /** 组内最晚 deadline（阶段截止日） */
  deadline?: string
}

/**
 * 把所有 quest 节点按 phase 分组（无 phase 的按 quest 分组），
 * 返回按 deadline 升序排列（最近的在前，无期限在最后）。
 */
export function groupNodesByPhase(quests: Quest[]): PhaseGroup[] {
  const map = new Map<string, PhaseGroup>()
  for (const q of quests) {
    for (const n of flattenNodes(q.nodes)) {
      const key = n.phase ? `${q.id}::${n.phase}` : q.id
      let g = map.get(key)
      if (!g) {
        g = {
          key,
          name: n.phase ?? q.title,
          questTitle: q.title,
          fromQuest: !n.phase,
          total: 0,
          done: 0,
          deadline: undefined,
        }
        map.set(key, g)
      }
      g.total += 1
      if (n.status === 'done') g.done += 1
      if (n.deadline && deadlineWeight(n.deadline) < Number.POSITIVE_INFINITY) {
        if (
          !g.deadline ||
          deadlineWeight(n.deadline) > deadlineWeight(g.deadline)
        ) {
          g.deadline = n.deadline
        }
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => deadlineWeight(a.deadline) - deadlineWeight(b.deadline),
  )
}

/**
 * ToDo 排序：未完成且今天到期/已逾期的置顶（按 dueDate 升序），
 * 其余未完成随后（按创建时间升序），已完成沉底。
 */
export function sortTodosForHome<
  T extends { done: boolean; createdAt: string; dueDate?: string },
>(todos: T[]): T[] {
  const todayKey = dateKey(startOfToday())
  const isTodayOrOverdue = (t: T) => {
    if (!t.dueDate) return false
    const d = new Date(t.dueDate)
    if (Number.isNaN(d.getTime())) return false
    return dateKey(d) <= todayKey
  }
  const dueWeight = (t: T) => {
    if (!t.dueDate) return Number.POSITIVE_INFINITY
    const d = new Date(t.dueDate).getTime()
    return Number.isNaN(d) ? Number.POSITIVE_INFINITY : d
  }
  return [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (!a.done && !b.done) {
      const aHot = isTodayOrOverdue(a)
      const bHot = isTodayOrOverdue(b)
      if (aHot !== bHot) return aHot ? -1 : 1
      const dw = dueWeight(a) - dueWeight(b)
      if (dw !== 0) return dw
    }
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/** todo dueDate 的简短显示（MM-DD），并标记是否今日/逾期 */
export function todoDueInfo(dueDate?: string): {
  label: string
  hot: boolean
} | null {
  if (!dueDate) return null
  const d = new Date(dueDate)
  if (Number.isNaN(d.getTime())) return null
  const todayKey = dateKey(startOfToday())
  const key = dateKey(d)
  const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
  if (key === todayKey) return { label: `今天 ${label}`, hot: true }
  if (key < todayKey) return { label: `逾期 ${label}`, hot: true }
  return { label, hot: false }
}
