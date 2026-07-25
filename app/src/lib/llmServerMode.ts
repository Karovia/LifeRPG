import type { LlmConfig } from '@/store/gameStore'

/**
 * ============================================================
 * LLM Server Mode（生产部署 · 前端零密钥）
 * ============================================================
 * 构建期注入 VITE_LLM_SERVER_MODE=true 时进入 server mode：
 *   - 就绪判定改为「server mode 或 四件套齐备」；store 的 initialLlmConfig
 *     在该模式下 enabled 默认 true、其余字段留空（见 gameStore）；
 *   - 请求体省略 baseURL/apiKey/model，由服务端 function 从
 *     LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 环境变量注入；
 *   - Admin 页用户手填四件套时仍原样上送（body 优先于服务端 env），
 *     保留个人自配覆盖能力。
 * dev 环境或该变量未置 true 时，行为与历史版本完全一致。
 * ============================================================
 */

/** 是否为 server mode（构建期内联常量） */
export const LLM_SERVER_MODE = (import.meta.env.VITE_LLM_SERVER_MODE ?? '') === 'true'

/**
 * LLM 功能就绪判定：server mode 直将就绪（密钥在服务端）；
 * 否则要求 enabled && baseURL && model && apiKey 四件套齐备。
 */
export function isLlmReady(cfg: LlmConfig): boolean {
  if (LLM_SERVER_MODE) return true
  return Boolean(cfg.enabled && cfg.baseURL.trim() && cfg.model.trim() && cfg.apiKey.trim())
}

/**
 * 组装 /api/llm 请求中的连接配置字段：
 * 四件套齐备（Admin 手填或 .env 默认）→ 原样上送；
 * 否则省略（server mode 下由服务端 function 注入 env 配置）。
 */
export function llmConnectionPayload(cfg: LlmConfig): {
  baseURL?: string
  apiKey?: string
  model?: string
} {
  const baseURL = cfg.baseURL.trim()
  const apiKey = cfg.apiKey.trim()
  const model = cfg.model.trim()
  if (baseURL && apiKey && model) return { baseURL, apiKey, model }
  return {}
}
