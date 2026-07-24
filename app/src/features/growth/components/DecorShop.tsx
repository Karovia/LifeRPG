import { useEffect, useState } from 'react'
import { PixelButton, PixelPanel } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { DECORATIONS, type DecorationDef } from '../data/decorations'
import { PixelImg } from './PixelImg'

/** 单个商品卡片 */
function ShopItem({
  item,
  owned,
  coins,
  onBuy,
}: {
  item: DecorationDef
  owned: boolean
  coins: number
  onBuy: (item: DecorationDef) => void
}) {
  const affordable = coins >= item.price

  return (
    <div className="pixel-border-sm flex flex-col items-center gap-1 bg-parchment p-2">
      <div className="flex h-12 w-12 items-center justify-center bg-parchment-dark">
        <PixelImg
          src={`/assets/decor/${item.id}.png`}
          alt={item.name}
          className="h-10 w-10 object-contain"
          fallback={
            <span className="text-2xl leading-none" role="img" aria-label={item.name}>
              {item.emoji}
            </span>
          }
        />
      </div>

      <span className="font-pixel text-[10px] text-ink">{item.name}</span>

      <span className="flex items-center gap-1 font-pixel text-[8px] text-gold-dark">
        <span className="inline-block h-2 w-2 bg-gold" />
        {item.price}
      </span>

      {owned ? (
        <span className="pixel-border-sm m-1 bg-moss px-3 py-1 font-pixel text-[8px] text-parchment-light">
          已拥有
        </span>
      ) : (
        <PixelButton
          variant={affordable ? 'gold' : 'wood'}
          className="px-3 py-1 text-[8px]"
          onClick={() => onBuy(item)}
        >
          购买
        </PixelButton>
      )}
    </div>
  )
}

/** 装饰品商店：5 件装饰品，金币购买，余额不足提示 */
export function DecorShop() {
  const coins = useGameStore((s) => s.player.coins)
  const ownedIds = useGameStore((s) => s.inventory.decorations)
  const buyDecoration = useGameStore((s) => s.buyDecoration)

  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(t)
  }, [notice])

  const handleBuy = (item: DecorationDef) => {
    const ok = buyDecoration(item.id, item.price)
    if (ok) {
      setNotice(`成功兑换「${item.name}」！已放进你的小屋。`)
    } else {
      setNotice('金币不足，去完成任务吧！')
    }
  }

  return (
    <PixelPanel bg="#FAF3E3" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-pixel text-xs text-wood-dark">装饰品商店</h2>
        <span className="flex items-center gap-1 font-pixel text-[10px] text-gold-dark">
          <PixelImg
            src="/assets/ui/coin.png"
            alt="金币"
            className="h-3 w-3"
            fallback={<span className="inline-block h-3 w-3 bg-gold" />}
          />
          {coins}
        </span>
      </div>

      {/* 购买结果提示 */}
      {notice && (
        <div className="pixel-border-sm bg-berry px-2 py-1 text-center font-pixel text-[8px] leading-relaxed text-parchment-light">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {DECORATIONS.slice(0, 3).map((item) => (
          <ShopItem
            key={item.id}
            item={item}
            owned={ownedIds.includes(item.id)}
            coins={coins}
            onBuy={handleBuy}
          />
        ))}
      </div>
      <div className="mx-auto grid max-w-[70%] grid-cols-2 gap-2">
        {DECORATIONS.slice(3).map((item) => (
          <ShopItem
            key={item.id}
            item={item}
            owned={ownedIds.includes(item.id)}
            coins={coins}
            onBuy={handleBuy}
          />
        ))}
      </div>
    </PixelPanel>
  )
}
