import { cn } from '@/lib/utils'
import { useState, type ReactNode } from 'react'

interface PixelImgProps {
  src: string
  alt: string
  className?: string
  /** 图片加载失败（素材未就绪）时的降级内容 */
  fallback: ReactNode
}

/**
 * 像素图片：image-rendering: pixelated，加载失败时降级为传入的占位内容。
 * 素材代理并行生成中，/assets 下文件可能尚未就绪。
 */
export function PixelImg({ src, alt, className, fallback }: PixelImgProps) {
  const [failed, setFailed] = useState(false)

  if (failed) return <>{fallback}</>

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('pixelated', className)}
    />
  )
}
