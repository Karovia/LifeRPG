import { cn } from '@/lib/utils'

type PixelProgressBarVariant = 'hp' | 'xp' | 'moss'

interface PixelProgressBarProps {
  /** 当前值 */
  value: number
  /** 最大值 */
  max: number
  /** hp=浆果红血条 xp=金币色经验条 moss=苔绿 */
  variant?: PixelProgressBarVariant
  /** 条内分段数（像素刻度感），默认 10 */
  segments?: number
  className?: string
  /** 右侧/上方文字，如 "32 / 100" */
  label?: string
}

const fillClasses: Record<PixelProgressBarVariant, string> = {
  hp: 'bg-berry',
  xp: 'bg-gold',
  moss: 'bg-moss',
}

/**
 * 像素风进度条（血条/经验条）：分段刻度、无渐变、无圆角。
 */
export function PixelProgressBar({
  value,
  max,
  variant = 'xp',
  segments = 10,
  className,
  label,
}: PixelProgressBarProps) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0
  const filledSegments = Math.round(ratio * segments)

  return (
    <div className={cn('w-full', className)}>
      {label !== undefined && (
        <div className="mb-1 flex justify-between font-pixel text-[10px] text-ink">
          <span>{label}</span>
          <span>
            {value} / {max}
          </span>
        </div>
      )}
      <div className="pixel-border-sm flex h-4 w-full gap-[2px] bg-parchment-dark p-[2px]">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-full flex-1',
              i < filledSegments ? fillClasses[variant] : 'bg-parchment',
            )}
          />
        ))}
      </div>
    </div>
  )
}
