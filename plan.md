# 职见未来：人生RPG — 执行计划

> PRD 见 `PRD.md`。8bit 复古像素风 Web App，React + TS + Vite + Tailwind（webapp-building skill，0-origin 基础工程）。
> Git 仓库位于工作区根目录；每完成一个部分立即 commit（各子代理只 add 自己负责的路径）。

## 架构约定（脚手架阶段必须落地，后续所有模块遵守）

- 应用代码在 `app/` 子目录
- 状态：zustand + persist（localStorage），脚手架一次性定义完整 store 类型与全部 slice 骨架，特性代理**不得修改共享文件**
- 路由：脚手架预注册全部路由，页面组件从 `src/features/<name>/` 导入占位组件，特性代理只填充自己的 feature 目录
- 像素字体："Press Start 2P"（@fontsource/press-start-2p）；低饱和暖色像素调色板写入 tailwind theme
- Pixellab：key 存 `app/.env`（gitignore）的 `VITE_PIXELLAB_API_KEY`，统一封装 `src/lib/pixellab.ts`（脚手架创建，含 create-image-pixflux / create-character-with-4-directions / animate-with-text 封装）
- AI 能力（目标拆解、日记回复、简历生成）：无 LLM key，脚手架定义 `src/lib/ai.ts` 接口 + 本地规则实现，界面标注可后续接入 LLM

## Stage 1 — 脚手架（1 个 coder 代理）

init-webapp.sh 初始化 `app/` → git init → 设计基础（像素字体/调色板/像素边框组件）→ 游戏外壳（顶栏 HUD：头像/等级/金币）→ 路由 + zustand store 全量骨架 + 各 feature 占位页 → pixellab.ts 封装（curl 验证 API key 可用）→ .env/.env.example → commit "scaffold"。

## Stage 2 — 并行特性开发（AgentSwarm，6 个 coder 代理，文件范围互斥）

| # | 角色 | 范围（只允许改这些路径） | 产出 |
|---|------|------|------|
| 1 | 素材生成员 | `app/scripts/`, `app/public/assets/` | Pixellab 批量素材脚本 + 生成静态素材（背景/金币/宝箱/装饰品/日记纹理/图标），记录清单 |
| 2 | 形象模块 | `app/src/features/avatar/` | 首次进入引导创建角色：文字描述→Pixellab 生成像素形象→存入 store |
| 3 | 职业规划模块 | `app/src/features/quests/` | 目标输入→任务树拆解（调用 ai.ts 接口）→层层递进节点→完成打勾联动成长 |
| 4 | 成长系统 | `app/src/features/growth/` | XP/等级/金币结算、升级动效、装饰品商店与背包 |
| 5 | 日记本模块 | `app/src/features/diary/` | 汤姆·里德尔日记本：输入停止后文字渐隐→AI 回复浮现→再渐隐；条目持久化 |
| 6 | 简历模块 | `app/src/features/resume/` | 汇总日记+任务完成记录→按意向岗位生成简历/作品集视图，可复制导出 |

并行代理互相看不到对方产出：素材路径通过约定（`public/assets/manifest.json`）解耦；缺失素材先用占位。

## Stage 3 — 集成验收（1 个 coder 代理）

装素材进各界面 → `npm run build` 通过 → 起 dev server 验证各路由 → 停掉 server → commit "integrate"。

## 交付

预览链接 `[职见未来](http://localhost:7100/)`，项目根 `/Users/apple/Documents/Kimi/Workspaces/职见未来/app`。

---

# 第二轮迭代（2026-07-24 晚）

需求：导航换像素图标｜任务拆解→成就树+AI联网搜索拆解+阶段Deadline｜导航去掉「形象」（改点头像）｜新增首页（今日目标+ToDo+Deadline+成长数据）｜成长页→俯视角小镇养成（NPC好感/委托/种植/宠物）｜每部分独立 commit。

- Stage 1（并行2代理）：契约改造（store 扩容 + 路由导航重构 + Home/Town 占位）∥ 素材补充（导航图标/地块/NPC/作物）
- Stage 2（并行3代理）：首页（features/home）∥ 成就树+AI拆解（features/quests + vite 中间件联网搜索）∥ 小镇养成（features/town）
- Stage 3：集成验收（build + 冒烟 + README）✅ 已完成（2026-07-24）
- 已知限制：无 LLM key，「AI拆解」= vite dev 中间件真实联网搜索（DuckDuckGo 免 key）+ 增强规则引擎，接口预留 LLM 接入点

## 第二轮验收结果（✅ 通过）

- 5 个 commit 全部在案（c28f309 core / bd4e4de assets / 81d9263 home / fa3bfd2 quests / d4f6f4a town），`npm run build` 一次通过
- 路由 /、/quests、/town、/diary、/resume、/avatar 全部 200；导航素材 /assets/nav/*.png 200；NPC id（painter→artist.png）映射有显式注释对齐
- `/api/decompose` 冒烟：HTTP 200，返回 5 阶段 13 节点（带 phase/deadline/anchorDate）；本机无外网时按设计降级 rules-only（非报错）
- 遗留：DuckDuckGo 联网检索需在有外网环境再验证一次（本环境 HTTP 000，仅验证了降级路径）

---

# 第三轮迭代（2026-07-24 晚）

需求：首页 Deadline 区改撕日历轮播动画｜小镇参考 peteroravec 重设计为全屏沉浸式像素世界。

- 完成：7d1f890 feat(home) 撕日历轮播 ∥ 865672b feat(town) 全屏沉浸式小镇；b6aee20 集成验收（build 通过 + 冒烟），本文件当时未补录，特此补记

---

# 第四轮迭代（2026-07-24 深夜）

需求：Admin 页面管理 LLM 配置（modelID/baseURL/apikey，登录 Karovia/173256）｜日记/规划拆解接入 LLM｜小镇美术资产升级+Pixellab 动画｜成就树拆解逻辑具体化。

- Stage 1（并行）：E1 契约+Admin+`/api/llm` 代理（store/App.tsx/vite.config.ts/vite-plugins/llm-proxy.ts/features/admin）∥ E2 美术资产重做+Pixellab animate-with-text 动画帧（scripts/public/assets）
- Stage 2（并行）：F1 日记接 LLM（features/diary）∥ F2 成就树拆解 LLM 化+具体化（features/quests + vite-plugins/decompose-api.ts）∥ F3 小镇应用新美术与动画（features/town）
- Stage 3：集成验收（build + 冒烟 + stub LLM 验证代理链路）✅ 已完成（2026-07-24）
- LLM 调用约定：OpenAI 兼容 POST {baseURL}/chat/completions（Bearer apiKey），浏览器侧经 `/api/llm` 中转避免 CORS；全部功能保留无配置时的本地降级

## 第四轮验收结果（✅ 通过）

- 5 个 commit 全部在案（74fe19a admin / 6c531b2 assets / e44804f diary / 970a088 quests / 417ccd2 town），`npm run build` 一次通过（tsc + vite，82 模块）
- LLM 链路端到端实测（本地 stub OpenAI @3999）：
  - `POST /api/llm`：HTTP 200 返回 stub 回复；stub 侧确认收到 model/max_tokens(messages 1 条，Bearer 转发正确)
  - `POST /api/decompose` 带 llm：HTTP 200，`source: llm-only`，stub 成就树（3 阶段 6 节点）被接受，节点带 deadline/奖励/首个 available；stub 侧确认 json_object 模式、system+user 双消息
  - `POST /api/decompose` 不带 llm：`source: rules-only` 正常回退（本机无外网，DuckDuckGo 检索 0 条属预期降级）
- 冒烟：/、/admin、/town 200；`/assets/anim/cat-walk/frame-0.png`、`anim/water/frame-3.png`、`tiles/fence|lamp|field.png`、`manifest.json` 全部 200
- 接缝：/admin 不进底部导航（HUD ⚙️ 进入）；/town 沉浸式布局（隐藏全局 HUD/底导航）未被破坏；manifest 5 组 anim 条目与前端 `animFrames()` 引用一致
- 遗留：① NPC 对话仍为本地模板，未接 LLM（本轮范围外）；② DuckDuckGo 联网检索需在有外网环境再验证（本环境验证的是 llm-only / rules-only 路径）
