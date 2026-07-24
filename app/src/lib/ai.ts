import type { CareerIntent, DiaryEntry, Quest, QuestNode } from '@/store/gameStore'

/**
 * ============================================================
 * AI 能力接口层（当前为确定性本地 mock，无 LLM key）
 * ============================================================
 * ⚠️ 接入点说明：后续接入真实 LLM 时，仅需替换本文件三个函数
 *    的内部实现（保持签名与返回类型不变），调用方无需改动。
 *    建议在函数内部增加 fetch('/api/llm', ...) 或对应 SDK 调用。
 * ============================================================
 */

/**
 * 将人生/职业目标拆解为层层递进的小节点树。
 * TODO(LLM 接入点): 用 LLM 按 SMART 原则拆解目标，返回结构化 JSON。
 */
export function decomposeGoal(goal: string): QuestNode[] {
  const trimmed = goal.trim() || '未命名目标'
  const stages = [
    { title: '了解与调研', description: `收集「${trimmed}」相关信息，明确达成标准与路径` },
    { title: '打基础', description: `学习/准备「${trimmed}」所需的核心知识与技能` },
    { title: '小步实践', description: `完成一个与「${trimmed}」相关的小型实践任务` },
    { title: '复盘与迭代', description: '总结实践经验，找出差距并制定改进计划' },
    { title: '达成目标', description: `完成最终验收，正式达成「${trimmed}」` },
  ]
  return stages.map((s, i) => ({
    id: crypto.randomUUID(),
    title: `第${i + 1}阶段 · ${s.title}`,
    description: s.description,
    status: i === 0 ? 'available' : 'locked',
    rewardXp: 20 * (i + 1),
    rewardCoins: 10 * (i + 1),
  }))
}

const REPLY_POOL = [
  '我已经记下了。一步一步来，你比自己想象中更接近目标。',
  '今天的你，也在认真生活呢。这件事值得被记住。',
  '墨水会消失，但成长不会。继续写下去吧。',
  '嗯，我听到了。把大目标拆小，明天先完成最小的一步。',
  '冒险者的日记又厚了一页。经验值 +1。',
]

/**
 * 日记本回复（汤姆·里德尔式浮现文字）。
 * TODO(LLM 接入点): 用 LLM 根据日记内容与用户目标生成共情式回复。
 */
export function diaryReply(content: string): string {
  // 确定性 mock：按内容长度取模选模板，保证同一内容回复稳定
  const idx = content.length % REPLY_POOL.length
  return REPLY_POOL[idx]
}

/**
 * 根据日记、已完成目标与职业意向生成简历/作品集文本。
 * TODO(LLM 接入点): 用 LLM 整合经历素材，按岗位要求生成可用简历。
 */
export function generateResume(
  entries: DiaryEntry[],
  quests: Quest[],
  intent: CareerIntent,
): string {
  const doneNodes: { quest: string; node: QuestNode }[] = []
  const walk = (questTitle: string, nodes: QuestNode[]) => {
    for (const n of nodes) {
      if (n.status === 'done') doneNodes.push({ quest: questTitle, node: n })
      if (n.children) walk(questTitle, n.children)
    }
  }
  quests.forEach((q) => walk(q.title, q.nodes))

  const lines: string[] = [
    `# 简历 · 意向岗位：${intent.targetRole || '（未填写）'}`,
    '',
    `## 岗位要求理解`,
    intent.requirements || '（未填写岗位要求）',
    '',
    `## 已完成的关键节点（${doneNodes.length} 项）`,
    ...(doneNodes.length
      ? doneNodes.map((d) => `- [${d.quest}] ${d.node.title}：${d.node.description}`)
      : ['- （暂无完成记录）']),
    '',
    `## 成长记录摘录（共 ${entries.length} 篇日记）`,
    ...(entries.length
      ? entries.slice(-5).map((e) => `- ${e.date}：${e.content.slice(0, 80)}`)
      : ['- （暂无日记）']),
  ]
  return lines.join('\n')
}
