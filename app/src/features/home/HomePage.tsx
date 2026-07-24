import { PixelPanel } from '@/components/pixel'

/** 首页（占位）：数据面板由首页代理在下一轮实现，直接读 store */
export default function HomePage() {
  return (
    <PixelPanel>
      <h2 className="font-pixel text-sm text-ink">首页</h2>
      <p className="mt-2 font-pixel text-xs text-stone">建设中……</p>
    </PixelPanel>
  )
}
