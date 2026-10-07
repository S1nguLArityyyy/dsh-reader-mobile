import { useMemo, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Timer
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../store/app'
import { BookCover } from '../components/BookCover'
import { EmptyState, ProgressRing, SegmentedControl } from '../components/ui'
import { bookBarColor, dayKey, durationParts, durationText, formatDate, percentText } from '../lib/format'

function StatCard({
  icon,
  label,
  value,
  unit,
  parts
}: {
  icon: ReactNode
  label: string
  value?: number
  unit?: string
  parts?: { value: string; unit: string }[]
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">
        {parts
          ? parts.map((part) => (
              <span key={part.unit} style={{ display: 'inline-flex', alignItems: 'baseline' }}>
                <span>{part.value}</span>
                <span className="stat-unit">{part.unit}</span>
              </span>
            ))
          : (
              <>
                <span>{value}</span>
                <span className="stat-unit">{unit}</span>
              </>
            )}
      </div>
    </div>
  )
}

interface Cell {
  day: number
  inMonth: boolean
  key: string
}

function buildMonth(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()
  const cells: Cell[] = []

  for (let i = offset - 1; i >= 0; i -= 1) {
    const day = prevDays - i
    cells.push({ day, inMonth: false, key: dayKey(new Date(year, month - 1, day)) })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, inMonth: true, key: dayKey(new Date(year, month, day)) })
  }
  let next = 1
  while (cells.length % 7 !== 0) {
    cells.push({ day: next, inMonth: false, key: dayKey(new Date(year, month + 1, next)) })
    next += 1
  }
  return cells
}

function heatLevel(seconds: number): number {
  if (seconds <= 0) return 0
  const minutes = seconds / 60
  if (minutes < 5) return 1
  if (minutes < 15) return 2
  if (minutes < 30) return 3
  if (minutes < 60) return 4
  return 5
}

type Range = 'all' | 'month' | 'year'

export function StatsPage() {
  const stats = useApp((s) => s.stats)
  const books = useApp((s) => s.books)
  const openReader = useApp((s) => s.openReader)

  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  // 视图状态支持通过地址栏深链，例如 ?cal=heatmap
  const [calendarMode, setCalendarMode] = useState<'calendar' | 'heatmap'>(() =>
    new URLSearchParams(window.location.search).get('cal') === 'heatmap' ? 'heatmap' : 'calendar'
  )
  const [range, setRange] = useState<Range>('all')
  // 点日历某一天 → 下半部分直接显示当天读了什么（不做上滑弹层）
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books])

  const dayMap = useMemo(() => {
    const map = new Map<string, { seconds: number; bookIds: string[] }>()
    for (const day of stats?.days ?? []) map.set(day.day, { seconds: day.seconds, bookIds: day.bookIds })
    return map
  }, [stats])

  const cells = useMemo(() => buildMonth(cursor.year, cursor.month), [cursor])

  const history = useMemo(() => {
    const list = (stats?.books ?? []).filter((item) => item.lastAt > 0 && bookMap.has(item.bookId))
    const now = new Date()
    const filtered = list.filter((item) => {
      if (range === 'all') return true
      const date = new Date(item.lastAt)
      if (range === 'year') return date.getFullYear() === now.getFullYear()
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
    })
    return filtered
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((item) => ({ ...item, book: bookMap.get(item.bookId)! }))
  }, [stats, bookMap, range])

  /* 按「全部 / 按月 / 按年」算概览数字 —— 不然这两个按钮点了没反应（用户反馈过） */
  const days = stats?.days ?? []
  const rangeDays = useMemo(() => {
    const now = new Date()
    return days.filter((day) => {
      if (range === 'all') return true
      const [year, month] = day.day.split('-').map(Number)
      if (range === 'year') return year === now.getFullYear()
      return year === now.getFullYear() && month === now.getMonth() + 1
    })
  }, [days, range])
  const rangeSeconds = rangeDays.reduce((total, day) => total + day.seconds, 0)
  const rangeBookIds = new Set(rangeDays.flatMap((day) => day.bookIds))
  const finishedInRange = (stats?.books ?? []).filter(
    (item) => rangeBookIds.has(item.bookId) && item.percent >= 0.99
  ).length
  const readingDays = rangeDays.filter((day) => day.seconds > 0).length
  const perReadingDay = readingDays > 0 ? rangeSeconds / readingDays : 0
  const rangeLabel = range === 'month' ? '本月' : range === 'year' ? '今年' : '全部'

  /* 选中的那天：默认落在最近有阅读记录的一天，进来就能看到内容 */
  const latestReadingDay = [...days]
    .filter((day) => day.seconds > 0)
    .sort((a, b) => b.day.localeCompare(a.day))[0]?.day
  const activeDay = selectedDay ?? latestReadingDay ?? dayKey(new Date())
  const activeEntry = days.find((day) => day.day === activeDay)
  const activeBooks = (activeEntry?.bookIds ?? []).flatMap((id) => {
    const book = bookMap.get(id)
    return book ? [book] : []
  })
  const [, activeMonth, activeDate] = activeDay.split('-')
  const activeLabel = `${Number(activeMonth)} 月 ${Number(activeDate)} 日`

  const moveMonth = (delta: number): void => {    setCursor((prev) => {
      const date = new Date(prev.year, prev.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  const monthLabel = `${cursor.year}年${cursor.month + 1}月`

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">统计</h1>
      </div>

      <div className="stats-body">
        <div className="card calendar-card">
          <div className="calendar-head">
            <SegmentedControl<'calendar' | 'heatmap'>
              size="sm"
              variant="soft"
              value={calendarMode}
              onChange={setCalendarMode}
              options={[
                {
                  value: 'calendar',
                  label: (
                    <>
                      <CalendarDays size={13} />
                      阅读日历
                    </>
                  )
                },
                {
                  value: 'heatmap',
                  label: (
                    <>
                      <Flame size={13} />
                      阅读热力图
                    </>
                  )
                }
              ]}
            />
            <div className="month-nav">
              <button className="icon-btn sm" onClick={() => moveMonth(-1)} aria-label="上个月">
                <ChevronLeft size={17} />
              </button>
              <span className="month-label">{monthLabel}</span>
              <button className="icon-btn sm" onClick={() => moveMonth(1)} aria-label="下个月">
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          <div className="calendar-weekdays">
            {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {cells.map((cell) => {
              const day = dayMap.get(cell.key)
              const seconds = day?.seconds ?? 0
              const level = calendarMode === 'heatmap' ? heatLevel(seconds) : 0
              const classes = ['cal-cell']
              if (!cell.inMonth) classes.push('muted')
              if (calendarMode === 'calendar' && seconds > 0 && cell.inMonth) classes.push('has-reading')
              if (calendarMode === 'heatmap' && level > 0) classes.push(`heat-${level}`)
              return (
                <button
                  type="button"
                  key={cell.key}
                  className={`${classes.join(' ')}${cell.key === activeDay ? ' selected' : ''}`}
                  title={seconds > 0 ? `${cell.key} · ${durationText(seconds)}` : cell.key}
                  onClick={() => {
                    if (cell.inMonth) setSelectedDay(cell.key)
                  }}
                >
                  <span className="cal-day">{cell.day}</span>
                  {cell.inMonth && day && day.bookIds.length > 0 ? (
                    <span className="cal-bars">
                      {day.bookIds.slice(0, 3).map((id) => {
                        const readBook = bookMap.get(id)
                        return readBook ? (
                          <i key={id} className="cal-bar" style={{ background: bookBarColor(readBook) }} />
                        ) : null
                      })}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

      {/* 区间选择：日历正下方、单独占一行；再往下直接就是书籍列表 */}
      <div className="stats-head">
        <h2 className="section-title">
          阅读历史 <span className="range-hint">{rangeLabel}</span>
        </h2>
        <SegmentedControl<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: 'all', label: '全部' },
            { value: 'month', label: '按月' },
            { value: 'year', label: '按年' }
          ]}
        />
      </div>

      <div className="card history-card">
          {history.length === 0 ? (
            <EmptyState
              icon={<BarChart3 size={26} />}
              title="还没有阅读记录"
              desc={range === 'all' ? '打开一本书开始阅读，这里会记录时长与进度' : '当前筛选范围内没有记录'}
            />
          ) : (
            history.map((item, index) => {
              const percent = percentText(item.percent)
              const status = item.percent >= 0.99 ? '已读完' : item.percent > 0.001 ? '阅读中' : '未开始'
              return (
                <div className="history-row" key={item.bookId}>
                  <span className="history-index">{index + 1}.</span>
                  <div className="history-cover">
                    <BookCover book={item.book} />
                  </div>
                  <div className="history-main">
                    <div className="history-title">{item.book.title}</div>
                    <div className="history-author">{item.book.author}</div>
                    <div className="history-meta">
                      <span>
                        <Clock size={12} />
                        {durationText(item.seconds)}
                      </span>
                      <span>
                        <CalendarDays size={12} />
                        {formatDate(item.lastAt)}
                      </span>
                      <span className={`chip${status === '阅读中' ? '' : ' muted'}`}>{status}</span>
                    </div>
                  </div>
                  <ProgressRing percent={item.percent} size={44} stroke={4}>
                    <span style={{ fontSize: 10.5, fontWeight: 600 }}>{percent}%</span>
                  </ProgressRing>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 选中那天的信息：直接排在日历下面，不做上滑弹层 */}
      <div className="card day-panel">
        <div className="day-panel-head">
          <span className="day-panel-date">{activeLabel}</span>
          <span className="day-panel-time">
            {activeEntry && activeEntry.seconds > 0 ? `共 ${durationText(activeEntry.seconds)}` : '没有阅读记录'}
          </span>
        </div>
        <div className="day-tags">
          {activeBooks.length === 0 ? (
            <span className="day-tag muted">这天没有读书</span>
          ) : (
            activeBooks.map((book) => (
              <button key={book.id} className="day-tag" onClick={() => void openReader(book.id)}>
                <i className="day-tag-bar" style={{ background: bookBarColor(book) }} />
                <span>{book.title}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 统计概览放在书籍列表下面（跟着区间筛选走） */}
      <div className="stat-grid">
        <StatCard icon={<BookOpen size={15} />} label="读过书籍" value={rangeBookIds.size} unit="本" />
        <StatCard icon={<CheckCircle2 size={15} />} label="已读完" value={finishedInRange} unit="本" />
        <StatCard icon={<Clock size={15} />} label="累计时间" parts={durationParts(rangeSeconds)} />
        <StatCard icon={<Timer size={15} />} label="平均每天" parts={durationParts(perReadingDay)} />
      </div>
    </div>
  )
}
