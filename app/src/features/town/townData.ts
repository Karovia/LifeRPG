import type { Placement, PlacementKind, Player, Quest, QuestNode, TownNpc } from '@/store/gameStore'

/**
 * ============================================================
 * 小镇模块：地图数据 / NPC 对话与好感度 mock / 委托模板
 * （纯本地确定性逻辑，不依赖 lib/ai，方便后续替换为真实 LLM）
 *
 * 重设计 D2：参考 peteroravec.com「整个页面即游戏世界」，
 * 地图为 32x20 可滚动世界，镜头跟随玩家；
 * 东侧 + 南侧为家园建设空地（建设判定见 canPlaceBuilding / canPaveRoad）。
 * ============================================================
 */

// ---------- 地图 ----------

export interface Pos {
  x: number
  y: number
}

export const MAP_COLS = 32
export const MAP_ROWS = 20

/** 单格像素尺寸（世界层按绝对像素排布，供镜头平移；56 贴近 64px 美术原图，细节更清晰） */
export const TILE = 56
export const WORLD_W = MAP_COLS * TILE
export const WORLD_H = MAP_ROWS * TILE

/** 地块编码：g 草地（基底） p 石板路 F 农田 w 水面 n 栅栏 l 路灯 */
export type TileCode = 'g' | 'p' | 'F' | 'w' | 'n' | 'l'

/**
 * 小镇布局（32x20，程序化生成避免手写错位）——仅描述地面层：
 * - 核心镇区（0-23 列 × 0-15 行）保持原布局：NPC 三宅 / 广场 / 水塘 / 码头 / 农田
 * - 地面：默认草地（grass 基底 + 少量 grass2 野花变体，由渲染层按种子确定性撒布）
 * - 路网：横向主路贯穿全镇（延伸至东侧建设区边缘）+ 通向各家门口的纵向支路 + 中心广场 + 农田便道
 * - 水塘：中南不规则水面（water 帧动画），东岸接木码头（dock 实体，可站立垂钓）
 * - 农田：右下 2x2 田块（field），西侧栅栏围合，其余三面便道环绕
 * - 路灯：沿主路两侧错落点缀
 * - 东侧（24-31 列）与南侧（16-19 行）：平整草地建设空地，少装饰，供家园建设
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
  rect(1, 8, 31, 8, 'p') // 横向主路（贯穿全镇，延伸至东侧建设区）
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
  // ----- 北缘大树（延伸至东侧建设区北缘，保持稀疏） -----
  ...[1, 5, 9, 16, 21, 26, 30].map(
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

// ---------- 家园建设：可放置建筑定义与建设判定 ----------

/** 可放置建筑的渲染元数据（复用 BUILDINGS 的贴图渲染约定：底边对齐 + spriteUp 悬挑 + y 排序） */
export interface PlacementDef {
  kind: PlacementKind
  name: string
  img: string
  /** footprint 宽高（格），全部占位格不可通行 */
  w: number
  h: number
  /** 精灵向上悬挑格数（树冠 / 塔楼屋顶） */
  spriteUp?: number
  /** 有烟囱（炊烟动效） */
  chimney?: boolean
  fallbackText: string
  /** 小地图色 */
  mini: string
}

export const PLACEMENT_DEFS: Record<PlacementKind, PlacementDef> = {
  'house-red': {
    kind: 'house-red',
    name: '红顶小屋',
    img: '/assets/buildings/house-red.png',
    w: 2,
    h: 2,
    chimney: true,
    fallbackText: '小屋',
    mini: '#8A4A3C',
  },
  'house-wood': {
    kind: 'house-wood',
    name: '原木木屋',
    img: '/assets/buildings/house-wood.png',
    w: 2,
    h: 2,
    fallbackText: '木屋',
    mini: '#6E5233',
  },
  'house-tall': {
    kind: 'house-tall',
    name: '高挑塔楼',
    img: '/assets/buildings/house-tall.png',
    w: 2,
    h: 2,
    spriteUp: 1,
    chimney: true,
    fallbackText: '塔楼',
    mini: '#7A4A44',
  },
  well: {
    kind: 'well',
    name: '石井',
    img: '/assets/buildings/well.png',
    w: 1,
    h: 1,
    fallbackText: '水井',
    mini: '#7A7568',
  },
  'tree-big': {
    kind: 'tree-big',
    name: '大树',
    img: '/assets/tiles/tree-big.png',
    w: 1,
    h: 1,
    spriteUp: 1,
    fallbackText: '大树',
    mini: '#5F6C43',
  },
}

export const PLACEMENT_KIND_LIST: PlacementKind[] = [
  'house-red',
  'house-wood',
  'house-tall',
  'well',
  'tree-big',
]

/** 铺路单价（金币/格），addRoad 的 cost 必须传这个值 */
export const ROAD_COST = 5

/** 某建筑 footprint 覆盖的所有格子 */
export function footprintCells(x: number, y: number, w: number, h: number): Pos[] {
  const cells: Pos[] = []
  for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) cells.push({ x: cx, y: cy })
  return cells
}

/** 某放置建筑 footprint 覆盖的所有格子 */
export function placementCells(p: Placement): Pos[] {
  const def = PLACEMENT_DEFS[p.kind]
  return footprintCells(p.x, p.y, def.w, def.h)
}

/** 全部静态建筑 footprint（含 walkable 码头；建设判定用，区别于通行判定） */
const ALL_BUILDING_CELLS = new Set<string>(
  BUILDINGS.flatMap((b) => footprintCells(b.x, b.y, b.w, b.h).map((c) => `${c.x},${c.y}`)),
)

export interface BuildCheck {
  ok: boolean
  /** 不可建原因（UI 提示 / 红色预览用） */
  reason?: string
}

/**
 * 建筑放置判定：footprint 全部合法才可放。
 * 可建区 = 东侧/南侧等平整草地；不可建 = 水面 / 道路 / 农田 / 栅栏 / 路灯 /
 * 现有建筑（含码头）/ 已放置建筑 / NPC 站位 / 玩家已铺道路 / 额外占用格（玩家、宠物）。
 */
export function canPlaceBuilding(
  kind: PlacementKind,
  x: number,
  y: number,
  placements: Placement[],
  extraOccupied: Pos[] = [],
): BuildCheck {
  const def = PLACEMENT_DEFS[kind]
  const cells = footprintCells(x, y, def.w, def.h)
  const placedCells = new Set(placements.flatMap((p) => placementCells(p).map((c) => `${c.x},${c.y}`)))
  const extraCells = new Set(extraOccupied.map((c) => `${c.x},${c.y}`))

  for (const c of cells) {
    if (c.x < 0 || c.x >= MAP_COLS || c.y < 0 || c.y >= MAP_ROWS) return { ok: false, reason: '超出小镇边界' }
    const code = TOWN_MAP[c.y][c.x]
    if (code === 'w') return { ok: false, reason: '水面上不能建设' }
    if (code === 'p') return { ok: false, reason: '道路上不能建设' }
    if (code === 'F') return { ok: false, reason: '农田要留着种地' }
    if (code === 'n' || code === 'l') return { ok: false, reason: '这里有镇上的设施' }
    if (ALL_BUILDING_CELLS.has(`${c.x},${c.y}`)) return { ok: false, reason: '与现有建筑冲突' }
    if (placedCells.has(`${c.x},${c.y}`)) return { ok: false, reason: '与已放置的建筑重叠' }
    if (NPC_POSITIONS.some((p) => p.x === c.x && p.y === c.y)) return { ok: false, reason: '不能建在居民脚下' }
    if (extraCells.has(`${c.x},${c.y}`)) return { ok: false, reason: '先走开一步再建' }
  }
  return { ok: true }
}

/**
 * 铺路判定：单格。草地空地上可铺；水面 / 道路 / 农田 / 设施 /
 * 建筑占位（含码头与已放置建筑）/ NPC 站位 / 额外占用格不可铺。
 */
export function canPaveRoad(
  x: number,
  y: number,
  placements: Placement[],
  extraOccupied: Pos[] = [],
): BuildCheck {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return { ok: false, reason: '超出小镇边界' }
  const code = TOWN_MAP[y][x]
  if (code === 'w') return { ok: false, reason: '水面上不能铺路' }
  if (code === 'p') return { ok: false, reason: '这里已经是道路了' }
  if (code === 'F') return { ok: false, reason: '农田要留着种地' }
  if (code === 'n' || code === 'l') return { ok: false, reason: '这里有镇上的设施' }
  if (ALL_BUILDING_CELLS.has(`${x},${y}`)) return { ok: false, reason: '建筑占位不能铺路' }
  if (placements.some((p) => placementCells(p).some((c) => c.x === x && c.y === y)))
    return { ok: false, reason: '已放置建筑的占位不能铺路' }
  if (NPC_POSITIONS.some((p) => p.x === x && p.y === y)) return { ok: false, reason: '不能铺在居民脚下' }
  if (extraOccupied.some((c) => c.x === x && c.y === y)) return { ok: false, reason: '先走开一步再铺' }
  return { ok: true }
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
    reward: 8,
    ripeImg: '/assets/crop/ripe.png',
  },
  pumpkin: {
    id: 'pumpkin',
    name: '南瓜',
    cost: 5,
    waterings: 2,
    reward: 18,
    ripeImg: '/assets/crop/pumpkin-ripe.png',
  },
  wheat: {
    id: 'wheat',
    name: '小麦',
    cost: 3,
    waterings: 3,
    reward: 12,
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

// ---------- 委托模板（本地回退池，带 key 去重） ----------

function walkNodes(nodes: QuestNode[], fn: (n: QuestNode) => void): void {
  for (const n of nodes) {
    fn(n)
    if (n.children) walkNodes(n.children, fn)
  }
}

/** 委托草稿（LLM 与本地池共用此结构；key 全局唯一，写入 commission.id 并进入 commissionHistory） */
export interface CommissionDraft {
  key: string
  title: string
  description: string
  rewardCoins: number
}

/** 模板参数化上下文（取自玩家当前状态） */
interface CommissionCtx {
  /** 第一个目标标题（无目标时为通用文案） */
  questTitle: string
  /** 第一个 available 节点标题（可空） */
  nodeTitle: string | null
  level: number
  availableNodes: number
  doneNodes: number
  hasQuest: boolean
}

interface CommissionTemplate {
  key: string
  make: (ctx: CommissionCtx) => Omit<CommissionDraft, 'key'>
}

function collectCtx(player: Player, quests: Quest[]): CommissionCtx {
  let availableNodes = 0
  let doneNodes = 0
  let nodeTitle: string | null = null
  quests.forEach((q) =>
    walkNodes(q.nodes, (n) => {
      if (n.status === 'available') {
        availableNodes += 1
        if (!nodeTitle) nodeTitle = n.title
      }
      if (n.status === 'done') doneNodes += 1
    }),
  )
  return {
    questTitle: quests[0]?.title ?? '你的目标',
    nodeTitle,
    level: player.level,
    availableNodes,
    doneNodes,
    hasQuest: quests.length > 0,
  }
}

const REPORT_HINT = '（认真写下 20 字以上的感受）'

/**
 * 本地委托模板池：每 NPC 7 条，key = <npc>-t<序号>。
 * 文案用当前 quest 标题 / available 节点 / 等级参数化；
 * 生成端按 key 排除 commissionHistory，做完的委托永不复现。
 */
const COMMISSION_POOLS: Record<string, CommissionTemplate[]> = {
  elder: [
    {
      key: 'elder-t1',
      make: (c) => ({
        title: '长者的委托 · 聊聊志向',
        description: c.hasQuest
          ? `听说你正在为「${c.questTitle}」努力。过来，跟我这个老头子讲讲：你为什么选择它？${REPORT_HINT}`
          : `你现在还没有任何目标。先去「任务」页为自己立下一个目标，然后回来告诉我：你为什么选择它？${REPORT_HINT}`,
        rewardCoins: 20,
      }),
    },
    {
      key: 'elder-t2',
      make: (c) => ({
        title: '长者的委托 · 耐心的故事',
        description: `我年轻时也追过目标。你已经是 LV.${c.level} 的冒险者了——告诉我，这一路上哪件事教会了你耐心？${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
    {
      key: 'elder-t3',
      make: (c) => ({
        title: '长者的委托 · 下一步',
        description: c.nodeTitle
          ? `你的「${c.nodeTitle}」还等着你。去完成它，回来跟我说说过程里印象最深的一刻。${REPORT_HINT}`
          : '挑一件你一直拖着没做的小事，今天完成它，回来跟我讲讲经过。' + REPORT_HINT,
        rewardCoins: 30,
      }),
    },
    {
      key: 'elder-t4',
      make: () => ({
        title: '长者的委托 · 挫折课',
        description: `成长路上谁没摔过跤？跟我讲讲你最近遇到的一次挫折，以及你打算怎么迈过去。${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
    {
      key: 'elder-t5',
      make: () => ({
        title: '长者的委托 · 感恩的心',
        description: `镇里的日子安稳，是因为有人帮衬。说说最近帮助过你的一个人，和你想怎么谢谢 TA。${REPORT_HINT}`,
        rewardCoins: 20,
      }),
    },
    {
      key: 'elder-t6',
      make: (c) => ({
        title: '长者的委托 · 老经验新用法',
        description: `我有一筐老道理，缺年轻人验证。挑一个你听过的道理，用你在「${c.questTitle}」上的经历讲讲它对不对。${REPORT_HINT}`,
        rewardCoins: 30,
      }),
    },
    {
      key: 'elder-t7',
      make: (c) => ({
        title: '长者的委托 · 成长复盘',
        description: `你已经完成了 ${c.doneNodes} 个任务节点。把这周的得与失捋一遍，来跟我汇报三条收获。${REPORT_HINT}`,
        rewardCoins: 35,
      }),
    },
  ],
  merchant: [
    {
      key: 'merchant-t1',
      make: (c) => ({
        title: '商人的委托 · 效率报告',
        description: c.hasQuest
          ? `时间就是金币！你手头的「${c.questTitle}」进展如何？给我一份简报：完成了什么、卡在哪里。${REPORT_HINT}`
          : `没有目标可不行！先去「任务」页立下目标，再回来跟我汇报你的计划。${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
    {
      key: 'merchant-t2',
      make: (c) => ({
        title: '商人的委托 · 目标盘点',
        description: `LV.${c.level} 的冒险者，把你的目标按轻重缓急排个序，跟我说说第一名为什么是它。${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
    {
      key: 'merchant-t3',
      make: (c) => ({
        title: '商人的委托 · 承诺兑现',
        description: c.nodeTitle
          ? `「${c.nodeTitle}」——就它了。去完成，然后回来兑现你的汇报，我欣赏说到做到的人。${REPORT_HINT}`
          : '随便挑一件小事，今天之内完成它，回来兑现你的汇报。' + REPORT_HINT,
        rewardCoins: 30,
      }),
    },
    {
      key: 'merchant-t4',
      make: (c) => ({
        title: '商人的委托 · 成本核算',
        description: `我算新货成本算到头大。帮我个忙：算算你每周在「${c.questTitle}」上投入多少时间，值不值？${REPORT_HINT}`,
        rewardCoins: 30,
      }),
    },
    {
      key: 'merchant-t5',
      make: (c) => ({
        title: '商人的委托 · 推销练习',
        description: `做生意要会卖卖点。把你的目标「${c.questTitle}」当成商品，跟我推销它——为什么值得坚持？${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
    {
      key: 'merchant-t6',
      make: () => ({
        title: '商人的委托 · 风险预案',
        description: `精明的商人都有 B 计划。说说你的目标万一受挫，你的备用方案是什么？${REPORT_HINT}`,
        rewardCoins: 30,
      }),
    },
    {
      key: 'merchant-t7',
      make: () => ({
        title: '商人的委托 · 一周结算',
        description: `到结算时间了！盘点这一周：赚到的成长、亏掉的时间，下周怎么改进？${REPORT_HINT}`,
        rewardCoins: 35,
      }),
    },
  ],
  painter: [
    {
      key: 'painter-t1',
      make: (c) => ({
        title: '画师的委托 · 目标的色彩',
        description: `如果「${c.questTitle}」是一种颜色，它会是什么？画不出来没关系，用语言为我上色。${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
    {
      key: 'painter-t2',
      make: (c) => ({
        title: '画师的委托 · 新招牌',
        description: `听说你在钻研「${c.questTitle}」？用你正在学的新东西，为我的画室「画」一张文字招牌——描绘它的样子。${REPORT_HINT}`,
        rewardCoins: 30,
      }),
    },
    {
      key: 'painter-t3',
      make: (c) => ({
        title: '画师的委托 · 灵感采集',
        description: c.nodeTitle
          ? `去完成「${c.nodeTitle}」，路上留意一个让你心动的画面，回来描述给我。${REPORT_HINT}`
          : '出门走一圈，把今天看到的最美的一帧画面描述给我。' + REPORT_HINT,
        rewardCoins: 30,
      }),
    },
    {
      key: 'painter-t4',
      make: () => ({
        title: '画师的委托 · 梦境速写',
        description: `昨晚的梦还记得吗？哪怕只剩一个片段，也讲给我听——梦是最好的颜料。${REPORT_HINT}`,
        rewardCoins: 20,
      }),
    },
    {
      key: 'painter-t5',
      make: () => ({
        title: '画师的委托 · 黄昏观后感',
        description: `今天的晚霞我画了下来。你去看看黄昏（或者窗外的天），把那一刻的感觉说给我听。${REPORT_HINT}`,
        rewardCoins: 20,
      }),
    },
    {
      key: 'painter-t6',
      make: (c) => ({
        title: '画师的委托 · 成长自画像',
        description: `LV.${c.level} 的你，和刚出发时的你有什么不同？用文字为我画一幅「自画像」。${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
    {
      key: 'painter-t7',
      make: () => ({
        title: '画师的委托 · 小镇写生',
        description: `为水塘、广场或农田任选一处写生——当然，用你的话。越具体，颜色越亮。${REPORT_HINT}`,
        rewardCoins: 25,
      }),
    },
  ],
}

/**
 * 本地回退委托：按 NPC 模板池顺序取第一条「key 不在历史、标题不重复」的模板，
 * 用当前 quest 标题 / available 节点 / 等级参数化文案。
 * 池子全部用完（key 都在 history 中）返回 null，由 UI 提示「暂时没有新委托」。
 */
export function buildLocalCommission(
  npc: TownNpc,
  player: Player,
  quests: Quest[],
  excludeKeys: Set<string>,
  excludeTitles: Set<string>,
): CommissionDraft | null {
  const ctx = collectCtx(player, quests)
  const pool = COMMISSION_POOLS[npc.id] ?? []
  for (const tpl of pool) {
    if (excludeKeys.has(tpl.key)) continue
    const draft = tpl.make(ctx)
    if (excludeTitles.has(draft.title)) continue
    return { key: tpl.key, ...draft }
  }
  return null
}
