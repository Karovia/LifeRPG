import { useEffect, useRef, useState } from 'react'
import type { Pos } from './townData'

/** 摇杆几何：底盘 112px，摇杆头 48px，最大偏移 32px */
const BASE_SIZE = 112
const KNOB_SIZE = 48
const MAX_OFFSET = 32
/** 小于此位移视为回中（死区） */
const DEAD_ZONE = 10
/** 持续移动步频：每 160ms 走一步 */
const STEP_MS = 160

/** 8 方向表（按 atan2 扇区顺时针：右、右下、下、左下、左、左上、上、右上） */
const DIRS: Pos[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
]

/** 触屏设备检测（pointer: coarse 或 touch 事件支持），桌面端返回 false → 摇杆隐藏 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
}

interface VirtualJoystickProps {
  /** 拖动方向持续移动回调（8 方向，含斜向） */
  onStep: (dir: Pos) => void
  /** 对话条打开等场景下隐藏，避免遮挡 */
  visible: boolean
}

/**
 * 移动端虚拟摇杆：/town 左下角固定。
 * 拖动摇杆头按 8 方向持续移动玩家（每 160ms 一步，斜向可走），
 * 松开回中停止。键盘 WASD/方向键与点击移动不受影响。
 */
export function VirtualJoystick({ onStep, visible }: VirtualJoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null)
  /** 摇杆头偏移（px），null = 回中 */
  const [offset, setOffset] = useState<Pos | null>(null)
  /** 当前 8 方向（null = 停止） */
  const [dir, setDir] = useState<Pos | null>(null)
  const activePointer = useRef<number | null>(null)

  // 方向变化 → 以 160ms 步频持续回调；按下立即先走一步，手感更跟手
  useEffect(() => {
    if (!dir) return
    onStep(dir)
    const id = setInterval(() => onStep(dir), STEP_MS)
    return () => clearInterval(id)
  }, [dir, onStep])

  if (!visible) return null

  const updateFromPointer = (clientX: number, clientY: number) => {
    const base = baseRef.current
    if (!base) return
    const rect = base.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = clientX - cx
    let dy = clientY - cy
    const len = Math.hypot(dx, dy)
    if (len > MAX_OFFSET) {
      dx = (dx / len) * MAX_OFFSET
      dy = (dy / len) * MAX_OFFSET
    }
    setOffset({ x: dx, y: dy })
    if (len < DEAD_ZONE) {
      setDir(null)
      return
    }
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
    setDir(DIRS[((sector % 8) + 8) % 8])
  }

  const release = () => {
    activePointer.current = null
    setOffset(null)
    setDir(null)
  }

  return (
    <div
      ref={baseRef}
      role="application"
      aria-label="虚拟摇杆：拖动控制移动方向"
      className="absolute bottom-4 left-4 z-40 select-none"
      style={{
        width: BASE_SIZE,
        height: BASE_SIZE,
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        activePointer.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        updateFromPointer(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (activePointer.current !== e.pointerId) return
        updateFromPointer(e.clientX, e.clientY)
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {/* 底盘：暖色羊皮纸半透明 + 像素描边 */}
      <div
        className="pixel-border-sm absolute inset-0 m-1 bg-parchment-dark/60"
        aria-hidden
      />
      {/* 方向刻度点（8 方向提示） */}
      {DIRS.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute h-1 w-1 bg-wood-dark/50"
          style={{
            left: BASE_SIZE / 2 + d.x * (MAX_OFFSET + 6) - 2,
            top: BASE_SIZE / 2 + d.y * (MAX_OFFSET + 6) - 2,
          }}
        />
      ))}
      {/* 摇杆头 */}
      <div
        aria-hidden
        className="pixel-border-sm absolute m-[3px] bg-gold/80"
        style={{
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          left: BASE_SIZE / 2 - KNOB_SIZE / 2,
          top: BASE_SIZE / 2 - KNOB_SIZE / 2,
          transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : 'none',
          transition: offset ? 'none' : 'transform 120ms steps(3, end)',
        }}
      />
    </div>
  )
}
