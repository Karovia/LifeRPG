import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * ============================================================
 * 职见未来 · 全局游戏状态（zustand + persist → localStorage）
 * ============================================================
 * ⚠️ 契约文件：后续特性模块代理只能通过 hooks 读写本 store，
 *    不得修改本文件。如需扩展，先与脚手架负责人对齐。
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

// ---------- Store 状态与动作 ----------

interface GameState {
  player: Player
  avatarDraft: AvatarDraft
  quests: Quest[]
  inventory: Inventory
  diaryEntries: DiaryEntry[]
  careerIntent: CareerIntent

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

  // ----- 背包 -----
  addDecoration: (decorationId: string) => void
  /** 花金币购买装饰品；余额不足返回 false */
  buyDecoration: (decorationId: string, price: number) => boolean

  // ----- 日记 -----
  addDiaryEntry: (entry: Omit<DiaryEntry, 'id'>) => void

  // ----- 职业意向 -----
  setCareerIntent: (intent: Partial<CareerIntent>) => void
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

// ---------- Store ----------

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      player: initialPlayer,
      avatarDraft: initialAvatarDraft,
      quests: [],
      inventory: { decorations: [] },
      diaryEntries: [],
      careerIntent: initialCareerIntent,

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
    }),
    {
      name: 'zhijian-weilai-game', // localStorage key
      version: 1,
    },
  ),
)
