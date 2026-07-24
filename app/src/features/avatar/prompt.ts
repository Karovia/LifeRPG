/**
 * 中文形象描述 → 英文 pixel art prompt 构建器
 * Pixellab 对英文提示词效果最佳；前端做确定性的关键词映射，
 * 未命中任何关键词时回退到通用冒险者描述。
 */

/** 关键词映射表：[匹配正则, 英文片段]（按序匹配，命中即收录） */
const KEYWORD_MAP: [RegExp, string][] = [
  // ----- 发型 -----
  [/短发/, 'short hair'],
  [/长发/, 'long hair'],
  [/马尾|辫子/, 'ponytail'],
  [/双马尾/, 'twin tails'],
  [/卷发/, 'curly hair'],
  [/直发/, 'straight hair'],
  [/刘海/, 'with bangs'],
  [/光头/, 'bald head'],
  [/丸子头|发髻/, 'hair bun'],
  [/披风|斗篷/, 'wearing a cloak'],
  // ----- 发色 -----
  [/黑发|黑色头?发/, 'black hair'],
  [/棕发|棕色头?发/, 'brown hair'],
  [/金发|金色头?发/, 'blonde hair'],
  [/白发|银发|白色头?发/, 'silver white hair'],
  [/红发|红色头?发/, 'red hair'],
  [/蓝发|蓝色头?发/, 'blue hair'],
  [/绿发|绿色头?发/, 'green hair'],
  [/粉发|粉色头?发/, 'pink hair'],
  [/紫发|紫色头?发/, 'purple hair'],
  // ----- 眼睛 -----
  [/大眼/, 'big eyes'],
  [/眼镜/, 'wearing glasses'],
  [/墨镜/, 'wearing sunglasses'],
  // ----- 服装 -----
  [/盔甲|铠甲/, 'wearing iron armor'],
  [/法师|魔法|巫师/, 'wizard robe'],
  [/长袍|袍子/, 'wearing a long robe'],
  [/皮甲/, 'leather armor'],
  [/卫衣|休闲/, 'casual hoodie'],
  [/西装|正装/, 'formal suit'],
  [/裙子/, 'wearing a dress'],
  [/围巾/, 'wearing a scarf'],
  [/帽子|兜帽/, 'wearing a hat'],
  [/背包/, 'carrying a backpack'],
  // ----- 武器/道具 -----
  [/剑/, 'holding a sword'],
  [/法杖|魔杖/, 'holding a magic staff'],
  [/弓/, 'carrying a bow'],
  [/盾/, 'holding a shield'],
  [/书/, 'holding a book'],
  // ----- 气质/风格 -----
  [/可爱|萌/, 'cute'],
  [/帅气|酷/, 'cool looking'],
  [/勇敢|勇者/, 'brave'],
  [/温柔|温和/, 'gentle looking'],
  [/神秘/, 'mysterious'],
  [/开心|笑容|微笑/, 'smiling'],
  [/强壮|肌肉/, 'strong'],
  [/瘦/, 'slim'],
]

/** 快捷标签（点击追加到描述，帮助用户输入可映射的关键词） */
export const SUGGESTION_GROUPS: { label: string; chips: string[] }[] = [
  { label: '发型', chips: ['短发', '长发', '马尾', '卷发', '刘海', '丸子头'] },
  { label: '发色', chips: ['黑发', '棕发', '金发', '红发', '蓝发', '粉发'] },
  { label: '服装', chips: ['斗篷', '盔甲', '法师长袍', '卫衣', '围巾', '眼镜'] },
  { label: '道具', chips: ['剑', '法杖', '弓', '盾', '书', '背包'] },
  { label: '气质', chips: ['勇敢', '可爱', '帅气', '神秘', '微笑'] },
]

/**
 * 把中文描述拼装成英文 pixel art prompt。
 * @returns 英文描述片段（createCharacter 会再做一层 RPG 风格包装）
 */
export function buildEnglishPrompt(zhDescription: string): string {
  const traits: string[] = []
  for (const [re, en] of KEYWORD_MAP) {
    if (re.test(zhDescription) && !traits.includes(en)) {
      traits.push(en)
    }
  }
  if (traits.length === 0) {
    // 未命中关键词：给一个安全的通用形象，避免生成失败或不可控结果
    return 'a brave young adventurer, friendly smile, simple outfit'
  }
  return `a young adventurer with ${traits.join(', ')}`
}
