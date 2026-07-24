import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import { useState } from 'react'
import { PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import AvatarPage from '@/features/avatar/AvatarPage'
import HomePage from '@/features/home/HomePage'
import QuestsPage from '@/features/quests/QuestsPage'
import TownPage from '@/features/town/TownPage'
import DiaryPage from '@/features/diary/DiaryPage'
import ResumePage from '@/features/resume/ResumePage'

/** 顶栏 HUD：头像（可点击 → /avatar）、等级、XP 条、金币 */
function Hud() {
  const player = useGameStore((s) => s.player)

  return (
    <header className="pixel-border m-2 flex items-center gap-3 bg-parchment-light px-4 py-3">
      {/* 头像缩略图（点击进入形象页） */}
      <Link
        to="/avatar"
        className="pixel-border-sm pixel-press block h-12 w-12 shrink-0 overflow-hidden bg-parchment-dark"
        aria-label="形象"
      >
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
      </Link>

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
  { to: '/', label: '首页', icon: '🏠', img: '/assets/nav/home.png', end: true },
  { to: '/quests', label: '任务', icon: '⚔️', img: '/assets/nav/quests.png' },
  { to: '/town', label: '小镇', icon: '🏘️', img: '/assets/nav/town.png' },
  { to: '/diary', label: '日记', icon: '📖', img: '/assets/nav/diary.png' },
  { to: '/resume', label: '简历', icon: '📜', img: '/assets/nav/resume.png' },
] as const

/** 像素导航图标：图片缺失时降级为 emoji */
function NavIcon({ img, icon, label }: { img: string; icon: string; label: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className="text-base leading-none">{icon}</span>
  }
  return (
    <img
      src={img}
      alt={label}
      className="pixelated h-5 w-5"
      onError={() => setFailed(true)}
    />
  )
}

/** 底部像素风导航 */
function BottomNav() {
  return (
    <nav className="pixel-border m-2 flex justify-around bg-wood px-2 py-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={'end' in item && item.end}
          className={({ isActive }) =>
            `pixel-press flex flex-col items-center gap-1 px-3 py-1 font-pixel text-[10px] ${
              isActive ? 'bg-gold text-ink' : 'text-parchment-light hover:bg-wood-light'
            }`
          }
        >
          <NavIcon img={item.img} icon={item.icon} label={item.label} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function App() {
  const { pathname } = useLocation()
  // /town 为全屏沉浸式世界：不占窄栏、不显示全局 HUD/底导航（小镇自带 HUD 与「离开」按钮）
  const immersive = pathname.startsWith('/town')

  return (
    <div
      className={
        immersive
          ? 'flex min-h-dvh flex-col bg-[#97A872]'
          : 'mx-auto flex min-h-dvh max-w-md flex-col bg-parchment'
      }
    >
      {!immersive && <Hud />}
      <main
        className={
          immersive ? 'flex flex-1 flex-col overflow-hidden' : 'flex-1 overflow-y-auto p-2'
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/avatar" element={<AvatarPage />} />
          <Route path="/quests" element={<QuestsPage />} />
          <Route path="/town" element={<TownPage />} />
          <Route path="/diary" element={<DiaryPage />} />
          <Route path="/resume" element={<ResumePage />} />
        </Routes>
      </main>
      {!immersive && <BottomNav />}
    </div>
  )
}
