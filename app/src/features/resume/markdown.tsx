import type { ReactNode } from 'react'

/**
 * 轻量 markdown 渲染器（无新依赖）。
 * 仅支持本项目生成结果用到的白名单语法：
 *   # 标题 / ## 小节 / ### 小标题 / - 列表项 / **加粗** / 普通段落
 * 其余内容按纯文本展示。
 */

/** 解析行内 **加粗** 片段 */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  if (parts.length === 1) return text
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i} className="text-berry-dark">
        {p.slice(2, -2)}
      </strong>
    ) : (
      p
    ),
  )
}

export function MarkdownScroll({ source }: { source: string }) {
  const lines = source.split('\n')
  const blocks: ReactNode[] = []

  lines.forEach((line, idx) => {
    const t = line.trimEnd()
    if (!t.trim()) {
      blocks.push(<div key={idx} className="h-2" />)
      return
    }
    if (t.startsWith('### ')) {
      blocks.push(
        <h3 key={idx} className="mt-2 font-pixel text-[10px] text-wood-dark">
          {renderInline(t.slice(4))}
        </h3>,
      )
      return
    }
    if (t.startsWith('## ')) {
      blocks.push(
        <h2
          key={idx}
          className="mt-3 border-b-2 border-dashed border-stone pb-1 font-pixel text-[11px] text-moss-dark"
        >
          {renderInline(t.slice(3))}
        </h2>,
      )
      return
    }
    if (t.startsWith('# ')) {
      blocks.push(
        <h1 key={idx} className="font-pixel text-xs text-ink">
          {renderInline(t.slice(2))}
        </h1>,
      )
      return
    }
    if (t.startsWith('- ')) {
      blocks.push(
        <p key={idx} className="flex gap-2 text-xs leading-relaxed text-ink">
          <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 bg-gold-dark" />
          <span>{renderInline(t.slice(2))}</span>
        </p>,
      )
      return
    }
    blocks.push(
      <p key={idx} className="text-xs leading-relaxed text-ink">
        {renderInline(t)}
      </p>,
    )
  })

  return <div className="flex flex-col gap-1">{blocks}</div>
}
