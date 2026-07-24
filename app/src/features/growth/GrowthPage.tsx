import { DecorShop } from './components/DecorShop'
import { HomePreview } from './components/HomePreview'
import { OverviewPanel } from './components/OverviewPanel'
import { RulesBoard } from './components/RulesBoard'

/**
 * 成长中心：成长概览 / 装饰品商店 / 家园预览 / 奖励结算告示牌。
 * 数据来源：useGameStore（player / quests / diaryEntries / inventory）。
 */
export default function GrowthPage() {
  return (
    <div className="space-y-3 p-1">
      <OverviewPanel />
      <DecorShop />
      <HomePreview />
      <RulesBoard />
    </div>
  )
}
