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
