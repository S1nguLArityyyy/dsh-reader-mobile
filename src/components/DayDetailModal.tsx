import { Clock } from 'lucide-react'
import { useApp } from '../store/app'
import { BookCover } from './BookCover'
import { Modal } from './ui'
import { durationText, formatDate, percentText } from '../lib/format'
import './day.css'

/**
 * 点日历某一天弹出的二级页：这一天读了哪些书、总共多久。
 *
 * 说明：现在只按「天」记了总时长与当天读过的书，没记「这一天在这本书上花了多久」，
 * 所以每本书显示的是它的**整体进度与累计时长**（界面上如实标注，不编数字）。
 */
export function DayDetailModal({ day, onClose }: { day: string | null; onClose: () => void }) {
  const stats = useApp((s) => s.stats)
  const books = useApp((s) => s.books)
  const openReader = useApp((s) => s.openReader)

  const entry = stats?.days.find((item) => item.day === day)
  const rows = (entry?.bookIds ?? []).flatMap((id) => {
    const book = books.find((item) => item.id === id)
    if (!book) return []
    const stat = stats?.books.find((item) => item.bookId === id)
    return [
      {
        book,
        percent: stat?.percent ?? 0,
        seconds: stat?.seconds ?? 0,
        lastAt: stat?.lastAt ?? 0
      }
    ]
  })

  return (
    <Modal
      open={Boolean(day)}
      title={day ? `${day} 的阅读记录` : ''}
      onClose={onClose}
      width={520}
      variant="sheet"
    >
      {entry ? (
        <>
          <div className="day-summary">
            <Clock size={14} />
            <span>
              这天共阅读 <b>{durationText(entry.seconds)}</b>
              {rows.length > 0 ? `，读了 ${rows.length} 本` : ''}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="day-empty">这天还没有书名记录（可能是从其它设备同步过来的时长）</div>
          ) : (
            <div className="day-list">
              {rows.map((row) => (
                <button
                  key={row.book.id}
                  className="day-row"
                  onClick={() => {
                    onClose()
                    void openReader(row.book.id)
                  }}
                >
                  <div className="day-cover">
                    <BookCover book={row.book} />
                  </div>
                  <div className="day-main">
                    <div className="day-title">{row.book.title}</div>
                    <div className="day-meta">
                      全书 {percentText(row.percent)}% · 累计 {durationText(row.seconds)}
                      {row.lastAt > 0 ? ` · 最近 ${formatDate(row.lastAt)}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="day-empty">这天没有阅读记录</div>
      )}
    </Modal>
  )
}
