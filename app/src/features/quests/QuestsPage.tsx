import { useMemo, useState } from 'react'
import { PixelButton, PixelPanel } from '@/components/pixel'
import { decomposeGoal } from '@/lib/ai'
import { useGameStore } from '@/store/gameStore'
import type { Quest, QuestNode } from '@/store/gameStore'
import QuestNodeCard from './components/QuestNodeCard'
import RewardToast, { type RewardInfo } from './components/RewardToast'
import EmptyState from './components/EmptyState'

/** 递归统计节点总数 / 已完成数 */
function countNodes(nodes: QuestNode[]): { total: number; done: number } {
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

/** 在节点树中查找节点（用于完成前读取奖励数值） */
function findNode(nodes: QuestNode[], nodeId: string): QuestNode | null {
  for (const n of nodes) {
    if (n.id === nodeId) return n
    if (n.children) {
      const hit = findNode(n.children, nodeId)
      if (hit) return hit
    }
  }
  return null
}

/**
 * 职业规划 · 任务树页面
 * 输入人生/职业目标 → AI 拆解为节点树 → 逐级完成拿 XP/金币
 */
export default function QuestsPage() {
  const quests = useGameStore((s) => s.quests)
  const addQuest = useGameStore((s) => s.addQuest)
  const removeQuest = useGameStore((s) => s.removeQuest)
  const completeQuestNode = useGameStore((s) => s.completeQuestNode)

  const [goalInput, setGoalInput] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reward, setReward] = useState<RewardInfo | null>(null)

  const activeQuest: Quest | null = useMemo(() => {
    if (quests.length === 0) return null
    return quests.find((q) => q.id === selectedId) ?? quests[quests.length - 1]
  }, [quests, selectedId])

  const progress = useMemo(
    () => (activeQuest ? countNodes(activeQuest.nodes) : { total: 0, done: 0 }),
    [activeQuest],
  )

  const handleDecompose = () => {
    const goal = goalInput.trim()
    if (!goal) return
    const nodes = decomposeGoal(goal)
    const quest: Quest = {
      id: crypto.randomUUID(),
      title: goal,
      description: `AI 拆解于 ${new Date().toLocaleDateString('zh-CN')}，共 ${nodes.length} 个阶段`,
      createdAt: new Date().toISOString(),
      nodes,
    }
    addQuest(quest)
    setSelectedId(quest.id)
    setGoalInput('')
  }

  const handleComplete = (nodeId: string) => {
    if (!activeQuest) return
    const node = findNode(activeQuest.nodes, nodeId)
    if (!node || node.status !== 'available') return
    // 先读奖励数值，再交给 store（store 会自动发放 XP/金币并解锁子节点）
    completeQuestNode(activeQuest.id, nodeId)
    setReward({ xp: node.rewardXp, coins: node.rewardCoins, title: node.title })
  }

  const handleRemove = (questId: string) => {
    const q = quests.find((x) => x.id === questId)
    if (!q) return
    if (window.confirm(`确定要放弃目标「${q.title}」吗？该目标的任务树将被移除。`)) {
      removeQuest(questId)
      if (selectedId === questId) setSelectedId(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ===== 目标输入区 ===== */}
      <PixelPanel>
        <h1 className="font-pixel text-sm text-wood-dark">职业规划 · 任务树</h1>
        <p className="mt-2 text-xs text-stone-dark">
          写下你的人生 / 职业目标，AI 会把它拆解成逐级解锁的冒险任务。
        </p>
        <div className="mt-3 flex gap-1">
          <input
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleDecompose()}
            placeholder="例如：成为前端工程师"
            maxLength={40}
            className="pixel-border-sm m-1 min-w-0 flex-1 bg-parchment-light px-3 py-2 text-sm text-ink placeholder:text-stone focus:outline-none"
          />
          <PixelButton
            variant="gold"
            onClick={handleDecompose}
            disabled={!goalInput.trim()}
            className="shrink-0"
          >
            拆解目标
          </PixelButton>
        </div>
      </PixelPanel>

      {/* ===== 多目标切换 ===== */}
      {quests.length > 0 && (
        <div className="flex gap-1 overflow-x-auto px-1 py-1">
          {quests.map((q) => {
            const isActive = activeQuest?.id === q.id
            return (
              <button
                key={q.id}
                onClick={() => setSelectedId(q.id)}
                className={`pixel-border-sm pixel-press m-1 shrink-0 px-3 py-1 font-pixel text-[10px] ${
                  isActive
                    ? 'bg-gold text-ink'
                    : 'bg-parchment-dark text-wood-dark hover:bg-parchment-light'
                }`}
              >
                ⚔ {q.title}
              </button>
            )
          })}
        </div>
      )}

      {/* ===== 任务树 / 空状态 ===== */}
      {!activeQuest ? (
        <EmptyState />
      ) : (
        <PixelPanel>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-pixel text-xs text-ink">{activeQuest.title}</h2>
              <p className="mt-1 text-[11px] text-stone-dark">{activeQuest.description}</p>
            </div>
            <PixelButton
              variant="berry"
              onClick={() => handleRemove(activeQuest.id)}
              className="shrink-0 px-2 py-1 text-[10px]"
            >
              放弃目标
            </PixelButton>
          </div>

          {/* 进度条 */}
          <div className="mt-3 flex items-center gap-2">
            <div className="pixel-border-sm h-3 flex-1 overflow-hidden bg-parchment-dark">
              <div
                className="h-full bg-moss transition-[width] duration-300"
                style={{
                  width: progress.total
                    ? `${Math.round((progress.done / progress.total) * 100)}%`
                    : '0%',
                }}
              />
            </div>
            <span className="font-pixel text-[10px] text-moss-dark">
              {progress.done}/{progress.total}
            </span>
          </div>

          {/* 树状节点列表 */}
          <div className="mt-4">
            {activeQuest.nodes.map((node, i) => (
              <QuestNodeCard
                key={node.id}
                node={node}
                depth={0}
                isLast={i === activeQuest.nodes.length - 1}
                onComplete={handleComplete}
              />
            ))}
          </div>
        </PixelPanel>
      )}

      {/* ===== 完成奖励弹窗 ===== */}
      {reward && <RewardToast reward={reward} onDone={() => setReward(null)} />}
    </div>
  )
}
