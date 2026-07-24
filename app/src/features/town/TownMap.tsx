import { useGameStore } from '@/store/gameStore'
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { MiniMap } from './MiniMap'
import { FrameAnim } from './FrameAnim'
import { PixelImage } from './PixelImage'
import {
  BUILDINGS,
  CAT_WALK_FRAMES,
  CROPS,
  DOCK_POS,
  FARM_CELLS,
  MAP_COLS,
  MAP_ROWS,
  NPC_META,
  PET_START,
  PLAYER_START,
  TILE,
  TILE_STYLE,
  TOWN_MAP,
  WATER_FRAMES,
  WORLD_H,
  WORLD_W,
  cropDef,
  isBlocked,
  isFlowerGrass,
  type CropId,
  type Pos,
} from './townData'

/** 作物生长阶段 0/1 的共用贴图与降级字符（成熟贴图按作物种类区分） */
const CROP_STAGE_IMG = ['/assets/crop/seed.png', '/assets/crop/sprout.png']
const CROP_FALLBACK = ['·', '🌱', '🌾']

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
/** 农田格操作冷却：点击后 2.5s 内该格忽略再次点击（修连点重复领奖 bug） */
const FARM_COOLDOWN_MS = 2500
/** 钓鱼：抛竿后 2-6s 随机上钩，上钩后 1.2s 内收竿，结束后 3s 冷却 */
const FISH_BITE_MIN_MS = 2000
const FISH_BITE_SPAN_MS = 4000
const FISH_REEL_WINDOW_MS = 1200
const FISH_COOLDOWN_MS = 3000

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

/** 昼夜循环色调罩层（随真实时间，暖色系、无蓝紫；新美术细节更丰富，罩层调柔和不压住画面） */
function dayNightBackground(date: Date): string {
  const t = date.getHours() + date.getMinutes() / 60
  if (t >= 5 && t < 7) {
    // 清晨：薄暖金
    return 'linear-gradient(rgba(228,170,96,0.12), rgba(200,122,62,0.09))'
  }
  if (t >= 7 && t < 16.5) return 'rgba(0,0,0,0)'
  if (t >= 16.5 && t < 19) {
    // 黄昏：暖橘渐变
    return 'linear-gradient(rgba(226,150,70,0.14), rgba(140,70,36,0.20))'
  }
  if (t >= 19 && t < 21) {
    // 入夜：暖褐加深
    return 'linear-gradient(rgba(92,52,32,0.22), rgba(42,28,22,0.30))'
  }
  // 夜晚：暖暗罩层
  return 'rgba(34,24,20,0.33)'
}

/**
 * 地面层（静态，memo 后只渲染一次）：
 * 每格先铺 grass 基底（约 13% 种子确定性替换 grass2 野花变体），
 * 再按地块码叠加 path / field / fence / lamp / 水面帧动画。
 */
const GroundLayer = memo(function GroundLayer() {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${MAP_COLS}, ${TILE}px)`, width: WORLD_W }}
    >
      {Array.from({ length: MAP_ROWS * MAP_COLS }).map((_, i) => {
        const x = i % MAP_COLS
        const y = Math.floor(i / MAP_COLS)
        const code = TOWN_MAP[y][x]
        const style = TILE_STYLE[code]
        return (
          <div
            key={i}
            className="relative"
            style={{ width: TILE, height: TILE, backgroundColor: TILE_STYLE.g.color }}
          >
            {/* 草地基底（g 格直接是基底；其他地块码也先铺草地再叠装饰/路面） */}
            <PixelImage
              src={isFlowerGrass(x, y) ? '/assets/tiles/grass2.png' : TILE_STYLE.g.img!}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full"
              fallbackClassName="pointer-events-none absolute inset-0"
              fallbackText=""
            />
            {code === 'w' ? (
              /* 水面：帧动画（降级链：water 帧 → tiles/water.png → 底色块） */
              <FrameAnim
                frames={WATER_FRAMES}
                fps={4}
                fallbackImg="/assets/tiles/water.png"
                alt="水面"
                className="pointer-events-none absolute inset-0 h-full w-full"
                fallbackClassName="pointer-events-none absolute inset-0"
                fallbackStyle={{ backgroundColor: style.color }}
                fallbackText=""
              />
            ) : (
              code !== 'g' &&
              style.img && (
                <PixelImage
                  src={style.img}
                  alt=""
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  fallbackClassName="pointer-events-none absolute inset-0"
                  fallbackText=""
                />
              )
            )}
          </div>
        )
      })}
    </div>
  )
})

/**
 * 多格建筑层（静态，memo 后只渲染一次）：
 * 每个建筑是一张跨格精灵图，底边与 footprint 底边对齐，
 * 向上可悬挑 spriteUp 格（屋顶/树冠），y 排序按 footprint 底边。
 */
const BuildingLayer = memo(function BuildingLayer() {
  return (
    <>
      {BUILDINGS.map((b) => {
        const spriteUp = b.spriteUp ?? 0
        const spriteH = (b.h + spriteUp) * TILE
        const spriteW = b.w * TILE
        return (
          <div
            key={b.id}
            className="pointer-events-none absolute"
            style={{
              left: b.x * TILE,
              top: (b.y + b.h) * TILE - spriteH,
              width: spriteW,
              height: spriteH,
              zIndex: 10 + b.y + b.h - 1,
            }}
          >
            <PixelImage
              src={b.img}
              alt={b.fallbackText}
              className="h-full w-full object-contain"
              fallbackClassName="h-full w-full bg-wood"
              fallbackText={b.fallbackText}
            />
          </div>
        )
      })}

      {/* 炊烟（有烟囱的建筑，精灵顶部偏右；z 高于所有 y 排序实体） */}
      {BUILDINGS.filter((b) => b.chimney).map((b) => {
        const spriteUp = b.spriteUp ?? 0
        const spriteTop = (b.y + b.h) * TILE - (b.h + spriteUp) * TILE
        return (
          <div
            key={`${b.id}-smoke`}
            className="pointer-events-none absolute z-30"
            style={{ left: (b.x + b.w * 0.68) * TILE, top: spriteTop + 4 }}
          >
            {[0, 1, 2].map((k) => (
              <span
                key={k}
                className="town-smoke-puff absolute block h-[6px] w-[6px] bg-[#D9D0BC]"
                style={{ animationDelay: `${k * 1.1}s`, opacity: 0 }}
              />
            ))}
          </div>
        )
      })}
    </>
  )
})

/** 钓鱼状态机：idle → waiting（2-6s）→ bite（1.2s 窗口）→ cooldown（3s）→ idle */
type FishingState =
  | { phase: 'idle' }
  | { phase: 'waiting'; spot: Pos }
  | { phase: 'bite'; spot: Pos }
  | { phase: 'cooldown' }

interface FishPop {
  id: number
  spot: Pos
  gain: number
}

interface TownMapProps {
  /** 对话打开时暂停移动 */
  movementEnabled: boolean
  onNpcClick: (npcId: string) => void
  /** 当前选中的种子（家园抽屉里切换） */
  selectedSeed: CropId
}

/**
 * 全屏沉浸式小镇世界：24x16 可滚动大地图 + 镜头跟随玩家 +
 * 多格建筑 / 云 / 炊烟 / 昼夜氛围 + 钓鱼 + 多种作物农田 + 左上角小地图。
 */
export function TownMap({ movementEnabled, onNpcClick, selectedSeed }: TownMapProps) {
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
  const [petFacing, setPetFacing] = useState<'left' | 'right'>('right')
  /** 猫咪位移后短暂播放行走帧，随后停回第 0 帧 */
  const [petMoving, setPetMoving] = useState(false)
  const [facing, setFacing] = useState<'left' | 'right'>('right')
  const [moving, setMoving] = useState(false)
  const [hearts, setHearts] = useState<number[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [now, setNow] = useState(() => new Date())
  /** 农田格冷却表：cellIndex → 冷却截止时刻（ms）；冷却中该格变暗并忽略点击 */
  const [farmCooldowns, setFarmCooldowns] = useState<Record<number, number>>({})
  const [fishing, setFishing] = useState<FishingState>({ phase: 'idle' })
  /** 钓到鱼的上浮动效（鱼图标 + 金币数） */
  const [fishPops, setFishPops] = useState<FishPop[]>([])

  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(playerPos)
  posRef.current = playerPos
  const petPosRef = useRef(petPos)
  petPosRef.current = petPos
  const petSeenRef = useRef(false)
  const heartSeq = useRef(0)
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 农田浇水进度：plotId:stage → 已浇水次数（跨阶段不清，成熟/收获后键自然失效） */
  const waterProgressRef = useRef<Record<string, number>>({})
  /** 钓鱼计时器（卸载时统一清理） */
  const biteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fishCooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fishingRef = useRef(fishing)
  fishingRef.current = fishing
  const fishPopSeq = useRef(0)

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
      if (biteTimer.current) clearTimeout(biteTimer.current)
      if (reelTimer.current) clearTimeout(reelTimer.current)
      if (fishCooldownTimer.current) clearTimeout(fishCooldownTimer.current)
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

  // 宠物随机漫步（顺带记录朝向，驱动行走帧翻转）
  useEffect(() => {
    if (!pet.adopted) return
    const id = setInterval(() => {
      const cur = petPosRef.current
      const options = [
        { x: cur.x + 1, y: cur.y },
        { x: cur.x - 1, y: cur.y },
        { x: cur.x, y: cur.y + 1 },
        { x: cur.x, y: cur.y - 1 },
      ].filter((p) => !isBlocked(p))
      if (options.length === 0) return
      const next = options[Math.floor(Math.random() * options.length)]
      if (next.x < cur.x) setPetFacing('left')
      else if (next.x > cur.x) setPetFacing('right')
      setPetPos(next)
    }, PET_WANDER_MS)
    return () => clearInterval(id)
  }, [pet.adopted])

  // 猫咪位移 → 播放一小段行走动画（首次挂载不算）
  useEffect(() => {
    if (!petSeenRef.current) {
      petSeenRef.current = true
      return
    }
    setPetMoving(true)
    const id = setTimeout(() => setPetMoving(false), 900)
    return () => clearTimeout(id)
  }, [petPos])

  // 宠物饥饿随时间下降
  useEffect(() => {
    if (!pet.adopted) return
    const id = setInterval(() => feedPet(-3), HUNGER_DECAY_MS)
    return () => clearInterval(id)
  }, [pet.adopted, feedPet])

  /**
   * 农田点击（含连点修复）：
   * - 每格 2.5s 冷却，冷却中直接忽略（组件层 disabled，不靠 store 防御）
   * - 操作前用 useGameStore.getState() 读最新 plots，杜绝闭包旧值重复领奖
   * - 空→播种（扣种子成本）；未熟→浇水（按作物需水次数推进）；成熟→收获
   */
  const handleFarmClick = (cellIndex: number) => {
    const nowMs = Date.now()
    if ((farmCooldowns[cellIndex] ?? 0) > nowMs) return

    // 先落冷却，再执行操作：快速连点第二次必被拦
    const until = nowMs + FARM_COOLDOWN_MS
    setFarmCooldowns((prev) => ({ ...prev, [cellIndex]: until }))
    setTimeout(() => {
      setFarmCooldowns((prev) => {
        if (prev[cellIndex] !== until) return prev
        const next = { ...prev }
        delete next[cellIndex]
        return next
      })
    }, FARM_COOLDOWN_MS)

    // 从 store 读最新状态（不用渲染闭包里的 plots，避免连点时旧 stage 重复领奖）
    const state = useGameStore.getState()
    const plot = state.town.garden.plots[cellIndex]

    if (!plot) {
      const def = CROPS[selectedSeed]
      if (state.player.coins < def.cost) {
        setToast(`金币不足，${def.name}种子需要 ${def.cost} 金币`)
        return
      }
      if (def.cost > 0) addCoins(-def.cost)
      plantCrop(def.id)
      setToast(
        def.cost > 0
          ? `播下${def.name}种子（-${def.cost} 金币）……点击浇水让它长大`
          : `播下${def.name}种子……点击浇水让它长大`,
      )
      return
    }

    const def = cropDef(plot.crop)
    if (plot.stage < 2) {
      const key = `${plot.id}:${plot.stage}`
      const progress = (waterProgressRef.current[key] ?? 0) + 1
      if (progress >= def.waterings) {
        delete waterProgressRef.current[key]
        advanceCropStage(plot.id)
        setToast(plot.stage === 0 ? '浇水中……发芽了！' : '浇水中……作物成熟了！')
      } else {
        waterProgressRef.current[key] = progress
        setToast(`浇水中……${def.name}还需 ${def.waterings - progress} 次浇水`)
      }
      return
    }

    // stage === 2 才允许收获（最新状态校验过，闭包旧值连点无法重复领奖）
    harvestPlot(plot.id)
    addCoins(def.reward)
    setToast(`收获「${def.name}」 +${def.reward} 金币`)
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

  /** 抛竿：进入等待，2-6s 随机上钩；上钩 1.2s 未收竿则鱼跑，随后 3s 冷却 */
  const startFishing = (spot: Pos) => {
    if (fishingRef.current.phase === 'cooldown') {
      setToast('鱼竿还没收拾好……稍等一下')
      return
    }
    if (fishingRef.current.phase !== 'idle') {
      setToast('浮标已有动静，专心等鱼上钩！')
      return
    }
    setFishing({ phase: 'waiting', spot })
    const biteDelay = FISH_BITE_MIN_MS + Math.random() * FISH_BITE_SPAN_MS
    biteTimer.current = setTimeout(() => {
      setFishing({ phase: 'bite', spot })
      reelTimer.current = setTimeout(() => {
        // 超时未收竿：鱼跑了
        setToast('鱼跑了……再来一次！')
        setFishing({ phase: 'cooldown' })
        fishCooldownTimer.current = setTimeout(
          () => setFishing({ phase: 'idle' }),
          FISH_COOLDOWN_MS,
        )
      }, FISH_REEL_WINDOW_MS)
    }, biteDelay)
  }

  /** 收竿（仅上钩窗口内有效）：随机 +5~20 金币 + 鱼图标上浮动效 */
  const reelIn = (spot: Pos) => {
    if (reelTimer.current) clearTimeout(reelTimer.current)
    const gain = 5 + Math.floor(Math.random() * 16)
    addCoins(gain)
    fishPopSeq.current += 1
    const id = fishPopSeq.current
    setFishPops((p) => [...p, { id, spot, gain }])
    setTimeout(() => setFishPops((p) => p.filter((f) => f.id !== id)), 1100)
    setToast(`钓到一条鱼！ +${gain} 金币`)
    setFishing({ phase: 'cooldown' })
    fishCooldownTimer.current = setTimeout(() => setFishing({ phase: 'idle' }), FISH_COOLDOWN_MS)
  }

  /**
   * 世界层点击：换算世界坐标 → 格子。
   * 优先级：收竿（上钩窗口内任意点击）→ NPC → 宠物 → 农田 → 钓鱼（水面/码头）→ 移动。
   */
  const handleWorldClick = (e: React.MouseEvent) => {
    const world = worldRef.current
    if (!world) return
    const rect = world.getBoundingClientRect()
    const pos: Pos = {
      x: Math.floor((e.clientX - rect.left) / TILE),
      y: Math.floor((e.clientY - rect.top) / TILE),
    }
    if (pos.x < 0 || pos.x >= MAP_COLS || pos.y < 0 || pos.y >= MAP_ROWS) return

    // 上钩窗口内：任意点击都视为收竿（移动端友好，不用精确点浮标）
    if (fishingRef.current.phase === 'bite') {
      reelIn((fishingRef.current as { phase: 'bite'; spot: Pos }).spot)
      return
    }

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
    // 点击水面 / 木码头 → 钓鱼（码头格上抛竿，浮标落在最近的水面格）
    if (TOWN_MAP[pos.y][pos.x] === 'w') {
      startFishing(pos)
      return
    }
    if (pos.x === DOCK_POS.x && pos.y === DOCK_POS.y) {
      startFishing({ x: DOCK_POS.x, y: DOCK_POS.y + 1 })
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

  /** 实体定位 + 简单 y 排序：y 越大 z 越高（后画盖在上面），云朵/炊烟保持最上层 */
  const entityStyle = (pos: Pos): CSSProperties => ({
    width: TILE,
    height: TILE,
    zIndex: 10 + pos.y,
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
        @keyframes town-bobber-bob {
          0%, 100% { transform: translate(-50%, -50%); }
          50% { transform: translate(-50%, -30%); }
        }
        .town-bobber {
          position: absolute; left: 0; top: 0;
          width: 8px; height: 8px;
          background: #A8504B; border: 2px solid #F4EBD4;
          animation: town-bobber-bob 1.2s steps(2, end) infinite;
        }
        @keyframes town-bobber-sink {
          0%, 100% { transform: translate(-50%, -10%); }
          50% { transform: translate(-50%, 30%); }
        }
        .town-bobber-bite { animation: town-bobber-sink 0.4s steps(2, end) infinite; }
        @keyframes town-bite-pop {
          0% { transform: translate(-50%, 0) scale(0.6); opacity: 0; }
          30% { transform: translate(-50%, -26px) scale(1.2); opacity: 1; }
          100% { transform: translate(-50%, -22px) scale(1); opacity: 1; }
        }
        .town-bite-mark {
          position: absolute; left: 0; top: 0;
          font-size: 16px; line-height: 1;
          animation: town-bite-pop 0.35s steps(3, end) both;
        }
        @keyframes town-splash-ring {
          0% { transform: translate(-50%, -50%) scale(0.4); opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
        }
        .town-splash-ring {
          position: absolute; left: 0; top: 0;
          width: 14px; height: 10px;
          border: 2px solid #EDE3C8; border-radius: 50%;
          animation: town-splash-ring 0.6s steps(4, end) infinite;
        }
        @keyframes town-fish-pop {
          0% { transform: translate(-50%, 0) scale(0.7); opacity: 0; }
          25% { transform: translate(-50%, -18px) scale(1.1); opacity: 1; }
          100% { transform: translate(-50%, -40px) scale(1); opacity: 0; }
        }
        .town-fish-pop { animation: town-fish-pop 1.05s steps(7, end) forwards; }
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
        {/* 地面层（静态 memo：grass 基底 + grass2 变体 + 路网 / 水面 / 农田 / 栅栏 / 路灯） */}
        <GroundLayer />

        {/* 多格建筑层（静态 memo：大房子 / 塔楼 / 水井 / 码头 / 大树 + 炊烟） */}
        <BuildingLayer />

        {/* 农田覆盖层（随 plots / 冷却变化重渲染，只有 4 格） */}
        {FARM_CELLS.map((c, farmIdx) => {
          const plot = plots[farmIdx]
          const cooling = (farmCooldowns[farmIdx] ?? 0) > Date.now()
          return (
            <div
              key={farmIdx}
              className="pointer-events-none absolute flex items-center justify-center"
              style={{
                left: c.x * TILE,
                top: c.y * TILE,
                width: TILE,
                height: TILE,
                zIndex: 10 + c.y,
              }}
            >
              {plot ? (
                <PixelImage
                  src={
                    plot.stage === 2 ? cropDef(plot.crop).ripeImg : CROP_STAGE_IMG[plot.stage]
                  }
                  alt={`${cropDef(plot.crop).name} 阶段${plot.stage}`}
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
              {/* 冷却中：变暗提示该格暂时不可操作（组件层 disabled 态） */}
              {cooling && (
                <div className="absolute inset-0 bg-ink/35 transition-opacity" />
              )}
            </div>
          )
        })}

        {/* 点击移动目标指示 */}
        {target && (
          <div
            className="pointer-events-none absolute z-20 border-2 border-dashed border-gold"
            style={{
              left: target.x * TILE + 4,
              top: target.y * TILE + 4,
              width: TILE - 8,
              height: TILE - 8,
            }}
          />
        )}

        {/* 钓鱼浮标与上钩动效（水花圈 + 感叹号；z 高于水面与建筑） */}
        {(fishing.phase === 'waiting' || fishing.phase === 'bite') && (
          <div
            className="pointer-events-none absolute z-30"
            style={{
              left: fishing.spot.x * TILE + TILE / 2,
              top: fishing.spot.y * TILE + TILE / 2,
            }}
          >
            {fishing.phase === 'bite' && (
              <>
                <span className="town-splash-ring" />
                <span className="town-bite-mark" role="img" aria-label="鱼上钩了">
                  ❗
                </span>
              </>
            )}
            <span
              className={`town-bobber ${fishing.phase === 'bite' ? 'town-bobber-bite' : ''}`}
            />
          </div>
        )}

        {/* 钓到鱼的上浮奖励动效（鱼图标 + 金币） */}
        {fishPops.map((f) => (
          <div
            key={f.id}
            className="pointer-events-none absolute z-30"
            style={{
              left: f.spot.x * TILE + TILE / 2,
              top: f.spot.y * TILE,
            }}
          >
            <div className="town-fish-pop flex flex-col items-center">
              <PixelImage
                src="/assets/ui/fish.png"
                alt="钓到的鱼"
                className="h-8 w-8 object-contain"
                fallbackClassName="h-8 w-8 bg-gold"
                fallbackText="🐟"
              />
              <span className="font-pixel text-[10px] text-gold-dark">+{f.gain}</span>
            </div>
          </div>
        ))}

        {/* NPC（各站自家门口；待机呼吸帧动画） */}
        {NPC_META.map((npc) => (
          <div key={npc.id} className="pointer-events-none absolute left-0 top-0" style={entityStyle(npc.pos)}>
            <div className="flex h-full w-full items-center justify-center">
              <FrameAnim
                frames={npc.anim}
                fps={4}
                fallbackImg={npc.img}
                alt="NPC"
                className="h-[48px] w-[48px] object-contain"
                fallbackClassName="h-[48px] w-[48px]"
                fallbackStyle={{ backgroundColor: npc.color }}
                fallbackText="人"
              />
            </div>
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-parchment-light px-1 font-pixel text-[8px] leading-3 text-ink">
              {npc.id === 'elder' ? '长者' : npc.id === 'merchant' ? '商人' : '画师'}
            </span>
          </div>
        ))}

        {/* 宠物橘猫（点击喂食；走动播 cat-walk 帧，站立停第 0 帧，朝向翻转） */}
        {pet.adopted && (
          <div className="pointer-events-none absolute left-0 top-0" style={entityStyle(petPos)}>
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                transform: petFacing === 'left' ? 'scaleX(-1)' : 'none',
                transition: 'transform 120ms steps(2, end)',
              }}
            >
              <FrameAnim
                frames={CAT_WALK_FRAMES}
                fps={6}
                active={petMoving}
                fallbackImg="/assets/decor/cat.png"
                alt="橘猫"
                className="h-[44px] w-[44px] object-contain"
                fallbackClassName="h-[44px] w-[44px] bg-gold"
                fallbackText="🐈"
              />
            </div>
            {hearts.map((h) => (
              <span
                key={h}
                className="town-heart absolute -top-1 left-1/2 -translate-x-1/2 text-sm"
              >
                ❤️
              </span>
            ))}
          </div>
        )}

        {/* 玩家（步行颠簸 + 朝向翻转） */}
        <div className="pointer-events-none absolute left-0 top-0" style={entityStyle(playerPos)}>
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
                className="h-[50px] w-[50px] object-contain"
                fallbackClassName="h-[50px] w-[50px] bg-berry"
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
