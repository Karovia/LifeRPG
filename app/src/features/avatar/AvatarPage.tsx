import { useState } from 'react'
import { useGameStore } from '@/store/gameStore'
import AvatarWizard from './AvatarWizard'
import AvatarProfile from './AvatarProfile'

/**
 * 虚拟形象模块入口：
 * - 首次进入（尚无 avatarUrl）→ 创建向导（名字 → 描述 → 生成确认）
 * - 已有形象 → 档案查看页，可随时「重新生成」
 */
export default function AvatarPage() {
  const avatarUrl = useGameStore((s) => s.player.avatarUrl)
  const updateAvatarDraft = useGameStore((s) => s.updateAvatarDraft)
  const [regenerating, setRegenerating] = useState(false)

  const showWizard = !avatarUrl || regenerating

  if (showWizard) {
    return (
      <AvatarWizard
        regenerating={regenerating}
        onExit={() => setRegenerating(false)}
      />
    )
  }

  return (
    <AvatarProfile
      onRegenerate={() => {
        // 重新生成：跳过起名，直接从描述步开始
        updateAvatarDraft({ step: 2, previewUrl: null })
        setRegenerating(true)
      }}
    />
  )
}
