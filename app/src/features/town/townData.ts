import type { Player, Quest, QuestNode, TownNpc } from '@/store/gameStore'

/**
 * ============================================================
 * 小镇模块：地图数据 / NPC 对话与好感度 mock / 委托模板
 * （纯本地确定性逻辑，不依赖 lib/ai，方便后续替换为真实 LLM）
 *
 * 重设计 D2：参考 peteroravec.com「整个页面即游戏世界」，
 * 地图扩大为 24x16 可滚动世界，镜头跟随玩家。
 * ============================================================
 */

// ---------- 地图 ----------

export interface Pos {
  x: number
  y: number
}

export const MAP_COLS = 24
export const MAP_ROWS = 16

/** 单格像素尺寸（世界层按绝对像素排布，供镜头平移；56 贴近 64px 美术原图，细节更清晰） */
export const TILE = 56
export const WORLD_W = MAP_COLS * TILE
export const WORLD_H = MAP_ROWS * TILE

/** 地块编码：g 草地（基底） p 石板路 F 农田 w 水面 n 栅栏 l 路灯 */
export type TileCode = 'g' | 'p' | 'F' | 'w' | 'n' | 'l'

/**
 * 小镇布局（24x16，程序化生成避免手写错位）——仅描述地面层：
 * - 地面：默认草地（grass 基底 + 少量 grass2 野花变体，由渲染层按种子确定性撒布）
 * - 路网：横向主路贯穿 + 通向各家门口的纵向支路 + 中心广场 + 农田便道
 * - 水塘：中南不规则水面（water 帧动画），东岸接木码头（dock 实体，可站立垂钓）
 * - 农田：右下 2x2 田块（field），西侧栅栏围合，其余三面便道环绕
 * - 路灯：沿主路两侧错落点缀
 * 建筑 / 大树 / 水井 / 码头均为多格实体（见 BUILDINGS），不再是单格图章。
 */
function buildTownMap(): TileCode[][] {
  const g: TileCode[][] = Array.from({ length: MAP_ROWS }, () =>
    Array<TileCode>(MAP_COLS).fill('g'),
  )
  const set = (x: number, y: number, c: TileCode) => {
    if (x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS) g[y][x] = c
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, c: TileCode) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c)
  }

  // ----- 连贯石板路网 -----
  rect(1, 8, 22, 8, 'p') // 横向主路（贯穿全镇）
  rect(3, 3, 3, 7, 'p') // 长者家门口 → 主路
  rect(3, 9, 3, 11, 'p') // 主路 → 玩家小屋
  rect(13, 3, 13, 4, 'p') // 画室门口 → 广场
  rect(19, 3, 19, 7, 'p') // 杂货铺门口 → 主路
  rect(10, 5, 15, 7, 'p') // 中心广场（水井坐落其中）
  rect(20, 9, 20, 11, 'p') // 主路 → 农田便道
  rect(18, 11, 21, 11, 'p') // 农田北便道
  rect(18, 14, 21, 14, 'p') // 农田南便道
  rect(21, 12, 21, 13, 'p') // 农田东便道

  // ----- 水塘（中南不规则小湖，帧动画水面；东岸 (12,11) 为码头格） -----
  ;[
    [9, 11],
    [10, 11],
    [11, 11],
    [9, 12],
    [10, 12],
    [11, 12],
    [12, 12],
    [9, 13],
    [10, 13],
    [11, 13],
    [10, 14],
  ].forEach(([x, y]) => set(x, y, 'w'))

  // ----- 农田（右下 2x2）+ 西侧栅栏围合（其余三面便道环绕） -----
  rect(19, 12, 20, 13, 'F')
  set(18, 12, 'n')
  set(18, 13, 'n')

  // ----- 路灯（沿主路两侧错落：北侧 4 盏 + 南侧 3 盏，避开支路与广场） -----
  ;[
    [1, 7],
    [7, 7],
    [16, 7],
    [22, 7],
    [5, 9],
    [11, 9],
    [17, 9],
  ].forEach(([x, y]) => set(x, y, 'l'))

  return g
}

export const TOWN_MAP: TileCode[][] = buildTownMap()

/** 地块贴图与纯色降级；mini 为小地图专用色（缺省用 color） */
export const TILE_STYLE: Record<TileCode, { img: string | null; color: string; mini?: string }> = {
  // 草地基底（grass2 野花变体由渲染层按种子确定性替换，不走这里）
  g: { img: '/assets/tiles/grass.png', color: '#97A872' },
  p: { img: '/assets/tiles/path.png', color: '#C9B48A' },
  F: { img: '/assets/tiles/field.png', color: '#7A5638' },
  // 水面由 TownMap 以帧动画渲染，此处仅提供降级底色 / 小地图色
  w: { img: null, color: '#7FA393' },
  // 栅栏 / 路灯为透明装饰图，叠在草地基底之上；小地图用木色 / 暖金区分
  n: { img: '/assets/tiles/fence.png', color: '#97A872', mini: '#8F7A56' },
  l: { img: '/assets/tiles/lamp.png', color: '#97A872', mini: '#C9A44A' },
}

/**
 * 草地变体（种子确定性）：约 13% 的格子使用带野花点缀的 grass2，
 * 纯函数只依赖坐标，渲染多次结果一致，不会每次渲染乱跳。
 */
export function isFlowerGrass(x: number, y: number): boolean {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100 < 13
}

// ---------- 多格建筑 / 装饰实体 ----------

export interface Building {
  id: string
  img: string
  /** footprint（占位格）左上角坐标 */
  x: number
  y: number
  /** footprint 宽高（格），占位格默认不可通行 */
  w: number
  h: number
  /**
   * 精灵向上额外延伸的格数（屋顶 / 树冠悬挑）。
   * 素材按 64px/格设计：精灵高 = (h + spriteUp) * TILE，底边与 footprint 底边对齐。
   */
  spriteUp?: number
  /** 可站立（码头：玩家能走上去垂钓） */
  walkable?: boolean
  /** 有烟囱（炊烟动效锚点：精灵顶部偏右） */
  chimney?: boolean
  /** 贴图缺失时的降级文字 */
  fallbackText: string
  /** 小地图色 */
  mini: string
}

/**
 * 多格建筑与大型装饰（y 排序按 footprint 底边）：
 * - 长者住左上红顶大屋（house-red 2x2），杂货铺（house-wood 2x2）是商人地盘，
 *   画室塔楼（house-tall 2x2+1 悬挑）是画师地盘，NPC 各站自家门口
 * - 中心广场：石井（well 1x1）；玩家小屋在左下
 * - 水塘东岸：木码头（dock 1x1，可站立，点击开始钓鱼）
 * - 大树（tree-big 1x1+1 悬挑）：北缘一排 + 场内零星点缀
 */
export const BUILDINGS: Building[] = [
  // ----- 房屋 -----
  {
    id: 'elder-home',
    img: '/assets/buildings/house-red.png',
    x: 2,
    y: 1,
    w: 2,
    h: 2,
    chimney: true,
    fallbackText: '长者家',
    mini: '#8A4A3C',
  },
  {
    id: 'general-store',
    img: '/assets/buildings/house-wood.png',
    x: 18,
    y: 1,
    w: 2,
    h: 2,
    fallbackText: '杂货铺',
    mini: '#6E5233',
  },
  {
    id: 'studio-tower',
    img: '/assets/buildings/house-tall.png',
    x: 13,
    y: 1,
    w: 2,
    h: 2,
    spriteUp: 1,
    chimney: true,
    fallbackText: '画室',
    mini: '#7A4A44',
  },
  {
    id: 'player-home',
    img: '/assets/buildings/house-red.png',
    x: 2,
    y: 12,
    w: 2,
    h: 2,
    chimney: true,
    fallbackText: '我的小屋',
    mini: '#8A4A3C',
  },
  // ----- 广场水井 -----
  {
    id: 'plaza-well',
    img: '/assets/buildings/well.png',
    x: 12,
    y: 6,
    w: 1,
    h: 1,
    fallbackText: '水井',
    mini: '#7A7568',
  },
  // ----- 钓鱼码头（可站立） -----
  {
    id: 'fishing-dock',
    img: '/assets/tiles/dock.png',
    x: 12,
    y: 11,
    w: 1,
    h: 1,
    walkable: true,
    fallbackText: '码头',
    mini: '#8F7A56',
  },
  // ----- 北缘大树 -----
  ...[1, 5, 9, 16, 21].map(
    (x): Building => ({
      id: `tree-n${x}`,
      img: '/assets/tiles/tree-big.png',
      x,
      y: 1,
      w: 1,
      h: 1,
      spriteUp: 1,
      fallbackText: '大树',
      mini: '#5F6C43',
    }),
  ),
  // ----- 场内零星大树 -----
  ...([
    [23, 3],
    [1, 5],
    [6, 6],
    [22, 6],
    [16, 10],
    [7, 14],
    [14, 14],
  ] as const).map(
    ([x, y]): Building => ({
      id: `tree-${x}-${y}`,
      img: '/assets/tiles/tree-big.png',
      x,
      y,
      w: 1,
      h: 1,
      spriteUp: 1,
      fallbackText: '大树',
      mini: '#5F6C43',
    }),
  ),
]

/** 钓鱼码头格（点击它与点击水面一样开始钓鱼；可站立故不阻挡移动） */
export const DOCK_POS: Pos = { x: 12, y: 11 }

/** 不可通行的地块（农田/水面/栅栏/路灯；建筑占位格单独计算） */
const BLOCKED_CODES: TileCode[] = ['F', 'w', 'n', 'l']

/** 建筑占位格集合（不可通行部分；码头等 walkable 除外），预计算避免每步遍历 */
const BUILDING_BLOCKED = new Set<string>(
  BUILDINGS.filter((b) => !b.walkable).flatMap((b) => {
    const cells: string[] = []
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) cells.push(`${x},${y}`)
    return cells
  }),
)

/** 帧动画路径工具：/assets/anim/<name>/frame-0..3.png */
export const animFrames = (name: string): string[] =>
  [0, 1, 2, 3].map((i) => `/assets/anim/${name}/frame-${i}.png`)

/** 橘猫行走帧序列 / 水塘水面帧序列 */
export const CAT_WALK_FRAMES = animFrames('cat-walk')
export const WATER_FRAMES = animFrames('water')

export interface NpcMeta {
  id: string
  img: string
  /** 待机呼吸帧序列（4 帧循环） */
  anim: string[]
  pos: Pos
  /** 贴图缺失时的降级底色 */
  color: string
}

/**
 * NPC 站位（各站自家门口，面向门前支路）：
 * 长者 → 红顶大屋门口；商人 → 杂货铺门口；画师 → 画室塔楼门口
 * （注意：store 里画师 id 为 painter，素材文件名为 artist.png / artist-idle）
 */
export const NPC_META: NpcMeta[] = [
  {
    id: 'elder',
    img: '/assets/npc/elder.png',
    anim: animFrames('elder-idle'),
    pos: { x: 3, y: 3 },
    color: '#8A6242',
  },
  {
    id: 'merchant',
    img: '/assets/npc/merchant.png',
    anim: animFrames('merchant-idle'),
    pos: { x: 19, y: 3 },
    color: '#9E7C33',
  },
  {
    id: 'painter',
    img: '/assets/npc/artist.png',
    anim: animFrames('artist-idle'),
    pos: { x: 13, y: 3 },
    color: '#A8504B',
  },
]

export const NPC_POSITIONS: Pos[] = NPC_META.map((n) => n.pos)

/** 农田 2x2 固定格（对应 garden.plots 数组下标） */
export const FARM_CELLS: Pos[] = [
  { x: 19, y: 12 },
  { x: 20, y: 12 },
  { x: 19, y: 13 },
  { x: 20, y: 13 },
]

export const PLAYER_START: Pos = { x: 3, y: 10 }
export const PET_START: Pos = { x: 5, y: 10 }

export function isBlocked(pos: Pos): boolean {
  if (pos.x < 0 || pos.x >= MAP_COLS || pos.y < 0 || pos.y >= MAP_ROWS) return true
  if (BLOCKED_CODES.includes(TOWN_MAP[pos.y][pos.x])) return true
  if (BUILDING_BLOCKED.has(`${pos.x},${pos.y}`)) return true
  if (NPC_POSITIONS.some((p) => p.x === pos.x && p.y === pos.y)) return true
  return false
}

// ---------- 作物图鉴（多种作物：种子成本 / 生长所需浇水次数 / 收获金币） ----------

export type CropId = 'carrot' | 'pumpkin' | 'wheat'

export interface CropDef {
  id: CropId
  name: string
  /** 播种成本（金币） */
  cost: number
  /** 每个生长阶段所需浇水次数（阶段 0→1→2，次数越多越慢） */
  waterings: number
  /** 成熟收获金币 */
  reward: number
  /** 成熟贴图（seed / sprout 阶段共用现有贴图） */
  ripeImg: string
}

export const CROPS: Record<CropId, CropDef> = {
  carrot: {
    id: 'carrot',
    name: '胡萝卜',
    cost: 0,
    waterings: 1,
    reward: 15,
    ripeImg: '/assets/crop/ripe.png',
  },
  pumpkin: {
    id: 'pumpkin',
    name: '南瓜',
    cost: 5,
    waterings: 2,
    reward: 30,
    ripeImg: '/assets/crop/pumpkin-ripe.png',
  },
  wheat: {
    id: 'wheat',
    name: '小麦',
    cost: 3,
    waterings: 3,
    reward: 20,
    ripeImg: '/assets/crop/wheat-ripe.png',
  },
}

export const CROP_LIST: CropDef[] = [CROPS.carrot, CROPS.pumpkin, CROPS.wheat]

/** 地块存的是作物 id；兼容旧存档里的中文作物名（默认按胡萝卜处理） */
export function cropDef(crop: string): CropDef {
  if (crop in CROPS) return CROPS[crop as CropId]
  if (crop.includes('南瓜')) return CROPS.pumpkin
  if (crop.includes('小麦')) return CROPS.wheat
  return CROPS.carrot
}

// ---------- 商人装饰店 ----------

export interface DecorItem {
  id: string
  name: string
  price: number
  img: string
}

export const DECOR_ITEMS: DecorItem[] = [
  { id: 'plant', name: '盆栽', price: 20, img: '/assets/decor/plant.png' },
  { id: 'bookshelf', name: '书架', price: 45, img: '/assets/decor/bookshelf.png' },
  { id: 'lamp', name: '落地灯', price: 35, img: '/assets/decor/lamp.png' },
  { id: 'trophy', name: '奖杯', price: 60, img: '/assets/decor/trophy.png' },
  { id: 'cat', name: '猫咪摆件', price: 50, img: '/assets/decor/cat.png' },
]

/** 按 id 查装饰品（背包陈列用；旧存档可能有未知 id，返回 undefined 时跳过） */
export function decorById(id: string): DecorItem | undefined {
  return DECOR_ITEMS.find((d) => d.id === id)
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
