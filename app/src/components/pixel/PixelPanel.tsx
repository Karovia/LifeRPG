import { cn } from '@/lib/utils'
import type { CSSProperties, ReactNode } from 'react'

interface PixelPanelProps {
  children: ReactNode
  className?: string
  /** 面板底色，默认羊皮纸浅色 */
  bg?: string
  /** 像素描边色，默认墨色 */
  borderColor?: string
}

/**
 * 像素边框面板：用 box-shadow 阶梯描边模拟 8bit 边框。
 * 注意：外层需留出 >=4px 间距（如 p-2 / gap），避免描边被裁切。
 */
export function PixelPanel({
  children,
  className,
  bg = '#FAF3E3',
  borderColor = '#3B2F2A',
}: PixelPanelProps) {
  const style = {
    backgroundColor: bg,
    '--pixel-border-color': borderColor,
  } as CSSProperties

  return (
    <div className={cn('pixel-border m-1 p-4', className)} style={style}>
      {children}
    </div>
  )
}
