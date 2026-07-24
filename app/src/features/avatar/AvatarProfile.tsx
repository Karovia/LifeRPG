import { PixelButton, PixelPanel, PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { PixelAvatar } from './PixelAvatar'

interface AvatarProfileProps {
  /** 点击「重新生成」 */
  onRegenerate: () => void
}

/** 已有形象的查看页：展示当前像素化身与冒险者信息 */
export default function AvatarProfile({ onRegenerate }: AvatarProfileProps) {
  const player = useGameStore((s) => s.player)

  return (
    <div className="space-y-2">
      <PixelPanel className="text-center">
        <h1 className="font-pixel text-xs text-wood-dark">冒险者档案</h1>

        {/* 形象大图（像素化放大） */}
        <div className="mt-4 flex justify-center">
          <div className="pixel-border bg-parchment-dark p-2">
            <PixelAvatar src={player.avatarUrl} alt={player.name} className="h-44 w-44" />
          </div>
        </div>

        <div className="mt-4 flex items-baseline justify-center gap-2">
          <span className="font-pixel text-sm text-ink">{player.name}</span>
          <span className="font-pixel text-[10px] text-wood-dark">LV.{player.level}</span>
        </div>

        {/* XP 进度 */}
        <div className="mx-auto mt-3 max-w-56">
          <PixelProgressBar variant="xp" value={player.xp} max={player.xpToNext} segments={12} />
          <p className="mt-1 font-pixel text-[9px] text-stone-dark">
            XP {player.xp} / {player.xpToNext}
          </p>
        </div>

        <div className="mt-5 flex justify-center">
          <PixelButton variant="gold" onClick={onRegenerate}>
            ↻ 重新生成形象
          </PixelButton>
        </div>
      </PixelPanel>

      <PixelPanel bg="#E4D5B8" className="text-center">
        <p className="text-xs leading-relaxed text-stone-dark">
          💡 提示：重新生成会保留你的名字与等级，
          <br />
          只重新绘制像素形象。
        </p>
      </PixelPanel>
    </div>
  )
}
