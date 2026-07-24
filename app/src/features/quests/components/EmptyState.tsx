import { useState } from 'react'
import { PixelPanel } from '@/components/pixel'

/**
 * 空状态引导：还没有任何目标时展示。
 * 预留像素插画位（宝箱素材未就绪时降级为占位图案）。
 */
export default function EmptyState() {
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <PixelPanel className="text-center">
      {/* 插画占位区 */}
      <div className="pixel-border-sm m-1 mx-auto flex h-32 w-32 items-center justify-center bg-parchment-dark [--pixel-border-color:#9C9484]">
        {imgFailed ? (
          <span className="font-pixel text-3xl text-stone" aria-hidden>
            ?
          </span>
        ) : (
          <img
            src="/assets/ui/chest.png"
            alt="宝箱"
            onError={() => setImgFailed(true)}
            className="pixelated h-24 w-24 object-contain"
          />
        )}
      </div>

      <h2 className="mt-3 font-pixel text-xs text-wood-dark">还没有冒险目标</h2>
      <p className="mt-2 text-xs leading-relaxed text-stone-dark">
        在上方输入你的人生 / 职业目标，
        <br />
        点击「拆解目标」，开启第一段任务链吧！
      </p>
      <p className="mt-3 font-pixel text-[9px] text-stone">
        TIP: 完成节点可获得 XP 与金币
      </p>
    </PixelPanel>
  )
}
