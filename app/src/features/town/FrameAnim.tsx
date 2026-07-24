import { cn } from '@/lib/utils'
import { useEffect, useState, type CSSProperties } from 'react'

interface FrameAnimProps {
  /** 帧序列（按顺序循环播放） */
  frames: string[]
  /** 播放帧率（4-6fps 最有 8bit 感），默认 4 */
  fps?: number
  /** 是否播放；false 时静止在第 0 帧（如猫咪站立不动） */
  active?: boolean
  /** 帧图加载失败时的静态降级图（通常是对应的静态贴图） */
  fallbackImg?: string
  alt: string
  className?: string
  /** 静态图也缺失时的降级色块类名（通常给底色） */
  fallbackClassName?: string
  /** 降级色块内联样式（如运行时决定的底色） */
  fallbackStyle?: CSSProperties
  /** 降级色块中显示的文字/emoji */
  fallbackText?: string
}

/** 监听 prefers-reduced-motion（系统减动效偏好） */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * 8bit 帧动画播放器：setInterval 驱动 4 帧循环。
 * 降级链：帧序列 → fallbackImg 静态图 → 纯色块/字符；
 * prefers-reduced-motion 或 active=false 时静止在第 0 帧。
 */
export function FrameAnim({
  frames,
  fps = 4,
  active = true,
  fallbackImg,
  alt,
  className,
  fallbackClassName,
  fallbackStyle,
  fallbackText,
}: FrameAnimProps) {
  const reducedMotion = useReducedMotion()
  const [frame, setFrame] = useState(0)
  /** anim: 播帧序列；static: 帧图失败退到静态图；block: 静态图也失败退到色块 */
  const [stage, setStage] = useState<'anim' | 'static' | 'block'>('anim')

  const playing = stage === 'anim' && active && !reducedMotion

  useEffect(() => {
    if (!playing) {
      setFrame(0)
      return
    }
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 1000 / fps)
    return () => clearInterval(id)
  }, [playing, fps, frames.length])

  if (stage === 'block') {
    return (
      <div
        role="img"
        aria-label={alt}
        style={fallbackStyle}
        className={cn(
          'pixelated flex items-center justify-center font-pixel text-[10px] text-parchment-light',
          fallbackClassName,
          className,
        )}
      >
        {fallbackText ?? ''}
      </div>
    )
  }

  const src = stage === 'static' && fallbackImg ? fallbackImg : frames[frame]
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn('pixelated', className)}
      onError={() => {
        // 帧图失败 → 有静态图先退静态图，否则（或静态图再失败）退色块
        if (stage === 'anim' && fallbackImg) setStage('static')
        else setStage('block')
      }}
    />
  )
}
