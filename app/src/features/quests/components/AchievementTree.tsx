import { useMemo } from 'react'
import type { QuestNode } from '@/store/gameStore'
import QuestNodeCard, { deadlineMeta } from './QuestNodeCard'

interface PhaseGroup {
  name: string
  nodes: QuestNode[]
}

interface AchievementTreeProps {
  nodes: QuestNode[]
  onComplete: (nodeId: string) => void
}

/** 按 phase 字段把顶层节点连续分组（保持原有顺序） */
function groupByPhase(nodes: QuestNode[]): PhaseGroup[] {
  const groups: PhaseGroup[] = []
  for (const n of nodes) {
    const phase = n.phase?.trim() || '冒险之路'
    const last = groups[groups.length - 1]
    if (last && last.name === phase) last.nodes.push(n)
    else groups.push({ name: phase, nodes: [n] })
  }
  return groups
}

/** 统计阶段进度（含 children） */
function phaseProgress(nodes: QuestNode[]): { total: number; done: number } {
  let total = 0
  let done = 0
  const walk = (list: QuestNode[]) => {
    for (const n of list) {
      total += 1
      if (n.status === 'done') done += 1
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return { total, done }
}

/** 阶段 deadline：取阶段内最晚的节点 deadline */
function phaseDeadline(nodes: QuestNode[]): string | null {
  let latest: string | null = null
  const walk = (list: QuestNode[]) => {
    for (const n of list) {
      if (n.deadline && (!latest || n.deadline > latest)) latest = n.deadline
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return latest
}

/**
 * 游戏成就树 / 天赋树：
 * 左侧纵向像素主干，按 phase 分阶段排列；每阶段有里程碑徽章，
 * 节点为徽章卡片，分支节点并排展开。
 */
export default function AchievementTree({ nodes, onComplete }: AchievementTreeProps) {
  const phases = useMemo(() => groupByPhase(nodes), [nodes])

  return (
    <div className="relative">
      {/* 纵向主干（像素虚线） */}
      <span
        aria-hidden
        className="absolute bottom-6 left-[25px] top-2 w-[4px]"
        style={{
          background:
            'repeating-linear-gradient(to bottom, #A97F57 0 6px, transparent 6px 10px)',
        }}
      />

      {phases.map((phase, pi) => {
        const prog = phaseProgress(phase.nodes)
        const allDone = prog.total > 0 && prog.done === prog.total
        const hasAvailable = phase.nodes.some(
          (n) =>
            n.status === 'available' ||
            (n.children ?? []).some((c) => c.status === 'available'),
        )
        const dl = phaseDeadline(phase.nodes)

        return (
          <section key={`${phase.name}-${pi}`} className="relative pb-5 pl-14">
            {/* 里程碑徽章（菱形） */}
            <span
              aria-hidden
              className={`pixel-border-sm absolute left-[13px] top-0 flex h-7 w-7 rotate-45 items-center justify-center ${
                allDone
                  ? 'bg-moss [--pixel-border-color:#5F6C43]'
                  : hasAvailable
                    ? 'animate-pulse bg-gold [--pixel-border-color:#9E7C33]'
                    : 'bg-stone-light [--pixel-border-color:#9C9484]'
              }`}
            >
              <span className="-rotate-45 text-xs leading-none">
                {allDone ? '🏅' : hasAvailable ? '🚩' : '🔒'}
              </span>
            </span>

            {/* 阶段标题行 */}
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-pixel text-[11px] text-wood-dark">
                STAGE {pi + 1} · {phase.name}
              </h3>
              <span className="bg-parchment-dark px-1.5 py-0.5 font-pixel text-[8px] text-moss-dark">
                {prog.done}/{prog.total}
              </span>
              {dl && !allDone && (
                <PhaseDeadlineChip deadline={dl} />
              )}
            </header>

            {/* 阶段节点列表：横向连接线接到主干 */}
            <div className="mt-2 flex flex-col gap-3">
              {phase.nodes.map((node) => (
                <div key={node.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute left-[-18px] top-6 h-[3px] w-[18px] bg-wood-light"
                  />
                  <QuestNodeCard node={node} onComplete={onComplete} />
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** 阶段期限徽章（临近金色警示 / 逾期红色） */
function PhaseDeadlineChip({ deadline }: { deadline: string }) {
  const meta = deadlineMeta(deadline)
  const cls =
    meta.tone === 'overdue'
      ? 'bg-berry-light/30 text-berry-dark'
      : meta.tone === 'soon'
        ? 'bg-gold-light/40 text-gold-dark'
        : 'bg-parchment-dark text-stone-dark'
  return (
    <span className={`px-1.5 py-0.5 font-pixel text-[8px] ${cls}`}>
      {meta.tone === 'overdue'
        ? `阶段已逾期 ${meta.text}`
        : meta.tone === 'soon'
          ? `⚠ 阶段剩${meta.daysLeft}天`
          : `阶段期限 ${meta.text}`}
    </span>
  )
}
