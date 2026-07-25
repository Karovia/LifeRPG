/**
 * ============================================================
 * Vercel serverless functions 单元测试（本地验证用，不进 CI/产物）
 * ============================================================
 * 用法：cd app && node scripts/test-api-functions.mjs
 *
 * 验证内容：
 *   1. esbuild 临时转译三个 function（api/llm.ts、api/decompose.ts、
 *      api/pixellab/[...path].ts）—— 同时作为 functions 可编译性检查
 *      （esbuild 来自 vite 的传递依赖，npx/node 直接可用，不新增 npm 依赖）；
 *   2. api/llm.ts 的 env 注入逻辑（stub 上游记录请求）：
 *      - body 缺 baseURL/apiKey/model → 从 LLM_* env 注入（server mode）；
 *      - body 自填配置 → 原样透传（env 不覆盖，Admin 页场景）；
 *      - body 与 env 均缺 → 400；
 *      - 上游 429 → 状态码与 body 原样透传；
 *   3. api/pixellab/[...path].ts 的代理逻辑：
 *      - GET /api/pixellab/balance → /v1/balance，Authorization 用 PIXELLAB_API_KEY；
 *      - POST 方法/body/query 透传；
 *      - 未配置 PIXELLAB_API_KEY → 500；
 *   4. api/decompose.ts 静态契约：default export 为函数，maxDuration = 120。
 * ============================================================
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhijian-api-test-'))

let passed = 0
function ok(name) {
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ---------- 1) 转译三个 function（可编译性检查） ----------
console.log('[1] esbuild 转译 api functions ...')
await build({
  absWorkingDir: appRoot,
  entryPoints: {
    llm: 'api/llm.ts',
    decompose: 'api/decompose.ts',
    pixellab: 'api/pixellab/[...path].ts',
  },
  outdir: tmp,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  logLevel: 'silent',
})
ok('三个 function 均转译成功')

const llmHandler = (await import(pathToFileURL(path.join(tmp, 'llm.mjs')).href)).default
const pixellabHandler = (await import(pathToFileURL(path.join(tmp, 'pixellab.mjs')).href)).default
const decomposeMod = await import(pathToFileURL(path.join(tmp, 'decompose.mjs')).href)

// ---------- 2) stub 上游（记录请求并按路径回包） ----------
const upstreamCalls = []
const upstream = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    upstreamCalls.push({ url: req.url, method: req.method, auth: req.headers.authorization, body })
    if (req.url === '/v1/balance') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'credits', usd: 1.23 }))
      return
    }
    if (req.url?.endsWith('/chat/completions')) {
      const parsed = JSON.parse(body)
      if (parsed.model === 'trigger-429') {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'rate limited' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'stub-ok' } }] }))
      return
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, echo: req.url }))
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
})
await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
const upPort = upstream.address().port

// ---------- 3) function 宿主（按路径分发，模拟 Vercel 路由） ----------
const harness = createServer((req, res) => {
  const run = req.url?.startsWith('/api/pixellab') ? pixellabHandler : llmHandler
  Promise.resolve(run(req, res)).catch((err) => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
  })
})
await new Promise((r) => harness.listen(0, '127.0.0.1', r))
const hPort = harness.address().port
const api = (p, init) => fetch(`http://127.0.0.1:${hPort}${p}`, init)
const postJson = (p, payload) =>
  api(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

try {
  // ---------- 4) api/llm.ts ----------
  console.log('[2] api/llm.ts env 注入与透传 ...')

  // 4.1 server mode：body 不带连接配置 → env 注入
  process.env.LLM_BASE_URL = `http://127.0.0.1:${upPort}/v1`
  process.env.LLM_API_KEY = 'env-secret'
  process.env.LLM_MODEL = 'env-model'
  const resA = await postJson('/api/llm', { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(resA.status, 200)
  const dataA = await resA.json()
  assert.equal(dataA.choices[0].message.content, 'stub-ok')
  const callA = upstreamCalls.at(-1)
  assert.equal(callA.url, '/v1/chat/completions')
  assert.equal(callA.auth, 'Bearer env-secret')
  assert.equal(JSON.parse(callA.body).model, 'env-model')
  ok('body 缺省三件套 → 从 LLM_* env 注入（server mode）')

  // 4.2 Admin 自填配置：body 优先，env 不覆盖
  const resB = await postJson('/api/llm', {
    baseURL: `http://127.0.0.1:${upPort}/v1`,
    apiKey: 'user-secret',
    model: 'user-model',
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(resB.status, 200)
  const callB = upstreamCalls.at(-1)
  assert.equal(callB.auth, 'Bearer user-secret')
  assert.equal(JSON.parse(callB.body).model, 'user-model')
  ok('body 自填配置 → 原样透传（env 不覆盖）')

  // 4.3 body 与 env 均缺 → 400
  delete process.env.LLM_BASE_URL
  delete process.env.LLM_API_KEY
  delete process.env.LLM_MODEL
  const resC = await postJson('/api/llm', { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(resC.status, 400)
  const dataC = await resC.json()
  assert.match(dataC.error, /LLM_BASE_URL/)
  ok('body 与 env 均缺配置 → 400 + 中文错误提示')

  // 4.4 上游 429 → 状态码与 body 原样透传
  const resD = await postJson('/api/llm', {
    baseURL: `http://127.0.0.1:${upPort}/v1`,
    apiKey: 'k',
    model: 'trigger-429',
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(resD.status, 429)
  const textD = await resD.text()
  assert.match(textD, /rate limited/)
  ok('上游 429 → 状态码与 body 透传')

  // ---------- 5) api/pixellab/[...path].ts ----------
  console.log('[3] api/pixellab/[...path].ts 代理 ...')

  // 5.1 GET /balance：路径改写 + Authorization 注入
  process.env.PIXELLAB_API_KEY = 'pix-secret'
  process.env.PIXELLAB_UPSTREAM_BASE_URL = `http://127.0.0.1:${upPort}/v1`
  const resE = await api('/api/pixellab/balance')
  assert.equal(resE.status, 200)
  const dataE = await resE.json()
  assert.equal(dataE.usd, 1.23)
  const callE = upstreamCalls.at(-1)
  assert.equal(callE.url, '/v1/balance')
  assert.equal(callE.method, 'GET')
  assert.equal(callE.auth, 'Bearer pix-secret')
  ok('GET /api/pixellab/balance → /v1/balance + env Bearer 注入')

  // 5.2 POST：方法/body/query 透传
  const resF = await postJson('/api/pixellab/generate-image-pixflux?x=1', {
    description: 'a cat',
    image_size: { width: 64, height: 64 },
  })
  assert.equal(resF.status, 200)
  const callF = upstreamCalls.at(-1)
  assert.equal(callF.url, '/v1/generate-image-pixflux?x=1')
  assert.equal(JSON.parse(callF.body).description, 'a cat')
  assert.equal(callF.auth, 'Bearer pix-secret')
  ok('POST 方法/body/query 透传，Authorization 由服务端注入')

  // 5.3 未配置 PIXELLAB_API_KEY → 500
  delete process.env.PIXELLAB_API_KEY
  const resG = await api('/api/pixellab/balance')
  assert.equal(resG.status, 500)
  const dataG = await resG.json()
  assert.match(dataG.error, /PIXELLAB_API_KEY/)
  ok('未配置 PIXELLAB_API_KEY → 500 + 中文错误提示')

  // ---------- 6) api/decompose.ts 静态契约 ----------
  console.log('[4] api/decompose.ts 静态契约 ...')
  assert.equal(typeof decomposeMod.default, 'function')
  assert.equal(decomposeMod.config?.maxDuration, 120)
  ok('default export 为函数且 maxDuration = 120')

  console.log(`\nALL PASS (${passed} 项)`)
} finally {
  harness.close()
  upstream.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
