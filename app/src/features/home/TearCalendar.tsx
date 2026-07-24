import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { getDeadlineInfo, type PhaseGroup } from './homeUtils'
import './tearCalendar.css'

/** 撕页动画时长（与 tearCalendar.css 中 animation 保持一致） */
const TEAR_MS = 700
/** 自动轮播间隔 */
const AUTO_MS = 4000

/* ---------------- 单页日历卡片 ---------------- */

function TearPage({ group }: { group: PhaseGroup }) {
  const info = getDeadlineInfo(group.deadline)
  const allDone = group.total > 0 && group.done === group.total
  const overdue = !!info?.overdue && !allDone

  const d = group.deadline ? new Date(group.deadline) : null
  const valid = !!d && !Number.isNaN(d.getTime())

  // 头部配色：逾期浆果深红 / 正常浆果红 / 无期限木色
  const headerBg = overdue ? '#7F3A36' : valid ? '#A8504B' : '#8A6242'

  return (
    <div className="pixel-border-sm flex h-full w-full flex-col bg-parchment-light">
      {/* 日历头部：月份 + DEADLINE 像素字 + 挂环 */}
      <div
        className="relative flex items-baseline justify-center gap-2 px-2 py-1.5"
        style={{ backgroundColor: headerBg }}
      >
        <span className="absolute -top-1 left-6 h-2 w-1 bg-ink" />
        <span className="absolute -top-1 right-6 h-2 w-1 bg-ink" />
        <span className="font-pixel text-[10px] text-parchment-light">
          {valid ? `${d!.getMonth() + 1}月` : '待定'}
        </span>
        <span className="font-pixel text-[8px] text-parchment-light/80">
          DEADLINE
        </span>
      </div>

      {/* 撕纸残边 */}
      <div className="tear-stub bg-parchment-dark" />

      {/* 大号日期数字 */}
      <div className="flex flex-col items-center pt-2">
        <span className="font-pixel text-3xl leading-none text-ink">
          {valid ? d!.getDate() : '--'}
        </span>
        <span className="mt-1 font-pixel text-[8px] text-stone-dark">
          {valid ? `${d!.getFullYear()} 年` : '日期待定'}
        </span>
      </div>

      {/* 活动名：阶段名 + 所属目标 + 进度 */}
      <div className="mt-2 flex-1 px-3 text-center">
        <p className="truncate font-pixel text-[10px] text-ink">{group.name}</p>
        {!group.fromQuest && (
          <p className="mt-1 truncate font-pixel text-[8px] text-stone-dark">
            「{group.questTitle}」
          </p>
        )}
        <p className="mt-1 font-pixel text-[8px] text-moss-dark">
          {group.done}/{group.total}
          {allDone ? ' ✓' : ''}
        </p>
      </div>

      {/* 底部人性化提示 */}
      <div className="px-3 pb-2 text-center">
        <span
          className={`font-pixel text-[8px] ${
            info
              ? overdue
                ? 'text-berry'
                : 'text-wood-dark'
              : 'text-stone'
          }`}
        >
          {info ? info.label : '无期限'}
        </span>
      </div>
    </div>
  )
}

/* ---------------- 撕日历轮播 ---------------- */

/**
 * 一次只显示一个活动的撕页日历：
 * 每 4 秒（或点击）撕掉当前页，露出下一页。
 * 悬停暂停轮播，离开恢复；仅 1 页时静止。
 */
export function TearCalendar({ groups }: { groups: PhaseGroup[] }) {
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const tearTimer = useRef<number | null>(null)

  const count = groups.length
  const safeIndex = count > 0 ? index % count : 0

  const advance = useCallback(() => {
    if (count <= 1) return
    setLeaving(safeIndex)
    setIndex((i) => (i + 1) % count)
    if (tearTimer.current !== null) window.clearTimeout(tearTimer.current)
    tearTimer.current = window.setTimeout(() => setLeaving(null), TEAR_MS)
  }, [count, safeIndex])

  // 自动轮播：悬停暂停；index 变化后重新计时
  useEffect(() => {
    if (paused || count <= 1) return
    const t = window.setTimeout(advance, AUTO_MS)
    return () => window.clearTimeout(t)
  }, [paused, count, safeIndex, advance])

  // 卸载时清理撕页定时器
  useEffect(
    () => () => {
      if (tearTimer.current !== null) window.clearTimeout(tearTimer.current)
    },
    [],
  )

  if (count === 0) return null

  const leavingGroup =
    leaving !== null && leaving < count ? groups[leaving] : null

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      advance()
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className="tear-scene relative w-full max-w-60 cursor-pointer select-none"
        role="button"
        tabIndex={0}
        aria-label="撕下当前日历页，查看下一个 Deadline"
        onClick={advance}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* 当前页（下一页在底下露出） */}
        <div className="h-56">
          <TearPage group={groups[safeIndex]} />
        </div>

        {/* 正在撕掉的上一页（覆盖在上层飞走） */}
        {leavingGroup && (
          <div
            key={`${leaving}-${safeIndex}`}
            className="tear-leaving absolute inset-x-0 top-0 h-56"
          >
            <TearPage group={leavingGroup} />
          </div>
        )}
      </div>

      {/* 页码指示 */}
      <p className="mt-2 text-center font-pixel text-[8px] text-stone-dark">
        第 {safeIndex + 1} / {count} 页
        {count > 1 && <span className="text-stone"> · 点击撕页</span>}
      </p>
    </div>
  )
}
