# 部署指南 · Vercel

「职见未来」是 Vite + React + TS 的 SPA。开发期的三个服务端能力（LLM 代理、
AI 目标拆解、Pixellab 代理）原本只存在于 vite dev server；本仓库已将其改造为
Vercel serverless functions，生产部署后行为与 dev 一致，且前端构建产物**零密钥**。

---

## 1. 架构说明：dev 中间件 vs 生产 functions

| 能力 | 开发环境（vite dev） | 生产环境（Vercel） |
| --- | --- | --- |
| 通用 LLM 代理 | vite 中间件 `POST /api/llm`（`app/vite-plugins/llm-proxy.ts`） | serverless function `app/api/llm.ts` |
| AI 目标拆解 | vite 中间件 `POST /api/decompose`（`app/vite-plugins/decompose-api.ts`） | serverless function `app/api/decompose.ts` |
| Pixellab 代理 | vite `server.proxy`：`/pixellab/*` → `https://api.pixellab.ai/v1/*` | serverless function `app/api/pixellab/[...path].ts`：`/api/pixellab/*` → 同上游 |
| SPA 路由 | vite history fallback | `app/vercel.json` rewrites：`/api/*` 以外全部 → `/index.html` |

两套宿主**共用同一套核心逻辑**（`app/api/_lib/`：`http.ts`、`llm-core.ts`、
`decompose-core.ts`），vite 插件只是薄壳，保证 dev 与生产契约一致：

- `POST /api/llm`：body `{ baseURL?, apiKey?, model?, messages, temperature?, maxTokens?, responseFormat? }`。
  连接三件套逐字段回退：body 优先，缺省从服务端 env `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` 注入；
  上游 60s 超时，上游状态码与 body 原样透传（错误透传），无上游响应返回 504/502。
- `POST /api/decompose`：body `{ goal, llm? }`。搜索链（Bing → 搜狗 → DuckDuckGo）
  + LLM 拆解 + 规则引擎兜底；LLM 配置优先 `body.llm`，缺省用 env `LLM_*`；
  `maxDuration: 120`（内部软预算 105s，任何路径都会在平台强杀前返回）。
- `/api/pixellab/*`：方法 / 查询串 / body 透传，`Authorization` 一律由服务端
  `PIXELLAB_API_KEY` 注入（覆盖客户端头）。

### Server mode（生产前端零密钥）

构建期注入 `VITE_LLM_SERVER_MODE=true` 后：

- store 的初始 LLM 配置：`enabled = true`，baseURL / model / apiKey 留空；
- 三个前端就绪判断（日记、NPC 对话、成就树）改为「server mode 或四件套齐备」；
- 前端请求 `/api/llm` / `/api/decompose` 时**不携带**连接三件套，由 function 注入 env；
- `src/lib/pixellab.ts`：dev 仍走 `/pixellab`（前端自带 key），生产走 `/api/pixellab`
  （key 在服务端），生产构建不再需要 `VITE_PIXELLAB_API_KEY`。

**Admin 页仍可覆盖**：用户手填四件套时原样上送（body 优先于服务端 env），
保留个人自配 LLM 的能力。

---

## 2. 部署步骤

前置：安装 Vercel CLI（`npm i -g vercel`），项目代码在 `app/` 目录。

```bash
cd app

# 1) 登录并关联项目（首次）
vercel login
vercel link          # 按提示创建或选择项目；root directory 即 app/

# 2) 配置环境变量（见下节清单）
vercel env add LLM_BASE_URL production
vercel env add LLM_API_KEY production
vercel env add LLM_MODEL production
vercel env add PIXELLAB_API_KEY production
vercel env add VITE_LLM_SERVER_MODE production   # 值填 true
# 也可在 Vercel Dashboard → Project → Settings → Environment Variables 配置

# 3) 部署
vercel deploy --prod
```

### 环境变量清单

| 变量 | 作用域 | 说明 |
| --- | --- | --- |
| `LLM_BASE_URL` | Serverless（服务端） | OpenAI 兼容 API 基础地址，如 `https://api.stepfun.com/step_plan/v1` |
| `LLM_API_KEY` | Serverless（服务端） | LLM Bearer 密钥 |
| `LLM_MODEL` | Serverless（服务端） | 模型 ID，如 `step-3.5-flash-2603` |
| `PIXELLAB_API_KEY` | Serverless（服务端） | Pixellab 像素图生成密钥 |
| `VITE_LLM_SERVER_MODE` | Build（构建期） | 填 `true`，开启 server mode（前端零密钥） |

注意：`LLM_*` / `PIXELLAB_API_KEY` 无 `VITE_` 前缀，只存在于服务端，不会进前端产物。
server mode 下**不要**再配置 `VITE_LLM_API_KEY` / `VITE_PIXELLAB_API_KEY` 等前端变量。

本地调试 functions（可选）：`vercel dev`，把服务端变量写入 `app/.env`
（gitignored，无 `VITE_` 前缀不会暴露给前端）；模板见 `app/.env.example`。

---

## 3. 注意事项

1. **拆解接口时长**：`/api/decompose` 的 LLM 大树生成约 80–100s，function 配置
   `maxDuration: 120`。若 Vercel plan 的 function 时长上限低于 120s 导致硬超时，
   前端 `fetchDecompose` 失败后会自动走本地离线降级（规则引擎），功能仍可用。
   函数内部另有 105s 软预算：预算不足时自动跳过 LLM、以规则引擎结果兜底返回。
2. **Pixellab 冷请求**：pixflux 冷请求可能超过 120s，function 配置
   `maxDuration: 180`（同样受 plan 上限约束）；内部上游超时 170s，保证早于平台强杀返回。
3. **密钥只在服务端**：生产构建产物不包含任何 LLM / Pixellab 密钥；
   不要把 `app/.env` 提交到仓库（已 gitignored）。
4. **Admin 覆盖配置**：Admin 页手填的 LLM 四件套会原样上送并优先于服务端 env，
   属于用户自留的浏览器侧配置（存于 localStorage），不影响服务端密钥安全。
5. **SPA rewrites**：`vercel.json` 中 `{"source": "/((?!api/).*)", "destination": "/index.html"}` —
   `/api/*` 直达 functions，其余路径（含 `/assets/*` 静态资源，由 Vercel 静态层优先命中）
   回退到 `/index.html`。静态资源由文件系统优先匹配，不受 rewrite 影响。
6. **本地验证**：`cd app && node scripts/test-api-functions.mjs` 可在不起 dev server
   的情况下自测三个 function（stub 上游验证 env 注入、透传与错误路径）。
