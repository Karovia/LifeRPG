import { PixelButton, PixelPanel } from '@/components/pixel'
import { PLACEMENT_COSTS, useGameStore, type PlacementKind } from '@/store/gameStore'
import { PixelImage } from './PixelImage'
import { PLACEMENT_DEFS, PLACEMENT_KIND_LIST, ROAD_COST } from './townData'

/** 建设工具：某种建筑，或铺路 */
export type BuildTool = PlacementKind | 'road'

interface BuildPanelProps {
  buildTool: BuildTool | null
  onSelectTool: (tool: BuildTool | null) => void
  /** 退出建设模式 */
  onClose: () => void
}

/**
 * 建设面板（底部滑出）：建筑列表（图 / 价 / 拥有数）+ 铺路。
 * 选中工具后到地图上点空地放置；不选工具时点已放置建筑可拆除。
 */
export function BuildPanel({ buildTool, onSelectTool, onClose }: BuildPanelProps) {
  const coins = useGameStore((s) => s.player.coins)
  const placements = useGameStore((s) => s.town.placements)
  const roads = useGameStore((s) => s.town.roads)

  const ownedCount = (kind: PlacementKind) => placements.filter((p) => p.kind === kind).length

  const cardCls = (active: boolean, affordable: boolean) =>
    `pixel-border-sm m-[2px] flex w-full flex-col items-center gap-1 p-1 text-left ${
      active ? 'bg-gold/40 text-ink' : 'bg-parchment-light text-stone-dark'
    } ${affordable ? '' : 'opacity-60'}`

  return (
    <div className="absolute inset-x-0 bottom-0 z-40 mx-auto w-full max-w-2xl px-3 pb-3">
      <style>{`
        @keyframes town-build-in {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .town-build-in { animation: town-build-in 0.28s steps(7, end) both; }
      `}</style>

      <PixelPanel className="town-build-in flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="font-pixel text-xs text-ink">
            🔨 建设模式
            <span className="ml-2 text-[10px] text-gold-dark">{coins} 金币</span>
          </div>
          <PixelButton variant="berry" onClick={onClose} aria-label="退出建设模式">
            完成
          </PixelButton>
        </div>

        {/* 建筑列表 + 铺路 */}
        <div className="grid grid-cols-6 gap-1">
          {PLACEMENT_KIND_LIST.map((kind) => {
            const def = PLACEMENT_DEFS[kind]
            const cost = PLACEMENT_COSTS[kind]
            return (
              <button
                key={kind}
                type="button"
                title={`${def.name} · ${def.w}x${def.h} · ${cost} 金币`}
                className={cardCls(buildTool === kind, coins >= cost)}
                onClick={() => onSelectTool(buildTool === kind ? null : kind)}
              >
                <PixelImage
                  src={def.img}
                  alt={def.name}
                  className="h-10 w-10 object-contain"
                  fallbackClassName="h-10 w-10 bg-wood"
                  fallbackText={def.fallbackText.slice(0, 1)}
                />
                <span className="font-pixel text-[9px] leading-3">{def.name}</span>
                <span className="font-pixel text-[8px] leading-3 text-gold-dark">
                  {cost} 金 · 有 {ownedCount(kind)}
                </span>
              </button>
            )
          })}

          {/* 铺路（5 金币/格） */}
          <button
            type="button"
            title={`铺路 · 1x1 · ${ROAD_COST} 金币/格`}
            className={cardCls(buildTool === 'road', coins >= ROAD_COST)}
            onClick={() => onSelectTool(buildTool === 'road' ? null : 'road')}
          >
            <PixelImage
              src="/assets/tiles/path.png"
              alt="铺路"
              className="h-10 w-10 object-contain"
              fallbackClassName="h-10 w-10 bg-stone"
              fallbackText="路"
            />
            <span className="font-pixel text-[9px] leading-3">铺路</span>
            <span className="font-pixel text-[8px] leading-3 text-gold-dark">
              {ROAD_COST} 金/格 · 已铺 {roads.length}
            </span>
          </button>
        </div>

        <p className="text-[11px] leading-4 text-stone-dark">
          {buildTool
            ? buildTool === 'road'
              ? '点击草地铺路；点击已铺的自家道路可铲除。WASD / 摇杆仍可走动看位置。'
              : `点击空地放置「${PLACEMENT_DEFS[buildTool].name}」（绿=可放 / 红=不可放）；再点一次列表可取消选择。WASD / 摇杆仍可走动看位置。`
            : '先选一个建筑或「铺路」，再点击空地放置。不选工具时点击已放置的建筑可拆除（半价退款，需二次确认）。'}
        </p>
      </PixelPanel>
    </div>
  )
}
