import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * ============================================================
 * 职见未来 · 全局游戏状态（zustand + persist → localStorage）
 * ============================================================
 * ⚠️ 契约文件：后续特性模块代理只能通过 hooks 读写本 store，
 *    不得修改本文件。如需扩展，先与脚手架负责人对齐。
 *
 * v3 新增（LLM 接入轮）：
 *   - llmConfig（Admin 页维护的 OpenAI 兼容 LLM 配置）
 *     各 LLM 功能（日记/拆解/NPC）读取约定：
 *     `llmConfig.enabled && llmConfig.baseURL && llmConfig.model && llmConfig.apiKey`
 *     任一不满足 → 必须走本地降级逻辑，不得直接发起 LLM 请求。
 *   - adminAuthed（Admin 页登录态）
 * ============================================================
 */

// ---------- 类型定义 ----------

/** 玩家基础信息 */
export interface Player {
  name: string
  /** 生成形象图路径/URL（Pixellab 生成后保存） */
  avatarUrl: string | null
  level: number
  xp: number
  /** 升到下一级所需 XP */
  xpToNext: number
  coins: number
  /** ISO 时间戳 */
  createdAt: string
}

/** 形象创建向导的临时状态（avatar 模块草稿） */
export interface AvatarDraft {
  step: number
  description: string
  /** 预览图 data URL 或路径 */
  previewUrl: string | null
}

export type QuestNodeStatus = 'locked' | 'available' | 'done'

/** 目标拆解节点（树形，children 为子节点） */
export interface QuestNode {
  id: string
  title: string
  description: string
  status: QuestNodeStatus
  rewardXp: number
  rewardCoins: number
  /** ISO 日期（可选，截止日） */
  deadline?: string
  /** 所属阶段名（可选，用于阶段化展示） */
  phase?: string
  children?: QuestNode[]
}

/** 一个目标 = 一棵节点树 */
export interface Quest {
  id: string
  title: string
  description: string
  createdAt: string
  nodes: QuestNode[]
}

/** 待办事项（首页/快速清单） */
export interface Todo {
  id: string
  title: string
  done: boolean
  /** ISO 时间戳 */
  createdAt: string
  /** ISO 日期（可选，到期日） */
  dueDate?: string
}

/** 背包/装饰品 */
export interface Inventory {
  /** 已拥有装饰品 id 列表 */
  decorations: string[]
}

/** 日记条目（汤姆·里德尔日记本） */
export interface DiaryEntry {
  id: string
  /** YYYY-MM-DD */
  date: string
  content: string
  /** 日记本的回复（浮现文本） */
  reply: string
}

/** 职业意向（简历/作品集生成依据） */
export interface CareerIntent {
  targetRole: string
  requirements: string
}

/**
 * LLM 接入配置（Admin 页维护）。
 * 默认值从 .env 的 VITE_LLM_* 读取（缺省空串）：三项齐备时 enabled 默认 true，
 * 用户开箱即用；未配置 env 时全空 + enabled=false，日记/任务拆解/NPC 对话走本地降级。
 */
export interface LlmConfig {
  /** OpenAI 兼容 API 基础地址，如 https://api.openai.com/v1 */
  baseURL: string
  /** 模型 ID，如 gpt-4o-mini */
  model: string
  apiKey: string
  /** 总开关：false 时即使填了配置也不调用 LLM */
  enabled: boolean
}

// ---------- 小镇 slice ----------

/** 小镇 NPC */
export interface TownNpc {
  id: string
  name: string
  /** 性格描述 */
  personality: string
  /** 好感度 0-100 */
  favorability: number
}

export type CommissionStatus = 'offered' | 'accepted' | 'done'

/** NPC 委托任务 */
export interface Commission {
  id: string
  npcId: string
  title: string
  description: string
  status: CommissionStatus
  rewardCoins: number
}

/** 花园地块 */
export interface GardenPlot {
  id: string
  /** 作物名 */
  crop: string
  /** 生长阶段 0=种子 1=幼苗 2=成熟 */
  stage: 0 | 1 | 2
  /** ISO 时间戳 */
  plantedAt: string
}

/** 宠物 */
export interface GardenPet {
  adopted: boolean
  name: string
  /** 饱食度 0-100 */
  hunger: number
}

export interface Garden {
  plots: GardenPlot[]
  pet: GardenPet
}

export interface TownState {
  npcs: TownNpc[]
  commissions: Commission[]
  garden: Garden
}

// ---------- Store 状态与动作 ----------

interface GameState {
  player: Player
  avatarDraft: AvatarDraft
  quests: Quest[]
  todos: Todo[]
  inventory: Inventory
  diaryEntries: DiaryEntry[]
  careerIntent: CareerIntent
  town: TownState
  llmConfig: LlmConfig
  /** Admin 页登录态（持久化，免每次进 /admin 重输口令） */
  adminAuthed: boolean

  // ----- 玩家/成长动作 -----
  /** 增加 XP，自动处理升级（level+1，xpToNext 按 1.5 倍增长） */
  addXp: (amount: number) => void
  /** 增加（正数）或扣减（负数）金币，余额不会低于 0 */
  addCoins: (amount: number) => void
  /** 设置玩家名 */
  setPlayerName: (name: string) => void
  /** 保存生成的形象（avatar 模块向导完成后调用） */
  setAvatar: (avatarUrl: string) => void

  // ----- 形象向导草稿 -----
  updateAvatarDraft: (patch: Partial<AvatarDraft>) => void
  resetAvatarDraft: () => void

  // ----- 目标/任务 -----
  /** 新增目标及其拆解节点树 */
  addQuest: (quest: Quest) => void
  /** 完成节点：标记 done、发放奖励、按需解锁子节点 */
  completeQuestNode: (questId: string, nodeId: string) => void
  removeQuest: (questId: string) => void

  // ----- 待办 -----
  addTodo: (todo: Omit<Todo, 'id' | 'done' | 'createdAt'> & { id?: string }) => void
  toggleTodo: (todoId: string) => void
  removeTodo: (todoId: string) => void

  // ----- 背包 -----
  addDecoration: (decorationId: string) => void
  /** 花金币购买装饰品；余额不足返回 false */
  buyDecoration: (decorationId: string, price: number) => boolean

  // ----- 日记 -----
  addDiaryEntry: (entry: Omit<DiaryEntry, 'id'>) => void

  // ----- 职业意向 -----
  setCareerIntent: (intent: Partial<CareerIntent>) => void

  // ----- LLM 配置 / Admin -----
  /** 部分更新 LLM 配置（保存时由调用方负责 trim） */
  setLlmConfig: (config: Partial<LlmConfig>) => void
  /** 清空 LLM 配置并关闭开关（各功能回到本地降级模式） */
  clearLlmConfig: () => void
  /** 设置 Admin 页登录态 */
  setAdminAuthed: (authed: boolean) => void

  // ----- 小镇：NPC / 委托 -----
  /** 设置 NPC 好感度（自动钳制 0-100） */
  setNpcFavorability: (npcId: string, favorability: number) => void
  addCommission: (commission: Omit<Commission, 'id'> & { id?: string }) => void
  updateCommissionStatus: (commissionId: string, status: CommissionStatus) => void

  // ----- 小镇：家园 -----
  /** 播种新地块 */
  plantCrop: (crop: string) => void
  /** 推进地块生长阶段（0→1→2，成熟后不变） */
  advanceCropStage: (plotId: string) => void
  /** 收获成熟地块（stage=2）并移除该地块 */
  harvestPlot: (plotId: string) => void
  adoptPet: (name: string) => void
  /** 喂食宠物，饱食度 +amount（默认 20），封顶 100 */
  feedPet: (amount?: number) => void
}

// ---------- 初始值 ----------

const initialPlayer: Player = {
  name: '冒险者',
  avatarUrl: null,
  level: 1,
  xp: 0,
  xpToNext: 100,
  coins: 0,
  createdAt: new Date().toISOString(),
}

const initialAvatarDraft: AvatarDraft = {
  step: 0,
  description: '',
  previewUrl: null,
}

const initialCareerIntent: CareerIntent = {
  targetRole: '',
  requirements: '',
}

/** .env 注入的 LLM 默认配置（构建期内联，缺省为空串） */
const envLlmBaseURL = (import.meta.env.VITE_LLM_BASE_URL ?? '') as string
const envLlmModel = (import.meta.env.VITE_LLM_MODEL ?? '') as string
const envLlmApiKey = (import.meta.env.VITE_LLM_API_KEY ?? '') as string

/** 全空配置：Admin 页「清空」时使用，回到本地降级模式 */
const emptyLlmConfig: LlmConfig = {
  baseURL: '',
  model: '',
  apiKey: '',
  enabled: false,
}

const initialLlmConfig: LlmConfig = {
  baseURL: envLlmBaseURL,
  model: envLlmModel,
  apiKey: envLlmApiKey,
  // 仅当三项都非空时默认开启，开箱即用
  enabled: Boolean(envLlmBaseURL && envLlmModel && envLlmApiKey),
}

/** 预置小镇 NPC */
const initialNpcs: TownNpc[] = [
  {
    id: 'elder',
    name: '长者',
    personality: '睿智而温和，喜欢用故事讲道理，欣赏踏实有耐心的年轻人',
    favorability: 0,
  },
  {
    id: 'merchant',
    name: '商人',
    personality: '精明健谈，重视效率与承诺，喜欢干脆利落、说到做到的人',
    favorability: 0,
  },
  {
    id: 'painter',
    name: '画师',
    personality: '浪漫敏感，痴迷色彩与美，容易被有想象力和真诚的表达打动',
    favorability: 0,
  },
]

const initialTown: TownState = {
  npcs: initialNpcs,
  commissions: [],
  garden: {
    plots: [],
    pet: { adopted: false, name: '', hunger: 0 },
  },
}

// ---------- 内部工具 ----------

/** 在节点树中查找并变换节点（不可变更新） */
function mapNodeTree(
  nodes: QuestNode[],
  nodeId: string,
  fn: (node: QuestNode) => QuestNode,
): QuestNode[] {
  return nodes.map((n) => {
    if (n.id === nodeId) return fn(n)
    if (n.children) return { ...n, children: mapNodeTree(n.children, nodeId, fn) }
    return n
  })
}

function findNode(nodes: QuestNode[], nodeId: string): QuestNode | null {
  for (const n of nodes) {
    if (n.id === nodeId) return n
    if (n.children) {
      const hit = findNode(n.children, nodeId)
      if (hit) return hit
    }
  }
  return null
}

/** 节点完成后解锁其直接子节点 */
function unlockChildren(nodes: QuestNode[], nodeId: string): QuestNode[] {
  return nodes.map((n) => {
    if (n.id === nodeId && n.children) {
      return {
        ...n,
        children: n.children.map((c) =>
          c.status === 'locked' ? { ...c, status: 'available' as const } : c,
        ),
      }
    }
    if (n.children) return { ...n, children: unlockChildren(n.children, nodeId) }
    return n
  })
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function makeId(): string {
  return crypto.randomUUID()
}

// ---------- Store ----------

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      player: initialPlayer,
      avatarDraft: initialAvatarDraft,
      quests: [],
      todos: [],
      inventory: { decorations: [] },
      diaryEntries: [],
      careerIntent: initialCareerIntent,
      town: initialTown,
      llmConfig: initialLlmConfig,
      adminAuthed: false,

      addXp: (amount) =>
        set((s) => {
          let { xp, level, xpToNext } = s.player
          xp += amount
          while (xp >= xpToNext) {
            xp -= xpToNext
            level += 1
            xpToNext = Math.round(xpToNext * 1.5)
          }
          return { player: { ...s.player, xp, level, xpToNext } }
        }),

      addCoins: (amount) =>
        set((s) => ({
          player: { ...s.player, coins: Math.max(0, s.player.coins + amount) },
        })),

      setPlayerName: (name) =>
        set((s) => ({ player: { ...s.player, name } })),

      setAvatar: (avatarUrl) =>
        set((s) => ({ player: { ...s.player, avatarUrl } })),

      updateAvatarDraft: (patch) =>
        set((s) => ({ avatarDraft: { ...s.avatarDraft, ...patch } })),

      resetAvatarDraft: () => set({ avatarDraft: initialAvatarDraft }),

      addQuest: (quest) => set((s) => ({ quests: [...s.quests, quest] })),

      completeQuestNode: (questId, nodeId) => {
        const quest = get().quests.find((q) => q.id === questId)
        if (!quest) return
        const node = findNode(quest.nodes, nodeId)
        if (!node || node.status === 'done') return

        set((s) => ({
          quests: s.quests.map((q) =>
            q.id === questId
              ? {
                  ...q,
                  nodes: mapNodeTree(
                    unlockChildren(q.nodes, nodeId),
                    nodeId,
                    (n) => ({ ...n, status: 'done' as const }),
                  ),
                }
              : q,
          ),
        }))
        // 发放奖励
        get().addXp(node.rewardXp)
        get().addCoins(node.rewardCoins)
      },

      removeQuest: (questId) =>
        set((s) => ({ quests: s.quests.filter((q) => q.id !== questId) })),

      // ----- 待办 -----
      addTodo: (todo) =>
        set((s) => ({
          todos: [
            ...s.todos,
            {
              id: todo.id ?? makeId(),
              title: todo.title,
              done: false,
              createdAt: new Date().toISOString(),
              dueDate: todo.dueDate,
            },
          ],
        })),

      toggleTodo: (todoId) =>
        set((s) => ({
          todos: s.todos.map((t) =>
            t.id === todoId ? { ...t, done: !t.done } : t,
          ),
        })),

      removeTodo: (todoId) =>
        set((s) => ({ todos: s.todos.filter((t) => t.id !== todoId) })),

      addDecoration: (decorationId) =>
        set((s) =>
          s.inventory.decorations.includes(decorationId)
            ? s
            : {
                inventory: {
                  decorations: [...s.inventory.decorations, decorationId],
                },
              },
        ),

      buyDecoration: (decorationId, price) => {
        const { player, inventory } = get()
        if (inventory.decorations.includes(decorationId)) return true
        if (player.coins < price) return false
        get().addCoins(-price)
        get().addDecoration(decorationId)
        return true
      },

      addDiaryEntry: (entry) =>
        set((s) => ({
          diaryEntries: [
            ...s.diaryEntries,
            { ...entry, id: crypto.randomUUID() },
          ],
        })),

      setCareerIntent: (intent) =>
        set((s) => ({ careerIntent: { ...s.careerIntent, ...intent } })),

      // ----- LLM 配置 / Admin -----
      setLlmConfig: (config) =>
        set((s) => ({ llmConfig: { ...s.llmConfig, ...config } })),

      clearLlmConfig: () => set({ llmConfig: emptyLlmConfig }),

      setAdminAuthed: (authed) => set({ adminAuthed: authed }),

      // ----- 小镇：NPC / 委托 -----
      setNpcFavorability: (npcId, favorability) =>
        set((s) => ({
          town: {
            ...s.town,
            npcs: s.town.npcs.map((n) =>
              n.id === npcId
                ? { ...n, favorability: clamp(favorability, 0, 100) }
                : n,
            ),
          },
        })),

      addCommission: (commission) =>
        set((s) => ({
          town: {
            ...s.town,
            commissions: [
              ...s.town.commissions,
              { ...commission, id: commission.id ?? makeId() },
            ],
          },
        })),

      updateCommissionStatus: (commissionId, status) =>
        set((s) => ({
          town: {
            ...s.town,
            commissions: s.town.commissions.map((c) =>
              c.id === commissionId ? { ...c, status } : c,
            ),
          },
        })),

      // ----- 小镇：家园 -----
      plantCrop: (crop) =>
        set((s) => ({
          town: {
            ...s.town,
            garden: {
              ...s.town.garden,
              plots: [
                ...s.town.garden.plots,
                {
                  id: makeId(),
                  crop,
                  stage: 0 as const,
                  plantedAt: new Date().toISOString(),
                },
              ],
            },
          },
        })),

      advanceCropStage: (plotId) =>
        set((s) => ({
          town: {
            ...s.town,
            garden: {
              ...s.town.garden,
              plots: s.town.garden.plots.map((p) =>
                p.id === plotId
                  ? { ...p, stage: Math.min(2, p.stage + 1) as 0 | 1 | 2 }
                  : p,
              ),
            },
          },
        })),

      harvestPlot: (plotId) =>
        set((s) => ({
          town: {
            ...s.town,
            garden: {
              ...s.town.garden,
              plots: s.town.garden.plots.filter(
                (p) => !(p.id === plotId && p.stage === 2),
              ),
            },
          },
        })),

      adoptPet: (name) =>
        set((s) => ({
          town: {
            ...s.town,
            garden: {
              ...s.town.garden,
              pet: { adopted: true, name, hunger: 50 },
            },
          },
        })),

      feedPet: (amount = 20) =>
        set((s) => ({
          town: {
            ...s.town,
            garden: {
              ...s.town.garden,
              pet: s.town.garden.pet.adopted
                ? {
                    ...s.town.garden.pet,
                    hunger: clamp(s.town.garden.pet.hunger + amount, 0, 100),
                  }
                : s.town.garden.pet,
            },
          },
        })),
    }),
    {
      name: 'zhijian-weilai-game', // localStorage key
      version: 4,
      migrate: (persistedState, version) => {
        // v1 → v2：补齐 todos / town，旧数据（player/quests/diary 等）保留
        const state = (persistedState ?? {}) as Partial<GameState>
        if (version < 2) {
          if (!Array.isArray(state.todos)) state.todos = []
          const town = state.town as Partial<TownState> | undefined
          state.town = {
            npcs:
              Array.isArray(town?.npcs) && town.npcs.length > 0
                ? town.npcs
                : initialNpcs,
            commissions: Array.isArray(town?.commissions)
              ? town.commissions
              : [],
            garden: {
              plots: Array.isArray(town?.garden?.plots)
                ? town.garden.plots
                : [],
              pet: town?.garden?.pet ?? { adopted: false, name: '', hunger: 0 },
            },
          }
        }
        // v2 → v3：补齐 llmConfig / adminAuthed，旧数据全部保留
        if (version < 3) {
          const cfg = state.llmConfig as Partial<LlmConfig> | undefined
          state.llmConfig = {
            baseURL: typeof cfg?.baseURL === 'string' ? cfg.baseURL : '',
            model: typeof cfg?.model === 'string' ? cfg.model : '',
            apiKey: typeof cfg?.apiKey === 'string' ? cfg.apiKey : '',
            enabled: cfg?.enabled === true,
          }
          state.adminAuthed = state.adminAuthed === true
        }
        // v3 → v4：内置 .env 默认 LLM 配置。
        //   旧数据 llmConfig 字段为空时用 env 默认补齐；用户已手填过的不覆盖。
        if (version < 4) {
          const cfg = state.llmConfig as Partial<LlmConfig> | undefined
          const userFilled = Boolean(cfg?.baseURL || cfg?.model || cfg?.apiKey)
          if (!userFilled) {
            // 从未手填：直接套用 env 内置默认（enabled 随三项齐备与否）
            state.llmConfig = { ...initialLlmConfig }
          } else {
            // 已手填：仅补齐仍为空的字段，enabled 尊重用户原值
            state.llmConfig = {
              baseURL: cfg?.baseURL || initialLlmConfig.baseURL,
              model: cfg?.model || initialLlmConfig.model,
              apiKey: cfg?.apiKey || initialLlmConfig.apiKey,
              enabled: cfg?.enabled === true,
            }
          }
        }
        return state as GameState
      },
    },
  ),
)
