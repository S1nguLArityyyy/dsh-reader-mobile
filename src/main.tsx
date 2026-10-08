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

/*
 * 自动同步（手机端此前【完全没实现】✗ 开关能拨但没人读它 ✓）
 *   · 启动 3 秒后跑一次（等书库/设置加载完 ✓）
 *   · 之后按设置里的间隔定时跑 ✓（每分钟检查一次设置，改了不用重启 ✓）
 */
void (async () => {
  const { useApp } = await import('./store/app')
  // 连续失败就停下来（此前会每分钟无脑重试 ✗ 网盘风控时反而一直撞墙 ✓）
  let consecutiveFailures = 0
  let stoppedUntil = 0
  const FAIL_LIMIT = 3

  const looksFailed = (message: string): boolean =>
    /失败|错误|无法|超时|errno|HTTP\s*[45]|未授权|未配置|请先/.test(message)

  const runOnce = (): void => {
    const state = useApp.getState()
    if (!state.settings?.sync.auto) return
    if (Date.now() < stoppedUntil) return
    if (consecutiveFailures >= FAIL_LIMIT) return
    console.info('[自动同步] 开始一轮（已连续失败 ' + consecutiveFailures + ' 次）')
    void Promise.resolve(state.runSync?.())
      .then(() => {
        const after = useApp.getState().sync
        const message = String(after?.message ?? '')
        if (looksFailed(message)) {
          consecutiveFailures += 1
          if (consecutiveFailures >= FAIL_LIMIT) {
            // 退避 30 分钟再试一轮 ✓ 不再每分钟撞墙 ✓
            stoppedUntil = Date.now() + 30 * 60_000
            consecutiveFailures = 0
            console.info('[自动同步] 连续失败 3 次，暂停 30 分钟')
          }
        } else {
          consecutiveFailures = 0
        }
      })
      .catch(() => {
        consecutiveFailures += 1
        if (consecutiveFailures >= FAIL_LIMIT) {
          stoppedUntil = Date.now() + 30 * 60_000
          consecutiveFailures = 0
        }
      })
  }
  window.setTimeout(runOnce, 3000)
  window.setInterval(runOnce, 60_000)
})()