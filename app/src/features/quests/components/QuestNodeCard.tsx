import { PixelButton } from '@/components/pixel'
import type { QuestNode, QuestNodeStatus } from '@/store/gameStore'

interface QuestNodeCardProps {
  node: QuestNode
  depth: number
  /** 是否为同级最后一个节点（控制竖向连接线是否向下延续） */
  isLast: boolean
  onComplete: (nodeId: string) => void
}

const statusMeta: Record<
  QuestNodeStatus,
  { label: string; icon: string; cardClass: string; badgeClass: string }
> = {
  locked: {
    label: '未解锁',
    icon: '🔒',
    cardClass: 'bg-stone-light/60 text-stone-dark',
    badgeClass: 'bg-stone text-parchment-light',
  },
  available: {
    label: '可完成',
    icon: '⚔️',
    cardClass: 'bg-parchment-light text-ink',
    badgeClass: 'bg-gold text-ink',
  },
  done: {
    label: '已完成',
    icon: '✅',
    cardClass: 'bg-parchment-light text-ink',
    badgeClass: 'bg-moss text-parchment-light',
  },
}

/**
 * 任务树节点卡片：左侧状态圆点 + 像素连接线，右侧节点卡片。
 * 递归渲染 children，形成阶梯式递进布局。
 *
 * 连接线规则（经典文件树画法）：
 * - 每个节点从自身行顶到圆点画一小段竖线，相邻兄弟行拼成连续竖线；
 * - 子节点额外画横线连到父级竖线列；
 * - 父节点若非最后兄弟、或拥有子节点，则竖线从圆点向下延续。
 */
export default function QuestNodeCard({
  node,
  depth,
  isLast,
  onComplete,
}: QuestNodeCardProps) {
  const meta = statusMeta[node.status]
  const isAvailable = node.status === 'available'
  const isDone = node.status === 'done'
  const isLocked = node.status === 'locked'
  const hasChildren = !!node.children && node.children.length > 0

  return (
    <div className="relative" style={{ marginLeft: depth === 0 ? 0 : 24 }}>
      {/* 子层级：行顶 → 圆点的竖线（父级列，x = -24+13） */}
      {depth > 0 && (
        <span
          aria-hidden
          className="absolute left-[-11px] top-0 h-[15px] w-[3px] bg-wood-light"
        />
      )}
      {/* 子层级：父级列 → 圆点的横线 */}
      {depth > 0 && (
        <span
          aria-hidden
          className="absolute left-[-11px] top-[14px] h-[3px] w-[24px] bg-wood-light"
        />
      )}
      {/* 圆点向下延续的竖线（有下一个兄弟或有子节点时） */}
      {(!isLast || hasChildren) && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[13px] top-[30px] w-[3px] bg-wood-light"
        />
      )}

      <div className="flex items-start gap-2 py-1.5">
        {/* 状态圆点 */}
        <span
          aria-hidden
          className={`pixel-border-sm z-10 mt-1 flex h-7 w-7 shrink-0 items-center justify-center text-sm ${
            isDone
              ? 'bg-moss'
              : isAvailable
                ? 'animate-pulse bg-gold'
                : 'bg-stone-light'
          }`}
        >
          {meta.icon}
        </span>

        {/* 节点卡片 */}
        <div
          className={`pixel-border-sm relative m-1 flex-1 p-3 ${meta.cardClass} ${
            isAvailable ? '[--pixel-border-color:#C9A24B]' : ''
          } ${isDone ? '[--pixel-border-color:#5F6C43]' : ''}`}
        >
          {/* 完成盖章 */}
          {isDone && (
            <span className="pixel-border-sm absolute -right-1 -top-3 rotate-6 bg-moss px-2 py-0.5 font-pixel text-[9px] text-parchment-light [--pixel-border-color:#5F6C43]">
              CLEAR!
            </span>
          )}

          <div className="flex items-center justify-between gap-2">
            <h3
              className={`font-pixel text-[11px] leading-relaxed ${
                isLocked ? 'text-stone-dark' : 'text-ink'
              }`}
            >
              {node.title}
            </h3>
            <span
              className={`shrink-0 px-1.5 py-0.5 font-pixel text-[8px] ${meta.badgeClass}`}
            >
              {meta.label}
            </span>
          </div>

          <p
            className={`mt-1.5 text-xs leading-relaxed ${
              isLocked ? 'text-stone' : 'text-stone-dark'
            }`}
          >
            {node.description}
          </p>

          {/* 奖励信息 + 完成按钮 */}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-pixel text-[9px]">
              <span className={isLocked ? 'text-stone' : 'text-gold-dark'}>
                ★ +{node.rewardXp} XP
              </span>
              <span className={isLocked ? 'text-stone' : 'text-wood-dark'}>
                ◼ +{node.rewardCoins} 金币
              </span>
            </div>
            {isAvailable && (
              <PixelButton
                variant="moss"
                onClick={() => onComplete(node.id)}
                className="px-3 py-1 text-[10px]"
              >
                完成
              </PixelButton>
            )}
          </div>
        </div>
      </div>

      {/* 子节点（递归，阶梯缩进） */}
      {hasChildren &&
        node.children!.map((child, i) => (
          <QuestNodeCard
            key={child.id}
            node={child}
            depth={depth + 1}
            isLast={i === node.children!.length - 1}
            onComplete={onComplete}
          />
        ))}
    </div>
  )
}
