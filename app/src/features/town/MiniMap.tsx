import { useEffect, useRef } from 'react'
import {
  FARM_CELLS,
  MAP_COLS,
  MAP_ROWS,
  NPC_META,
  TILE_STYLE,
  TOWN_MAP,
  type Pos,
} from './townData'

/** 小地图缩放：每格 5px → 120x80 画布 */
const SCALE = 5

interface MiniMapProps {
  playerPos: Pos
  petPos: Pos
  petAdopted: boolean
}

/** 左上角小地图：canvas 绘制世界轮廓 + 玩家/NPC/宠物光点，实时更新 */
export function MiniMap({ playerPos, petPos, petAdopted }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // 世界轮廓（按地块底色缩略）
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        ctx.fillStyle = TILE_STYLE[TOWN_MAP[y][x]].color
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
      }
    }
    // 农田格强调
    ctx.fillStyle = TILE_STYLE.F.color
    FARM_CELLS.forEach((c) => ctx.fillRect(c.x * SCALE, c.y * SCALE, SCALE, SCALE))

    // NPC 光点（浆果红）
    ctx.fillStyle = '#A8504B'
    NPC_META.forEach((n) => {
      ctx.fillRect(n.pos.x * SCALE + 1, n.pos.y * SCALE + 1, SCALE - 2, SCALE - 2)
    })

    // 宠物光点（暖金小点）
    if (petAdopted) {
      ctx.fillStyle = '#E8D9A0'
      ctx.fillRect(petPos.x * SCALE + 1, petPos.y * SCALE + 1, SCALE - 2, SCALE - 2)
    }

    // 玩家光点（金色 + 墨色描边，最醒目）
    ctx.fillStyle = '#3B2F2A'
    ctx.fillRect(playerPos.x * SCALE - 1, playerPos.y * SCALE - 1, SCALE + 2, SCALE + 2)
    ctx.fillStyle = '#D9A441'
    ctx.fillRect(playerPos.x * SCALE, playerPos.y * SCALE, SCALE, SCALE)
  }, [playerPos, petPos, petAdopted])

  return (
    <div className="pixel-border-sm pointer-events-none m-1 bg-parchment-dark p-1">
      <div className="mb-1 text-center font-pixel text-[8px] leading-3 text-wood-dark">
        小地图
      </div>
      <canvas
        ref={canvasRef}
        width={MAP_COLS * SCALE}
        height={MAP_ROWS * SCALE}
        className="pixelated block"
        aria-label="小镇小地图"
      />
    </div>
  )
}
