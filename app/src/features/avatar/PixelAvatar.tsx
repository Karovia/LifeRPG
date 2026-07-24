import { useState } from 'react'
import { cn } from '@/lib/utils'

/** 素材代理生成的默认形象（可能尚未就绪，加载失败继续降级） */
export const PLACEHOLDER_AVATAR = '/assets/avatar/placeholder.png'

/**
 * 纯 CSS 像素头像（最终降级方案，不依赖任何素材）。
 * 10x12 像素网格，用调色板颜色拼一个冒险者小人。
 */
const PIXEL_MAP = [
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.hssssssh.',
  '.hsessesh.',
  '.ssssssss.',
  '..ssmmss..',
  '...ssss...',
  '.cccccccc.',
  'cccccccccc',
  'c.cccccc.c',
  '..cccccc..',
  '..bb..bb..',
] as const

const PIXEL_COLORS: Record<string, string> = {
  h: '#6B4A2F', // wood-dark 头发
  s: '#E8B88A', // 肤色
  e: '#3B2F2A', // ink 眼睛
  m: '#A8504B', // berry 嘴
  c: '#7C8A5A', // moss 衣服
  b: '#6B4A2F', // wood-dark 靴子
}

function CssPixelAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn('grid h-full w-full', className)}
      style={{
        gridTemplateColumns: `repeat(${PIXEL_MAP[0].length}, 1fr)`,
        gridTemplateRows: `repeat(${PIXEL_MAP.length}, 1fr)`,
      }}
      role="img"
      aria-label="默认像素头像"
    >
      {PIXEL_MAP.flatMap((row, y) =>
        row.split('').map((ch, x) => (
          <div
            key={`${y}-${x}`}
            style={{ backgroundColor: PIXEL_COLORS[ch] ?? 'transparent' }}
          />
        )),
      )}
    </div>
  )
}

interface PixelAvatarProps {
  /** 形象地址（data URL / 路径），为空时直接用占位图 */
  src: string | null
  alt?: string
  className?: string
}

/**
 * 像素形象展示组件，三级降级链：
 * 1. src（Pixellab 生成的 data URL 或已保存路径）
 * 2. /assets/avatar/placeholder.png（素材代理产物，可能未就绪）
 * 3. 纯 CSS 像素色块头像（永远可用）
 */
export function PixelAvatar({ src, alt = '冒险者形象', className }: PixelAvatarProps) {
  const [stage, setStage] = useState<'src' | 'placeholder' | 'css'>(
    src ? 'src' : 'placeholder',
  )

  return (
    <div className={cn('pixelated overflow-hidden bg-parchment-dark', className)}>
      {stage === 'css' ? (
        <CssPixelAvatar />
      ) : (
        <img
          src={stage === 'src' ? (src as string) : PLACEHOLDER_AVATAR}
          alt={alt}
          className="pixelated h-full w-full object-cover"
          draggable={false}
          onError={() =>
            setStage((s) => (s === 'src' ? 'placeholder' : 'css'))
          }
        />
      )}
    </div>
  )
}
