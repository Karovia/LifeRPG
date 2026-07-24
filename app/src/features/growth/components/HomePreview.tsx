import { PixelPanel } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { getDecoration } from '../data/decorations'
import { PixelImg } from './PixelImg'

/**
 * 家园预览区：已拥有的装饰品平铺在小屋背景上（简单绝对定位）。
 * 背景 /assets/bg/town.png 未就绪时降级为羊皮纸色块 + 像素地面。
 */
export function HomePreview() {
  const ownedIds = useGameStore((s) => s.inventory.decorations)
  const owned = ownedIds
    .map((id) => getDecoration(id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined)

  return (
    <PixelPanel bg="#FAF3E3" className="space-y-2">
      <h2 className="font-pixel text-xs text-wood-dark">我的小屋</h2>

      <div className="pixel-border-sm relative h-48 overflow-hidden bg-parchment-dark">
        {/* 背景图（素材缺失时整块隐藏，露出底色） */}
        <PixelImg
          src="/assets/bg/town.png"
          alt="小屋背景"
          className="absolute inset-0 h-full w-full object-cover"
          fallback={
            <>
              {/* 降级背景：天空 + 像素地面 */}
              <div className="absolute inset-0 bg-parchment" />
              <div className="absolute inset-x-0 bottom-0 h-10 bg-moss" />
              <div className="absolute inset-x-0 bottom-10 h-2 bg-moss-dark" />
            </>
          }
        />

        {owned.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
            <p className="font-pixel text-[8px] leading-relaxed text-stone-dark">
              小屋还空空的……
              <br />
              去商店兑换第一件装饰品吧！
            </p>
          </div>
        ) : (
          owned.map((d) => (
            <div
              key={d.id}
              className="absolute flex items-center justify-center"
              style={{
                left: d.homeSpot.left,
                top: d.homeSpot.top,
                width: d.homeSize,
                height: d.homeSize,
              }}
              title={d.name}
            >
              <PixelImg
                src={`/assets/decor/${d.id}.png`}
                alt={d.name}
                className="h-full w-full object-contain"
                fallback={
                  <span
                    style={{ fontSize: d.homeSize * 0.7 }}
                    className="leading-none"
                    role="img"
                    aria-label={d.name}
                  >
                    {d.emoji}
                  </span>
                }
              />
            </div>
          ))
        )}
      </div>

      <p className="font-pixel text-[8px] text-stone-dark">
        已摆放 {owned.length} / 5 件装饰品
      </p>
    </PixelPanel>
  )
}
