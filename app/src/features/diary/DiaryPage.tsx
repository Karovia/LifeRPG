import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelButton, PixelPanel } from '@/components/pixel'
import { diaryReply } from '@/lib/ai'
import { useGameStore } from '@/store/gameStore'
import { cn } from '@/lib/utils'
import { fetchLlmDiaryReply, isLlmReady } from './llm'
import './diary.css'

/**
 * ============================================================
 * 魔法日记本（汤姆·里德尔日记本）
 * ------------------------------------------------------------
 * 状态机：
 *   writing  —— 用户正在纸面书写
 *   fading   —— 停笔 2.5s 后，文字像墨水被吸走一样淡出（约 2.2s）
 *   waiting  —— 纸面空白，日记本"思考"中
 *               · 本地降级：固定约 1.5s（✒️ 墨点）
 *               · LLM：显示「墨水晕开…」，不设上限，响应到达才进入 replying
 *   replying —— 回复以墨水浮现效果逐字显现
 *   holding  —— 回复完整展示（约 6s）
 *   replyFading —— 回复缓缓隐去（约 1.8s），随后回到 writing
 *
 * 回复来源：
 *   llmConfig 四者齐备 → POST /api/llm（90s 超时）；
 *   任一不齐 / 非 2xx / 超时 / 网络错误 → 静默回退本地 diaryReply。
 *   回复展示时以极小徽标区分来源（✨AI 回应 / 📜 纸灵回应）。
 * ============================================================
 */

type Phase =
  | 'writing'
  | 'fading'
  | 'waiting'
  | 'replying'
  | 'holding'
  | 'replyFading'

/** 回复来源：ai = LLM，local = 本地降级（纸灵） */
type ReplySource = 'ai' | 'local'

/** 各阶段时长（ms） */
const IDLE_BEFORE_FADE = 2500
const FADE_DURATION = 2300 // 略大于 CSS 动画 2.2s
const WAIT_BEFORE_REPLY = 1500
const CHAR_STAGGER = 55 // 每个字的浮现间隔
const CHAR_ANIM = 900 // 单字浮现动画时长
const REPLY_HOLD = 6000
const REPLY_FADE = 1900 // 略大于 CSS 动画 1.8s

const PARCHMENT_BG = '/assets/bg/parchment.png'

function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export default function DiaryPage() {
  const diaryEntries = useGameStore((s) => s.diaryEntries)
  const addDiaryEntry = useGameStore((s) => s.addDiaryEntry)
  const llmConfig = useGameStore((s) => s.llmConfig)

  const [phase, setPhase] = useState<Phase>('writing')
  const [content, setContent] = useState('')
  const [reply, setReply] = useState('')
  const [replySource, setReplySource] = useState<ReplySource | null>(null)
  /** 当前等待是否在为 LLM 而等（决定 waiting 阶段展示哪种动画） */
  const [waitingForLlm, setWaitingForLlm] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  /** 纸面背景图加载失败时降级为纯 CSS 纹理 */
  const [bgOk, setBgOk] = useState(true)

  /** 所有定时器统一登记，卸载/打断时清理 */
  const timersRef = useRef<number[]>([])
  /** 会话序号：用户重新书写/打断后，旧定时器与旧 LLM 回调自动失效 */
  const sessionRef = useRef(0)

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t))
    timersRef.current = []
  }, [])

  const later = useCallback(
    (ms: number, fn: () => void) => {
      const session = sessionRef.current
      const t = window.setTimeout(() => {
        if (sessionRef.current === session) fn()
      }, ms)
      timersRef.current.push(t)
    },
    [],
  )

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      clearTimers()
    }
  }, [clearTimers])

  /** 打断当前流程，回到书写状态（点击纸面或翻页时触发） */
  const backToWriting = useCallback(() => {
    sessionRef.current += 1
    clearTimers()
    setPhase('writing')
    setReply('')
    setReplySource(null)
    setWaitingForLlm(false)
    setIsTyping(false)
  }, [clearTimers])

  /** 回复就绪：逐字浮现 → 展示 → 隐去 → 落库已在进入前完成 */
  const revealReply = useCallback(
    (replyText: string, source: ReplySource, text: string) => {
      setReply(replyText)
      setReplySource(source)
      setWaitingForLlm(false)
      setPhase('replying')
      // 持久化本次书写
      addDiaryEntry({ date: todayStr(), content: text, reply: replyText })

      const revealMs = replyText.length * CHAR_STAGGER + CHAR_ANIM
      // 回复完整显现后进入展示
      later(revealMs, () => {
        setPhase('holding')
        // 展示后缓缓隐去
        later(REPLY_HOLD, () => {
          setPhase('replyFading')
          later(REPLY_FADE, () => {
            setContent('')
            setReply('')
            setReplySource(null)
            setPhase('writing')
          })
        })
      })
    },
    [later, addDiaryEntry],
  )

  /** 停笔后启动「吸墨 → 等待 → 浮现 → 隐去」完整流程 */
  const beginInkCycle = useCallback(
    (text: string) => {
      setIsTyping(false)
      setPhase('fading')

      // ---------- LLM 路径：配置齐备才启用，失败静默降级 ----------
      if (isLlmReady(llmConfig)) {
        const session = sessionRef.current
        const start = Date.now()
        setWaitingForLlm(true)

        // 1) 文字被纸面吸走后进入等待（墨水晕开…，不设上限）
        later(FADE_DURATION, () => setPhase('waiting'))

        // 2) 与吸墨并行发起 LLM 请求；响应到达（或降级就绪）才进入浮现
        fetchLlmDiaryReply(text, llmConfig)
          .then(
            (t): { text: string; source: ReplySource } => ({
              text: t,
              source: 'ai',
            }),
          )
          .catch(
            (): { text: string; source: ReplySource } => ({
              text: diaryReply(text),
              source: 'local',
            }),
          )
          .then((result) => {
            if (sessionRef.current !== session) return
            // 吸墨尚未放完则补足剩余时长，保证视觉节奏不被快响应打断
            const remain = Math.max(0, FADE_DURATION - (Date.now() - start))
            later(remain, () => revealReply(result.text, result.source, text))
          })
        return
      }

      // ---------- 本地降级路径：节奏与原版一致 ----------
      // 1) 文字被纸面吸走
      later(FADE_DURATION, () => setPhase('waiting'))

      // 2) 停顿后，日记本落笔回复
      later(FADE_DURATION + WAIT_BEFORE_REPLY, () => {
        revealReply(diaryReply(text), 'local', text)
      })
    },
    [later, llmConfig, revealReply],
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContent(value)
    setIsTyping(true)
    // 重新输入：作废旧流程（含在途 LLM 响应），重新计时
    sessionRef.current += 1
    clearTimers()
    setPhase('writing')
    setWaitingForLlm(false)
    if (value.trim()) {
      later(IDLE_BEFORE_FADE, () => beginInkCycle(value))
    } else {
      setIsTyping(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-2">
      {/* ===== 标题 ===== */}
      <div className="mb-4 flex items-center justify-center gap-3">
        <span
          className={cn(
            'diary-quill text-2xl',
            isTyping && 'diary-quill-writing',
          )}
          aria-hidden
        >
          🪶
        </span>
        <h1 className="font-pixel text-sm tracking-wider text-wood-dark">
          魔法日记本
        </h1>
      </div>

      {/* ===== 摊开的日记本 ===== */}
      <div className="diary-book-shadow relative overflow-hidden rounded-sm">
        {/* 纸面底色：CSS 纹理（素材缺失时的降级方案） */}
        <div className="diary-paper absolute inset-0" aria-hidden />
        {/* 纸面背景图：加载失败时自动隐藏，露出下方 CSS 纹理 */}
        {bgOk && (
          <img
            src={PARCHMENT_BG}
            alt=""
            aria-hidden
            onError={() => setBgOk(false)}
            className="pixelated pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80"
          />
        )}
        {/* 书页中缝 */}
        <div
          className="diary-crease pointer-events-none absolute inset-y-0 left-0 right-0"
          aria-hidden
        />

        <div
          className="relative min-h-[420px] px-8 py-10 sm:px-14"
          onClick={phase !== 'writing' ? backToWriting : undefined}
          title={phase !== 'writing' ? '点击纸面可重新书写' : undefined}
        >
          {/* 页眉日期 */}
          <p className="mb-6 text-center font-pixel text-[10px] text-stone-dark">
            — {todayStr()} —
          </p>

          {/* 回复来源徽标（极小，不阻断交互） */}
          {replySource &&
            (phase === 'replying' ||
              phase === 'holding' ||
              phase === 'replyFading') && (
              <span
                className={cn(
                  'pointer-events-none absolute right-3 top-3 font-pixel text-[8px] tracking-wider',
                  replySource === 'ai' ? 'text-gold-dark' : 'text-stone-dark',
                )}
              >
                {replySource === 'ai' ? '✨ AI 回应' : '📜 纸灵回应'}
              </span>
            )}

          {/* 书写态：纸面 textarea */}
          {phase === 'writing' && (
            <textarea
              value={content}
              onChange={handleChange}
              placeholder="写下今天的成长……停笔片刻，墨水会被日记本吸走。"
              autoFocus
              className={cn(
                'h-72 w-full resize-none bg-transparent leading-loose text-ink',
                'placeholder:text-stone focus:outline-none',
                'text-base tracking-wide',
              )}
              style={{ fontFamily: '"Kaiti SC", KaiTi, "STKaiti", cursive' }}
            />
          )}

          {/* 淡出态：文字被吸走 */}
          {phase === 'fading' && (
            <p
              className="diary-ink-fade-out whitespace-pre-wrap leading-loose text-ink"
              style={{ fontFamily: '"Kaiti SC", KaiTi, "STKaiti", cursive' }}
            >
              {content}
            </p>
          )}

          {/* 等待态：LLM=墨水晕开（无上限）；本地=仅余墨点 */}
          {phase === 'waiting' &&
            (waitingForLlm ? (
              <div className="flex flex-col items-center gap-4 pt-12">
                <div className="relative h-16 w-16" aria-hidden>
                  <span className="diary-ink-blot absolute inset-0" />
                  <span className="diary-ink-blot diary-ink-blot-late absolute inset-2" />
                </div>
                <p className="font-pixel text-[10px] tracking-wider text-stone-dark">
                  墨水晕开<span className="animate-caret-blink">…</span>
                </p>
              </div>
            ) : (
              <p className="text-center text-sm text-stone-dark">
                <span className="animate-caret-blink">✒️</span>
              </p>
            ))}

          {/* 回复态：逐字浮现 / 展示 / 隐去 */}
          {(phase === 'replying' || phase === 'holding') && (
            <p
              className="whitespace-pre-wrap leading-loose text-wood-dark"
              style={{ fontFamily: '"Kaiti SC", KaiTi, "STKaiti", cursive' }}
            >
              {phase === 'replying'
                ? reply.split('').map((ch, i) => (
                    <span
                      key={`${i}-${ch}`}
                      className="diary-ink-char"
                      style={{ animationDelay: `${i * CHAR_STAGGER}ms` }}
                    >
                      {ch}
                    </span>
                  ))
                : reply}
            </p>
          )}
          {phase === 'replyFading' && (
            <p
              className="diary-reply-fade-out whitespace-pre-wrap leading-loose text-wood-dark"
              style={{ fontFamily: '"Kaiti SC", KaiTi, "STKaiti", cursive' }}
            >
              {reply}
            </p>
          )}
        </div>
      </div>

      {/* ===== 提示与翻页 ===== */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-stone-dark">
          {phase === 'writing'
            ? '停笔片刻，日记本会回应你。'
            : '墨水涌动中……点击纸面可重新书写。'}
        </p>
        <PixelButton
          variant="wood"
          onClick={() => {
            backToWriting()
            setShowHistory((v) => !v)
          }}
        >
          {showHistory ? '📖 合上旧页' : '📜 翻阅旧页'}
        </PixelButton>
      </div>

      {/* ===== 历史条目 ===== */}
      {showHistory && (
        <div className="mt-4 space-y-3">
          {diaryEntries.length === 0 && (
            <PixelPanel className="text-center">
              <p className="text-sm text-stone-dark">
                旧页还空着，写下第一篇吧。
              </p>
            </PixelPanel>
          )}
          {[...diaryEntries].reverse().map((entry) => (
            <PixelPanel key={entry.id} bg="#F5ECD7">
              <p className="font-pixel text-[9px] text-gold-dark">
                {entry.date}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink">
                {entry.content.length > 80
                  ? `${entry.content.slice(0, 80)}……`
                  : entry.content}
              </p>
              <p className="mt-2 border-t-2 border-dashed border-parchment-dark pt-2 text-sm italic leading-relaxed text-wood-dark">
                「{entry.reply}」
              </p>
            </PixelPanel>
          ))}
        </div>
      )}
    </div>
  )
}
