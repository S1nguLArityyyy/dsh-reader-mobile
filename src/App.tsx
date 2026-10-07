import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { BarChart3, Library, Settings as SettingsIcon, Upload } from 'lucide-react'
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
function MobileNav() {
  const route = useApp((s) => s.route)
  const go = useApp((s) => s.go)
  const items: Array<{ key: Route; label: string; icon: ReactNode }> = [
    { key: 'library', label: '书库', icon: <Library size={20} /> },
    { key: 'stats', label: '统计', icon: <BarChart3 size={20} /> },
    { key: 'settings', label: '设置', icon: <SettingsIcon size={20} /> }
  ]
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.key === route)
  )
  const drag = useRef<{ x: number; index: number; moved: boolean } | null>(null)
  // 拖动结束后浏览器还会补一次 click：用它把那次 click 吞掉，否则会"滑一下跳两格"
  const swallowClick = useRef(false)

  return (
    <nav
      className="mobile-nav"
      onTouchStart={(e) => {
        const touch = e.touches[0]
        if (touch) drag.current = { x: touch.clientX, index: activeIndex, moved: false }
      }}
      onTouchMove={(e) => {
        const touch = e.touches[0]
        if (!drag.current || !touch) return
        if (Math.abs(touch.clientX - drag.current.x) > 10) drag.current.moved = true
        // 注意：React 的 touchmove 监听是 passive 的，preventDefault 无效，
        // 横向手势的默认行为由 CSS 的 touch-action: none 屏蔽
      }}
      onTouchEnd={(e) => {
        const start = drag.current
        drag.current = null
        if (!start) return
        const touch = e.changedTouches[0]
        if (!touch) return
        const dx = touch.clientX - start.x
        // 拖动超过一个手指宽度才切选项卡
        if (Math.abs(dx) < 40) return
        swallowClick.current = true
        const next = start.index + (dx < 0 ? 1 : -1)
        const target = items[Math.max(0, Math.min(items.length - 1, next))]
        if (target) go(target.key)
      }}
    >
      {/* 选中圆点：圆心落在当前选项卡图标的中心（q 弹靠 transition 的过冲曲线） */}
      <span
        className="mobile-nav-dot"
        style={{ left: `${((activeIndex + 0.5) * 100) / items.length}%` }}
      />
      {items.map((item) => (
        <button
          key={item.key}
          className={`mobile-nav-item${route === item.key ? ' active' : ''}`}
          onClick={() => {
            if (swallowClick.current) {
              swallowClick.current = false
              return
            }
            go(item.key)
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
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
      <MobileNav />

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
