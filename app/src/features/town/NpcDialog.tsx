import { PixelButton, PixelPanel, PixelProgressBar } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import { useEffect, useRef, useState } from 'react'
import { PixelImage } from './PixelImage'
import {
  NPC_META,
  buildCommission,
  npcGreeting,
  npcReply,
  scoreMessage,
} from './townData'

interface NpcDialogProps {
  npcId: string
  onClose: () => void
}

interface ChatMsg {
  from: 'npc' | 'me' | 'sys'
  text: string
}

const REPORT_MIN_LEN = 20

/**
 * NPC 对话条：从屏幕底部滑入的覆盖式 DOM overlay（不遮挡场景中心）。
 * 含头像 / 好感度条 / 聊天 / 委托流程。
 */
export function NpcDialog({ npcId, onClose }: NpcDialogProps) {
  const npc = useGameStore((s) => s.town.npcs.find((n) => n.id === npcId))
  const commissions = useGameStore((s) => s.town.commissions)
  const player = useGameStore((s) => s.player)
  const quests = useGameStore((s) => s.quests)
  const setNpcFavorability = useGameStore((s) => s.setNpcFavorability)
  const addCommission = useGameStore((s) => s.addCommission)
  const updateCommissionStatus = useGameStore((s) => s.updateCommissionStatus)
  const addCoins = useGameStore((s) => s.addCoins)

  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    { from: 'npc', text: npcGreeting(npcId) },
  ])
  const [input, setInput] = useState('')
  const [report, setReport] = useState('')
  const [reportHint, setReportHint] = useState<string | null>(null)

  const lastInputRef = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // 聊天自动滚到底部
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  if (!npc) return null

  const npcImg = NPC_META.find((n) => n.id === npcId)?.img ?? ''
  const npcCommissions = commissions.filter((c) => c.npcId === npcId)
  const activeCommission = npcCommissions.find((c) => c.status !== 'done')
  const doneCommissions = npcCommissions.filter((c) => c.status === 'done')

  const send = () => {
    const text = input.trim()
    if (!text) return
    const { delta, dismissive } = scoreMessage(text, npcId, lastInputRef.current)
    lastInputRef.current = text
    const reply = npcReply(npcId, text, dismissive)
    const next: ChatMsg[] = [
      { from: 'me', text },
      { from: 'npc', text: reply },
      ...(delta > 0
        ? [{ from: 'sys' as const, text: `好感度 +${delta}` }]
        : []),
    ]
    setMessages((m) => [...m, ...next])
    if (delta > 0) setNpcFavorability(npcId, npc.favorability + delta)
    setInput('')
  }

  const offerCommission = () => {
    const tpl = buildCommission(npc, player, quests)
    addCommission({
      npcId,
      title: tpl.title,
      description: tpl.description,
      status: 'offered',
      rewardCoins: tpl.rewardCoins,
    })
  }

  const submitReport = () => {
    if (!activeCommission) return
    const text = report.trim()
    if (text.length <= REPORT_MIN_LEN) {
      setReportHint(`再多写一点吧（需要超过 ${REPORT_MIN_LEN} 字才算认真）`)
      return
    }
    updateCommissionStatus(activeCommission.id, 'done')
    addCoins(activeCommission.rewardCoins)
    setNpcFavorability(npcId, npc.favorability + 5)
    setMessages((m) => [
      ...m,
      { from: 'sys', text: `委托完成！+${activeCommission.rewardCoins} 金币，好感度 +5` },
      { from: 'npc', text: '说得真好。这是给你的报酬，以后也常来坐坐。' },
    ])
    setReport('')
    setReportHint(null)
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-3">
      {/* 底部滑入动效 */}
      <style>{`
        @keyframes town-dialog-in {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .town-dialog-in { animation: town-dialog-in 0.28s steps(7, end) both; }
      `}</style>

      <PixelPanel className="town-dialog-in flex max-h-[52dvh] flex-col gap-2 overflow-y-auto">
        {/* 头部：头像 / 名字 / 性格 / 好感度 */}
        <div className="flex items-start gap-2">
          <div className="pixel-border-sm m-[3px] shrink-0 bg-parchment-dark p-[2px]">
            <PixelImage
              src={npcImg}
              alt={npc.name}
              className="h-10 w-10 object-contain"
              fallbackClassName="h-10 w-10 bg-wood"
              fallbackText="人"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-pixel text-xs text-ink">{npc.name}</div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-stone-dark">
              {npc.personality}
            </p>
            <PixelProgressBar
              className="mt-1 max-w-48"
              variant="hp"
              value={npc.favorability}
              max={100}
              segments={10}
              label="好感度"
            />
          </div>
          <PixelButton variant="berry" onClick={onClose} aria-label="结束对话">
            离开
          </PixelButton>
        </div>

        {/* 聊天记录 */}
        <div
          ref={logRef}
          className="pixel-border-sm m-1 h-28 overflow-y-auto bg-parchment-dark p-2"
        >
          {messages.map((m, i) =>
            m.from === 'sys' ? (
              <div key={i} className="my-1 text-center font-pixel text-[9px] text-gold-dark">
                ✦ {m.text} ✦
              </div>
            ) : (
              <div
                key={i}
                className={`mb-1 flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`pixel-border-sm m-[3px] max-w-[80%] px-2 py-1 text-[11px] leading-4 ${
                    m.from === 'me' ? 'bg-moss-light text-ink' : 'bg-parchment-light text-ink'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ),
          )}
        </div>

        {/* 输入行 */}
        <div className="flex gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
            placeholder="认真聊聊才会提升好感度……"
            className="pixel-border-sm m-1 min-w-0 flex-1 bg-parchment-light px-2 py-1 text-[11px] text-ink placeholder:text-stone"
          />
          <PixelButton variant="moss" onClick={send}>
            发送
          </PixelButton>
        </div>

        {/* 委托区 */}
        <div className="pixel-border-sm m-1 bg-parchment-dark p-2">
          <div className="mb-1 font-pixel text-[10px] text-wood-dark">委托</div>

          {!activeCommission && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-dark">
                {doneCommissions.length > 0
                  ? `已完成 ${doneCommissions.length} 个委托`
                  : '这位居民似乎有个挑战想交给你'}
              </span>
              <PixelButton variant="gold" onClick={offerCommission}>
                领取委托
              </PixelButton>
            </div>
          )}

          {activeCommission && (
            <div className="flex flex-col gap-1">
              <div className="font-pixel text-[10px] text-ink">
                {activeCommission.title}
                <span className="ml-1 text-gold-dark">+{activeCommission.rewardCoins} 金币</span>
              </div>
              <p className="text-[11px] leading-4 text-stone-dark">
                {activeCommission.description}
              </p>

              {activeCommission.status === 'offered' && (
                <div>
                  <PixelButton
                    variant="moss"
                    onClick={() => updateCommissionStatus(activeCommission.id, 'accepted')}
                  >
                    接受委托
                  </PixelButton>
                </div>
              )}

              {activeCommission.status === 'accepted' && (
                <div className="flex flex-col gap-1">
                  <textarea
                    value={report}
                    onChange={(e) => setReport(e.target.value)}
                    rows={3}
                    placeholder="达成条件后，回来认真讲讲你的感受（超过 20 字）……"
                    className="pixel-border-sm m-1 bg-parchment-light px-2 py-1 text-[11px] leading-4 text-ink placeholder:text-stone"
                  />
                  {reportHint && (
                    <div className="font-pixel text-[9px] text-berry">{reportHint}</div>
                  )}
                  <div>
                    <PixelButton variant="gold" onClick={submitReport}>
                      汇报感受
                    </PixelButton>
                  </div>
                </div>
              )}
            </div>
          )}

          {doneCommissions.length > 0 && activeCommission && (
            <div className="mt-1 font-pixel text-[9px] text-stone">
              已完成：{doneCommissions.map((c) => c.title.replace(/^.*· /, '')).join('、')}
            </div>
          )}
        </div>
      </PixelPanel>
    </div>
  )
}
