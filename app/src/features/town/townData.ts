import type { Player, Quest, QuestNode, TownNpc } from '@/store/gameStore'

/**
 * ============================================================
 * 小镇模块：地图数据 / NPC 对话与好感度 mock / 委托模板
 * （纯本地确定性逻辑，不依赖 lib/ai，方便后续替换为真实 LLM）
 * ============================================================
 */

// ---------- 地图 ----------

export interface Pos {
  x: number
  y: number
}

export const MAP_COLS = 12
export const MAP_ROWS = 8

/** 地块编码：g 草地 p 小路 f 花丛 h 房屋 t 树 F 农田 */
export type TileCode = 'g' | 'p' | 'f' | 'h' | 't' | 'F'

export const TOWN_MAP: TileCode[][] = [
  ['t', 'g', 'g', 'f', 'g', 'g', 'g', 'g', 'f', 'g', 'g', 't'],
  ['g', 'h', 'h', 'g', 'p', 'p', 'p', 'p', 'g', 'h', 'h', 'g'],
  ['g', 'h', 'h', 'g', 'p', 'g', 'g', 'p', 'g', 'h', 'h', 'g'],
  ['g', 'f', 'g', 'g', 'p', 'g', 'g', 'p', 'g', 'g', 'f', 'g'],
  ['g', 'g', 'g', 'g', 'p', 'p', 'p', 'p', 'g', 'g', 'g', 'g'],
  ['g', 'g', 'g', 'g', 'g', 'g', 'g', 'g', 'g', 'g', 'g', 'g'],
  ['t', 'g', 'f', 'g', 'g', 'g', 'g', 'g', 'g', 'F', 'F', 'g'],
  ['g', 'g', 'g', 'g', 'f', 'g', 'g', 't', 'g', 'F', 'F', 'g'],
]

/** 地块贴图与纯色降级 */
export const TILE_STYLE: Record<TileCode, { img: string | null; color: string }> = {
  g: { img: '/assets/tiles/grass.png', color: '#97A872' },
  p: { img: '/assets/tiles/path.png', color: '#C9B48A' },
  f: { img: '/assets/tiles/flower.png', color: '#8FA06B' },
  h: { img: '/assets/tiles/house.png', color: '#8A6242' },
  t: { img: '/assets/tiles/tree.png', color: '#5F6C43' },
  F: { img: null, color: '#6B4A2F' },
}

/** 不可通行的地块（房屋/树/农田） */
const BLOCKED_CODES: TileCode[] = ['h', 't', 'F']

export interface NpcMeta {
  id: string
  img: string
  pos: Pos
  /** 贴图缺失时的降级底色 */
  color: string
}

/** NPC 固定站位（注意：store 里画师 id 为 painter，素材文件名为 artist.png） */
export const NPC_META: NpcMeta[] = [
  { id: 'elder', img: '/assets/npc/elder.png', pos: { x: 5, y: 1 }, color: '#8A6242' },
  { id: 'merchant', img: '/assets/npc/merchant.png', pos: { x: 7, y: 3 }, color: '#9E7C33' },
  { id: 'painter', img: '/assets/npc/artist.png', pos: { x: 3, y: 5 }, color: '#A8504B' },
]

export const NPC_POSITIONS: Pos[] = NPC_META.map((n) => n.pos)

/** 农田 2x2 固定格（对应 garden.plots 数组下标） */
export const FARM_CELLS: Pos[] = [
  { x: 9, y: 6 },
  { x: 10, y: 6 },
  { x: 9, y: 7 },
  { x: 10, y: 7 },
]

export const PLAYER_START: Pos = { x: 5, y: 5 }
export const PET_START: Pos = { x: 2, y: 6 }

export function isBlocked(pos: Pos): boolean {
  if (pos.x < 0 || pos.x >= MAP_COLS || pos.y < 0 || pos.y >= MAP_ROWS) return true
  if (BLOCKED_CODES.includes(TOWN_MAP[pos.y][pos.x])) return true
  if (NPC_POSITIONS.some((p) => p.x === pos.x && p.y === pos.y)) return true
  return false
}

// ---------- NPC 对话（本地 mock，按性格分词） ----------

const GREETING_WORDS = ['你好', '您好', '嗨', '哈喽', '早上好', '晚上好', '在吗']
const EMOTION_WORDS = [
  '开心', '难过', '累', '焦虑', '喜欢', '感谢', '谢谢', '激动',
  '担心', '希望', '迷茫', '期待', '害怕', '骄傲', '烦躁', '欣慰',
]

/** 各 NPC 性格偏好的话题关键词（聊到他感兴趣的会额外加分） */
const NPC_TOPIC_WORDS: Record<string, string[]> = {
  elder: ['故事', '道理', '经验', '耐心', '坚持', '请教', '慢慢'],
  merchant: ['效率', '计划', '目标', '完成', '承诺', '进度', '安排'],
  painter: ['颜色', '美', '想象', '感觉', '灵感', '画', '风景', '梦'],
}

export interface FavorScore {
  delta: number
  /** 敷衍输入（不长好感） */
  dismissive: boolean
}

/**
 * 好感度启发式评分：只有「聊得好」才加分。
 * 长度 >10、含问候/情绪词、命中 NPC 话题、与上一句同话题延续都会加分；
 * 短促敷衍（<=4 字）不加分。单条上限 +6。
 */
export function scoreMessage(
  input: string,
  npcId: string,
  lastPlayerInput: string | null,
): FavorScore {
  const text = input.trim()
  if (text.length <= 4) return { delta: 0, dismissive: true }

  let delta = 0
  if (text.length > 10) delta += 2
  if (text.length > 30) delta += 1
  if (GREETING_WORDS.some((w) => text.includes(w))) delta += 2
  if (EMOTION_WORDS.some((w) => text.includes(w))) delta += 3
  if (/[?？]/.test(text)) delta += 1

  const topicWords = NPC_TOPIC_WORDS[npcId] ?? []
  if (topicWords.some((w) => text.includes(w))) delta += 2

  // 同话题延续：与上一句共享 >=2 字片段
  if (lastPlayerInput) {
    outer: for (let len = Math.min(4, lastPlayerInput.length); len >= 2; len--) {
      for (let i = 0; i + len <= lastPlayerInput.length; i++) {
        const seg = lastPlayerInput.slice(i, i + len)
        if (seg.trim() && text.includes(seg)) {
          delta += 1
          break outer
        }
      }
    }
  }

  return { delta: Math.min(delta, 6), dismissive: false }
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const GREETING_LINES: Record<string, string> = {
  elder: '孩子，过来坐坐。小镇的风里，藏着许多故事。',
  merchant: '哟，稀客！时间就是金币，有什么正事吗？',
  painter: '你来得正好，我正给晚霞调色呢。要一起看看吗？',
}

export function npcGreeting(npcId: string): string {
  return GREETING_LINES[npcId] ?? '你好呀，冒险者。'
}

const REPLY_POOLS: Record<string, string[]> = {
  elder: [
    '嗯，说下去。年轻人肯静下心来聊这些，很难得。',
    '我年轻时也走过这样的路。慢一点，稳一点，路不会跑。',
    '你这句话里有故事。记住今天的心情，以后会用得上。',
    '好问题。答案不在我这里，在你接下来走的每一步里。',
    '呵呵，和你说说话，我这把老骨头都觉得暖了。',
  ],
  merchant: [
    '干脆！我就欣赏说到做到的人。这单聊得很值。',
    '有规划、有情绪、有细节——你比镇上大多数人都靠谱。',
    '记下来：今天的谈话，价值至少三个金币。当然，金币先记账上。',
    '效率不错！跟你说话不费劲，下次有好差事我先想着你。',
    '成交！哦不，我是说——你这话我记下了，继续。',
  ],
  painter: [
    '你描述的画面……我能看见颜色！再多说一点，拜托。',
    '真诚是最难得的颜料。你刚刚的话，我想画下来。',
    '嗯——这个感觉，像傍晚最后一缕橘色的光。继续说呀。',
    '你的想象力和我的画笔很合拍。今天的天空都更好看了。',
    '别停，我正有灵感。你的话里有别人没有的色彩。',
  ],
}

const DISMISSIVE_REPLIES = [
  '（对方礼貌地笑了笑，似乎不知道该接什么……）',
  '（对话有点冷场，看来得多说点真诚的话才行。）',
  '（对方点点头，目光飘向了别处。）',
]

/** NPC 回复：按性格取词池，同一输入回复稳定（确定性 hash） */
export function npcReply(npcId: string, input: string, dismissive: boolean): string {
  if (dismissive) {
    return DISMISSIVE_REPLIES[hashCode(npcId + input) % DISMISSIVE_REPLIES.length]
  }
  const pool = REPLY_POOLS[npcId] ?? DISMISSIVE_REPLIES
  return pool[hashCode(npcId + input) % pool.length]
}

// ---------- 委托模板 ----------

function walkNodes(nodes: QuestNode[], fn: (n: QuestNode) => void): void {
  for (const n of nodes) {
    fn(n)
    if (n.children) walkNodes(n.children, fn)
  }
}

/**
 * 根据玩家当前状态生成挑战委托（本地模板）。
 * 完成方式统一为：接受 → 达成条件 → 回 NPC 处认真汇报感受（>20 字）。
 */
export function buildCommission(
  npc: TownNpc,
  player: Player,
  quests: Quest[],
): { title: string; description: string; rewardCoins: number } {
  let availableNodes = 0
  let doneNodes = 0
  quests.forEach((q) =>
    walkNodes(q.nodes, (n) => {
      if (n.status === 'available') availableNodes += 1
      if (n.status === 'done') doneNodes += 1
    }),
  )

  if (quests.length === 0) {
    return {
      title: `${npc.name}的委托 · 立下志向`,
      description:
        '你现在还没有任何目标。先去「任务」页为自己立下一个目标，然后回来告诉我：你为什么选择它？（认真写下 20 字以上的感受）',
      rewardCoins: 20,
    }
  }
  if (availableNodes > 0) {
    return {
      title: `${npc.name}的委托 · 小步挑战`,
      description: `你有 ${availableNodes} 个待完成的任务节点。去完成其中任意一个，然后回来跟我聊聊过程中的感受（认真写下 20 字以上）。`,
      rewardCoins: 30,
    }
  }
  if (player.level >= 3 || doneNodes >= 3) {
    return {
      title: `${npc.name}的委托 · 成长故事`,
      description: `你已经升到 LV.${player.level}、完成了 ${doneNodes} 个节点。跟我讲讲这一路上印象最深的一件事吧（认真写下 20 字以上）。`,
      rewardCoins: 40,
    }
  }
  return {
    title: `${npc.name}的委托 · 聊聊近况`,
    description:
      '最近过得怎么样？把你的近况、目标或者烦恼认真讲给我听听（写下 20 字以上），我会把报酬准备好。',
    rewardCoins: 20,
  }
}
