import { PixelButton, PixelPanel, PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { useState } from 'react'
import { NpcDialog } from './NpcDialog'
import { TownMap } from './TownMap'

const ADOPT_COST = 50

/** 家园面板：农田说明 + 宠物领养/状态 */
function GardenPanel() {
  const plots = useGameStore((s) => s.town.garden.plots)
  const pet = useGameStore((s) => s.town.garden.pet)
  const coins = useGameStore((s) => s.player.coins)
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
    <PixelPanel className="flex flex-col gap-2">
      <div className="font-pixel text-xs text-ink">家园养成</div>

      {/* 农田 */}
      <div className="pixel-border-sm m-1 bg-parchment-dark p-2">
        <div className="mb-1 font-pixel text-[10px] text-wood-dark">
          农田（{plots.length}/4）
        </div>
        <p className="text-[11px] leading-4 text-stone-dark">
          点击地图右下角的农田：空地播种 → 再点浇水生长 → 成熟（金框）收获 +15 金币。
        </p>
        {plots.length > 0 && (
          <div className="mt-1 font-pixel text-[9px] text-stone">
            {plots
              .map((p) => `${p.crop}·${['种子', '幼苗', '成熟'][p.stage]}`)
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
              橘猫「{pet.name}」正在小镇里散步，点击地图上的它喂食（-5 金币，+20 饱食度）。
            </div>
            <PixelProgressBar
              variant="xp"
              value={pet.hunger}
              max={100}
              segments={10}
              label="饱食度"
              className="max-w-48"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-stone-dark">
              一只橘猫在镇口徘徊，领养它会在小镇里散步。
            </span>
            <PixelButton variant="gold" onClick={handleAdopt}>
              领养 {ADOPT_COST} 金币
            </PixelButton>
          </div>
        )}
        {hint && <div className="mt-1 font-pixel text-[9px] text-berry">{hint}</div>}
      </div>
    </PixelPanel>
  )
}

/** 小镇页：俯视角像素小镇（NPC 好感 / 委托 / 种植 / 宠物） */
export default function TownPage() {
  const [activeNpcId, setActiveNpcId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-1">
      <PixelPanel className="p-3" bg="#97A872">
        <div className="font-pixel text-sm text-parchment-light">职见小镇</div>
        <p className="mt-1 font-pixel text-[9px] leading-4 text-parchment">
          方向键 / WASD 或点击格子移动 · 点击 NPC 聊天 · 点击农田耕种 · 点击猫咪喂食
        </p>
      </PixelPanel>

      <TownMap movementEnabled={!activeNpcId} onNpcClick={setActiveNpcId} />

      {activeNpcId ? (
        <NpcDialog npcId={activeNpcId} onClose={() => setActiveNpcId(null)} />
      ) : (
        <GardenPanel />
      )}
    </div>
  )
}
