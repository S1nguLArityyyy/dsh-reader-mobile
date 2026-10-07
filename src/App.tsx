import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { BarChart3, Library, Search, Settings as SettingsIcon, Upload } from 'lucide-react'
import { useApp, type Route } from './store/app'
import { Sidebar } from './components/Sidebar'
import { ConflictModal, SyncStatusModal } from './components/SyncModals'
import { Toaster } from './components/ui'
import { BookDetailModal } from './components/BookDetailModal'
import { LibraryPage } from './pages/LibraryPage'
import { StatsPage } from './pages/StatsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReaderPage } from './pages/ReaderPage'
import { applyAppearance } from './lib/appearance'

const ROUTE_ORDER: Record<Route, number> = { library: 0, stats: 1, settings: 2, reader: 3 }

function PageBody({ route }: { route: Route }) {
  if (route === 'stats') return <StatsPage />
  if (route === 'settings') return <SettingsPage />
  return <LibraryPage />
}

/**
 * 手机端的底部导航（桌面端由 CSS 隐藏）。
 * 桌面用左侧边栏，屏宽 ≤768px 时侧边栏让位给这个，系列筛选改到书库页顶部的横向胶囊。
 */
/**
 * 底部毛玻璃导航 BottomGlassTabBar
 *
 * 规格：全宽 fixed 贴底 + 顶部两角 16px 圆角 + 72px 高（底部再叠加安全区）、
 * 4 个 tab：书库 → 统计 → 设置 → 搜索（原「标签」已移除）。
 * 毛玻璃：rgba(255,255,255,0.72) + blur(20px) + 顶部高光描边 + 微弱上浮阴影。
 *
 * 注：本地书库没有独立的搜索页，所以「搜索」是一个动作 tab —— 切到书库并把焦点打进搜索框。
 * 之前那套"横向拖动切换 tab"按新规格去掉了（它在本机 WebView 里也一直没生效）。
 */
function BottomGlassTabBar() {
  const route = useApp((s) => s.route)
  const go = useApp((s) => s.go)
  const tabs: Array<{ key: Route; label: string; icon: ReactNode }> = [
    { key: 'library', label: '书库', icon: <Library size={24} /> },
    { key: 'stats', label: '统计', icon: <BarChart3 size={24} /> },
    { key: 'settings', label: '设置', icon: <SettingsIcon size={24} /> }
  ]

  const openSearch = (): void => {
    go('library')
    // 等书库页挂载完成再聚焦（没有独立搜索页，搜索 tab 的语义就是"打开搜索框"）
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        '.search-input, input[type="search"], .page input'
      )
      input?.focus()
    }, 80)
  }

  return (
    <nav className="glass-tabbar">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`glass-tab${route === tab.key ? ' active' : ''}`}
          onClick={() => go(tab.key)}
        >
          <span className="glass-tab-icon">
            {/* key={route} 让光晕在每次切换时重新挂载，动画就会重新播一遍 */}
            {route === tab.key ? <span key={route} className="glass-tab-halo" /> : null}
            {tab.icon}
          </span>
          <span className="glass-tab-label">{tab.label}</span>
        </button>
      ))}
      <button className="glass-tab" onClick={openSearch}>
        <span className="glass-tab-icon">
          <Search size={24} />
        </span>
        <span className="glass-tab-label">搜索</span>
      </button>
    </nav>
  )
}

export default function App() {
  const ready = useApp((s) => s.ready)
  const route = useApp((s) => s.route)
  const theme = useApp((s) => s.settings?.theme ?? 'light')
  const settings = useApp((s) => s.settings)
  const init = useApp((s) => s.init)
  const importPaths = useApp((s) => s.importPaths)
  const [dragging, setDragging] = useState(false)
  const [prev, setPrev] = useState<{ route: Route; dir: number } | null>(null)
  const lastRoute = useRef<Route>(route)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    applyAppearance(settings)
  }, [settings])

  /* 页面切换：旧页面飞出、新页面飞入 */
  useEffect(() => {
    if (route === lastRoute.current) return
    const from = lastRoute.current
    lastRoute.current = route
    // 进/出阅读器不做推拉动画：阅读器是整屏的，没有"左右"可言，
    // 硬套页面推拉会变成抽搐式回弹（用户反馈过）
    if (route === 'reader' || from === 'reader') {
      setPrev(null)
      return
    }
    const dir = ROUTE_ORDER[route] >= ROUTE_ORDER[from] ? 1 : -1
    setPrev({ route: from, dir })
    const timer = window.setTimeout(() => setPrev(null), 260)
    return () => window.clearTimeout(timer)
  }, [route])

  useEffect(() => {
    let depth = 0
    const onEnter = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) {
        depth += 1
        setDragging(true)
      }
    }
    const onLeave = (): void => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((file) => window.api.app.pathForFile(file)).filter((p) => p && p.length > 0)
      void importPaths(paths)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [importPaths])

  if (!ready) {
    return <div className="app" />
  }

  if (route === 'reader') {
    return (
      <>
        <ReaderPage />
        <SyncStatusModal />
        <ConflictModal />
        <Toaster />
      </>
    )
  }

  const dir = prev?.dir ?? 1

  return (
    <>
      <div className="app">
        <Sidebar />
        <main className="main">
          <div className="page-stack" style={{ '--dir': `${dir * 26}px` } as CSSProperties}>
            {prev ? (
              <div className="page-layer exiting" key={`prev-${prev.route}`}>
                <PageBody route={prev.route} />
              </div>
            ) : null}
            <div className="page-layer entering" key={route}>
              <PageBody route={route} />
            </div>
          </div>
        </main>
      </div>

      {/* 底部导航放在 .app 外面：固定在视口上，不受页面容器的影响 */}
      <BottomGlassTabBar />

      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-hint">
            <Upload size={18} style={{ verticalAlign: -3, marginRight: 6 }} />
            松开以导入 EPUB 到书库
          </div>
        </div>
      ) : null}

      <BookDetailModal />
      <SyncStatusModal />
      <ConflictModal />
      <Toaster />
    </>
  )
}
