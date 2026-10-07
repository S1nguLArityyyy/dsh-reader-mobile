import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProbePage } from './probe/ProbePage'
import { createLocalApi } from './api/local'
import { installAndroidBack } from './lib/android-back'
import './styles/base.css'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

/*
 * 本地数据 api：读导出好的真书数据（public/data/library.json，由桌面端解析器导出）。
 * 之前的 mock-api 还留在 src/lib/mock-api.ts，等数据层完全接好后删掉。
 */
;(window as unknown as { api: unknown }).api = createLocalApi()
console.info('[Dsh Reader 手机端] 本地数据模式：读 data/library.json')

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

createRoot(container).render(<ErrorBoundary><Shell /></ErrorBoundary>)
