import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { createLocalApi } from './api/local'
import { installAndroidBack } from './lib/android-back'
import './styles/base.css'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

/*
 * 本地数据 api：读导出好的真书数据（public/data/library.json，由桌面端解析器导出）。
 * 数据来自本机 IndexedDB（导入/局域网/网盘拉取的书）✓
 */
;(window as unknown as { api: unknown }).api = createLocalApi()
console.info('[Dsh Reader 手机端] 本地数据模式：读 data/library.json')


// 安卓返回键：弹窗 → 阅读器 → 应用，逐层退（不装插件，走 history）
installAndroidBack()

createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
