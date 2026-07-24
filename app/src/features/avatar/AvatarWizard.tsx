import { useState } from 'react'
import { PixelButton, PixelPanel } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { createCharacter, PixellabError } from '@/lib/pixellab'
import { buildEnglishPrompt, SUGGESTION_GROUPS } from './prompt'
import { PixelAvatar, PLACEHOLDER_AVATAR } from './PixelAvatar'

/** 生成可能很慢（实测 24s~120s+），轮播提示语 */
const LOADING_TIPS = [
  '像素法师正在绘制你的形象…',
  '正在挑选发型与装备…',
  '正在点亮像素格…',
  '耐心是冒险者的美德…',
]

interface AvatarWizardProps {
  /** 是否为已有形象用户的「重新生成」模式 */
  regenerating?: boolean
  /** 向导完成（已 setAvatar）或取消重新生成时回调 */
  onExit: () => void
}

/** 步骤指示器：像素方块 */
function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className={`pixel-border-sm flex h-7 w-7 items-center justify-center font-pixel text-[10px] ${
            n <= step ? 'bg-gold text-ink' : 'bg-stone-light text-stone-dark'
          }`}
        >
          {n}
        </div>
      ))}
    </div>
  )
}

export default function AvatarWizard({ regenerating = false, onExit }: AvatarWizardProps) {
  const player = useGameStore((s) => s.player)
  const draft = useGameStore((s) => s.avatarDraft)
  const updateAvatarDraft = useGameStore((s) => s.updateAvatarDraft)
  const resetAvatarDraft = useGameStore((s) => s.resetAvatarDraft)
  const setPlayerName = useGameStore((s) => s.setPlayerName)
  const setAvatar = useGameStore((s) => s.setAvatar)

  // 第 1 步：名字输入（已有非默认名字则预填）
  const [nameInput, setNameInput] = useState(
    player.name && player.name !== '冒险者' ? player.name : '',
  )
  // 第 3 步：生成状态
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tipIndex, setTipIndex] = useState(0)

  const step = draft.step <= 0 ? 0 : draft.step

  /** 调用 Pixellab 生成形象（失败进入错误态，可重试） */
  const runGenerate = async () => {
    setGenerating(true)
    setError(null)
    setTipIndex(0)
    const tipTimer = setInterval(
      () => setTipIndex((i) => (i + 1) % LOADING_TIPS.length),
      4000,
    )
    try {
      const prompt = buildEnglishPrompt(draft.description)
      const img = await createCharacter(prompt)
      updateAvatarDraft({ previewUrl: img.dataUrl, step: 3 })
    } catch (e) {
      if (e instanceof PixellabError && e.status === 402) {
        setError('像素法师的魔法能量不足（生成服务余额已耗尽）')
      } else if (e instanceof PixellabError) {
        setError(`生成失败：${e.message.slice(0, 80)}`)
      } else {
        setError('生成失败：网络似乎开小差了')
      }
    } finally {
      clearInterval(tipTimer)
      setGenerating(false)
    }
  }

  /** 完成创建：保存形象并清空草稿 */
  const finish = (url: string) => {
    setAvatar(url)
    resetAvatarDraft()
    onExit()
  }

  // ---------- 第 0 步：欢迎页 ----------
  if (step === 0) {
    return (
      <PixelPanel className="text-center">
        <h1 className="font-pixel text-sm leading-relaxed text-wood-dark">
          创建你的冒险者
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-stone-dark">
          欢迎来到「职见未来」！
          <br />
          在踏上职业冒险之前，
          <br />
          先塑造你的像素化身吧。
        </p>
        <div className="mt-6 flex justify-center">
          <PixelButton variant="gold" onClick={() => updateAvatarDraft({ step: 1 })}>
            ▶ 开始创建
          </PixelButton>
        </div>
      </PixelPanel>
    )
  }

  // ---------- 第 1 步：输入名字 ----------
  if (step === 1) {
    const canNext = nameInput.trim().length > 0
    return (
      <PixelPanel>
        <StepDots step={1} />
        <h2 className="mt-4 text-center font-pixel text-xs text-wood-dark">
          第一步 · 你的名字
        </h2>
        <p className="mt-3 text-center text-sm text-stone-dark">
          冒险者，该如何称呼你？
        </p>
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          maxLength={12}
          placeholder="例如：小林"
          className="pixel-border-sm mt-4 w-full bg-parchment-light px-3 py-2 text-center text-ink placeholder:text-stone focus:outline-none"
        />
        <div className="mt-5 flex justify-center gap-2">
          {regenerating && (
            <PixelButton variant="wood" onClick={onExit}>
              返回
            </PixelButton>
          )}
          <PixelButton
            variant="moss"
            disabled={!canNext}
            onClick={() => {
              setPlayerName(nameInput.trim())
              updateAvatarDraft({ step: 2 })
            }}
          >
            下一步 ▶
          </PixelButton>
        </div>
      </PixelPanel>
    )
  }

  // ---------- 第 2 步：描述形象 ----------
  if (step === 2) {
    const canGenerate = draft.description.trim().length > 0 && !generating
    return (
      <PixelPanel>
        <StepDots step={2} />
        <h2 className="mt-4 text-center font-pixel text-xs text-wood-dark">
          第二步 · 描绘形象
        </h2>
        <p className="mt-3 text-center text-sm text-stone-dark">
          用文字描述你想成为的样子：发型、发色、服装、道具…
        </p>
        <textarea
          value={draft.description}
          onChange={(e) => updateAvatarDraft({ description: e.target.value })}
          rows={3}
          maxLength={120}
          placeholder="例如：黑色短发，戴着眼镜，穿绿色斗篷，拿着一本书，微笑"
          className="pixel-border-sm mt-4 w-full resize-none bg-parchment-light px-3 py-2 text-sm text-ink placeholder:text-stone focus:outline-none"
        />
        {/* 快捷标签 */}
        <div className="mt-3 space-y-2">
          {SUGGESTION_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 font-pixel text-[10px] text-stone-dark">
                {group.label}
              </span>
              {group.chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() =>
                    updateAvatarDraft({
                      description: draft.description
                        ? `${draft.description.replace(/[，,。\s]*$/, '')}，${chip}`
                        : chip,
                    })
                  }
                  className="pixel-border-sm pixel-press bg-parchment-dark px-2 py-1 text-xs text-ink hover:bg-gold-light"
                >
                  {chip}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-center gap-2">
          {!regenerating && (
            <PixelButton variant="wood" onClick={() => updateAvatarDraft({ step: 1 })}>
              ◀ 上一步
            </PixelButton>
          )}
          <PixelButton
            variant="gold"
            disabled={!canGenerate}
            onClick={() => {
              updateAvatarDraft({ step: 3, previewUrl: null })
              // 进入第 3 步后立即开始生成
              setTimeout(runGenerate, 0)
            }}
          >
            ✦ 生成形象
          </PixelButton>
        </div>
      </PixelPanel>
    )
  }

  // ---------- 第 3 步：生成与确认 ----------
  return (
    <PixelPanel>
      <StepDots step={3} />
      <h2 className="mt-4 text-center font-pixel text-xs text-wood-dark">
        第三步 · 你的化身
      </h2>

      <div className="mt-4 flex justify-center">
        <div className="pixel-border bg-parchment-dark p-2">
          {generating ? (
            <div className="flex h-40 w-40 flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 animate-bounce bg-gold" />
              <span className="px-2 text-center font-pixel text-[10px] leading-relaxed text-stone-dark">
                LOADING…
              </span>
            </div>
          ) : error ? (
            <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 px-3">
              <span className="text-3xl">🕯️</span>
              <span className="text-center font-pixel text-[10px] leading-relaxed text-berry-dark">
                ERROR
              </span>
            </div>
          ) : (
            <PixelAvatar src={draft.previewUrl} className="h-40 w-40" />
          )}
        </div>
      </div>

      {/* 状态文案 */}
      <p className="mt-4 min-h-6 text-center text-sm leading-relaxed text-stone-dark">
        {generating ? (
          <span className="animate-pulse">{LOADING_TIPS[tipIndex]}</span>
        ) : error ? (
          <span className="text-berry">{error}</span>
        ) : (
          '这位就是你在这个世界的化身！'
        )}
      </p>

      {/* 操作按钮 */}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {generating ? null : error ? (
          <>
            <PixelButton variant="gold" onClick={runGenerate}>
              ↻ 重试
            </PixelButton>
            <PixelButton variant="moss" onClick={() => finish(PLACEHOLDER_AVATAR)}>
              使用默认形象
            </PixelButton>
            <PixelButton variant="wood" onClick={() => updateAvatarDraft({ step: 2 })}>
              修改描述
            </PixelButton>
          </>
        ) : (
          <>
            <PixelButton
              variant="moss"
              disabled={!draft.previewUrl}
              onClick={() => draft.previewUrl && finish(draft.previewUrl)}
            >
              ✔ 确认完成
            </PixelButton>
            <PixelButton variant="gold" onClick={runGenerate}>
              ↻ 重新生成
            </PixelButton>
            <PixelButton variant="wood" onClick={() => updateAvatarDraft({ step: 2 })}>
              修改描述
            </PixelButton>
          </>
        )}
      </div>
    </PixelPanel>
  )
}
