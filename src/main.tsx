import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ProbePage } from './probe/ProbePage'
import { createMockApi } from './lib/mock-api'
import { installAndroidBack } from './lib/android-back'
import './styles/base.css'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

/*
 * window.api 的两个来源：
 *  1. 真正的手机端实现（直连 WebDAV）—— 还在做，见 README 的"下一步"；
 *  2. 现在先用内存示例数据顶上，保证界面能跑起来（与桌面端的浏览器预览模式同一套假数据）。
 */
if (typeof window.api === 'undefined') {
  ;(window as unknown as { api: unknown }).api = createMockApi()
  console.info('[Dsh Reader 手机端] 暂用内存示例数据：真实数据要等 WebDAV 版 api 接完')
}

/** 手机上没法敲 URL，所以给探路页留一个悬浮入口（开发阶段用，正式版会去掉） */
function Shell() {
  const [probe, setProbe] = useState(() => new URLSearchParams(location.search).has('probe'))

  return (
    <>
      <App />
      {probe ? <ProbePage onClose={() => setProbe(false)} /> : null}
      {probe ? null : (
        <button className="probe-fab" onClick={() => setProbe(true)} title="WebDAV 探路测试">
          WD
        </button>
      )}
    </>
  )
}

// 安卓返回键：弹窗 → 阅读器 → 应用，逐层退（不装插件，走 history）
installAndroidBack()

createRoot(container).render(<Shell />)
