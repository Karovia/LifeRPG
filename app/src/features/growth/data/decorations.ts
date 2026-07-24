/** 装饰品商店商品定义（成长模块本地数据，与素材代理的 /assets/decor/<id>.png 对应） */

export interface DecorationDef {
  id: string
  name: string
  /** 图片加载失败时的 emoji 降级 */
  emoji: string
  price: number
  /** 家园预览区中的绝对定位（百分比） */
  homeSpot: { left: string; top: string }
  /** 家园预览区中的显示尺寸（px） */
  homeSize: number
}

export const DECORATIONS: DecorationDef[] = [
  {
    id: 'plant',
    name: '盆栽',
    emoji: '🪴',
    price: 30,
    homeSpot: { left: '8%', top: '62%' },
    homeSize: 40,
  },
  {
    id: 'bookshelf',
    name: '书架',
    emoji: '📚',
    price: 60,
    homeSpot: { left: '28%', top: '34%' },
    homeSize: 48,
  },
  {
    id: 'lamp',
    name: '油灯',
    emoji: '🏮',
    price: 50,
    homeSpot: { left: '70%', top: '30%' },
    homeSize: 36,
  },
  {
    id: 'trophy',
    name: '奖杯',
    emoji: '🏆',
    price: 100,
    homeSpot: { left: '52%', top: '55%' },
    homeSize: 40,
  },
  {
    id: 'cat',
    name: '宠物猫',
    emoji: '🐱',
    price: 120,
    homeSpot: { left: '82%', top: '66%' },
    homeSize: 36,
  },
]

export function getDecoration(id: string): DecorationDef | undefined {
  return DECORATIONS.find((d) => d.id === id)
}
