import { useState } from 'react'
import { PixelButton, PixelPanel } from '@/components/pixel'
import { useGameStore } from '@/store/gameStore'
import type { LlmConfig } from '@/store/gameStore'

/**
 * ============================================================
 * 职见未来 · 管理台（/admin，不进底部导航，HUD ⚙️ 进入）
 * ============================================================
 * - 口令登录（本地单机应用，硬编码校验仅作入口保护）
 * - LLM 配置：BaseURL / Model ID / API Key / enabled 开关
 * - 测试连接：经 /api/llm 代理发一条 ping，验证配置可用性
 * - 配置为空或 enabled=false 时，日记/拆解/NPC 一律走本地降级
 * ============================================================
 */

// ---------- 硬编码管理口令 ----------

const ADMIN_ACCOUNT = 'Karovia'
const ADMIN_PASSWORD = '173256'

// ---------- 通用小组件 ----------

const inputClass =
  'pixel-border-sm w-full bg-parchment-light px-3 py-2 text-sm text-ink placeholder:text-stone focus:outline-none'

function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-pixel text-[10px] text-stone-dark">
      {children}
    </label>
  )
}

// ---------- 登录表单 ----------

function LoginForm() {
  const setAdminAuthed = useGameStore((s) => s.setAdminAuthed)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const submit = () => {
    if (account === ADMIN_ACCOUNT && password === ADMIN_PASSWORD) {
      setError(false)
      setAdminAuthed(true)
    } else {
      setError(true)
    }
  }

  return (
    <PixelPanel className="mt-8">
      <h1 className="text-center font-pixel text-xs text-wood-dark">
        ⚙️ 管理台
      </h1>
      <p className="mt-3 text-center text-sm text-stone-dark">
        输入口令，进入 LLM 配置管理
      </p>

      <div className="mt-5 space-y-3">
        <div>
          <FieldLabel>账号</FieldLabel>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="账号"
            autoComplete="username"
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel>密码</FieldLabel>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="密码"
            autoComplete="current-password"
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="pixel-border-sm mt-4 bg-berry-light px-3 py-2 text-center font-pixel text-[10px] leading-relaxed text-ink">
          ✕ 口令错误
        </p>
      )}

      <div className="mt-5 flex justify-center">
        <PixelButton variant="moss" onClick={submit}>
          进入 ▶
        </PixelButton>
      </div>
    </PixelPanel>
  )
}

// ---------- 测试连接 ----------

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'done'; ok: boolean; summary: string }

/** 从上游响应文本中提取一段简短摘要（成功取模型应答，失败取错误信息） */
function summarizeUpstream(text: string, ok: boolean): string {
  const fallback = text.slice(0, 160) || '（空响应）'
  try {
    const json = JSON.parse(text) as {
      choices?: { message?: { content?: unknown } }[]
      error?: unknown
    }
    if (ok) {
      const content = json.choices?.[0]?.message?.content
      return typeof content === 'string' && content
        ? content.slice(0, 120)
        : fallback
    }
    if (typeof json.error === 'string') return json.error.slice(0, 160)
    if (json.error && typeof json.error === 'object') {
      const msg = (json.error as { message?: unknown }).message
      if (typeof msg === 'string') return msg.slice(0, 160)
      return JSON.stringify(json.error).slice(0, 160)
    }
    return fallback
  } catch {
    return fallback
  }
}

// ---------- 配置表单 ----------

function ConfigForm() {
  const llmConfig = useGameStore((s) => s.llmConfig)
  const setLlmConfig = useGameStore((s) => s.setLlmConfig)
  const clearLlmConfig = useGameStore((s) => s.clearLlmConfig)
  const setAdminAuthed = useGameStore((s) => s.setAdminAuthed)

  const [form, setForm] = useState<LlmConfig>({ ...llmConfig })
  const [showKey, setShowKey] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [test, setTest] = useState<TestState>({ phase: 'idle' })

  const patch = (p: Partial<LlmConfig>) => setForm((f) => ({ ...f, ...p }))

  const canTest =
    form.baseURL.trim().length > 0 &&
    form.model.trim().length > 0 &&
    form.apiKey.trim().length > 0 &&
    test.phase !== 'testing'

  // 当前已保存配置的生效状态（持久化在 store 里的那份）
  const activeNow =
    llmConfig.enabled &&
    llmConfig.baseURL.length > 0 &&
    llmConfig.model.length > 0 &&
    llmConfig.apiKey.length > 0

  const onSave = () => {
    setLlmConfig({
      baseURL: form.baseURL.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim(),
      enabled: form.enabled,
    })
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 2000)
  }

  const onTest = async () => {
    if (!canTest) return
    setTest({ phase: 'testing' })
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseURL: form.baseURL.trim(),
          apiKey: form.apiKey.trim(),
          model: form.model.trim(),
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 8,
        }),
      })
      const text = await res.text()
      if (res.ok) {
        setTest({
          phase: 'done',
          ok: true,
          summary: `模型应答：${summarizeUpstream(text, true)}`,
        })
      } else {
        setTest({
          phase: 'done',
          ok: false,
          summary: `HTTP ${res.status} · ${summarizeUpstream(text, false)}`,
        })
      }
    } catch (err) {
      setTest({
        phase: 'done',
        ok: false,
        summary: `代理不可达：${err instanceof Error ? err.message : String(err)}（请确认 dev server 已注册 /api/llm）`,
      })
    }
  }

  const onClear = () => {
    clearLlmConfig()
    setForm({ baseURL: '', model: '', apiKey: '', enabled: false })
    setTest({ phase: 'idle' })
  }

  return (
    <div className="space-y-2">
      <PixelPanel>
        <h1 className="text-center font-pixel text-xs text-wood-dark">
          ⚙️ LLM 配置管理
        </h1>
        <p className="mt-3 text-center text-xs leading-relaxed text-stone-dark">
          配置任意 OpenAI 兼容接口，为日记回复、任务拆解、NPC 对话注入真实 AI。
          <br />
          未配置或关闭开关时，以上功能自动使用本地降级内容。
        </p>

        {/* 当前生效状态 */}
        <p
          className={`pixel-border-sm mt-4 px-3 py-2 text-center font-pixel text-[10px] leading-relaxed ${
            activeNow ? 'bg-moss-light text-ink' : 'bg-parchment-dark text-stone-dark'
          }`}
        >
          {activeNow
            ? `● LLM 已启用 · ${llmConfig.model}`
            : '○ LLM 未启用 · 当前为本地降级模式'}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <FieldLabel>Base URL</FieldLabel>
            <input
              value={form.baseURL}
              onChange={(e) => patch({ baseURL: e.target.value })}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Model ID</FieldLabel>
            <input
              value={form.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="gpt-4o-mini"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>API Key</FieldLabel>
            <div className="flex items-stretch gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                className="pixel-border-sm pixel-press bg-parchment-dark px-3 text-sm text-ink hover:bg-gold-light"
              >
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {/* enabled 开关 */}
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            onClick={() => patch({ enabled: !form.enabled })}
            className="pixel-border-sm pixel-press flex w-full items-center justify-between bg-parchment-light px-3 py-2 hover:bg-parchment-dark"
          >
            <span className="font-pixel text-[10px] text-stone-dark">
              启用 LLM（关闭则全部走本地降级）
            </span>
            <span
              className={`pixel-border-sm flex h-5 w-10 items-center px-0.5 ${
                form.enabled ? 'justify-end bg-moss' : 'justify-start bg-stone'
              }`}
            >
              <span className="h-3.5 w-3.5 bg-parchment-light" />
            </span>
          </button>
        </div>

        {/* 测试结果 */}
        {test.phase === 'testing' && (
          <p className="mt-4 text-center font-pixel text-[10px] text-stone-dark">
            正在连接模型…
          </p>
        )}
        {test.phase === 'done' && (
          <p
            className={`pixel-border-sm mt-4 break-all px-3 py-2 font-pixel text-[10px] leading-relaxed ${
              test.ok ? 'bg-moss-light text-ink' : 'bg-berry-light text-ink'
            }`}
          >
            {test.ok ? '✓ 连接成功 · ' : '✕ 连接失败 · '}
            {test.summary}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-1">
          <PixelButton variant="moss" onClick={onSave}>
            保存配置
          </PixelButton>
          <PixelButton variant="gold" disabled={!canTest} onClick={onTest}>
            {test.phase === 'testing' ? '测试中…' : '测试连接'}
          </PixelButton>
        </div>
        {savedFlash && (
          <p className="mt-2 text-center font-pixel text-[10px] text-moss-dark">
            ✓ 已保存
          </p>
        )}
      </PixelPanel>

      <PixelPanel>
        <div className="flex flex-wrap justify-center gap-1">
          <PixelButton variant="berry" onClick={onClear}>
            清除配置
          </PixelButton>
          <PixelButton variant="wood" onClick={() => setAdminAuthed(false)}>
            退出登录
          </PixelButton>
        </div>
      </PixelPanel>
    </div>
  )
}

// ---------- 页面入口 ----------

export default function AdminPage() {
  const adminAuthed = useGameStore((s) => s.adminAuthed)
  return <div className="p-2">{adminAuthed ? <ConfigForm /> : <LoginForm />}</div>
}
