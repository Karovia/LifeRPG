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

      <h2 className="mt-3 font-pixel text-xs text-wood-dark">成就树等待播种</h2>
      <p className="mt-2 text-xs leading-relaxed text-stone-dark">
        在上方写下你的人生 / 职业目标，AI 会联网检索参考资料，
        <br />
        把目标拆解成一棵多阶段成就树，并为每个阶段算出 Deadline。
      </p>
      <p className="mt-3 font-pixel text-[9px] text-stone">
        TIP: 金色徽章 = 可挑战，灰色徽章 = 未解锁，CLEAR = 已通关
      </p>
    </PixelPanel>
  )
}
