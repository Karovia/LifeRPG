import type { DiaryEntry, QuestNode } from '@/store/gameStore'

/** 递归统计节点树中已完成的节点数 */
export function countDoneNodes(nodes: QuestNode[]): number {
  return nodes.reduce(
    (sum, n) =>
      sum +
      (n.status === 'done' ? 1 : 0) +
      (n.children ? countDoneNodes(n.children) : 0),
    0,
  )
}

/** 递归统计节点树总节点数 */
export function countTotalNodes(nodes: QuestNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + 1 + (n.children ? countTotalNodes(n.children) : 0),
    0,
  )
}

/** 本地日期 → YYYY-MM-DD */
function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 连续记录天数：从今天（或昨天，若今天还没写）开始向前逐日计数。
 * 同一天多条日记只算一天。
 */
export function calcDiaryStreak(entries: DiaryEntry[]): number {
  if (entries.length === 0) return 0
  const days = new Set(entries.map((e) => e.date))

  const cursor = new Date()
  if (!days.has(fmtDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
    if (!days.has(fmtDate(cursor))) return 0
  }

  let streak = 0
  while (days.has(fmtDate(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
