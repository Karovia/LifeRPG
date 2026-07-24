# 职见未来 · 像素风人生 RPG

一款像素风移动端 Web 应用：把职业规划变成一场 RPG 冒险。创建专属像素形象，把人生目标拆解成任务树，完成任务赚取 XP 与金币，装饰自己的家园，与汤姆·里德尔式魔法日记本对话，并一键生成自动化简历。

## 运行方式

```bash
cd app
npm install
npm run dev
```

默认地址：http://localhost:3000/ （端口被占用时 Vite 会自动顺延）。

生产构建：`npm run build`（输出到 `app/dist/`），本地预览构建产物：`npm run preview`。

## Pixellab Key 配置

像素素材与形象生成走 [Pixellab](https://www.pixellab.ai) API：

1. 复制 `app/.env.example` 为 `app/.env`
2. 填入你的 key：`VITE_PIXELLAB_API_KEY=<你的 key>`
3. 重启 dev server

开发环境通过 Vite proxy（`/pixellab/*` → `https://api.pixellab.ai/v1/*`）绕开 CORS。未配置 key 时应用仍可运行：头像与素材走内置降级链（占位图 + 像素兜底渲染），AI 文本能力为确定性本地 mock（接入点见 `app/src/lib/ai.ts`）。

## 功能清单

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 首页 | `/` | 成长数据总览、今日目标、阶段 Deadline 撕日历轮播（4s 自动撕页 / 点击撕页 / 悬停暂停）、ToDo 快速清单 |
| 成就树 | `/quests` | 目标 → 多阶段成就树（节点带 phase/deadline），逐级解锁；`POST /api/decompose` 开发中间件提供 AI 拆解：DuckDuckGo 联网检索 + 规则引擎，断网自动降级 rules-only，预留 LLM 接入点（`app/vite-plugins/decompose-api.ts`） |
| 小镇养成 | `/town` | 全屏沉浸式像素世界（参考 peteroravec.com）：24×16 跟随镜头大地图、小地图、NPC 对话好感度、委托任务、家园种植、宠物喂养、云/炊烟/昼夜罩层；该路由下隐藏全局 HUD 与底导航，由小镇自带 HUD 与「离开」按钮接管 |
| 形象创建 | `/avatar` | 三步向导（起名 → 描述 → Pixellab 生成确认），支持重新生成；HUD 头像可点击直达 |
| 魔法日记 | `/diary` | 汤姆·里德尔式日记本：文字吸入纸面、回复浮现，支持历史旧页 |
| 简历生成 | `/resume` | 意向设置 → AI 生成 → 卷轴展示，支持复制/导出与信息差告示牌 |

底部导航为 5 项像素图标（首页/任务/小镇/日记/简历），「形象」入口移至顶栏头像。全局状态使用 zustand + persist 持久化到 localStorage（key：`zhijian-weilai-game`，v2 结构含 todos/town，自动迁移旧数据），新用户打开会自动进入形象创建引导。

## 素材

`app/public/assets/` 下像素素材全部由 Pixellab 实际生成：第一轮 11 张（金币、宝箱、XP 星、羊皮纸、小镇背景、占位头像、5 件家园装饰品），第二轮新增 17 张（5 张导航图标、小镇地块、3 个 NPC、作物等）。清单见 `app/public/assets/manifest.json`（含每张图的 prompt、尺寸与来源）。重新生成脚本：`app/scripts/generate-assets.mjs`。
