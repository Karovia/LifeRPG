import { PixelButton, PixelPanel, PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { useState } from 'react'
import { PixelImage } from './PixelImage'
import { CROP_LIST, DECOR_ITEMS, cropDef, type CropId } from './townData'

const ADOPT_COST = 50

interface GardenPanelProps {
  onClose: () => void
  /** 当前选中的种子（提升到 TownPage，与 TownMap 共享） */
  selectedSeed: CropId
  onSelectSeed: (seed: CropId) => void
}

/** 家园抽屉（右侧滑入 overlay）：种子选择 + 农田状态 + 橘猫 + 我的庭院 */
export function GardenPanel({ onClose, selectedSeed, onSelectSeed }: GardenPanelProps) {
  const plots = useGameStore((s) => s.town.garden.plots)
  const pet = useGameStore((s) => s.town.garden.pet)
  const coins = useGameStore((s) => s.player.coins)
  const decorations = useGameStore((s) => s.inventory.decorations)
  const adoptPet = useGameStore((s) => s.adoptPet)
  const addCoins = useGameStore((s) => s.addCoins)
  const [hint, setHint] = useState<string | null>(null)

  const handleAdopt = () => {
    if (coins < ADOPT_COST) {
      setHint(`金币不足，领养需要 ${ADOPT_COST} 金币（可完成委托或收获作物赚取）`)
      return
    }
    addCoins(-ADOPT_COST)
    adoptPet('橘子')
    setHint('橘猫「橘子」入住小镇！点击地图上的它可以喂食')
  }

  return (
    <div className="absolute bottom-3 right-3 top-16 z-40 w-60 max-w-[calc(100vw-24px)]">
      {/* 右侧滑入动效 */}
      <style>{`
        @keyframes town-drawer-in {
          from { transform: translateX(110%); }
          to { transform: translateX(0); }
        }
        .town-drawer-in { animation: town-drawer-in 0.26s steps(7, end) both; }
      `}</style>

      <PixelPanel className="town-drawer-in flex h-full flex-col gap-2 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="font-pixel text-xs text-ink">家园养成</div>
          <PixelButton variant="berry" onClick={onClose} aria-label="关闭家园面板">
            收起
          </PixelButton>
        </div>

        {/* 种子选择（点空地农田时播种当前选中的种子） */}
        <div className="pixel-border-sm m-1 bg-parchment-dark p-2">
          <div className="mb-1 font-pixel text-[10px] text-wood-dark">种子选择</div>
          <div className="flex flex-col gap-1">
            {CROP_LIST.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectSeed(c.id)}
                className={`pixel-border-sm m-[2px] flex items-center gap-2 px-2 py-1 text-left ${
                  selectedSeed === c.id
                    ? 'bg-gold/40 text-ink'
                    : 'bg-parchment-light text-stone-dark'
                }`}
              >
                <PixelImage
                  src={c.ripeImg}
                  alt={c.name}
                  className="h-6 w-6 object-contain"
                  fallbackClassName="h-6 w-6 bg-moss"
                  fallbackText={c.name.slice(0, 1)}
                />
                <span className="flex-1 font-pixel text-[10px] leading-4">
                  {c.name}
                  <span className="ml-1 text-[9px] text-stone">
                    {c.cost > 0 ? `成本 ${c.cost}` : '免费'} · 浇水×{c.waterings * 2} · 收{' '}
                    {c.reward}
                  </span>
                </span>
                {selectedSeed === c.id && <span className="text-[10px]">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 农田 */}
        <div className="pixel-border-sm m-1 bg-parchment-dark p-2">
          <div className="mb-1 font-pixel text-[10px] text-wood-dark">
            农田（{plots.length}/4）
          </div>
          <p className="text-[11px] leading-4 text-stone-dark">
            点击右下农田区：空地播种当前种子 → 再点浇水生长 → 成熟（金框）收获金币。每格操作有
            2.5s 冷却。
          </p>
          {plots.length > 0 && (
            <div className="mt-1 font-pixel text-[9px] text-stone">
              {plots
                .map((p) => `${cropDef(p.crop).name}·${['种子', '幼苗', '成熟'][p.stage]}`)
                .join('　')}
            </div>
          )}
        </div>

        {/* 宠物 */}
        <div className="pixel-border-sm m-1 bg-parchment-dark p-2">
          <div className="mb-1 font-pixel text-[10px] text-wood-dark">宠物</div>
          {pet.adopted ? (
            <div className="flex flex-col gap-1">
              <div className="text-[11px] text-stone-dark">
                橘猫「{pet.name}」正在小镇里漫步，点击地图上的它喂食（-5 金币，+20 饱食度）。
              </div>
              <PixelProgressBar
                variant="xp"
                value={pet.hunger}
                max={100}
                segments={10}
                label="饱食度"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-stone-dark">
                一只橘猫在镇口徘徊，领养它会在小镇里散步。
              </span>
              <div>
                <PixelButton variant="gold" onClick={handleAdopt}>
                  领养 {ADOPT_COST} 金币
                </PixelButton>
              </div>
            </div>
          )}
          {hint && <div className="mt-1 font-pixel text-[9px] text-berry">{hint}</div>}
        </div>

        {/* 我的庭院：已拥有装饰品像素图陈列（找商人购买） */}
        <div className="pixel-border-sm m-1 bg-parchment-dark p-2">
          <div className="mb-1 font-pixel text-[10px] text-wood-dark">
            我的庭院（{decorations.length}）
          </div>
          {decorations.length === 0 ? (
            <p className="text-[11px] leading-4 text-stone-dark">
              还没有装饰品。去杂货铺找商人聊聊，「商店」页签里有好东西。
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1">
              {decorations.map((id) => {
                const item = DECOR_ITEMS.find((d) => d.id === id)
                if (!item) return null
                return (
                  <div
                    key={id}
                    className="pixel-border-sm m-[2px] flex flex-col items-center bg-parchment-light p-1"
                    title={item.name}
                  >
                    <PixelImage
                      src={item.img}
                      alt={item.name}
                      className="h-8 w-8 object-contain"
                      fallbackClassName="h-8 w-8 bg-wood"
                      fallbackText={item.name.slice(0, 1)}
                    />
                    <span className="font-pixel text-[8px] leading-3 text-stone-dark">
                      {item.name}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PixelPanel>
    </div>
  )
}
