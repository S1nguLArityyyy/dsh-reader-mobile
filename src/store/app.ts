import { create } from 'zustand'
import { percentByPosition } from '@shared/progress'
import type {
  AppInfo,
  Book,
  ChapterRef,
  ConflictItem,
  Settings,
  StatsPayload,
  SyncState,
  TocEntry
} from '@shared/types'

export type Route = 'library' | 'stats' | 'settings' | 'reader'

export interface ToastItem {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface ReaderState {
  bookId: string | null
  book: Book | null
  toc: TocEntry[]
  chapters: ChapterRef[]
  chapterIndex: number
  chapterLabel: string
  html: string
  loading: boolean
  error: string | null
  /** 打开时恢复用的滚动比例 */
  scrollRatio: number
  /**
   * 最近一次换章的方向：
   *  - forward：向后翻过章末（落在新章开头）
   *  - backward：向前翻过章首（落在上一章末尾）
   *  - resume：回到该章上次读到的位置（按章翻阅时用）
   */
  jumpDir?: 'forward' | 'backward' | 'resume'
  /** jumpDir === 'resume' 时要恢复到的章内位置（0~1） */
  restoreRatio?: number
}

const emptyReader: ReaderState = {
  bookId: null,
  book: null,
  toc: [],
  chapters: [],
  chapterIndex: 0,
  chapterLabel: '',
  html: '',
  loading: false,
  error: null,
  scrollRatio: 0,
  jumpDir: 'forward'
}

const emptySync: SyncState = {
  phase: 'idle',
  connected: false,
  deviceName: null,
  lastSyncAt: null,
  tasks: [],
  transferred: 0,
  total: 0,
  message: null
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * 没有历史进度时选择起始章节：
 * 跳过封面/制作/版权等前置页，从正文第一项开始。
 */
  /^(封面|书封|書封|封底|书名|書名|标题|標題|制作|製作|版权|版權|版权页|版權頁|声明|聲明|免责|免責|录入|錄入|下载|下載|简介|簡介|内容简介|作品简介|目录|目次|目錄|信息|資訊|彩插|彩頁|彩页|插图|插圖|扉页|扉頁|奥付|翻译|翻譯|汉化|漢化|制作信息)/

/**
 * 决定"从哪一章开始读"（仅用于没有阅读记录的新书）。
 * 旧实现会挑"第一个像正文的条目" ✗ 于是一本没开过的书默认停在第十章左右（用户反馈）✓
 * 现在保守：只有明确是封面/目录/版权这类非正文条目才往后跳 ✓ 其余一律第 0 章 ✓
 */
function pickStartChapter(payload: { toc: { label: string; chapterIndex: number }[] }, skipFrontMatter: boolean): number {
  // 开关关着（默认）→ 一律从第 1 页开始，封面/扉页都能看到
  if (!skipFrontMatter) return 0
  const skip = /^(封面|书名|目录|目次|版权|扉页|插页|广告|contents?|cover|title)/i
  for (const item of payload.toc ?? []) {
    const label = String(item.label ?? "").trim()
    if (label && !skip.test(label)) return item.chapterIndex
  }
  return 0
}

/**
 * 整书进度：按「读到的位置」计算，而不是章节序号。
 * 没有字数数据时退回按章节序号估算。
 */
export function bookPercent(book: Book | null, chapterIndex: number, scrollRatio: number): number {
  if (!book) return 0
  const chars = book.chapterChars ?? []
  const total = book.wordCount > 0 ? book.wordCount : chars.reduce((sum, n) => sum + n, 0)
  if (chars.length === 0 || total <= 0) {
    const count = Math.max(1, book.chapterCount || 1)
    return Math.min(1, Math.max(0, (chapterIndex + scrollRatio) / count))
  }
  return percentByPosition(chars, total, chapterIndex, scrollRatio)
}

interface AppStore {
  ready: boolean
  route: Route
  info: AppInfo | null
  books: Book[]
  settings: Settings | null
  stats: StatsPayload | null
  sync: SyncState
  conflicts: ConflictItem[]
  syncModalOpen: boolean
  conflictModalOpen: boolean
  toasts: ToastItem[]
  reader: ReaderState
  /** 书籍详情弹窗 */
  detailBookId: string | null
  /** 书库筛选：null=全部，'__singles__'=单册，其它=系列名 */
  seriesFilter: string | null
  /** 侧边栏系列二级菜单是否展开 */
  seriesOpen: boolean
  /** 书库搜索词（匹配书名 / 作者 / 系列） */
  search: string
  /** 多选管理模式 */
  selectMode: boolean
  selected: string[]

  init: () => Promise<void>
  go: (route: Route) => void
  toast: (kind: ToastItem['kind'], text: string) => void
  dismissToast: (id: number) => void
  openDetail: (bookId: string) => void
  closeDetail: () => void
  setSeriesFilter: (key: string | null) => void
  toggleSeries: () => void
  setSearch: (value: string) => void
  toggleSelectMode: () => void
  toggleSelected: (bookId: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  bulkRemove: (deleteFile: boolean) => Promise<void>
  bulkHide: () => Promise<void>
  setManualSeries: (ids: string[], name: string | null) => Promise<void>

  loadBooks: () => Promise<void>
  loadStats: () => Promise<void>
  loadSync: () => Promise<void>
  refreshAll: () => Promise<void>
  /** 同步收尾：有冲突就弹裁决窗，返回是否已接管 */
  finishSync: (sync: SyncState) => Promise<boolean>
  /** 只同步阅读记录（书库页的同步按钮） */
  syncRecordsOnly: () => Promise<void>

  importDialog: () => Promise<void>
  importFolderDialog: () => Promise<void>
  importPaths: (paths: string[]) => Promise<void>
  removeBook: (id: string, deleteFile: boolean) => Promise<void>
  updateBook: (id: string, patch: Partial<Book>) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  markAllSyncUpload: (value: boolean) => Promise<void>

  openReader: (bookId: string) => Promise<void>
  closeReader: () => void
  goToChapter: (
    index: number,
    dir?: 'forward' | 'backward',
    resume?: { positions?: Record<number, number> }
  ) => Promise<void>

  setSyncModal: (open: boolean) => void
  setConflictModal: (open: boolean) => void
  runSync: () => Promise<void>
  cancelSync: () => Promise<void>
  connectSync: () => Promise<void>
  downloadAll: () => Promise<void>
  resolveConflicts: (choices: Record<string, 'local' | 'cloud'>) => Promise<void>
}

let toastSeq = 0

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  route: 'library',
  info: null,
  books: [],
  settings: null,
  stats: null,
  sync: emptySync,
  conflicts: [],
  syncModalOpen: false,
  conflictModalOpen: false,
  toasts: [],
  reader: { ...emptyReader },
  detailBookId: null,
  seriesFilter: null,
  seriesOpen: true,
  search: '',
  selectMode: false,
  selected: [],

  async init() {
    try {
      const params = new URLSearchParams(window.location.search)
      const routeParam = (params.get('route') ?? 'library') as Route
      const modal = params.get('modal') ?? ''
      const bookParam = params.get('book') ?? ''

      const [info, settings, books, stats, sync] = await Promise.all([
        window.api.app.info(),
        window.api.settings.get(),
        window.api.library.list(),
        window.api.stats.get(),
        window.api.sync.status()
      ])

      set({
        info,
        settings,
        books: [...books].sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt)),
        stats,
        sync,
        route: routeParam,
        ready: true
      })

      if (modal === 'sync') set({ syncModalOpen: true })
      if (modal === 'detail' && books.length > 0) set({ detailBookId: books[0].id })

      // 便于深链 / 截图的状态参数
      const searchParam = params.get('search')
      if (searchParam) set({ search: searchParam })
      if (params.get('select') === '1' && books.length > 0) {
        set({ selectMode: true, selected: books.slice(0, 2).map((book) => book.id) })
      }

      // 主进程补齐旧书信息后会通知刷新
      if (typeof window.api.library.onChanged === 'function') {
        window.api.library.onChanged(() => {
          void get().loadBooks()
        })
      }

      // 同步跑完（含启动后 / 定时 / 退出前的自动同步）后刷新：
      // 书库进度、「今日阅读」显示的是哪本书、统计页数字都可能变了
      if (typeof window.api.sync.onChanged === 'function') {
        window.api.sync.onChanged(() => {
          void get().loadSync()
          void get().loadBooks()
          void get().loadStats()
        })
      }

      if (routeParam === 'reader' && books.length > 0) {
        const target = bookParam && bookParam !== 'first' ? bookParam : books[0].id
        await get().openReader(target)
      }
    } catch (err) {
      set({ ready: true })
      get().toast('error', `初始化失败：${errorText(err)}`)
    }
  },

  go(route) {
    set({ route })
  },

  toast(kind, text) {
    toastSeq += 1
    const id = toastSeq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    window.setTimeout(() => get().dismissToast(id), 4200)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  openDetail(bookId) {
    set({ detailBookId: bookId })
  },

  closeDetail() {
    set({ detailBookId: null })
  },

  setSeriesFilter(key) {
    set({ seriesFilter: key, route: 'library' })
  },

  toggleSeries() {
    set({ seriesOpen: !get().seriesOpen })
  },

  setSearch(value) {
    set({ search: value })
  },

  toggleSelectMode() {
    const next = !get().selectMode
    set({ selectMode: next, selected: next ? get().selected : [] })
  },

  toggleSelected(bookId) {
    const selected = get().selected
    set({
      selected: selected.includes(bookId) ? selected.filter((id) => id !== bookId) : [...selected, bookId]
    })
  },

  selectAll(ids) {
    set({ selected: ids })
  },

  clearSelection() {
    set({ selected: [] })
  },

  async bulkRemove(deleteFile) {
    const ids = get().selected
    if (ids.length === 0) return
    const ok = await window.api.dialog.confirm({
      title: deleteFile ? '批量删除' : '批量移出书库',
      message: deleteFile ? `确定删除选中的 ${ids.length} 本书吗？` : `确定把选中的 ${ids.length} 本书移出书库吗？`,
      detail: deleteFile ? '书籍文件与阅读记录都会被删除，此操作不可撤销。' : '仅从书库移除，磁盘上的原文件会保留。',
      confirmText: deleteFile ? '删除' : '移除',
      danger: deleteFile
    })
    if (!ok) return
    for (const id of ids) await window.api.library.remove(id, deleteFile)
    await get().loadBooks()
    await get().loadStats()
    set({ selected: [], selectMode: false })
    get().toast('success', `已处理 ${ids.length} 本书`)
  },

  async bulkHide() {
    const ids = get().selected
    if (ids.length === 0) return
    for (const id of ids) await window.api.library.update(id, { hidden: true })
    await get().loadBooks()
    set({ selected: [], selectMode: false })
    get().toast('success', `已隐藏 ${ids.length} 本书`)
  },

  async setManualSeries(ids, name) {
    if (ids.length === 0) return
    for (const id of ids) await window.api.library.update(id, { manualSeries: name })
    await get().loadBooks()
    get().toast('success', name ? `已归入合集「${name}」` : '已移出合集')
  },

  async markAllSyncUpload(value) {
    try {
      await window.api.library.markSyncUpload(value)
      await get().loadBooks()
      get().toast('info', value ? '已把全部书籍标为「同步到云端」' : '已取消全部书籍的云端同步标记')
    } catch (err) {
      get().toast('error', errorText(err))
    }
  },

  async loadBooks() {
    const books = await window.api.library.list()
    set({ books: [...books].sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt)) })
  },

  async loadStats() {
    set({ stats: await window.api.stats.get() })
  },

  async loadSync() {
    const [sync, conflicts] = await Promise.all([window.api.sync.status(), window.api.sync.conflicts()])
    set({ sync, conflicts })
  },

  async refreshAll() {
    await Promise.all([get().loadBooks(), get().loadStats(), get().loadSync()])
  },

  async importDialog() {
    try {
      const result = await window.api.library.importDialog()
      await get().loadBooks()
      await get().loadStats()
      if (result.books.length > 0) get().toast('success', `已导入 ${result.books.length} 本书`)
      if (result.errors.length > 0) get().toast('error', result.errors[0])
    } catch (err) {
      get().toast('error', `导入失败：${errorText(err)}`)
    }
  },

  async importFolderDialog() {
    try {
      const result = await window.api.library.importFolderDialog()
      await get().loadBooks()
      await get().loadStats()
      if (result.books.length > 0) get().toast('success', `已导入 ${result.books.length} 本书`)
      if (result.errors.length > 0) get().toast('error', result.errors[0])
    } catch (err) {
      get().toast('error', `导入失败：${errorText(err)}`)
    }
  },

  async importPaths(paths) {
    if (paths.length === 0) return
    try {
      const result = await window.api.library.importPaths(paths)
      await get().loadBooks()
      await get().loadStats()
      if (result.books.length > 0) get().toast('success', `已导入 ${result.books.length} 本书`)
      for (const err of result.errors.slice(0, 3)) get().toast('error', err)
    } catch (err) {
      get().toast('error', `导入失败：${errorText(err)}`)
    }
  },

  async removeBook(id, deleteFile) {
    try {
      const books = await window.api.library.remove(id, deleteFile)
      // ⚠ 手机端的 remove 返回 undefined ✗ 直接 set({ books }) 会把书库置空 ✗（用户反馈"删一本全没了"✓）
      if (Array.isArray(books)) set({ books })
      else await get().loadBooks()
      await get().loadStats()
      get().toast('success', deleteFile ? '已删除书籍与文件' : '已从书库移除')
    } catch (err) {
      get().toast('error', `删除失败：${errorText(err)}`)
    }
  },

  async updateBook(id, patch) {
    try {
      const books = await window.api.library.update(id, patch)
      if (Array.isArray(books)) set({ books })
      else await get().loadBooks()
    } catch (err) {
      get().toast('error', `更新失败：${errorText(err)}`)
    }
  },

  async saveSettings(patch) {
    try {
      const settings = await window.api.settings.set(patch)
      set({ settings })
    } catch (err) {
      get().toast('error', `设置保存失败：${errorText(err)}`)
    }
  },

  async openReader(bookId) {
    set({ route: 'reader', reader: { ...emptyReader, bookId, loading: true } })
    try {
      const payload = await window.api.reader.open(bookId)
      // 没有历史进度时，跳过封面/制作页，从正文第一项开始
      const startIndex = payload.progress?.chapterIndex ?? pickStartChapter(payload, get().settings?.reader?.skipFrontMatter === true)
      set({
        reader: {
          bookId,
          book: payload.book,
          toc: payload.toc,
          chapters: payload.chapters,
          chapterIndex: startIndex,          chapterLabel: payload.chapters[startIndex]?.label ?? '',
          html: '',
          loading: true,
          error: null,
          scrollRatio: payload.progress?.scrollRatio ?? 0
        }
      })
      await get().goToChapter(startIndex)
      await get().loadBooks()
    } catch (err) {
      set({ reader: { ...get().reader, loading: false, error: errorText(err) } })
      get().toast('error', `打开失败：${errorText(err)}`)
    }
  },

  closeReader() {
    set({ route: 'library', reader: { ...emptyReader } })
    void get().refreshAll()
    // 合上书顺手同步一次（主进程会稍等片刻，让卸载时刷下的最后一条进度先落到本地）
    void window.api.sync.afterReading()
  },

  async goToChapter(index, dir, resume) {
    const { reader } = get()
    if (!reader.bookId) return
    const target = Math.max(0, Math.min(reader.chapters.length - 1, index))
    // 方向决定新章节落在哪里
    const jumpDir =
      dir ?? (target > reader.chapterIndex ? 'forward' : target < reader.chapterIndex ? 'backward' : reader.jumpDir)
    // 向前翻回上一章：若阅读器记过那一章读到哪，就回到那个位置；
    // 没记过（比如从没进过那一章）才落到章末
    const restored = jumpDir === 'backward' ? resume?.positions?.[target] : undefined
    set({
      reader: {
        ...get().reader,
        loading: true,
        chapterIndex: target,
        jumpDir: restored !== undefined ? 'resume' : jumpDir,
        restoreRatio: restored
      }
    })
    try {
      const chapter = await window.api.reader.chapter(reader.bookId, target)
      set({
        reader: {
          ...get().reader,
          chapterIndex: chapter.index,
          chapterLabel: chapter.label,
          html: chapter.html,
          loading: false,
          error: null
        }
      })
    } catch (err) {
      set({ reader: { ...get().reader, loading: false, error: errorText(err) } })
      get().toast('error', `章节加载失败：${errorText(err)}`)
    }
  },

  /**
   * 同步结束后的统一收尾：只要有冲突就把裁决弹窗弹出来（不管用户是从哪里点的同步），
   * 否则只更新状态。
   * 返回 true 表示已经接管（有冲突），调用方不用再弹提示。
   */
  async finishSync(sync: SyncState): Promise<boolean> {
    set({ sync })
    if (sync.phase !== 'conflict') return false
    await get().loadSync()
    set({ conflictModalOpen: true })
    get().toast('info', sync.message ?? '发现阅读进度冲突，请选择保留哪一边')
    return true
  },

  /**
   * 书库页那个「同步」按钮用这个：只同步记录，不拉书。
   * 以前它直接调 window.api.sync.recordsOnly()，绕过了冲突处理 ——
   * 于是只有在同步面板里点「立即同步」才会看到冲突弹窗（用户反馈的 bug）。
   */
  async syncRecordsOnly() {
    try {
      const sync = (await (
        window.api as unknown as { sync: { recordsOnly: () => Promise<SyncState> } }
      ).sync.recordsOnly()) as SyncState
      await get().loadBooks()
      await get().loadStats()
      if (await get().finishSync(sync)) return
      // 平时安静同步：只有面板开着才提示
      if (sync.message && get().syncModalOpen) get().toast(sync.phase === 'error' ? 'error' : 'info', sync.message)
    } catch (err) {
      get().toast('error', `同步失败：${errorText(err)}`)
    }
  },

  setSyncModal(open) {
    set({ syncModalOpen: open })
    if (open) void get().loadSync()
  },

  setConflictModal(open) {
    set({ conflictModalOpen: open })
    if (open) void get().loadSync()
  },

  async runSync() {
    try {
      const sync = await window.api.sync.run()
      // 进度 / 今日阅读 / 统计都可能变了，立刻刷新
      await get().loadBooks()
      await get().loadStats()
      if (await get().finishSync(sync)) return
      // 只有面板开着才弹提示，平时安静同步
      if (sync.message && get().syncModalOpen) get().toast(sync.phase === 'error' ? 'error' : 'info', sync.message)
    } catch (err) {
      get().toast('error', `同步失败：${errorText(err)}`)
    }
  },

  async cancelSync() {
    const sync = await window.api.sync.cancel()
    set({ sync })
  },

  async connectSync() {
    try {
      const sync = await window.api.sync.connect()
      // 连接时主进程会把选中的目录写进设置，这里跟着刷新一次
      const settings = await window.api.settings.get()
      set({ sync, settings })
      await get().loadBooks()
      await get().loadStats()
      if (sync.phase === 'conflict') {
        await get().loadSync()
        set({ conflictModalOpen: true })
        get().toast('info', sync.message ?? '发现阅读进度冲突，请选择保留哪一边')
        return
      }
      if (sync.message) get().toast('info', sync.message)
    } catch (err) {
      get().toast('error', errorText(err))
    }
  },

  async downloadAll() {
    try {
      const sync = await window.api.sync.downloadAll()
      set({ sync })
      await get().loadBooks()
      await get().loadStats()
      if (sync.message) get().toast('info', sync.message)
    } catch (err) {
      get().toast('error', errorText(err))
    }
  },

  async resolveConflicts(choices) {
    try {
      const sync = await window.api.sync.resolve(choices)
      set({ sync, conflictModalOpen: false, conflicts: [] })
      get().toast('success', '冲突已解决，正在把结果推给电脑…')
    } catch (err) {
      get().toast('error', errorText(err))
    }
  }
}))
