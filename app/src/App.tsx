import { NavLink, Route, Routes } from 'react-router'
import { PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import AvatarPage from '@/features/avatar/AvatarPage'
import QuestsPage from '@/features/quests/QuestsPage'
import GrowthPage from '@/features/growth/GrowthPage'
import DiaryPage from '@/features/diary/DiaryPage'
import ResumePage from '@/features/resume/ResumePage'

/** 顶栏 HUD：头像、等级、XP 条、金币 */
function Hud() {
  const player = useGameStore((s) => s.player)

  return (
    <header className="pixel-border m-2 flex items-center gap-3 bg-parchment-light px-4 py-3">
      {/* 头像缩略图 */}
      <div className="pixel-border-sm h-12 w-12 shrink-0 overflow-hidden bg-parchment-dark">
        {player.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt={player.name}
            className="pixelated h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-pixel text-lg text-stone">
            ?
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-pixel text-xs text-ink">{player.name}</span>
          <span className="font-pixel text-[10px] text-wood-dark">
            LV.{player.level}
          </span>
        </div>
        <PixelProgressBar
          variant="xp"
          value={player.xp}
          max={player.xpToNext}
          segments={12}
          className="mt-1 max-w-56"
        />
      </div>

      {/* 金币 */}
      <div className="flex shrink-0 items-center gap-1 font-pixel text-xs text-gold-dark">
        <img
          src="/assets/ui/coin.png"
          alt="金币"
          className="pixelated h-4 w-4"
          onError={(e) => {
            // 素材缺失时降级为色块
            const el = e.currentTarget
            el.style.display = 'none'
            const fallback = document.createElement('span')
            fallback.className = 'inline-block h-3 w-3 bg-gold'
            el.parentElement?.prepend(fallback)
          }}
        />
        {player.coins}
      </div>
    </header>
  )
}

const NAV_ITEMS = [
  { to: '/avatar', label: '形象', icon: '👤' },
  { to: '/quests', label: '目标', icon: '⚔️' },
  { to: '/growth', label: '成长', icon: '🌱' },
  { to: '/diary', label: '日记', icon: '📖' },
  { to: '/resume', label: '简历', icon: '📜' },
]

/** 底部像素风导航 */
function BottomNav() {
  return (
    <nav className="pixel-border m-2 flex justify-around bg-wood px-2 py-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `pixel-press flex flex-col items-center gap-1 px-3 py-1 font-pixel text-[10px] ${
              isActive ? 'bg-gold text-ink' : 'text-parchment-light hover:bg-wood-light'
            }`
          }
        >
          <span className="text-base leading-none">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-parchment">
      <Hud />
      <main className="flex-1 overflow-y-auto p-2">
        <Routes>
          <Route path="/" element={<AvatarPage />} />
          <Route path="/avatar" element={<AvatarPage />} />
          <Route path="/quests" element={<QuestsPage />} />
          <Route path="/growth" element={<GrowthPage />} />
          <Route path="/diary" element={<DiaryPage />} />
          <Route path="/resume" element={<ResumePage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}
