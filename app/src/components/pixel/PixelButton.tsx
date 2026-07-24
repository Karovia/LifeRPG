import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type PixelButtonVariant = 'wood' | 'moss' | 'berry' | 'gold'

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PixelButtonVariant
}

const variantClasses: Record<PixelButtonVariant, string> = {
  wood: 'bg-wood text-parchment-light hover:bg-wood-light',
  moss: 'bg-moss text-parchment-light hover:bg-moss-light',
  berry: 'bg-berry text-parchment-light hover:bg-berry-light',
  gold: 'bg-gold text-ink hover:bg-gold-light',
}

/**
 * 像素风按钮：像素字体 + 阶梯描边 + 按下位移。
 */
export function PixelButton({
  variant = 'wood',
  className,
  children,
  ...props
}: PixelButtonProps) {
  return (
    <button
      className={cn(
        'pixel-border-sm pixel-press m-1 px-4 py-2 font-pixel text-xs leading-relaxed',
        'disabled:cursor-not-allowed disabled:bg-stone disabled:text-stone-light',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
