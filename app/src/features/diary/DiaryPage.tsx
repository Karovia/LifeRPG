import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelButton, PixelPanel } from '@/components/pixel'
import { diaryReply } from '@/lib/ai'
import { useGameStore } from '@/store/gameStore'
import { cn } from '@/lib/utils'
import './diary.css'

/**
 * ============================================================
 * 魔法日记本（汤姆·里德尔日记本）
 * ------------------------------------------------------------
 * 状态机：
 *   writing  —— 用户正在纸面书写
 *   fading   —— 停笔 2.5s 后，文字像墨水被吸走一样淡出（约 2.2s）
 *   waiting  —— 纸面空白，日记本"思考"中（约 1.5s）
 *   replying —— 回复以墨水浮现效果逐字显现
 *   holding  —— 回复完整展示（约 6s）
 *   replyFading —— 回复缓缓隐去（约 1.8s），随后回到 writing
 * ============================================================
 */

type Phase =
  | 'writing'
  | 'fading'
  | 'waiting'
  | 'replying'
  | 'holding'
  | 'replyFading'

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

  const [phase, setPhase] = useState<Phase>('writing')
  const [content, setContent] = useState('')
  const [reply, setReply] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  /** 纸面背景图加载失败时降级为纯 CSS 纹理 */
  const [bgOk, setBgOk] = useState(true)

  /** 所有定时器统一登记，卸载/打断时清理 */
  const timersRef = useRef<number[]>([])
  /** 会话序号：用户重新书写/打断后，旧定时器回调自动失效 */
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
    setIsTyping(false)
  }, [clearTimers])

  /** 停笔后启动「吸墨 → 浮现 → 隐去」完整流程 */
  const beginInkCycle = useCallback(
    (text: string) => {
      setIsTyping(false)
      setPhase('fading')

      // 1) 文字被纸面吸走
      later(FADE_DURATION, () => setPhase('waiting'))

      // 2) 停顿后，日记本落笔回复
      later(FADE_DURATION + WAIT_BEFORE_REPLY, () => {
        const replyText = diaryReply(text)
        setReply(replyText)
        setPhase('replying')
        // 持久化本次书写
        addDiaryEntry({ date: todayStr(), content: text, reply: replyText })

        const revealMs = replyText.length * CHAR_STAGGER + CHAR_ANIM
        // 3) 回复完整显现后进入展示
        later(revealMs, () => {
          setPhase('holding')
          // 4) 展示后缓缓隐去
          later(REPLY_HOLD, () => {
            setPhase('replyFading')
            later(REPLY_FADE, () => {
              setContent('')
              setReply('')
              setPhase('writing')
            })
          })
        })
      })
    },
    [later, addDiaryEntry],
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContent(value)
    setIsTyping(true)
    // 重新输入：作废旧流程，重新计时
    sessionRef.current += 1
    clearTimers()
    setPhase('writing')
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

          {/* 等待态：纸面空白，仅余墨点 */}
          {phase === 'waiting' && (
            <p className="text-center text-sm text-stone-dark">
              <span className="animate-caret-blink">✒️</span>
            </p>
          )}

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
