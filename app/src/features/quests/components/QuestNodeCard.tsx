import { useMemo, useState } from 'react'
import { PixelButton } from '@/components/pixel'
import type { QuestNode } from '@/store/gameStore'

/** 拆解 API 返回的联网参考资料（/api/decompose references 条目） */
export interface QuestReference {
  title: string
  snippet: string
  url?: string
}

/**
 * 从 references 中挑出与节点相关的条目：
 * 用节点标题+描述的连续双字词去匹配资料标题/摘要打分，
 * 有命中按分数取前 limit 条；无命中回退前 limit 条通用资料。
 */
export function pickRelevantRefs(
  node: QuestNode,
  refs: QuestReference[],
  limit = 3,
): QuestReference[] {
  if (refs.length === 0) return []
  const text = `${node.title} ${node.description}`
  const scored = refs.map((r) => {
    const hay = `${r.title} ${r.snippet}`
    let score = 0
    for (let i = 0; i < text.length - 1; i++) {
      const gram = text.slice(i, i + 2)
      if (!/^[一-鿿]{2}$/.test(gram)) continue
      if (hay.includes(gram)) score += 1
    }
    return { r, score }
  })
  const hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.r)
  return (hits.length > 0 ? hits : refs).slice(0, limit)
}

/** deadline 紧迫度：overdue 逾期 / soon 3 天内 / normal 其余 */
export type DeadlineTone = 'overdue' | 'soon' | 'normal'

/** 计算 deadline 展示文案与紧迫度（以本地当天为锚点） */
export function deadlineMeta(deadline: string): {
  text: string
  tone: DeadlineTone
  daysLeft: number
} {
  const due = new Date(deadline)
  const now = new Date()
  due.setHours(23, 59, 59, 999)
  const daysLeft = Math.ceil((due.getTime() - now.getTime()) / 86_400_000)
  const text = `${due.getMonth() + 1}月${due.getDate()}日`
  if (daysLeft < 0) return { text, tone: 'overdue', daysLeft }
  if (daysLeft <= 3) return { text, tone: 'soon', daysLeft }
  return { text, tone: 'normal', daysLeft }
}

const toneClasses: Record<DeadlineTone, string> = {
  overdue: 'bg-berry-light/30 text-berry-dark',
  soon: 'bg-gold-light/40 text-gold-dark',
  normal: 'bg-parchment-dark text-stone-dark',
}

interface QuestNodeCardProps {
  node: QuestNode
  /** 分支子节点用紧凑宽度 */
  compact?: boolean
  /** 本次拆解的联网参考资料（节点卡片上按相关度挑出展示） */
  references?: QuestReference[]
  onComplete: (nodeId: string) => void
}

/**
 * 成就树节点徽章卡片：
 * - locked：灰暗锁定（🔒）
 * - available：金色描边 + 金光脉动，可点击完成
 * - done：盖章 CLEAR!
 * 带 deadline 时展示期限徽章：3 天内金色警示、逾期红色。
 * 带参考资料时展示「📚 参考」可展开小列表（新窗口打开链接）。
 * children 分支在卡片下方并排展开（像素连接线）。
 */
export default function QuestNodeCard({
  node,
  compact,
  references,
  onComplete,
}: QuestNodeCardProps) {
  const isAvailable = node.status === 'available'
  const isDone = node.status === 'done'
  const isLocked = node.status === 'locked'
  const hasChildren = !!node.children && node.children.length > 0
  const dl = node.deadline ? deadlineMeta(node.deadline) : null
  const [refsOpen, setRefsOpen] = useState(false)
  const nodeRefs = useMemo(
    () => (references && references.length > 0 ? pickRelevantRefs(node, references) : []),
    [node, references],
  )

  return (
    <div className="flex flex-col items-center">
      {/* ===== 徽章卡片本体 ===== */}
      <div
        className={`pixel-border-sm relative m-1 p-3 ${compact ? 'w-40' : 'w-full'} ${
          isLocked
            ? 'bg-stone-light/50'
            : 'bg-parchment-light'
        } ${isAvailable ? '[--pixel-border-color:#C9A24B]' : ''} ${
          isDone ? '[--pixel-border-color:#5F6C43]' : ''
        } ${isLocked ? '[--pixel-border-color:#9C9484]' : ''}`}
      >
        {/* 完成盖章 */}
        {isDone && (
          <span className="pixel-border-sm absolute -right-1 -top-3 rotate-6 bg-moss px-2 py-0.5 font-pixel text-[9px] text-parchment-light [--pixel-border-color:#5F6C43]">
            CLEAR!
          </span>
        )}

        <div className="flex items-center gap-2">
          {/* 状态徽章 */}
          <span
            aria-hidden
            className={`pixel-border-sm flex h-7 w-7 shrink-0 items-center justify-center text-sm ${
              isDone
                ? 'bg-moss'
                : isAvailable
                  ? 'animate-pulse bg-gold'
                  : 'bg-stone-light'
            }`}
          >
            {isDone ? '★' : isAvailable ? '⚔️' : '🔒'}
          </span>
          <h3
            className={`min-w-0 font-pixel leading-relaxed ${
              compact ? 'text-[9px]' : 'text-[11px]'
            } ${isLocked ? 'text-stone-dark' : 'text-ink'}`}
          >
            {node.title}
          </h3>
        </div>

        <p
          className={`mt-1.5 text-xs leading-relaxed ${
            isLocked ? 'text-stone' : 'text-stone-dark'
          } ${compact ? 'line-clamp-3' : ''}`}
        >
          {node.description}
        </p>

        {/* 参考资料（📚 参考：可展开小列表，新窗口打开链接） */}
        {nodeRefs.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setRefsOpen((v) => !v)}
              className={`font-pixel text-[9px] ${
                isLocked ? 'text-stone' : 'text-moss-dark hover:text-wood-dark'
              }`}
            >
              {refsOpen ? '▾' : '▸'} 📚 参考 ({nodeRefs.length})
            </button>
            {refsOpen && (
              <ul className="pixel-border-sm mt-1 flex flex-col gap-1 bg-parchment-dark/60 p-2 [--pixel-border-color:#C9B98F]">
                {nodeRefs.map((r, i) => (
                  <li key={`${r.title}-${i}`} className="text-[10px] leading-relaxed">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-moss-dark underline decoration-dotted underline-offset-2 hover:text-wood-dark"
                      >
                        {r.title}
                      </a>
                    ) : (
                      <span className="text-stone-dark">{r.title}</span>
                    )}
                    {r.snippet && (
                      <span className="block text-stone-dark">
                        {r.snippet.slice(0, 60)}
                        {r.snippet.length > 60 ? '…' : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 奖励 + deadline */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-pixel text-[9px]">
          <span className={isLocked ? 'text-stone' : 'text-gold-dark'}>
            ★ +{node.rewardXp} XP
          </span>
          <span className={isLocked ? 'text-stone' : 'text-wood-dark'}>
            ◼ +{node.rewardCoins} 金币
          </span>
          {dl && (
            <span
              className={`px-1 py-0.5 ${
                isDone ? 'bg-parchment-dark text-stone-dark' : toneClasses[dl.tone]
              }`}
            >
              {isDone
                ? `✓ ${dl.text}`
                : dl.tone === 'overdue'
                  ? `已逾期 ${dl.text}`
                  : dl.tone === 'soon'
                    ? `⚠ 剩${dl.daysLeft}天 ${dl.text}`
                    : `期限 ${dl.text}`}
            </span>
          )}
        </div>

        {isAvailable && (
          <PixelButton
            variant="moss"
            onClick={() => onComplete(node.id)}
            className="mt-2 w-full px-3 py-1 text-[10px]"
          >
            完成
          </PixelButton>
        )}
      </div>

      {/* ===== 分支子节点（并排展开 + 像素连接线） ===== */}
      {hasChildren && (
        <div className="flex flex-col items-center">
          {/* 卡片底部 → 分支横线的竖线 */}
          <span aria-hidden className="h-3 w-[3px] bg-wood-light" />
          <div className="relative flex items-start gap-3">
            {/* 分支横线：覆盖首个到末个子节点中心之间 */}
            {node.children!.length > 1 && (
              <span
                aria-hidden
                className="absolute left-[84px] right-[84px] top-0 h-[3px] bg-wood-light"
              />
            )}
            {node.children!.map((child) => (
              <div key={child.id} className="relative pt-3">
                {/* 横线 → 子卡片顶部的竖线 */}
                <span
                  aria-hidden
                  className="absolute left-1/2 top-0 h-3 w-[3px] -translate-x-1/2 bg-wood-light"
                />
                <QuestNodeCard
                  node={child}
                  compact
                  references={references}
                  onComplete={onComplete}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
