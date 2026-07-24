import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PixelButton, PixelPanel } from '@/components/pixel'
import { generateResume } from '@/lib/ai'
import { useGameStore } from '@/store/gameStore'
import type { QuestNode } from '@/store/gameStore'
import { MarkdownScroll } from './markdown'
import { getJobTips } from './jobTips'

/** 在 AI 生成内容前补上玩家基本信息头 */
function buildFullResume(
  aiMarkdown: string,
  playerName: string,
  level: number,
  questCount: number,
  diaryCount: number,
): string {
  const header = [
    `# ${playerName} 的冒险者简历`,
    '',
    `**等级 LV.${level}** ｜ 目标树 ${questCount} 棵 ｜ 成长日记 ${diaryCount} 篇`,
    '',
    '--- 以下为根据成长记录整理的正文 ---',
    '',
  ]
  return header.join('\n') + aiMarkdown
}

/** 复制到剪贴板：优先 navigator.clipboard，降级 textarea + execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/** Blob + a[download] 导出 .md 文件 */
function exportMarkdown(text: string, role: string) {
  const date = new Date().toISOString().slice(0, 10)
  const safeRole = role.trim() || 'resume'
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `职见未来-简历-${safeRole}-${date}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 自动化简历/作品集 —— ResumePage（resume 模块_A6） */
export default function ResumePage() {
  const player = useGameStore((s) => s.player)
  const quests = useGameStore((s) => s.quests)
  const diaryEntries = useGameStore((s) => s.diaryEntries)
  const careerIntent = useGameStore((s) => s.careerIntent)
  const setCareerIntent = useGameStore((s) => s.setCareerIntent)

  const [roleDraft, setRoleDraft] = useState(careerIntent.targetRole)
  const [reqDraft, setReqDraft] = useState(careerIntent.requirements)
  const [saved, setSaved] = useState(false)
  const [resumeMd, setResumeMd] = useState('')
  const [toast, setToast] = useState('')

  // 是否有素材（已完成的节点或日记）
  const hasMaterial = useMemo(() => {
    if (diaryEntries.length > 0) return true
    const hasDone = (nodes: QuestNode[]): boolean =>
      nodes.some(
        (n) => n.status === 'done' || (n.children ? hasDone(n.children) : false),
      )
    return quests.some((q) => hasDone(q.nodes))
  }, [diaryEntries, quests])

  const tips = useMemo(
    () => getJobTips(careerIntent.targetRole || roleDraft),
    [careerIntent.targetRole, roleDraft],
  )

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2000)
  }

  const handleSaveIntent = () => {
    setCareerIntent({ targetRole: roleDraft.trim(), requirements: reqDraft.trim() })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const handleGenerate = () => {
    // 生成前同步一次当前意向草稿，避免用户忘记点保存
    const intent = {
      targetRole: roleDraft.trim(),
      requirements: reqDraft.trim(),
    }
    setCareerIntent(intent)
    const aiMd = generateResume(diaryEntries, quests, intent)
    setResumeMd(
      buildFullResume(
        aiMd,
        player.name,
        player.level,
        quests.length,
        diaryEntries.length,
      ),
    )
    showToast('✨ 简历已生成！')
  }

  const handleCopy = async () => {
    const ok = await copyText(resumeMd)
    showToast(ok ? '📋 已复制全文' : '⚠️ 复制失败，请手动选择文本')
  }

  const handleExport = () => {
    exportMarkdown(resumeMd, careerIntent.targetRole || roleDraft)
    showToast('📜 已导出 .md 文件')
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 标题 */}
      <PixelPanel className="text-center" bg="#F3E6C8">
        <h1 className="font-pixel text-sm text-wood-dark">📜 冒险者简历工坊</h1>
        <p className="mt-2 text-xs text-stone-dark">
          把你的冒险记录整理成一份可用的简历/作品集
        </p>
      </PixelPanel>

      {/* 意向设置区 */}
      <PixelPanel>
        <h2 className="font-pixel text-[11px] text-moss-dark">🎯 意向设置</h2>
        <label className="mt-3 block text-xs text-ink">
          意向岗位
          <input
            value={roleDraft}
            onChange={(e) => setRoleDraft(e.target.value)}
            placeholder="如：前端工程师"
            className="pixel-border-sm mt-1 w-full bg-parchment-light px-3 py-2 text-xs text-ink placeholder:text-stone"
          />
        </label>
        <label className="mt-3 block text-xs text-ink">
          岗位要求 / 关键词
          <textarea
            value={reqDraft}
            onChange={(e) => setReqDraft(e.target.value)}
            placeholder="粘贴 JD 或写下关键词，如：React、TypeScript、性能优化…"
            rows={3}
            className="pixel-border-sm mt-1 w-full resize-none bg-parchment-light px-3 py-2 text-xs leading-relaxed text-ink placeholder:text-stone"
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <PixelButton variant="moss" onClick={handleSaveIntent}>
            保存意向
          </PixelButton>
          {saved && <span className="font-pixel text-[10px] text-moss">✔ 已保存</span>}
        </div>
      </PixelPanel>

      {/* 素材为空时的引导 */}
      {!hasMaterial && (
        <PixelPanel bg="#F8EED9" borderColor="#8A5A3B">
          <h2 className="font-pixel text-[11px] text-wood-dark">🗺️ 还没有冒险素材</h2>
          <p className="mt-2 text-xs leading-relaxed text-stone-dark">
            简历内容由「已完成的目标节点」和「日记」提炼而成。先去积累一点冒险记录吧：
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/quests">
              <PixelButton variant="wood">⚔️ 去完成目标节点</PixelButton>
            </Link>
            <Link to="/diary">
              <PixelButton variant="berry">📖 去写一篇日记</PixelButton>
            </Link>
          </div>
        </PixelPanel>
      )}

      {/* 生成区 */}
      <PixelPanel>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-pixel text-[11px] text-moss-dark">⚗️ 简历生成</h2>
          <PixelButton variant="gold" onClick={handleGenerate}>
            ✨ 生成简历
          </PixelButton>
        </div>
        <p className="mt-2 text-xs text-stone-dark">
          将整合 Lv.{player.level} 的 {player.name} 的目标成果与日记记录
        </p>
      </PixelPanel>

      {/* 卷轴展示区 */}
      {resumeMd && (
        <div className="m-1">
          {/* 卷轴上轴 */}
          <div className="pixel-border-sm mx-2 h-3 bg-wood-dark" />
          <PixelPanel bg="#FBF6E8" className="mx-2 max-h-96 overflow-y-auto">
            <MarkdownScroll source={resumeMd} />
          </PixelPanel>
          {/* 卷轴下轴 */}
          <div className="pixel-border-sm mx-2 h-3 bg-wood-dark" />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <PixelButton variant="moss" onClick={handleCopy}>
              📋 复制全文
            </PixelButton>
            <PixelButton variant="wood" onClick={handleExport}>
              💾 导出 .md 文件
            </PixelButton>
            {toast && (
              <span className="font-pixel text-[10px] text-gold-dark">{toast}</span>
            )}
          </div>
        </div>
      )}
      {!resumeMd && toast && (
        <p className="m-1 text-center font-pixel text-[10px] text-gold-dark">{toast}</p>
      )}

      {/* 信息差提示区（告示牌风格） */}
      <PixelPanel bg="#EBD9B8" borderColor="#6B4A2F">
        <h2 className="font-pixel text-[11px] text-wood-dark">
          📌 告示牌 · 求职信息差
          {(careerIntent.targetRole || roleDraft) && (
            <span className="ml-1 text-stone-dark">
              （{careerIntent.targetRole || roleDraft}）
            </span>
          )}
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {tips.map((tip, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink">
              <span className="font-pixel text-[10px] text-berry">{i + 1}.</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </PixelPanel>
    </div>
  )
}
