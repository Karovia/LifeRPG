import { useEffect, useState } from 'react'
import { PixelPanel } from '@/components/pixel'

export interface RewardInfo {
  xp: number
  coins: number
  title: string
}

interface RewardToastProps {
  reward: RewardInfo
  onDone: () => void
}

/** 带 onError 降级的像素素材图（素材可能尚未生成） */
function PixelAsset({
  src,
  alt,
  fallback,
}: {
  src: string
  alt: string
  fallback: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className="text-xl leading-none">{fallback}</span>
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="pixelated h-8 w-8 object-contain"
    />
  )
}

/**
 * 节点完成瞬间的像素风奖励弹窗：+XP +金币，约 2.4s 后自动消失。
 */
export default function RewardToast({ reward, onDone }: RewardToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2400)
    return () => window.clearTimeout(timer)
  }, [onDone])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
      onClick={onDone}
      role="alert"
    >
      {/* 内联 keyframes（模块自治，不改全局 css） */}
      <style>{`
        @keyframes quest-reward-pop {
          0%   { transform: scale(0.6) translateY(12px); opacity: 0; }
          60%  { transform: scale(1.06) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes quest-reward-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
      `}</style>

      <div
        className="w-full max-w-xs [animation:quest-reward-pop_.35s_steps(4,end)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        <PixelPanel bg="#FAF3E3" borderColor="#9E7C33" className="text-center">
          <p className="font-pixel text-xs text-gold-dark">QUEST CLEAR!</p>
          <p className="mt-2 truncate text-xs text-stone-dark">{reward.title}</p>

          <div className="mt-4 flex items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-1 [animation:quest-reward-float_1.2s_steps(2,end)_infinite]">
              <PixelAsset src="/assets/ui/xp-star.png" alt="XP" fallback="⭐" />
              <span className="font-pixel text-[10px] text-moss-dark">
                +{reward.xp} XP
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 [animation:quest-reward-float_1.2s_steps(2,end)_infinite_.2s]">
              <PixelAsset src="/assets/ui/coin.png" alt="金币" fallback="🪙" />
              <span className="font-pixel text-[10px] text-gold-dark">
                +{reward.coins}
              </span>
            </div>
          </div>

          <p className="mt-4 font-pixel text-[8px] text-stone">点击任意处关闭</p>
        </PixelPanel>
      </div>
    </div>
  )
}
