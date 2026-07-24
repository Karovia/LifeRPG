import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { PixelButton, PixelPanel, PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import {
  collectAvailableNodes,
  computeDiaryStreak,
  countDoneNodes,
  countTotalNodes,
  getDeadlineInfo,
  groupNodesByPhase,
  sortTodosForHome,
  todoDueInfo,
} from './homeUtils'
import { TearCalendar } from './TearCalendar'

/** 像素图标：图片缺失时降级为 emoji */
function IconImg({
  src,
  alt,
  fallback,
  className = 'h-5 w-5',
}: {
  src: string
  alt: string
  fallback: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className="text-sm leading-none">{fallback}</span>
  }
  return (
    <img
      src={src}
      alt={alt}
      className={`pixelated ${className}`}
      onError={() => setFailed(true)}
    />
  )
}

/** 区块标题 */
function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-2 font-pixel text-xs text-ink">
      <span className="text-gold-dark">▸ </span>
      {children}
    </h2>
  )
}

/* ---------------- 成长数据区 ---------------- */

function GrowthSection() {
  const player = useGameStore((s) => s.player)
  const quests = useGameStore((s) => s.quests)
  const diaryEntries = useGameStore((s) => s.diaryEntries)

  const doneCount = countDoneNodes(quests)
  const totalCount = countTotalNodes(quests)
  const streak = computeDiaryStreak(diaryEntries)

  return (
    <PixelPanel className="md:col-span-2">
      <SectionTitle>成长数据</SectionTitle>

      <div className="flex flex-wrap items-center gap-3">
        {/* 等级徽章 */}
        <div className="pixel-border-sm flex h-14 w-14 shrink-0 flex-col items-center justify-center bg-gold text-ink">
          <span className="font-pixel text-[8px]">LV</span>
          <span className="font-pixel text-sm leading-none">{player.level}</span>
        </div>

        {/* XP 进度条 */}
        <div className="min-w-40 flex-1">
          <div className="mb-1 flex items-center gap-1">
            <IconImg
              src="/assets/ui/xp-star.png"
              alt="XP"
              fallback="⭐"
              className="h-4 w-4"
            />
            <span className="font-pixel text-[10px] text-wood-dark">
              经验值
            </span>
          </div>
          <PixelProgressBar
            variant="xp"
            value={player.xp}
            max={player.xpToNext}
            segments={12}
            label="XP"
          />
        </div>
      </div>

      {/* 数值小卡：金币 / 已完成 / 连续日记 */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="pixel-border-sm flex flex-col items-center gap-1 bg-parchment-dark px-2 py-2">
          <IconImg src="/assets/ui/coin.png" alt="金币" fallback="🪙" />
          <span className="font-pixel text-xs text-gold-dark">
            {player.coins}
          </span>
          <span className="font-pixel text-[8px] text-stone-dark">金币</span>
        </div>
        <div className="pixel-border-sm flex flex-col items-center gap-1 bg-parchment-dark px-2 py-2">
          <span className="text-sm leading-none">⚔️</span>
          <span className="font-pixel text-xs text-moss-dark">
            {doneCount}
            <span className="text-[8px] text-stone-dark">/{totalCount}</span>
          </span>
          <span className="font-pixel text-[8px] text-stone-dark">
            已完成任务
          </span>
        </div>
        <div className="pixel-border-sm flex flex-col items-center gap-1 bg-parchment-dark px-2 py-2">
          <span className="text-sm leading-none">📖</span>
          <span className="font-pixel text-xs text-berry">
            {streak}
            <span className="text-[8px] text-stone-dark"> 天</span>
          </span>
          <span className="font-pixel text-[8px] text-stone-dark">
            连续日记
          </span>
        </div>
      </div>
    </PixelPanel>
  )
}

/* ---------------- 今日目标区 ---------------- */

function TodayGoalsSection() {
  const quests = useGameStore((s) => s.quests)
  const items = collectAvailableNodes(quests).slice(0, 6)

  return (
    <PixelPanel>
      <SectionTitle>今日目标</SectionTitle>
      {items.length === 0 ? (
        <div className="py-3 text-center">
          <p className="font-pixel text-[10px] leading-relaxed text-stone-dark">
            当前没有可行动的任务节点。
            <br />
            去拆解一个目标，点亮第一格经验条吧！
          </p>
          <Link to="/quests">
            <PixelButton variant="moss" className="mt-3">
              ⚔️ 前往任务页
            </PixelButton>
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map(({ node, questTitle }) => {
            const info = getDeadlineInfo(node.deadline)
            return (
              <li key={node.id}>
                <Link
                  to="/quests"
                  className="pixel-border-sm pixel-press block bg-parchment-light px-3 py-2 hover:bg-parchment-dark"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-pixel text-[10px] text-ink">
                      {node.title}
                    </span>
                    {info && (
                      <span
                        className={`shrink-0 font-pixel text-[8px] ${
                          info.overdue ? 'text-berry' : 'text-wood-dark'
                        }`}
                      >
                        {info.label}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-pixel text-[8px] text-stone-dark">
                    <span className="truncate">「{questTitle}」</span>
                    {node.phase && (
                      <span className="shrink-0 text-moss-dark">
                        ◆ {node.phase}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </PixelPanel>
  )
}

/* ---------------- 阶段 Deadline 区 ---------------- */

function PhaseDeadlineSection() {
  const quests = useGameStore((s) => s.quests)
  const groups = groupNodesByPhase(quests)

  return (
    <PixelPanel>
      <SectionTitle>阶段 Deadline</SectionTitle>
      {groups.length === 0 ? (
        <div className="py-3 text-center">
          <p className="font-pixel text-[10px] leading-relaxed text-stone-dark">
            还没有任何阶段时间线。
            <br />
            创建一个目标，为每个阶段设下期限吧！
          </p>
          <Link to="/quests">
            <PixelButton variant="moss" className="mt-3">
              ⚔️ 去创建目标
            </PixelButton>
          </Link>
        </div>
      ) : (
        <TearCalendar groups={groups} />
      )}
    </PixelPanel>
  )
}

/* ---------------- ToDo List 区 ---------------- */

function TodoSection() {
  const todos = useGameStore((s) => s.todos)
  const addTodo = useGameStore((s) => s.addTodo)
  const toggleTodo = useGameStore((s) => s.toggleTodo)
  const removeTodo = useGameStore((s) => s.removeTodo)

  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')

  const sorted = sortTodosForHome(todos)

  const handleAdd = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    addTodo({ title: trimmed, dueDate: dueDate || undefined })
    setTitle('')
    setDueDate('')
  }

  return (
    <PixelPanel className="md:col-span-2">
      <SectionTitle>ToDo List</SectionTitle>

      {/* 快速新增 */}
      <form onSubmit={handleAdd} className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="写下一件要做的事…"
          maxLength={50}
          className="pixel-border-sm min-w-0 flex-1 bg-parchment-light px-3 py-2 font-pixel text-[10px] text-ink placeholder:text-stone focus:outline-none"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="到期日（可选）"
          className="pixel-border-sm bg-parchment-light px-2 py-2 font-pixel text-[10px] text-ink focus:outline-none"
        />
        <PixelButton type="submit" variant="gold" disabled={!title.trim()}>
          添加
        </PixelButton>
      </form>

      {sorted.length === 0 ? (
        <p className="py-2 text-center font-pixel text-[10px] leading-relaxed text-stone-dark">
          清单空空如也。
          <br />
          在上方写下今天的第一件小事吧 ✏️
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((t) => {
            const due = todoDueInfo(t.dueDate)
            return (
              <li
                key={t.id}
                className="flex items-center gap-2 px-1 py-1"
              >
                {/* 复选框 */}
                <button
                  type="button"
                  onClick={() => toggleTodo(t.id)}
                  aria-label={t.done ? '标记为未完成' : '标记为完成'}
                  className={`pixel-border-sm flex h-5 w-5 shrink-0 items-center justify-center font-pixel text-[10px] ${
                    t.done
                      ? 'bg-moss text-parchment-light'
                      : 'bg-parchment-light text-transparent hover:bg-parchment-dark'
                  }`}
                >
                  ✓
                </button>
                <span
                  className={`min-w-0 flex-1 truncate font-pixel text-[10px] ${
                    t.done ? 'text-stone line-through' : 'text-ink'
                  }`}
                >
                  {t.title}
                </span>
                {due && (
                  <span
                    className={`shrink-0 font-pixel text-[8px] ${
                      t.done
                        ? 'text-stone'
                        : due.hot
                          ? 'text-berry'
                          : 'text-wood-dark'
                    }`}
                  >
                    {due.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeTodo(t.id)}
                  aria-label="删除待办"
                  className="shrink-0 px-1 font-pixel text-[10px] text-stone hover:text-berry"
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </PixelPanel>
  )
}

/* ---------------- 页面 ---------------- */

/** 首页：成长数据 + 今日目标 + 阶段 Deadline + ToDo List */
export default function HomePage() {
  return (
    <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
      <GrowthSection />
      <TodayGoalsSection />
      <PhaseDeadlineSection />
      <TodoSection />
    </div>
  )
}
