import { PixelPanel, PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { calcDiaryStreak, countDoneNodes, countTotalNodes } from '../utils/stats'
import { PixelImg } from './PixelImg'

/** 概览小图标：素材缺失时降级为色块/emoji */
function StatIcon({ src, alt, fallbackClass, fallback }: {
  src: string
  alt: string
  fallbackClass: string
  fallback: string
}) {
  return (
    <PixelImg
      src={src}
      alt={alt}
      className="h-6 w-6"
      fallback={
        <span
          className={`flex h-6 w-6 items-center justify-center text-sm leading-none ${fallbackClass}`}
        >
          {fallback}
        </span>
      }
    />
  )
}

/** 成长概览：等级 / XP 进度 / 金币 / 已完成任务数 / 连续记录天数 */
export function OverviewPanel() {
  const player = useGameStore((s) => s.player)
  const quests = useGameStore((s) => s.quests)
  const diaryEntries = useGameStore((s) => s.diaryEntries)

  const doneNodes = quests.reduce((sum, q) => sum + countDoneNodes(q.nodes), 0)
  const totalNodes = quests.reduce((sum, q) => sum + countTotalNodes(q.nodes), 0)
  const streak = calcDiaryStreak(diaryEntries)

  return (
    <PixelPanel bg="#FAF3E3" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-pixel text-xs text-wood-dark">成长概览</h2>
        <span className="pixel-border-sm bg-gold px-2 py-1 font-pixel text-[10px] text-ink">
          LV.{player.level}
        </span>
      </div>

      {/* XP 进度条 */}
      <div>
        <PixelProgressBar
          variant="xp"
          value={player.xp}
          max={player.xpToNext}
          segments={12}
          label="EXP"
        />
        <p className="mt-1 font-pixel text-[8px] text-stone-dark">
          再获得 {Math.max(0, player.xpToNext - player.xp)} XP 升级
        </p>
      </div>

      {/* 三项统计 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="pixel-border-sm flex flex-col items-center gap-1 bg-parchment px-1 py-2">
          <StatIcon
            src="/assets/ui/coin.png"
            alt="金币"
            fallbackClass="bg-gold text-ink"
            fallback="◆"
          />
          <span className="font-pixel text-xs text-gold-dark">{player.coins}</span>
          <span className="font-pixel text-[8px] text-stone-dark">金币</span>
        </div>

        <div className="pixel-border-sm flex flex-col items-center gap-1 bg-parchment px-1 py-2">
          <StatIcon
            src="/assets/ui/xp-star.png"
            alt="任务"
            fallbackClass="bg-moss text-parchment-light"
            fallback="★"
          />
          <span className="font-pixel text-xs text-moss-dark">
            {doneNodes}
            <span className="text-[8px] text-stone-dark">/{totalNodes}</span>
          </span>
          <span className="font-pixel text-[8px] text-stone-dark">已完成任务</span>
        </div>

        <div className="pixel-border-sm flex flex-col items-center gap-1 bg-parchment px-1 py-2">
          <span className="flex h-6 w-6 items-center justify-center text-sm leading-none">
            📖
          </span>
          <span className="font-pixel text-xs text-berry-dark">{streak} 天</span>
          <span className="font-pixel text-[8px] text-stone-dark">连续记录</span>
        </div>
      </div>
    </PixelPanel>
  )
}
