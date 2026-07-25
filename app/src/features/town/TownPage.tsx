import { PixelButton } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { BuildPanel, type BuildTool } from './BuildPanel'
import { GardenPanel } from './GardenPanel'
import { NpcDialog } from './NpcDialog'
import { PixelImage } from './PixelImage'
import { TownMap } from './TownMap'
import type { CropId } from './townData'

/** 天气按日轮换（确定性，纯前端氛围） */
const WEATHERS = [
  { label: '晴', icon: '☀️' },
  { label: '多云', icon: '⛅' },
  { label: '小雨', icon: '🌧️' },
]

/** 时段名（与 TownMap 的昼夜罩层同节律） */
function dayPhase(date: Date): string {
  const t = date.getHours() + date.getMinutes() / 60
  if (t >= 5 && t < 7) return '清晨'
  if (t >= 7 && t < 16.5) return '白天'
  if (t >= 16.5 && t < 19) return '黄昏'
  return '夜晚'
}

/**
 * 职见小镇 · 全屏沉浸式像素世界（参考 peteroravec.com：
 * 整个页面即游戏世界，UI 以 DOM 覆盖层浮在场景之上）。
 */
export default function TownPage() {
  const [activeNpcId, setActiveNpcId] = useState<string | null>(null)
  const [gardenOpen, setGardenOpen] = useState(false)
  /** 当前选中的种子（家园抽屉切换，TownMap 播种时读取） */
  const [selectedSeed, setSelectedSeed] = useState<CropId>('carrot')
  /** 建设模式：HUD「🔨 建设」切换；底部滑出建设面板，点击世界转为放置/拆除 */
  const [buildMode, setBuildMode] = useState(false)
  const [buildTool, setBuildTool] = useState<BuildTool | null>(null)
  const navigate = useNavigate()
  const coins = useGameStore((s) => s.player.coins)

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const weather = WEATHERS[Math.floor(now.getTime() / 86400000) % WEATHERS.length]
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const exitBuildMode = () => {
    setBuildMode(false)
    setBuildTool(null)
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-[#97A872]">
      {/* 全屏游戏场景（镜头跟随玩家，含小地图 / 云 / 炊烟 / 昼夜罩层） */}
      <TownMap
        movementEnabled={!activeNpcId}
        onNpcClick={setActiveNpcId}
        selectedSeed={selectedSeed}
        buildMode={buildMode}
        buildTool={buildTool}
      />

      {/* 右上角 HUD：时段·天气徽章 / 金币 / 建设 / 家园 / 离开 */}
      <div className="absolute right-2 top-2 z-30 flex flex-col items-end gap-1">
        <div className="pixel-border-sm m-1 flex items-center gap-2 bg-parchment-light px-2 py-1">
          <span className="font-pixel text-[10px] text-ink">{hhmm}</span>
          <span className="font-pixel text-[9px] text-wood-dark">{dayPhase(now)}</span>
          <span className="text-[11px] leading-none" aria-hidden>
            {weather.icon}
          </span>
          <span className="font-pixel text-[9px] text-stone-dark">{weather.label}</span>
        </div>

        <div className="pixel-border-sm m-1 flex items-center gap-1 bg-parchment-light px-2 py-1">
          <PixelImage
            src="/assets/ui/coin.png"
            alt="金币"
            className="h-4 w-4"
            fallbackClassName="h-4 w-4 bg-gold"
            fallbackText=""
          />
          <span className="font-pixel text-[10px] text-gold-dark">{coins}</span>
        </div>

        <div className="flex items-center">
          <PixelButton
            variant={buildMode ? 'gold' : 'moss'}
            onClick={() => (buildMode ? exitBuildMode() : setBuildMode(true))}
          >
            {buildMode ? '建设中' : '🔨 建设'}
          </PixelButton>
          <PixelButton variant="moss" onClick={() => setGardenOpen((v) => !v)}>
            家园
          </PixelButton>
          <PixelButton variant="wood" onClick={() => navigate('/')}>
            离开
          </PixelButton>
        </div>
      </div>

      {/* 操作提示（底部，对话 / 建设面板打开时让位） */}
      {!activeNpcId && !buildMode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center px-3">
          <div className="pixel-border-sm m-1 bg-ink/80 px-3 py-1 text-center font-pixel text-[9px] leading-4 text-parchment-light">
            方向键 / WASD 或点击地面移动 · 点 NPC 聊天 · 点农田耕种 · 点水塘/码头钓鱼 · 点猫咪喂食 · 「🔨 建设」盖房铺路
          </div>
        </div>
      )}

      {/* 家园抽屉（右侧 overlay） */}
      {gardenOpen && (
        <GardenPanel
          onClose={() => setGardenOpen(false)}
          selectedSeed={selectedSeed}
          onSelectSeed={setSelectedSeed}
        />
      )}

      {/* 建设面板（底部滑出 overlay；建设中行走保留，点击用于放置/拆除） */}
      {buildMode && (
        <BuildPanel buildTool={buildTool} onSelectTool={setBuildTool} onClose={exitBuildMode} />
      )}

      {/* NPC 对话条（底部滑入 overlay） */}
      {activeNpcId && (
        <NpcDialog npcId={activeNpcId} onClose={() => setActiveNpcId(null)} />
      )}
    </div>
  )
}
