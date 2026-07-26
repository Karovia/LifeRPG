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

## Admin 管理台与 LLM 接入

`/admin` 为登录保护的管理台（账号 `Karovia` / 密码 `173256`），**不进底部导航**，经顶栏 HUD 右侧 ⚙️ 进入。功能：

- 维护 OpenAI 兼容 LLM 配置（baseURL / apiKey / modelID / enabled 开关），持久化在本地 store（v4 结构含 `llmConfig` / `adminAuthed`，自动迁移旧数据）
- **已内置阶跃星辰 step-3.5-flash 默认配置**（`app/.env` 的 `VITE_LLM_*` 三项，仓库内为 `.env.example` 占位）：开箱即用无需手填，可在 /admin 覆盖，「清空」回到本地降级
- 「测试连接」：经 `POST /api/llm` 代理发一条 ping（maxTokens=8），展示上游真实响应或错误详情

LLM 调用统一走 OpenAI 兼容协议（`POST {baseURL}/chat/completions`，Bearer apiKey），三个板块：

| 板块 | 链路 | 说明 |
| --- | --- | --- |
| 魔法日记 `/diary` | 浏览器 → `POST /api/llm`（dev 中间件中转，绕 CORS，密钥不进打包产物）→ 上游 | 魔法日记本人格，90s 超时；回复带来源徽标（✨ AI 回应 / 📜 纸灵回应） |
| 成就树拆解 `/quests` | 浏览器 → `POST /api/decompose` → **服务端直连上游**（不经 `/api/llm`） | body 带 `llm` 三字段时优先 `response_format=json_object`，上游 400 回退普通模式并从文本/```json 块提取 JSON；产出 3-5 阶段具体化成就树（产出物 + 量化验收标准 + 推荐资源），前端展示 source 徽标 |
| Admin 测试连接 | 与日记同链路 | 验证配置可用性 |

降级行为（全部静默、不阻断使用）：

- 未配置 LLM，或请求失败 / 超时 / 返回结构不合格：日记回退本地规则 mock（📜 纸灵回应）；拆解回退规则引擎具体化模板
- 拆解响应 `source` 标识来源：`llm+search` / `llm-only`（LLM 成功）、`duckduckgo+rules` / `rules-only`（回退规则引擎）
- `/api/llm` 透传上游 HTTP 错误状态码与详情；超时 60s 返回 504、连接失败 502，前端据此走本地降级
- `/api/decompose` 的联网检索（DuckDuckGo 免 key，10s 超时）失败不阻断，LLM 与规则引擎均可无资料继续

## 功能清单

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 首页 | `/` | 成长数据总览、今日目标、阶段 Deadline 撕日历轮播（4s 自动撕页 / 点击撕页 / 悬停暂停）、ToDo 快速清单 |
| 成就树 | `/quests` | 目标 → 多阶段成就树（节点带 phase/deadline），逐级解锁；`POST /api/decompose` 开发中间件提供 AI 拆解：联网检索 + LLM 具体化拆解（未配置/失败自动回退规则引擎模板），节点全部带产出物与量化验收标准，前端展示 source 徽标（`app/vite-plugins/decompose-api.ts`） |
| 小镇养成 | `/town` | 全屏沉浸式像素世界（参考 peteroravec.com）：32×20 跟随镜头大地图、小地图、NPC 对话好感度、委托任务、家园种植、宠物喂养、云/炊烟/昼夜罩层；水面/NPC 待机/猫行走为 FrameAnim 4 帧动画，角色按 y 排序遮挡；该路由下隐藏全局 HUD 与底导航，由小镇自带 HUD 与「离开」按钮接管。地图为多格建筑实体（红顶大屋/杂货铺/画室塔楼 2×2、水井/码头 1×1、大树带悬挑）+ 连贯路网 + 草地 13% 野花变体。玩法：**钓鱼**（点水面/码头抛竿，2-6s 上钩、1.2s 窗口收竿，+3~12 金币，结束 8s 冷却）；**三种作物**（胡萝卜 0 成本/奖 8、南瓜 5/18、小麦 3/12，需水次数各异，家园抽屉切换种子）；**装饰店**（杂货铺商人「商店」页签出售盆栽/书架/落地灯/奖杯/猫咪摆件）+**我的庭院**（家园抽屉陈列已购装饰）；农田每格 15s 操作冷却（先落冷却再执行，防连点重复领奖）；**委托去重+状态感知**（LLM 生成注入玩家目标/日记/委托历史，本地池每 NPC 7 条带 key；历史 key 永不复现，LLM 重复重试 1 次后回退本地池）；**家园建设**（🔨 建设模式：放建筑/铺路/拆除半价退款，动态阻挡，canPlaceBuilding/canPaveRoad 判定覆盖水面/道路/NPC/既有建筑）；**移动端虚拟摇杆**（左下角，8 方向 160ms/步，仅触屏设备渲染，桌面端不受影响） |
| 形象创建 | `/avatar` | 三步向导（起名 → 描述 → Pixellab 生成确认），支持重新生成；HUD 头像可点击直达 |
| 魔法日记 | `/diary` | 汤姆·里德尔式日记本：文字吸入纸面、回复浮现，支持历史旧页；配置 LLM 后由魔法日记本人格回复（✨ AI 回应），失败静默回退本地纸灵（📜 纸灵回应） |
| 简历生成 | `/resume` | 意向设置 → AI 生成 → 卷轴展示，支持复制/导出与信息差告示牌 |
| 管理台 | `/admin` | 登录保护（Karovia/173256）：LLM 配置表单 + 测试连接；不进底部导航，HUD ⚙️ 进入 |

底部导航为 5 项像素图标（首页/任务/小镇/日记/简历），「形象」入口移至顶栏头像。全局状态使用 zustand + persist 持久化到 localStorage（key：`zhijian-weilai-game`，v5 结构含 todos/town/llmConfig/adminAuthed，town 内含 placements 建筑放置/roads 铺路/commissionHistory 委托历史，自动迁移旧数据），新用户打开会自动进入形象创建引导。

## 素材

`app/public/assets/` 下像素素材全部由 Pixellab 实际生成，清单见 `app/public/assets/manifest.json`（含每张图的 prompt、尺寸与来源）：

- 第一轮 11 张：金币、宝箱、XP 星、羊皮纸、小镇背景、占位头像、5 件家园装饰品
- 第二轮 17 张：5 张导航图标、小镇地块、3 个 NPC、作物等
- 第四轮：小镇 tiles 全部重绘并新增水面/栅栏/路灯/农田地块（旧图归档 `assets/_legacy/`）；5 组 Pixellab 4 帧动画（`anim/cat-walk`、`anim/water`、`anim/elder-idle`、`anim/merchant-idle`、`anim/artist-idle`）；3 个 NPC 立绘重绘
- 第五轮 10 张：无缝地面（grass / grass2 野花变体 / path / field，部分经 PIL 程序化无缝重建）、多格建筑精灵（buildings/house-red 128×128、house-wood 128×128、house-tall 128×192、well 64×64、tree-big 64×128）、钓鱼与作物素材（tiles/dock、ui/fish、crop/pumpkin-ripe、crop/wheat-ripe）

动画渲染：前端以 `animFrames('<name>')` 拼 `/assets/anim/<name>/frame-0..3.png` 路径（与 manifest 条目一致），由小镇的 `FrameAnim` 组件循环播放。重新生成脚本：`app/scripts/generate-assets.mjs`。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
