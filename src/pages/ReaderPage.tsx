import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Info, List, LogOut, Palette, Search, Type, X } from 'lucide-react'
import type { ReaderTheme } from '@shared/types'
import { bookPercent, useApp } from '../store/app'
import { FONT_STACKS, READER_THEMES, type FontKey } from '../lib/reader-theme'
import { mediaUrl, percentText } from '../lib/format'
import { SegmentedControl, Slider } from '../components/ui'

const COLUMN_GAP = 48
/** 点击左右多少比例的区域翻页 */
const TAP_ZONE = 0.28
/** 滚轮翻页的节流间隔（毫秒） */
const WHEEL_LOCK = 300

export function ReaderPage() {
  const reader = useApp((s) => s.reader)
  const settings = useApp((s) => s.settings)
  const closeReader = useApp((s) => s.closeReader)
  const goToChapter = useApp((s) => s.goToChapter)
  const saveSettings = useApp((s) => s.saveSettings)
  const toast = useApp((s) => s.toast)

  const [panel, setPanel] = useState<'none' | 'toc' | 'settings' | 'tools' | 'search'>('none')
  /** 跳转前的位置：点过目录/跳转后可以用「跳转返回」回来 */
  const [lastPos, setLastPos] = useState<{ chapterIndex: number } | null>(null)
  /* 翻页模式的滑动翻页：起点 + "刚滑过"标记（放在提前 return 之前，避免 hooks 顺序问题） */
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeGuardRef = useRef(false)
  /* ---------- 一级界面底部状态条：电量 · 页数/总章 · 百分比 · 时间 ---------- */
  const [clock, setClock] = useState('')
  const [battery, setBattery] = useState<number | null>(null)
  /* 全文搜索状态 */
  const [searchText, setSearchText] = useState('')
  const [searchHits, setSearchHits] = useState<
    Array<{ chapterIndex: number; label: string; snippet: string }>
  >([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const tick = (): void => {
      const now = new Date()
      setClock(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`)
    }
    tick()
    const timer = window.setInterval(tick, 20000)
    // 电量：Chromium / 安卓 WebView 支持 Battery Status API
    // 电量：之前只取了一次 ✗ 永远不变 ✓ 现在监听 levelchange + 每 60 秒兜底 ✓
    type BatteryLike = { level: number; addEventListener?: (type: string, fn: () => void) => void }
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
    let batteryTimer = 0
    const applyBattery = (info: BatteryLike): void => setBattery(Math.round(info.level * 100))
    void nav
      .getBattery?.()
      .then((info) => {
        applyBattery(info)
        info.addEventListener?.('levelchange', () => applyBattery(info))
        info.addEventListener?.('chargingchange', () => applyBattery(info))
        batteryTimer = window.setInterval(() => applyBattery(info), 60_000)
      })
      .catch(() => setBattery(null))
    return () => {
      window.clearInterval(timer)
      window.clearInterval(batteryTimer)
    }
  }, [])
  const [ratio, setRatio] = useState(0)
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 })

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const ratioRef = useRef(0)
  const lastRatioUpdate = useRef(0)
  const saveTimer = useRef<number | null>(null)
  const restoredBook = useRef<string | null>(null)
  const pendingAnchor = useRef<string | null>(null)

  const readerSettings = settings?.reader
  const theme = READER_THEMES[readerSettings?.theme ?? 'paper']
  const mode = readerSettings?.mode ?? 'scroll'
  // 页边距：滚动用 padding；翻页用 pagedPadding（没设就回落到 padding）
  const padding = readerSettings?.padding ?? 28
  const pagedPadding = readerSettings?.pagedPadding ?? readerSettings?.padding ?? 28
  const { bookId, chapters, chapterIndex, html, loading, book } = reader

  /* ---------- 分栏计算：按窗口宽度决定单栏还是双栏 ---------- */
  /* 分页可用宽：翻页模式的左右留白**由这里算**（正文宽度实际由这段 JS 决定，改 CSS 是无效的）。
     翻页用自己那套页边距（pagedPadding），默认与滚动一致，不再额外加宽。 */
  const pagedSideMargin = pagedPadding
  const available = Math.max(
    0,
    mode === 'paged'
      ? bodySize.width - pagedSideMargin * 2
      : bodySize.width - padding * 2
  )
  // 手机端一律单栏（此前沿用桌面端"够宽就两栏"的判断 ✗ 手机上会跳页 ✓）
  const columns = 1
  const columnWidth = useMemo(() => {
    // 单栏：版心宽度 = min(设置值, 可用宽)，只保留很小的安全下限（翻页用自己那套版心宽度）
    const wanted =
      mode === 'paged'
        ? (readerSettings?.pagedPageWidth ?? readerSettings?.pageWidth ?? 720)
        : (readerSettings?.pageWidth ?? 720)
    if (columns === 1) return Math.max(160, Math.min(wanted, available))
    return Math.floor((available - COLUMN_GAP) / 2)
  }, [columns, available, mode, readerSettings?.pageWidth, readerSettings?.pagedPageWidth])
  const screenWidth = columns * columnWidth + (columns - 1) * COLUMN_GAP
  const step = screenWidth + COLUMN_GAP

  /* ---------- 尺寸监听：用回调 ref，元素挂载/卸载时都能正确接上 ---------- */
  const observerRef = useRef<ResizeObserver | null>(null)
  const attachBody = useCallback((el: HTMLDivElement | null) => {
    bodyRef.current = el
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return
    const update = (): void => setBodySize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    observerRef.current = observer
  }, [])

  /* ---------- 进度持久化（按读到的位置） ---------- */
  const persist = useCallback((value: number) => {
    const state = useApp.getState().reader
    if (!state.bookId || state.chapters.length === 0) return
    const percent = bookPercent(state.book, state.chapterIndex, value)
    void window.api.reader.setProgress(state.bookId, {
      chapterIndex: state.chapterIndex,
      chapterTitle: state.chapterLabel,
      scrollRatio: value,
      percent
    })
  }, [])

  const schedulePersist = useCallback(
    (value: number) => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => persist(value), 900)
    },
    [persist]
  )

  /* ---------- 阅读计时 ---------- */
  useEffect(() => {
    if (!bookId) return
    let last = Date.now()
    let acc = 0
    const flush = (): void => {
      if (acc >= 1) {
        void window.api.reader.tick(bookId, acc)
        acc = 0
      }
    }
    const timer = window.setInterval(() => {
      const now = Date.now()
      const delta = (now - last) / 1000
      last = now
      if (document.hidden || !document.hasFocus()) return
      acc += delta
      if (acc >= 20) flush()
    }, 4000)
    const onBlur = (): void => {
      last = Date.now()
      flush()
    }
    const onFocus = (): void => {
      last = Date.now()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onBlur)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onBlur)
      flush()
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      persist(ratioRef.current)
    }
  }, [bookId, persist])

  /** 翻页模式下用于识别"换章了"：换章要回到开头，切模式/改排版不能回到开头 */
  const pagedChapter = useRef<number | null>(null)
  /** 上一次的阅读模式：用来识别"刚切回滚动模式" */
  const prevMode = useRef<'scroll' | 'paged'>('scroll')

  /*
   * 从翻页切回滚动：必须**主动**把滚动位置恢复回去。
   * 分页时滚动容器里是 .reader-viewport，滚动位置一直是 0；
   * 切回滚动后没有任何东西会把它设回来，于是看着就像"跳回本章开头"。
   * 用 useLayoutEffect 在浏览器绘制前设好，用户看不到跳动。
   */
  useLayoutEffect(() => {
    const cameFromPaged = prevMode.current === 'paged'
    prevMode.current = mode
    if (!cameFromPaged || mode !== 'scroll') return
    const el = bodyRef.current
    if (!el) return
    const value = ratioRef.current
    if (value <= 0.005) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) return
    el.scrollTop = max * value
    setRatio(value)
  }, [mode, html, chapterIndex])

  /* ---------- 滚动模式的进度 ---------- */
  useEffect(() => {
    const el = bodyRef.current
    if (!el || mode !== 'scroll') return
    const onScroll = (): void => {
      const max = el.scrollHeight - el.clientHeight
      const value = max > 8 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0
      ratioRef.current = value
      const now = Date.now()
      if (now - lastRatioUpdate.current > 150) {
        lastRatioUpdate.current = now
        setRatio(value)
      }
      schedulePersist(value)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [mode, chapterIndex, html, schedulePersist])

  /* ---------- 翻页模式：分页计算 ---------- */
  useLayoutEffect(() => {
    if (mode !== 'paged') {
      setPages(1)
      setPage(0)
      return
    }
    const el = pageRef.current
    if (!el || columnWidth <= 0) {
      setPages(1)
      return
    }
    const totalColumns = Math.max(1, Math.round((el.scrollWidth + COLUMN_GAP) / (columnWidth + COLUMN_GAP)))
    const screens = Math.max(1, Math.ceil(totalColumns / columns))
    setPages(screens)

    // ★ 换章必须回到章首，但切模式 / 改排版 / 缩放窗口不能 ★
    //   之前这里无条件 setPage(0) + ratio=0，于是"阅读中切滚动↔翻页"会跳回本章开头（用户反馈的 bug）
    if (pagedChapter.current !== chapterIndex) {
      pagedChapter.current = chapterIndex
      ratioRef.current = 0
      setRatio(0)
      setPage(0)
      return
    }

    // 同章内的重新分页：按当前位置换算成新的页码，别把读者拽回开头
    const current = ratioRef.current
    if (current > 0.005) {
      setPage(Math.max(0, Math.min(screens - 1, Math.round(current * screens))))
    } else {
      setPage(0)
    }
  }, [mode, columnWidth, columns, html, chapterIndex, readerSettings?.fontSize, readerSettings?.lineHeight, bodySize.width])

  /* ---------- 换章时把滚动位置复位（否则新章会停在末尾，看起来像卡住） ---------- */
  const lastChapter = useRef<number | null>(null)
  // 换书时先作废标记，交给「恢复上次位置」处理
  useEffect(() => {
    lastChapter.current = null
    pagedChapter.current = null
  }, [bookId])
  useEffect(() => {
    if (mode !== 'scroll' || !html) return
    // 只是切换了阅读模式（章号没变）→ 保持当前滚动位置，别跳回章首
    if (lastChapter.current === chapterIndex) return
    const first = lastChapter.current === null
    lastChapter.current = chapterIndex
    if (first) return // 首次进入交给「恢复上次位置」处理
    const el = bodyRef.current
    if (el) el.scrollTop = 0
    ratioRef.current = 0
    setRatio(0)
  }, [chapterIndex, mode, html])

  /* ---------- 恢复上次位置 ---------- */
  useEffect(() => {
    if (!bookId || !html) return
    const saved = reader.scrollRatio
    if (saved <= 0.01) {
      restoredBook.current = bookId
      return
    }

    // 滚动模式：容器高度一就绪就能定位
    if (mode === 'scroll') {
      if (restoredBook.current === bookId) return
      const el = bodyRef.current
      if (!el || el.clientHeight === 0) return // 还没量到高度，等下一轮
      restoredBook.current = bookId
      el.scrollTop = (el.scrollHeight - el.clientHeight) * saved
      ratioRef.current = saved
      setRatio(saved)
      return
    }

    // 翻页模式：必须等分页数算出来再定位。
    // 此前在 html 一就绪就 setPage(saved * pages)，而那时 pages 还是初始值 1，
    // 乘出来是 0 —— 于是"退出再进"总是回到本章开头（用户反馈的 bug）。
    // 这里不设一次性守卫，pages 变化时会重算一次，setPage 对同值不会再触发渲染。
    if (bodySize.width <= 0 || pages <= 0) return
    const target = Math.max(0, Math.min(pages - 1, Math.round(saved * pages)))
    restoredBook.current = bookId
    ratioRef.current = saved
    setRatio(saved)
    setPage(target)
  }, [bookId, html, mode, pages, reader.scrollRatio, bodySize.width])

  /* ---------- 翻页 ---------- */
  const turn = useCallback(
    (delta: number) => {
      if (mode === 'paged') {
        const next = page + delta
        if (next < 0) {
          if (chapterIndex > 0) void goToChapter(chapterIndex - 1)
          return
        }
        if (next >= pages) {
          if (chapterIndex < chapters.length - 1) void goToChapter(chapterIndex + 1)
          return
        }
        setPage(next)
        const value = pages > 1 ? next / pages : 0
        ratioRef.current = value
        setRatio(value)
        schedulePersist(value)
        return
      }
      const el = bodyRef.current
      if (el) el.scrollBy({ top: delta * (el.clientHeight * 0.86), behavior: 'smooth' })
    },
    [mode, page, pages, chapterIndex, chapters.length, goToChapter, schedulePersist]
  )

  const turnRef = useRef(turn)
  turnRef.current = turn


  /* ---------- 鼠标滚轮翻页 ---------- */
  useEffect(() => {
    const el = bodyRef.current
    if (!el || mode !== 'paged') return
    let lock = 0
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) < 6) return
      e.preventDefault()
      const now = Date.now()
      if (now < lock) return
      lock = now + WHEEL_LOCK
      turnRef.current(e.deltaY > 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode, html])

  /* ---------- 键盘 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        turn(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        turn(-1)
      } else if (e.key === 'Escape') {
        if (panel !== 'none') setPanel('none')
        else closeReader()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, panel, closeReader])

  /* ---------- 正文内链跳转 ---------- */
  const scrollToAnchor = useCallback((fragment: string) => {
    if (!fragment) return
    const container = bodyRef.current
    if (!container) return
    const target =
      container.querySelector(`[id="${fragment}"]`) ?? container.querySelector(`[name="${fragment}"]`)
    if (target) target.scrollIntoView({ block: 'start' })
  }, [])

  useEffect(() => {
    if (!html) return
    const fragment = pendingAnchor.current
    if (!fragment) return
    pendingAnchor.current = null
    if (mode === 'scroll') window.requestAnimationFrame(() => scrollToAnchor(fragment))
  }, [html, mode, scrollToAnchor])

  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!href.startsWith('#epub:')) return
      e.preventDefault()
      e.stopPropagation()

      const rest = href.slice('#epub:'.length)
      const hashIndex = rest.indexOf('#')
      const rawPath = hashIndex >= 0 ? rest.slice(0, hashIndex) : rest
      const fragment = hashIndex >= 0 ? rest.slice(hashIndex + 1) : ''
      let path = rawPath
      try {
        path = decodeURIComponent(rawPath)
      } catch {
        /* 保留原值 */
      }

      const index = chapters.findIndex((chapter) => chapter.href === path)
      if (index < 0) {
        toast('info', '该链接指向的内容不在本书章节中')
        return
      }
      if (index === chapterIndex && fragment) {
        scrollToAnchor(fragment)
        return
      }
      pendingAnchor.current = fragment || null
      void goToChapter(index)
    },
    [chapters, chapterIndex, goToChapter, scrollToAnchor, toast]
  )

  /* ---------- 点击左右区域翻页；面板打开时点击正文先关面板 ---------- */
  const handleBodyClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('a, button, select, input, label')) return
      if (panel !== 'none') {
        setPanel('none')
        return
      }
      if (mode !== 'paged') return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      if (x <= TAP_ZONE) turn(-1)
      else if (x >= 1 - TAP_ZONE) turn(1)
    },
    [mode, panel, turn]
  )

  /* ---------- 进度条拖动定位（章内） ----------
     进度条元素由**调用方传入**：以前共用 barRef，底部条和面板里的条会互相抢 ref，
     拖动时按错误的矩形算位置（所以这里改成从被拖的元素自身取矩形）。 */
  const lastHapticRef = useRef(-1)
  const dragSeek = useCallback(
    (bar: HTMLElement | null, clientX: number) => {
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      const value = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      // 震动反馈：每跨过 1% 震一下（不能每个 move 都震，否则是持续嗡嗡）
      const step = Math.round(value * 100)
      if (step !== lastHapticRef.current) {
        lastHapticRef.current = step
        navigator.vibrate?.(8)
      }
      if (mode === 'paged') {
        const target = Math.min(Math.max(0, pages - 1), Math.round(value * Math.max(0, pages - 1)))
        setPage(target)
        ratioRef.current = pages > 1 ? target / pages : 0
        setRatio(ratioRef.current)
        schedulePersist(ratioRef.current)
        return
      }
      const body = bodyRef.current
      if (!body) return
      const max = body.scrollHeight - body.clientHeight
      const next = max * value
      body.scrollTop = next
      ratioRef.current = max > 8 ? next / max : 0
      setRatio(ratioRef.current)
      schedulePersist(ratioRef.current)
    },
    [mode, pages, schedulePersist]
  )

  const onBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      // 手机上**没有鼠标**：只挂 onMouseDown 的话手指根本拖不动进度条（用户反馈过），
      // 必须用 Pointer Events（鼠标 / 触摸 / 触控笔通用）。
      const bar = e.currentTarget as HTMLElement
      // 拖动进度条即视为一次跳转：记下当前章，左上角就会出现「跳转返回」
      setLastPos({ chapterIndex })
      dragSeek(bar, e.clientX)
      bar.setPointerCapture?.(e.pointerId)
      const onMove = (ev: PointerEvent): void => dragSeek(bar, ev.clientX)
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [dragSeek]
  )

  const totalPercent = bookPercent(book, chapterIndex, ratio)
  // 滑块按**章节内**进度（用户要求）
  const chapterRatio = mode === 'paged' ? (pages > 1 ? page / pages : 0) : ratio

  const readerStyle = useMemo(
    () =>
      ({
        '--reader-bg': theme.bg,
        '--reader-text': theme.text,
        '--reader-quote': theme.quote,
        // 版心宽度 / 页边距：两种模式共用（翻页模式的这两项设置已按用户要求移除）
        '--reader-width': `${readerSettings?.pageWidth ?? 720}px`,
        '--reader-padding': `${padding}px`,
        '--reader-size': `${mode === 'paged' ? (readerSettings?.pagedFontSize ?? readerSettings?.fontSize ?? 18) : (readerSettings?.fontSize ?? 18)}px`,
        '--reader-lh': String(
          mode === 'paged'
            ? (readerSettings?.pagedLineHeight ?? readerSettings?.lineHeight ?? 1.9)
            : (readerSettings?.lineHeight ?? 1.9)
        ),
        '--reader-font': FONT_STACKS[(readerSettings?.fontFamily ?? 'system') as FontKey].css,
        // 翻页模式下单栏可用高度，供竖长图限高使用（减去上下内边距）
        '--reader-col-height': `${Math.max(240, bodySize.height - 58)}px`,
        ...(settings?.appearance.readerBackgroundImage
          ? {
              backgroundImage: `linear-gradient(${theme.bg}cc, ${theme.bg}cc), url("${mediaUrl(
                settings.appearance.readerBackgroundImage
              )}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }
          : {})
      }) as React.CSSProperties,
    [theme, padding, readerSettings, settings, bodySize.height, mode]
  )

  if (!book) {
    return (
      <div className="reader" style={readerStyle}>
        <div className="reader-bar">
          <button className="icon-btn sm" onClick={closeReader}>
            <ArrowLeft size={18} />
          </button>
          <span className="reader-bar-title">未打开书籍</span>
        </div>
        <div className="reader-empty">
          <Info size={26} />
          <div>请从书库中选择一本书开始阅读</div>
        </div>
      </div>
    )
  }

  const pageContent = (
    <div
      ref={pageRef}
      className={`reader-page${mode === 'paged' ? ' paged' : ''}`}
      style={
        mode === 'paged'
          ? {
              width: `${screenWidth}px`,
              maxWidth: 'none',
              columnWidth: `${columnWidth}px`,
              columnGap: `${COLUMN_GAP}px`,
              columnFill: 'auto',
              transform: `translateX(-${page * step}px)`
            }
          : undefined
      }
      onClick={handleContentClick}
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <div className="reader-chapter-nav">
        <button
          className="btn btn-ghost btn-sm"
          disabled={chapterIndex === 0}
          onClick={() => void goToChapter(chapterIndex - 1)}
        >
          <ChevronLeft size={15} />
          上一章
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={chapterIndex >= chapters.length - 1}
          onClick={() => void goToChapter(chapterIndex + 1)}
        >
          下一章
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )


  /** 执行全书搜索（接口没在公共类型里，这里局部断言） */
  const runSearch = async (): Promise<void> => {
    const query = searchText.trim()
    if (!query) {
      setSearchHits([])
      return
    }
    setSearching(true)
    try {
      const api = window.api.reader as unknown as {
        search: (
          id: string,
          text: string
        ) => Promise<Array<{ chapterIndex: number; label: string; snippet: string }>>
      }
      setSearchHits(await api.search(bookId ?? '', query))
    } catch {
      setSearchHits([])
    } finally {
      setSearching(false)
    }
  }

  // 章节名优先用**书本目录里的名字**（如"～第一败～ 专业青梅竹马 八奈见杏菜的惨烈败相"），
  // 目录里没有对应条目时才退回接口给的"第 N 章"
  let runLabel = reader.chapterLabel
  for (const entry of reader.toc) {
    if (entry.chapterIndex <= chapterIndex) runLabel = entry.label
    else break
  }

  return (
    <div className="reader" style={readerStyle}>
      <div
        className="reader-bar"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) setPanel('none')
        }}
      >
        <button className="icon-btn sm" onClick={closeReader} title="返回书库">
          <ArrowLeft size={18} />
        </button>
        <span className="reader-bar-title">{book.title}</span>
        <span className="reader-bar-sub">
          {chapterIndex + 1}/{chapters.length} · {reader.chapterLabel}
        </span>
        <div className="reader-chapter-switch">
          <button
            className="icon-btn sm"
            title="上一章"
            disabled={chapterIndex === 0}
            onClick={() => void goToChapter(chapterIndex - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-btn sm"
            title="下一章"
            disabled={chapterIndex >= chapters.length - 1}
            onClick={() => void goToChapter(chapterIndex + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="reader-spacer" />
        {mode === 'paged' ? (
          <span className="reader-bar-sub">
            {page + 1}/{pages}
          </span>
        ) : null}
        <button
          className={`icon-btn sm${panel === 'toc' ? ' active' : ''}`}
          title="目录"
          onClick={() => setPanel(panel === 'toc' ? 'none' : 'toc')}
        >
          <List size={17} />
        </button>
        <button
          className={`icon-btn sm${panel === 'settings' ? ' active' : ''}`}
          title="排版设置"
          onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
        >
          <Type size={17} />
        </button>
      </div>

      {/* 页眉：章节名常驻在正文上方 —— 放在滚动容器**外面**，所以永远可见
          （放里面用 sticky 会被 flex 压成一列竖排，踩过） */}
      {!loading ? <div className="reader-runhead">{runLabel}</div> : null}

      {/* 跳转返回：页眉下方的左上角，**跟着气泡面板一起出现/消失** */}
      {lastPos && panel !== 'none' ? (
        <button
          className="reader-back-bubble"
          onClick={() => {
            void goToChapter(lastPos.chapterIndex)
            setLastPos(null)
          }}
          title="跳转返回"
        >
          <ArrowLeft size={15} /> 跳转返回
        </button>
      ) : null}

      <div
        className={`reader-body${mode === 'paged' ? ' paged' : ''}`}
        ref={attachBody}
        onClick={handleBodyClick}
      >
        {loading && !html ? (
          <div className="reader-loading">正在解析章节…</div>
        ) : mode === 'paged' ? (
          <div
            className="reader-viewport"
            style={{ width: `${screenWidth}px` }}
            /* 翻页模式：手指左右滑动翻页（水平位移 > 40px，且明显大于垂直位移） */
            onPointerDown={(e) => {
              if (mode !== 'paged') return
              swipeStartRef.current = { x: e.clientX, y: e.clientY }
            }}
            onPointerUp={(e) => {
              const start = swipeStartRef.current
              swipeStartRef.current = null
              if (!start || mode !== 'paged') return
              const dx = e.clientX - start.x
              const dy = e.clientY - start.y
              if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4) return
              // 滑完浏览器可能补一次 click（会被当成"点两侧翻页"），先吞掉它
              swipeGuardRef.current = true
              window.setTimeout(() => {
                swipeGuardRef.current = false
              }, 400)
              turn(dx < 0 ? 1 : -1)
            }}
            onClickCapture={(e) => {
              if (swipeGuardRef.current) {
                e.stopPropagation()
                e.preventDefault()
              }
            }}
          >
            {pageContent}
          </div>
        ) : (
          pageContent
        )}
      </div>

      {/* 一级界面：最下方只留一条状态（电量 · 页数/总章 · 百分比 · 时间），点它唤出二级菜单 */}
      <div
        className="reader-foot reader-status"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          setPanel(panel === 'none' ? 'tools' : 'none')
        }}
      >
        <span className="rs-item">
          {/* 电量图标：内部色块按百分比填充 —— 50% 就占一半；低于 20% 变红 */}
          <svg
            className="battery-icon"
            width="24"
            height="13"
            viewBox="0 0 26 13"
            aria-hidden="true"
            style={{
              color: battery !== null && battery < 20 ? '#d9534f' : 'inherit'
            }}
          >
            <rect
              x="0.7"
              y="0.7"
              width="21.6"
              height="11.6"
              rx="3.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <rect
              x="2.4"
              y="2.4"
              width={Math.max(1.4, 18.2 * Math.max(0, Math.min(1, (battery ?? 0) / 100)))}
              height="8.2"
              rx="1.8"
              fill="currentColor"
            />
            <rect x="23.2" y="4.4" width="2.4" height="4.2" rx="1.1" fill="currentColor" />
          </svg>
          {battery === null ? '—' : `${battery}%`}
        </span>
        <span className="rs-item">
          {mode === 'paged' ? '第 ' + (chapterIndex + 1) + '/' + chapters.length + ' 章 · ' + (page + 1) + '/' + pages + ' 页' : '第 ' + (chapterIndex + 1) + '/' + chapters.length + ' 章'} · 本书 {percentText(totalPercent)}%
        </span>
        <span className="rs-item">{clock}</span>
      </div>

      {panel === 'tools' ? (
        <div className="reader-panel reader-tools">
          <div className="reader-panel-head">
            <span>阅读工具</span>
            <button className="icon-btn sm" onClick={() => setPanel('none')} title="收起">
              ✕
            </button>
          </div>
          <div className="reader-panel-body">
            {/* 第一行：搜索占三分之二 + 取消 / 退出（纯图标）—— 按用户给的成品图 */}
            <div className="tool-row-top">
              <button className="tool-bubble tool-bubble-wide" onClick={() => setPanel('search')}>
                <Search size={17} /> 搜索
              </button>
              <button className="tool-bubble" onClick={() => setPanel('none')} title="取消">
                <X size={19} />
              </button>
              <button className="tool-bubble" onClick={closeReader} title="退出">
                <LogOut size={19} />
              </button>
            </div>

            {/* 第二行：第一行整根滚动条（只做翻页定位），第二行箭头（章节跳转）+ 提示语 */}
            <div className="tool-seek">
              <div
                className="reader-progress"
                onPointerDown={onBarPointerDown}
                title="长按后左右微调"
              >
                {/* 填充用**全书进度**（和底栏那个百分比同一个口径，否则条形和数字对不上） */}
                <i style={{ width: `${percentText(chapterRatio)}%` }} />
              </div>
              <div className="tool-seek-row">
                <button
                  className="icon-btn sm"
                  onClick={() => void goToChapter(chapterIndex - 1)}
                  disabled={chapterIndex === 0}
                  title="上一章"
                >
                  <ChevronLeft size={17} />
                </button>
                <span className="tool-seek-hint">长按后左右微调</span>
                <button
                  className="icon-btn sm"
                  onClick={() => void goToChapter(chapterIndex + 1)}
                  disabled={chapterIndex >= chapters.length - 1}
                  title="下一章"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>

            {/* 第三行：样式编辑 / 目录（各占一半，都带图标） */}
            <div className="tool-row">
              <button className="tool-bubble" onClick={() => setPanel('settings')}>
                <Palette size={17} /> 样式编辑
              </button>
              <button className="tool-bubble" onClick={() => setPanel('toc')}>
                <List size={17} /> 目录
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {panel === 'search' ? (
        <div className="reader-panel">
          <div className="reader-panel-head">
            <span>搜索</span>
            <button className="icon-btn sm" onClick={() => setPanel('none')}>
              ✕
            </button>
          </div>
          <div className="reader-panel-body">
            <div className="tool-seek" style={{ marginBottom: 10, padding: '4px 12px' }}>
              <input
                className="search-input"
                value={searchText}
                placeholder="搜索本书内容…"
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runSearch()
                }}
                style={{
                  width: '100%',
                  height: 38,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  fontSize: 14
                }}
              />
            </div>
            <button
              className="tool-bubble"
              style={{ width: '100%', marginBottom: 12 }}
              onClick={() => void runSearch()}
            >
              <Search size={16} /> 搜索
            </button>
            {searching ? <div className="setting-hint" style={{ padding: 8 }}>搜索中…</div> : null}
            {!searching && searchText.trim() && searchHits.length === 0 ? (
              <div className="setting-hint" style={{ padding: 8 }}>没有找到包含该词的内容</div>
            ) : null}
            {searchHits.map((hit) => (
              <button
                key={hit.chapterIndex}
                className="toc-item"
                style={{ display: 'block', width: '100%', textAlign: 'left', lineHeight: 1.5 }}
                onClick={() => {
                  void goToChapter(hit.chapterIndex)
                  setPanel('none')
                }}
              >
                <span style={{ fontWeight: 600 }}>{hit.label}</span>
                <span style={{ opacity: 0.7 }}> · {hit.snippet}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {panel === 'toc' ? (
        <div className="reader-panel">
          <div className="reader-panel-head">
            <span>目录</span>
            <button className="icon-btn sm" onClick={() => setPanel('none')}>
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="reader-panel-body">
            {reader.toc.length === 0 ? (
              <div className="setting-hint" style={{ padding: 12 }}>
                这本书没有提供目录，可在底部按章翻页。
              </div>
            ) : (
              reader.toc.map((entry) => (
                <button
                  key={entry.id}
                  className={`toc-item${entry.chapterIndex === chapterIndex ? ' active' : ''}`}
                  style={{ paddingLeft: 12 + entry.level * 14 }}
                  onClick={() => {
                    // 记下跳转前的位置，方便用「跳转返回」回来
                    setLastPos({ chapterIndex })
                    void goToChapter(entry.chapterIndex)
                    setPanel('none')
                  }}
                >
                  {entry.label}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {panel === 'settings' ? (
        <div className="reader-panel">
          <div className="reader-panel-head">
            <span>排版设置 · {mode === 'paged' ? '翻页' : '滚动'}</span>
            <button className="icon-btn sm" onClick={() => setPanel('none')}>
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="reader-panel-body">
            <div className="panel-row">
              <div className="panel-row-title">
                <span>字号</span>
                <span className="range-value">
                  {mode === 'paged'
                    ? (readerSettings?.pagedFontSize ?? readerSettings?.fontSize ?? 18)
                    : (readerSettings?.fontSize ?? 18)}{' '}
                  px
                </span>
              </div>
              <Slider
                value={
                  mode === 'paged'
                    ? (readerSettings?.pagedFontSize ?? readerSettings?.fontSize ?? 18)
                    : (readerSettings?.fontSize ?? 18)
                }
                min={14}
                max={30}
                onChange={(v) =>
                  void saveSettings({
                    reader: {
                      ...readerSettings!,
                      ...(mode === 'paged' ? { pagedFontSize: v } : { fontSize: v })
                    }
                  })
                }
              />
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>行距</span>
                <span className="range-value">
                  {(mode === 'paged'
                    ? (readerSettings?.pagedLineHeight ?? readerSettings?.lineHeight ?? 1.9)
                    : (readerSettings?.lineHeight ?? 1.9)
                  ).toFixed(1)}
                </span>
              </div>
              <Slider
                value={
                  mode === 'paged'
                    ? (readerSettings?.pagedLineHeight ?? readerSettings?.lineHeight ?? 1.9)
                    : (readerSettings?.lineHeight ?? 1.9)
                }
                min={1.4}
                max={2.6}
                step={0.1}
                onChange={(v) =>
                  void saveSettings({
                    reader: {
                      ...readerSettings!,
                      ...(mode === 'paged' ? { pagedLineHeight: v } : { lineHeight: v })
                    }
                  })
                }
              />
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>版心宽度</span>
                <span className="range-value">
                  {mode === 'paged'
                    ? (readerSettings?.pagedPageWidth ?? readerSettings?.pageWidth ?? 720)
                    : (readerSettings?.pageWidth ?? 720)}{' '}
                  px
                </span>
              </div>
              <Slider
                value={
                  mode === 'paged'
                    ? (readerSettings?.pagedPageWidth ?? readerSettings?.pageWidth ?? 720)
                    : (readerSettings?.pageWidth ?? 720)
                }
                min={240}
                max={460}
                step={10}
                onChange={(v) =>
                  void saveSettings({
                    reader: {
                      ...readerSettings!,
                      ...(mode === 'paged' ? { pagedPageWidth: v } : { pageWidth: v })
                    }
                  })
                }
              />
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>页边距</span>
                <span className="range-value">{pagedPadding === padding ? padding : pagedPadding} px</span>
              </div>
              <Slider
                value={mode === 'paged' ? pagedPadding : padding}
                min={12}
                max={80}
                step={4}
                onChange={(v) =>
                  void saveSettings({
                    reader: {
                      ...readerSettings!,
                      ...(mode === 'paged' ? { pagedPadding: v } : { padding: v })
                    }
                  })
                }
              />
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>字体</span>
              </div>
              <select
                className="select"
                style={{ width: '100%' }}
                value={readerSettings?.fontFamily ?? 'system'}
                onChange={(e) =>
                  void saveSettings({ reader: { ...readerSettings!, fontFamily: e.target.value as FontKey } })
                }
              >
                {Object.entries(FONT_STACKS).map(([key, spec]) => (
                  <option key={key} value={key}>
                    {spec.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>主题</span>
              </div>
              <div className="theme-swatches">
                {(Object.keys(READER_THEMES) as ReaderTheme[]).map((key) => (
                  <button
                    key={key}
                    title={READER_THEMES[key].label}
                    className={`theme-swatch${readerSettings?.theme === key ? ' active' : ''}`}
                    style={{ background: READER_THEMES[key].swatch, color: READER_THEMES[key].text }}
                    onClick={() => void saveSettings({ reader: { ...readerSettings!, theme: key } })}
                  >
                    A
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>翻页方式</span>
              </div>
              <SegmentedControl<'scroll' | 'paged'>
                size="sm"
                value={mode}
                onChange={(v) => void saveSettings({ reader: { ...readerSettings!, mode: v } })}
                options={[
                  { value: 'scroll', label: '滚动' },
                  { value: 'paged', label: '翻页' }
                ]}
              />
              <div className="setting-hint" style={{ marginTop: 8 }}>
                {mode === 'paged'
                  ? `当前 ${columns} 栏显示，点击页面左右两侧或滚动滚轮翻页`
                  : '上下滚动阅读'}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
