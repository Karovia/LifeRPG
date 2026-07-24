import { cn } from '@/lib/utils'
import { useState } from 'react'

interface PixelImageProps {
  src: string
  alt: string
  className?: string
  /** 贴图加载失败时的降级块类名（通常给底色） */
  fallbackClassName?: string
  /** 降级块中显示的文字/emoji */
  fallbackText?: string
}

/** 像素风图片：统一样式 + onError 降级为纯色块/字符 */
export function PixelImage({
  src,
  alt,
  className,
  fallbackClassName,
  fallbackText,
}: PixelImageProps) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
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
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn('pixelated', className)}
      onError={() => setFailed(true)}
    />
  )
}
