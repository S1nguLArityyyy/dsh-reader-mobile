import { Play } from 'lucide-react'
import { useApp } from '../store/app'
import { BookCover } from './BookCover'
import { Modal } from './ui'
import { bookAccentColor, coverHero, durationText, formatDateTime, formatWordCount, percentText } from '../lib/format'

/** 点击书架上的书弹出的详情面板（封面、进度、阅读时间、格式、字数、状态、简介） */
export function BookDetailModal() {
  const detailBookId = useApp((s) => s.detailBookId)
  const books = useApp((s) => s.books)
  const stats = useApp((s) => s.stats)
  const closeDetail = useApp((s) => s.closeDetail)
  const openReader = useApp((s) => s.openReader)

  const book = (books ?? []).find((b) => b.id === detailBookId) ?? null
  const stat = stats?.books.find((item) => item.bookId === detailBookId)
  const percent = stat?.percent ?? 0
  const seconds = stat?.seconds ?? 0
  const lastAt = stat?.lastAt ?? 0
  const status = percent >= 0.99 ? '已读完' : percent > 0.001 ? '阅读中' : '未开始'

  return (
    <Modal open={Boolean(book)} title="书籍详情" onClose={closeDetail} width={640} variant="sheet">
      {book ? (
        <>
          <div className="detail-hero" style={{ background: coverHero(bookAccentColor(book), book.id) }}>
            <div className="detail-cover">
              <BookCover book={book} />
            </div>
            <div className="detail-head">
              <h2 className="detail-title">{book.title}</h2>
              <div className="detail-author">{book.author}</div>
              <div className="detail-tags">
                {book.volume ? <span className="detail-tag">第 {book.volume} 卷</span> : null}
                {book.seriesKey ? <span className="detail-tag">{book.seriesKey}</span> : null}
                <span className="detail-tag">
                  {book.chapterCount} 章 · {formatWordCount(book.wordCount)}
                </span>
              </div>
            </div>
          </div>

          <div className="detail-progress">
            <div>
              <div className="detail-progress-title">阅读进度</div>
              <div className="detail-progress-sub">
                {lastAt > 0
                  ? `${formatDateTime(lastAt)} · 已读完 ${percentText(percent)} %`
                  : '还没有开始阅读'}
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                closeDetail()
                void openReader(book.id)
              }}
            >
              <Play size={14} fill="currentColor" />
              {percent > 0.001 ? '继续阅读' : '开始阅读'}
            </button>
          </div>

          {/*
            手机上用「清单行」而不是四宫格卡片：窄屏下卡片容易挤变形、内容显示不全，
            清单行标签在左、值在右，结构上保证一定显示完整。
          */}
          {/*
            统计信息用最朴素的行内文本（block 行 + 两个 inline span）：
            不用 flex、不用 space-between、不用裸文本节点 —— 没有可压缩/可裁切的结构，
            值不可能"存在但看不见"（之前 flex 方案里值一直被顶出可视区）
          */}
          <div className="detail-facts">
            <div className="detail-fact">
              <span className="fact-label">阅读时间</span>
              <span className="fact-value">{durationText(seconds)}</span>
            </div>
            <div className="detail-fact">
              <span className="fact-label">书籍格式</span>
              <span className="fact-value">{book.format.toUpperCase()}</span>
            </div>
            <div className="detail-fact">
              <span className="fact-label">总字数</span>
              <span className="fact-value">{formatWordCount(book.wordCount)}</span>
            </div>
            <div className="detail-fact">
              <span className="fact-label">阅读状态</span>
              <span className="fact-value">{status}</span>
            </div>
          </div>

          <div className="detail-desc">
            <h3>书籍简介</h3>
            <p>{book.description || '这本书没有提供简介。'}</p>
          </div>

          <div className="detail-file">
            <span>文件名：{book.fileName}</span>
            {book.metaTitle && book.metaTitle !== book.title ? (
              <span>EPUB 书名：{book.metaTitle}</span>
            ) : null}
          </div>
        </>
      ) : null}
    </Modal>
  )
}
