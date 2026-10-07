import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Info, List, LogOut, Palette, Search, Type, X } from 'lucide-react'
import type { ReaderTheme } from '@shared/types'
import { bookPercent, useApp } from '../store/app'
import { FONT_STACKS, READER_THEMES, type FontKey } from '../lib/reader-theme'
import { mediaUrl, percentText } from '../lib/format'
import { SegmentedControl, Slider } from '../components/ui'

const COLUMN_GAP = 48
const MIN_COLUMN = 340
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
  useEffect(() => {
    const tick = (): void => {
      const now = new Date()
      setClock(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`)
    }
    tick()
    const timer = window.setInterval(tick, 20000)
    // 电量：Chromium / 安卓 WebView 支持 Battery Status API
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }
    void nav
      .getBattery?.()
      .then((info) => setBattery(Math.round(info.level * 100)))
      .catch(() => setBattery(null))
    return () => window.clearInterval(timer)
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
  const padding = readerSettings?.padding ?? 36
  const { bookId, chapters, chapterIndex, html, loading, book } = reader

  /* ---------- 分栏计算：按窗口宽度决定单栏还是双栏 ---------- */
  const available = Math.max(0, bodySize.width - padding * 2)
  const columns = mode === 'paged' && available >= MIN_COLUMN * 2 + COLUMN_GAP ? 2 : 1
  const columnWidth = useMemo(() => {
    if (columns === 1) return Math.min(readerSettings?.pageWidth ?? 720, Math.max(MIN_COLUMN, available))
    return Math.floor((available - COLUMN_GAP) / 2)
  }, [columns, available, readerSettings?.pageWidth])
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
    setPage(0)
    ratioRef.current = 0
    setRatio(0)
  }, [mode, columnWidth, columns, html, chapterIndex, readerSettings?.fontSize, readerSettings?.lineHeight, bodySize.width])

  /* ---------- 换章时把滚动位置复位（否则新章会停在末尾，看起来像卡住） ---------- */
  const lastChapter = useRef<number | null>(null)
  // 换书时先作废标记，交给「恢复上次位置」处理
  useEffect(() => {
    lastChapter.current = null
  }, [bookId])
  useEffect(() => {
    if (mode !== 'scroll' || !html) return
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
    if (restoredBook.current === bookId) return
    restoredBook.current = bookId
    const saved = reader.scrollRatio
    if (saved <= 0.01) return
    if (mode === 'scroll') {
      const el = bodyRef.current
      if (el) {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * saved
        ratioRef.current = saved
        setRatio(saved)
      }
    } else {
      setPage(Math.max(0, Math.min(pages - 1, Math.round(saved * pages))))
    }
  }, [bookId, html, mode, pages, reader.scrollRatio])

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

  /* ---------- 手机：左右滑动翻页（点击两侧已有，滑动更合手机习惯） ---------- */
  useEffect(() => {
    const el = bodyRef.current
    if (!el || mode !== 'paged' || !('ontouchstart' in window)) return
    let startX = 0
    let startY = 0
    const onStart = (event: TouchEvent): void => {
      startX = event.touches[0]?.clientX ?? 0
      startY = event.touches[0]?.clientY ?? 0
    }
    const onEnd = (event: TouchEvent): void => {
      const touch = event.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      // 横向位移够大、且明显大于纵向，才算翻页（否则是滚动或选字）
      if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      turnRef.current(dx < 0 ? 1 : -1)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
  }, [mode])

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
        '--reader-width': `${readerSettings?.pageWidth ?? 720}px`,
        '--reader-padding': `${padding}px`,
        '--reader-size': `${readerSettings?.fontSize ?? 18}px`,
        '--reader-lh': String(readerSettings?.lineHeight ?? 1.9),
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
    [theme, padding, readerSettings, settings, bodySize.height]
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
          {chapterIndex + 1}/{chapters.length} · {percentText(totalPercent)}%
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
            <div className="setting-hint" style={{ padding: 12 }}>
              全文搜索还没做（要先给全书建索引），下一轮补上。
            </div>
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
            <span>排版设置</span>
            <button className="icon-btn sm" onClick={() => setPanel('none')}>
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="reader-panel-body">
            <div className="panel-row">
              <div className="panel-row-title">
                <span>字号</span>
                <span className="range-value">{readerSettings?.fontSize ?? 18} px</span>
              </div>
              <Slider
                value={readerSettings?.fontSize ?? 18}
                min={14}
                max={30}
                onChange={(v) => void saveSettings({ reader: { ...readerSettings!, fontSize: v } })}
              />
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>行距</span>
                <span className="range-value">{(readerSettings?.lineHeight ?? 1.9).toFixed(1)}</span>
              </div>
              <Slider
                value={readerSettings?.lineHeight ?? 1.9}
                min={1.4}
                max={2.6}
                step={0.1}
                onChange={(v) => void saveSettings({ reader: { ...readerSettings!, lineHeight: v } })}
              />
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>版心宽度</span>
                <span className="range-value">{readerSettings?.pageWidth ?? 720} px</span>
              </div>
              <Slider
                value={readerSettings?.pageWidth ?? 720}
                min={480}
                max={920}
                step={20}
                onChange={(v) => void saveSettings({ reader: { ...readerSettings!, pageWidth: v } })}
              />
            </div>
            <div className="panel-row">
              <div className="panel-row-title">
                <span>页边距</span>
                <span className="range-value">{padding} px</span>
              </div>
              <Slider
                value={padding}
                min={12}
                max={80}
                step={4}
                onChange={(v) => void saveSettings({ reader: { ...readerSettings!, padding: v } })}
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
