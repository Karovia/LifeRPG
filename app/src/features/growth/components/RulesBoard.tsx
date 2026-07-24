import { PixelPanel } from '@/components/pixel'
import { PixelImg } from './PixelImg'

const RULES = [
  {
    icon: '⚔️',
    title: '完成任务节点',
    desc: '在「目标」页把大目标拆成小节点，每完成一个节点，立即获得 XP 和金币奖励。',
  },
  {
    icon: '⭐',
    title: '积累经验升级',
    desc: 'XP 攒满即自动升级，下一级所需经验会提高 50%，冒险难度与荣耀并存。',
  },
  {
    icon: '🏠',
    title: '金币兑换装饰',
    desc: '用金币在商店兑换装饰品，装扮你的小屋。盆栽、书架、油灯、奖杯，还有一只猫。',
  },
  {
    icon: '📖',
    title: '坚持记录日记',
    desc: '每天向日记本倾诉，保持连续记录天数，见证自己一步步走向目标职业。',
  },
]

/** 奖励结算说明区：游戏内告示牌风格 */
export function RulesBoard() {
  return (
    <PixelPanel bg="#E4D5B8" borderColor="#6B4A2F" className="space-y-3">
      {/* 告示牌牌头：木牌 + 挂钉 */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex gap-8">
          <span className="h-2 w-2 rounded-full bg-ink" />
          <span className="h-2 w-2 rounded-full bg-ink" />
        </div>
        <div className="pixel-border-sm bg-wood px-4 py-2">
          <h2 className="font-pixel text-xs text-parchment-light">告 示 牌</h2>
        </div>
      </div>

      <ul className="space-y-2">
        {RULES.map((rule, i) => (
          <li
            key={rule.title}
            className="pixel-border-sm flex items-start gap-2 bg-parchment-light p-2"
          >
            <span className="mt-0.5 shrink-0 text-base leading-none">{rule.icon}</span>
            <div>
              <p className="font-pixel text-[10px] text-wood-dark">
                {i + 1}. {rule.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink">{rule.desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-center gap-2 pt-1">
        <PixelImg
          src="/assets/ui/chest.png"
          alt="宝箱"
          className="h-5 w-5"
          fallback={
            <span className="flex h-5 w-5 items-center justify-center text-sm leading-none">
              🎁
            </span>
          }
        />
        <p className="font-pixel text-[8px] text-wood-dark">
          努力冒险，丰厚奖励等着你！
        </p>
      </div>
    </PixelPanel>
  )
}
