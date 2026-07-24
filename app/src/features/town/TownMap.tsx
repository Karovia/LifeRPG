import { useGameStore } from '@/store/gameStore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelImage } from './PixelImage'
import {
  FARM_CELLS,
  MAP_COLS,
  MAP_ROWS,
  NPC_META,
  PET_START,
  PLAYER_START,
  TILE_STYLE,
  TOWN_MAP,
  isBlocked,
  type Pos,
} from './townData'

/** 作物贴图（按生长阶段 0/1/2）与降级字符 */
const CROP_IMG = ['/assets/crop/seed.png', '/assets/crop/sprout.png', '/assets/crop/ripe.png']
const CROP_FALLBACK = ['·', '🌱', '🌾']
const CROP_NAMES = ['胡萝卜', '小麦', '番茄']

const KEY_DIRS: Record<string, Pos> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
}

const PET_WANDER_MS = 2400
const HUNGER_DECAY_MS = 20000
const CLICK_STEP_MS = 140
const FEED_COST = 5
const HARVEST_COINS = 15

interface TownMapProps {
  /** 对话打开时暂停移动 */
  movementEnabled: boolean
  onNpcClick: (npcId: string) => void
}

/** 俯视角像素小镇地图：键盘/点击移动、NPC、农田、宠物 */
export function TownMap({ movementEnabled, onNpcClick }: TownMapProps) {
  const player = useGameStore((s) => s.player)
  const plots = useGameStore((s) => s.town.garden.plots)
  const pet = useGameStore((s) => s.town.garden.pet)
  const plantCrop = useGameStore((s) => s.plantCrop)
  const advanceCropStage = useGameStore((s) => s.advanceCropStage)
  const harvestPlot = useGameStore((s) => s.harvestPlot)
  const feedPet = useGameStore((s) => s.feedPet)
  const addCoins = useGameStore((s) => s.addCoins)

  const [playerPos, setPlayerPos] = useState<Pos>(PLAYER_START)
  const [target, setTarget] = useState<Pos | null>(null)
  const [petPos, setPetPos] = useState<Pos>(PET_START)
  const [hearts, setHearts] = useState<number[]>([])
  const [toast, setToast] = useState<string | null>(null)

  const posRef = useRef(playerPos)
  posRef.current = playerPos
  const heartSeq = useRef(0)

  // 提示自动消失
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(id)
  }, [toast])

  const movePlayer = useCallback(
    (dx: number, dy: number) => {
      setTarget(null)
      setPlayerPos((cur) => {
        const next = { x: cur.x + dx, y: cur.y + dy }
        return isBlocked(next) ? cur : next
      })
    },
    [],
  )

  // 键盘移动（方向键 / WASD），输入框聚焦时不劫持；卸载清理
  useEffect(() => {
    if (!movementEnabled) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const dir = KEY_DIRS[e.key] ?? KEY_DIRS[e.key.toLowerCase()]
      if (!dir) return
      e.preventDefault()
      movePlayer(dir.x, dir.y)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [movementEnabled, movePlayer])

  // 点击移动：直线步进（先横后纵，遇阻即停，不做寻路）
  useEffect(() => {
    if (!target || !movementEnabled) return
    const id = setInterval(() => {
      const cur = posRef.current
      const dx = Math.sign(target.x - cur.x)
      const dy = Math.sign(target.y - cur.y)
      if (dx === 0 && dy === 0) {
        setTarget(null)
        return
      }
      const step: Pos = dx !== 0 ? { x: cur.x + dx, y: cur.y } : { x: cur.x, y: cur.y + dy }
      if (isBlocked(step)) {
        setTarget(null)
        return
      }
      setPlayerPos(step)
      if (step.x === target.x && step.y === target.y) setTarget(null)
    }, CLICK_STEP_MS)
    return () => clearInterval(id)
  }, [target, movementEnabled])

  // 宠物随机漫步
  useEffect(() => {
    if (!pet.adopted) return
    const id = setInterval(() => {
      setPetPos((cur) => {
        const options = [
          { x: cur.x + 1, y: cur.y },
          { x: cur.x - 1, y: cur.y },
          { x: cur.x, y: cur.y + 1 },
          { x: cur.x, y: cur.y - 1 },
        ].filter((p) => !isBlocked(p))
        if (options.length === 0) return cur
        return options[Math.floor(Math.random() * options.length)]
      })
    }, PET_WANDER_MS)
    return () => clearInterval(id)
  }, [pet.adopted])

  // 宠物饥饿随时间下降
  useEffect(() => {
    if (!pet.adopted) return
    const id = setInterval(() => feedPet(-3), HUNGER_DECAY_MS)
    return () => clearInterval(id)
  }, [pet.adopted, feedPet])

  // 农田点击：空→播种，未熟→浇水推进，成熟→收获
  const handleFarmClick = (cellIndex: number) => {
    const plot = plots[cellIndex]
    if (!plot) {
      plantCrop(CROP_NAMES[plots.length % CROP_NAMES.length])
      setToast('播种成功！再点击浇水让它长大')
      return
    }
    if (plot.stage < 2) {
      advanceCropStage(plot.id)
      setToast(plot.stage === 0 ? '浇水中……发芽了！' : '浇水中……作物成熟了！')
      return
    }
    harvestPlot(plot.id)
    addCoins(HARVEST_COINS)
    setToast(`收获「${plot.crop}」 +${HARVEST_COINS} 金币`)
  }

  // 喂食：点击猫咪，花少量金币 + 爱心动效
  const handlePetClick = () => {
    if (player.coins < FEED_COST) {
      setToast(`金币不足，喂食需要 ${FEED_COST} 金币`)
      return
    }
    addCoins(-FEED_COST)
    feedPet(20)
    heartSeq.current += 1
    const id = heartSeq.current
    setHearts((h) => [...h, id])
    setTimeout(() => setHearts((h) => h.filter((x) => x !== id)), 900)
  }

  const handleCellClick = (pos: Pos) => {
    const farmIdx = FARM_CELLS.findIndex((c) => c.x === pos.x && c.y === pos.y)
    if (farmIdx >= 0) {
      handleFarmClick(farmIdx)
      return
    }
    if (!movementEnabled || isBlocked(pos)) return
    setTarget(pos)
  }

  const npcAt = (pos: Pos) => NPC_META.find((n) => n.pos.x === pos.x && n.pos.y === pos.y)
  const farmIndexAt = (pos: Pos) => FARM_CELLS.findIndex((c) => c.x === pos.x && c.y === pos.y)

  return (
    <div className="relative">
      {/* 爱心飘浮动效（steps 保持像素感） */}
      <style>{`
        @keyframes town-heart-float {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-28px); opacity: 0; }
        }
        .town-heart { animation: town-heart-float 0.9s steps(6, end) forwards; }
      `}</style>

      <div
        className="pixel-border m-1 grid w-full select-none"
        style={{
          gridTemplateColumns: `repeat(${MAP_COLS}, 1fr)`,
          aspectRatio: `${MAP_COLS} / ${MAP_ROWS}`,
        }}
        role="application"
        aria-label="小镇地图，方向键或 WASD 移动，点击格子也可移动"
      >
        {Array.from({ length: MAP_ROWS * MAP_COLS }).map((_, i) => {
          const pos: Pos = { x: i % MAP_COLS, y: Math.floor(i / MAP_COLS) }
          const code = TOWN_MAP[pos.y][pos.x]
          const tile = TILE_STYLE[code]
          const npc = npcAt(pos)
          const farmIdx = farmIndexAt(pos)
          const plot = farmIdx >= 0 ? plots[farmIdx] : undefined
          const isPlayer = playerPos.x === pos.x && playerPos.y === pos.y
          const isPet = pet.adopted && petPos.x === pos.x && petPos.y === pos.y
          const isTarget = target?.x === pos.x && target?.y === pos.y

          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              onClick={() => handleCellClick(pos)}
              className="relative block cursor-pointer p-0"
              style={{ backgroundColor: tile.color }}
              aria-label={`格子 ${pos.x},${pos.y}`}
            >
              {/* 地面贴图（农田格无底图，纯土色） */}
              {tile.img && (
                <PixelImage
                  src={tile.img}
                  alt=""
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  fallbackClassName="pointer-events-none absolute inset-0"
                  fallbackText=""
                />
              )}

              {/* 点击目标指示 */}
              {isTarget && (
                <div className="pointer-events-none absolute inset-1 z-10 border-2 border-dashed border-gold" />
              )}

              {/* 农田内容 */}
              {farmIdx >= 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  {plot ? (
                    <PixelImage
                      src={CROP_IMG[plot.stage]}
                      alt={`${plot.crop} 阶段${plot.stage}`}
                      className="h-4/5 w-4/5 object-contain"
                      fallbackClassName="h-4/5 w-4/5"
                      fallbackText={CROP_FALLBACK[plot.stage]}
                    />
                  ) : (
                    <span className="font-pixel text-[8px] text-parchment-dark">+</span>
                  )}
                  {plot?.stage === 2 && (
                    <div className="pointer-events-none absolute inset-[3px] border-2 border-gold" />
                  )}
                </div>
              )}

              {/* NPC */}
              {npc && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onNpcClick(npc.id)
                  }}
                  className="absolute inset-0 z-20 flex cursor-pointer items-center justify-center"
                  aria-label="与 NPC 对话"
                >
                  <PixelImage
                    src={npc.img}
                    alt="NPC"
                    className="h-4/5 w-4/5 object-contain"
                    fallbackClassName="h-4/5 w-4/5"
                    fallbackText="人"
                  />
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-parchment-light px-1 font-pixel text-[8px] leading-3 text-ink">
                    {npc.id === 'elder' ? '长者' : npc.id === 'merchant' ? '商人' : '画师'}
                  </span>
                </span>
              )}

              {/* 宠物橘猫（点击喂食） */}
              {isPet && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePetClick()
                  }}
                  className="absolute inset-0 z-20 flex cursor-pointer items-center justify-center"
                  aria-label={`喂食${pet.name || '猫咪'}`}
                >
                  <PixelImage
                    src="/assets/decor/cat.png"
                    alt="橘猫"
                    className="h-4/5 w-4/5 object-contain"
                    fallbackClassName="h-4/5 w-4/5 bg-gold"
                    fallbackText="🐈"
                  />
                  {hearts.map((h) => (
                    <span
                      key={h}
                      className="town-heart pointer-events-none absolute -top-1 left-1/2 z-30 -translate-x-1/2 text-sm"
                    >
                      ❤️
                    </span>
                  ))}
                </span>
              )}

              {/* 玩家 */}
              {isPlayer && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                  <PixelImage
                    src={player.avatarUrl || '/assets/avatar/placeholder.png'}
                    alt={player.name}
                    className="h-[90%] w-[90%] object-contain"
                    fallbackClassName="h-[90%] w-[90%] bg-berry"
                    fallbackText="我"
                  />
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 地图内提示气泡 */}
      {toast && (
        <div className="pixel-border-sm pointer-events-none absolute left-1/2 top-2 z-40 -translate-x-1/2 whitespace-nowrap bg-ink px-3 py-1 font-pixel text-[10px] text-parchment-light">
          {toast}
        </div>
      )}
    </div>
  )
}
