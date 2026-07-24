import { useGameStore } from '@/store/gameStore'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MiniMap } from './MiniMap'
import { PixelImage } from './PixelImage'
import {
  CHIMNEYS,
  FARM_CELLS,
  MAP_COLS,
  MAP_ROWS,
  NPC_META,
  PET_START,
  PLAYER_START,
  TILE,
  TILE_STYLE,
  TOWN_MAP,
  WORLD_H,
  WORLD_W,
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
const WALK_IDLE_MS = 240
const FEED_COST = 5
const HARVEST_COINS = 15

/** 云朵配置：缓慢漂移（世界层内，负 delay 让初始位置散开） */
const CLOUDS = [
  { top: 22, duration: 95, delay: -12, scale: 1 },
  { top: 74, duration: 130, delay: -68, scale: 1.5 },
  { top: 128, duration: 110, delay: -40, scale: 0.8 },
  { top: 44, duration: 150, delay: -110, scale: 1.2 },
  { top: 100, duration: 120, delay: -90, scale: 0.9 },
]

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 昼夜循环色调罩层（随真实时间，暖色系、无蓝紫） */
function dayNightBackground(date: Date): string {
  const t = date.getHours() + date.getMinutes() / 60
  if (t >= 5 && t < 7) {
    // 清晨：薄暖金
    return 'linear-gradient(rgba(228,170,96,0.14), rgba(200,122,62,0.10))'
  }
  if (t >= 7 && t < 16.5) return 'rgba(0,0,0,0)'
  if (t >= 16.5 && t < 19) {
    // 黄昏：暖橘渐变
    return 'linear-gradient(rgba(226,150,70,0.16), rgba(140,70,36,0.24))'
  }
  if (t >= 19 && t < 21) {
    // 入夜：暖褐加深
    return 'linear-gradient(rgba(92,52,32,0.26), rgba(42,28,22,0.34))'
  }
  // 夜晚：暖暗罩层
  return 'rgba(34,24,20,0.38)'
}

interface TownMapProps {
  /** 对话打开时暂停移动 */
  movementEnabled: boolean
  onNpcClick: (npcId: string) => void
}

/**
 * 全屏沉浸式小镇世界：24x16 可滚动大地图 + 镜头跟随玩家 +
 * 云 / 炊烟 / 昼夜氛围 + 左上角小地图（DOM overlay 风格）。
 */
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
  const [facing, setFacing] = useState<'left' | 'right'>('right')
  const [moving, setMoving] = useState(false)
  const [hearts, setHearts] = useState<number[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [now, setNow] = useState(() => new Date())

  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(playerPos)
  posRef.current = playerPos
  const heartSeq = useRef(0)
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 视口尺寸（镜头计算用）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 昼夜罩层每分钟刷新
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // 提示自动消失
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(id)
  }, [toast])

  /** 标记「行走中」，停顿片刻后恢复站立（驱动颠簸步行动效） */
  const pulseWalking = useCallback(() => {
    setMoving(true)
    if (walkTimer.current) clearTimeout(walkTimer.current)
    walkTimer.current = setTimeout(() => setMoving(false), WALK_IDLE_MS)
  }, [])

  useEffect(
    () => () => {
      if (walkTimer.current) clearTimeout(walkTimer.current)
    },
    [],
  )

  const movePlayer = useCallback(
    (dx: number, dy: number) => {
      setTarget(null)
      if (dx < 0) setFacing('left')
      else if (dx > 0) setFacing('right')
      setPlayerPos((cur) => {
        const next = { x: cur.x + dx, y: cur.y + dy }
        if (isBlocked(next)) return cur
        pulseWalking()
        return next
      })
    },
    [pulseWalking],
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
      if (dx < 0) setFacing('left')
      else if (dx > 0) setFacing('right')
      const step: Pos = dx !== 0 ? { x: cur.x + dx, y: cur.y } : { x: cur.x, y: cur.y + dy }
      if (isBlocked(step)) {
        setTarget(null)
        return
      }
      pulseWalking()
      setPlayerPos(step)
      if (step.x === target.x && step.y === target.y) setTarget(null)
    }, CLICK_STEP_MS)
    return () => clearInterval(id)
  }, [target, movementEnabled, pulseWalking])

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

  /** 世界层点击：换算世界坐标 → 格子，按 NPC / 宠物 / 农田 / 移动 优先级处理 */
  const handleWorldClick = (e: React.MouseEvent) => {
    const world = worldRef.current
    if (!world) return
    const rect = world.getBoundingClientRect()
    const pos: Pos = {
      x: Math.floor((e.clientX - rect.left) / TILE),
      y: Math.floor((e.clientY - rect.top) / TILE),
    }
    if (pos.x < 0 || pos.x >= MAP_COLS || pos.y < 0 || pos.y >= MAP_ROWS) return

    const npc = NPC_META.find((n) => n.pos.x === pos.x && n.pos.y === pos.y)
    if (npc) {
      onNpcClick(npc.id)
      return
    }
    if (pet.adopted && petPos.x === pos.x && petPos.y === pos.y) {
      handlePetClick()
      return
    }
    const farmIdx = FARM_CELLS.findIndex((c) => c.x === pos.x && c.y === pos.y)
    if (farmIdx >= 0) {
      handleFarmClick(farmIdx)
      return
    }
    if (!movementEnabled || isBlocked(pos)) return
    setTarget(pos)
  }

  // ----- 镜头：跟随玩家保持居中，边缘钳制 -----
  const camX =
    viewport.w <= 0
      ? 0
      : WORLD_W <= viewport.w
        ? (WORLD_W - viewport.w) / 2
        : clamp(playerPos.x * TILE + TILE / 2 - viewport.w / 2, 0, WORLD_W - viewport.w)
  const camY =
    viewport.h <= 0
      ? 0
      : WORLD_H <= viewport.h
        ? (WORLD_H - viewport.h) / 2
        : clamp(playerPos.y * TILE + TILE / 2 - viewport.h / 2, 0, WORLD_H - viewport.h)

  const entityStyle = (pos: Pos): CSSProperties => ({
    width: TILE,
    height: TILE,
    transform: `translate(${pos.x * TILE}px, ${pos.y * TILE}px)`,
    transition: `transform ${CLICK_STEP_MS}ms linear`,
  })

  return (
    <div
      ref={viewportRef}
      className="absolute inset-0 select-none overflow-hidden"
      role="application"
      aria-label="小镇世界，方向键或 WASD 移动，点击地面也可移动"
    >
      {/* 像素动效 keyframes（steps 保持 8bit 感） */}
      <style>{`
        @keyframes town-walk-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .town-walking { animation: town-walk-bob 0.26s steps(2, end) infinite; }
        @keyframes town-heart-float {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-28px); opacity: 0; }
        }
        .town-heart { animation: town-heart-float 0.9s steps(6, end) forwards; }
        @keyframes town-cloud-drift {
          from { transform: translateX(-360px); }
          to { transform: translateX(${WORLD_W + 360}px); }
        }
        .town-cloud-shape {
          width: 40px; height: 14px; background: #F4EBD4;
          box-shadow:
            14px -8px 0 0 #F4EBD4,
            28px -2px 0 0 #F4EBD4,
            6px 8px 0 0 #EDE3C8,
            22px 8px 0 0 #EDE3C8,
            36px 6px 0 0 #EDE3C8;
        }
        @keyframes town-smoke-rise {
          0% { transform: translate(0, 0) scale(1); opacity: 0; }
          15% { opacity: 0.55; }
          100% { transform: translate(6px, -54px) scale(1.7); opacity: 0; }
        }
        .town-smoke-puff { animation: town-smoke-rise 3.2s steps(8, end) infinite; }
      `}</style>

      {/* 世界层（镜头平移） */}
      <div
        ref={worldRef}
        onClick={handleWorldClick}
        className="absolute left-0 top-0 cursor-pointer"
        style={{
          width: WORLD_W,
          height: WORLD_H,
          transform: `translate3d(${-camX}px, ${-camY}px, 0)`,
          transition: `transform ${CLICK_STEP_MS}ms linear`,
          backgroundColor: TILE_STYLE.g.color,
        }}
      >
        {/* 地面格子 */}
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${MAP_COLS}, ${TILE}px)`, width: WORLD_W }}
        >
          {Array.from({ length: MAP_ROWS * MAP_COLS }).map((_, i) => {
            const x = i % MAP_COLS
            const y = Math.floor(i / MAP_COLS)
            const tile = TILE_STYLE[TOWN_MAP[y][x]]
            const farmIdx = FARM_CELLS.findIndex((c) => c.x === x && c.y === y)
            const plot = farmIdx >= 0 ? plots[farmIdx] : undefined
            const isTarget = target?.x === x && target?.y === y

            return (
              <div
                key={i}
                className="relative"
                style={{ width: TILE, height: TILE, backgroundColor: tile.color }}
              >
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
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    {plot ? (
                      <PixelImage
                        src={CROP_IMG[plot.stage]}
                        alt={`${plot.crop} 阶段${plot.stage}`}
                        className="h-4/5 w-4/5 object-contain"
                        fallbackClassName="h-4/5 w-4/5"
                        fallbackText={CROP_FALLBACK[plot.stage]}
                      />
                    ) : (
                      <span className="font-pixel text-[10px] text-parchment-dark">+</span>
                    )}
                    {plot?.stage === 2 && (
                      <div className="absolute inset-[3px] border-2 border-gold" />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 炊烟（房屋烟囱上升烟圈） */}
        {CHIMNEYS.map((c, i) => (
          <div
            key={i}
            className="pointer-events-none absolute z-20"
            style={{ left: (c.x + 0.5) * TILE - 3, top: c.y * TILE - 2 }}
          >
            {[0, 1, 2].map((k) => (
              <span
                key={k}
                className="town-smoke-puff absolute block h-[6px] w-[6px] bg-[#D9D0BC]"
                style={{ animationDelay: `${k * 1.1}s`, opacity: 0 }}
              />
            ))}
          </div>
        ))}

        {/* NPC（站在有意义的地点：房门口 / 市集 / 画室旁） */}
        {NPC_META.map((npc) => (
          <div key={npc.id} className="pointer-events-none absolute left-0 top-0 z-20" style={entityStyle(npc.pos)}>
            <div className="flex h-full w-full items-center justify-center">
              <PixelImage
                src={npc.img}
                alt="NPC"
                className="h-[42px] w-[42px] object-contain"
                fallbackClassName="h-[42px] w-[42px]"
                fallbackText="人"
              />
            </div>
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-parchment-light px-1 font-pixel text-[8px] leading-3 text-ink">
              {npc.id === 'elder' ? '长者' : npc.id === 'merchant' ? '商人' : '画师'}
            </span>
          </div>
        ))}

        {/* 宠物橘猫（点击喂食） */}
        {pet.adopted && (
          <div className="pointer-events-none absolute left-0 top-0 z-20" style={entityStyle(petPos)}>
            <div className="flex h-full w-full items-center justify-center">
              <PixelImage
                src="/assets/decor/cat.png"
                alt="橘猫"
                className="h-[38px] w-[38px] object-contain"
                fallbackClassName="h-[38px] w-[38px] bg-gold"
                fallbackText="🐈"
              />
            </div>
            {hearts.map((h) => (
              <span
                key={h}
                className="town-heart absolute -top-1 left-1/2 z-30 -translate-x-1/2 text-sm"
              >
                ❤️
              </span>
            ))}
          </div>
        )}

        {/* 玩家（步行颠簸 + 朝向翻转） */}
        <div className="pointer-events-none absolute left-0 top-0 z-30" style={entityStyle(playerPos)}>
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              transform: facing === 'left' ? 'scaleX(-1)' : 'none',
              transition: 'transform 120ms steps(2, end)',
            }}
          >
            <div className={moving ? 'town-walking' : undefined}>
              <PixelImage
                src={player.avatarUrl || '/assets/avatar/placeholder.png'}
                alt={player.name}
                className="h-[44px] w-[44px] object-contain"
                fallbackClassName="h-[44px] w-[44px] bg-berry"
                fallbackText="我"
              />
            </div>
          </div>
        </div>

        {/* 漂移的云朵（世界尺度，浮于场景之上） */}
        {CLOUDS.map((c, i) => (
          <div
            key={i}
            className="pointer-events-none absolute left-0 z-40"
            style={{
              top: c.top,
              animation: `town-cloud-drift ${c.duration}s linear infinite`,
              animationDelay: `${c.delay}s`,
              opacity: 0.75,
            }}
          >
            <div className="town-cloud-shape" style={{ transform: `scale(${c.scale})` }} />
          </div>
        ))}
      </div>

      {/* 昼夜循环色调罩层（暖黄昏 / 夜色，不拦截操作） */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ background: dayNightBackground(now), transition: 'background 3s linear' }}
      />

      {/* 左上角小地图（DOM overlay） */}
      <div className="absolute left-2 top-2 z-30">
        <MiniMap playerPos={playerPos} petPos={petPos} petAdopted={pet.adopted} />
      </div>

      {/* 场景内提示气泡 */}
      {toast && (
        <div className="pixel-border-sm pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 whitespace-nowrap bg-ink px-3 py-1 font-pixel text-[10px] text-parchment-light">
          {toast}
        </div>
      )}
    </div>
  )
}
