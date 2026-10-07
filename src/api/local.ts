import type {
  Book,
  BookOpenPayload,
  ChapterPayload,
  Progress,
  Settings,
  StatsPayload,
  SyncState
} from '@shared/types'

/**
 * 手机端的本地数据 api —— 数据层第 1 步。
 *
 * 数据来源：`public/data/library.json`（由桌面端 `npm run` 的 export-mobile-data 脚本用
 * **桌面端已跑通的解析器**导出：真书名 / 真目录 / 真正文 / 真插图 / 真封面）。
 * 这一步不碰"解析器移植"，先把渲染链路打通；进度先用 localStorage 存。
 *
 * 用法：main.tsx 里 `window.api = createLocalApi()` 取代 createMockApi()。
 */

interface ExportedChapter {
  index: number
  label: string
  html: string
}

interface ExportedTocNode {
  label?: string
  href?: string
  children?: ExportedTocNode[]
}

interface ExportedLibrary {
  exportedAt: string
  book: {
    id: string
    title: string
    metaTitle?: string
    author: string
    description?: string
    format?: string
    fileName?: string
    coverFile?: string
    chapterCount: number
    wordCount: number
    toc?: ExportedTocNode[]
  }
  chapters: ExportedChapter[]
}

const PROGRESS_KEY = 'dsh.progress'
const SESSIONS_KEY = 'dsh.sessions'
const SETTINGS_KEY = 'dsh.settings'

let cache: ExportedLibrary | null = null

async function loadLibrary(): Promise<ExportedLibrary> {
  if (!cache) {
    const response = await fetch('data/library.json')
    if (!response.ok) throw new Error(`读取书籍数据失败：HTTP ${response.status}`)
    cache = (await response.json()) as ExportedLibrary
    seedDemoReading(cache.book.id)
  }
  return cache
}

/**
 * 演示用阅读记录（用户要求"伪造一个记录看效果"）。
 *
 * 只在**第一次**打开时写入 localStorage：今天 1 分 57 秒、昨天 1 分 40 秒、
 * 进度 18%（读到第 13 章）。之后真实阅读会在这些记录上继续累加。
 * 想清空：删掉应用数据，或在开发者工具里清 localStorage。
 */
function seedDemoReading(bookId: string): void {
  const now = Date.now()
  const today = dayKey()
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10)

  // 只要书还没有进度就种一条（不依赖 localStorage 标记，内存兜底也认）
  const all = readProgress()
  if (!all[bookId]) {
    all[bookId] = {
      bookId,
      percent: 0.18,
      chapterIndex: 12,
      chapterTitle: '第 13 章',
      scrollRatio: 0.42,
      updatedAt: now,
      deviceId: 'mobile-local',
      rev: 1
    }
    writeProgress(all)
  }

  const rows = readSessions()
  if (!rows.some((row) => row.bookId === bookId)) {
    rows.push({ bookId, day: today, seconds: 117 })
    rows.push({ bookId, day: yesterday, seconds: 100 })
    writeSessions(rows)
  }
}

function toBook(data: ExportedLibrary): Book {
  const source = data.book
  return {
    id: source.id,
    title: source.title,
    metaTitle: source.metaTitle ?? source.title,
    author: source.author,
    description: source.description ?? '',
    format: 'epub',
    fileName: source.fileName ?? `${source.title}.epub`,
    filePath: '',
    fileSize: 0,
    contentHash: null,
    // 封面是导出时一起带过来的真实封面图（相对路径，浏览器与 Capacitor 都能取到）
    coverFile: source.coverFile ?? null,
    // 取色来自桌面端对这本书封面的抽取结果（有真封面时必须用它，卡片/详情页配色才和封面对得上）
    coverColor: source.coverFile ? '#264886' : null,
    chapterCount: data.chapters.length,
    chapterChars: data.chapters.map((chapter) => chapter.html.replace(/<[^>]+>/g, '').length),
    wordCount: source.wordCount,
    volume: null,
    seriesKey: null,
    manualSeries: null,
    addedAt: Date.parse(data.exportedAt ?? '') || Date.now(),
    lastOpenedAt: null,
    hidden: false,
    syncUpload: false
  }
}

/** 目录：导出时带的是 EpubNode 树，这里拍平成 app 需要的 {id,label,chapterIndex,level} */
function toToc(data: ExportedLibrary): BookOpenPayload['toc'] {
  const hrefToIndex = new Map<string, number>()
  // 导出数据里 toc 的 href 与 chapters 未必同名，所以按顺序兜底：目录条目依次对应章节
  const flat: BookOpenPayload['toc'] = []
  const walk = (nodes: ExportedTocNode[], level: number): void => {
    for (const node of nodes) {
      const label = (node.label ?? '').trim()
      const index = flat.length < data.chapters.length ? flat.length : data.chapters.length - 1
      if (label) {
        flat.push({ id: `toc-${flat.length}`, label, chapterIndex: index, level })
        if (node.href) hrefToIndex.set(node.href.split('#')[0], index)
      }
      if (node.children?.length) walk(node.children, level + 1)
    }
  }
  if (data.book.toc?.length) walk(data.book.toc, 0)
  if (flat.length === 0) {
    for (const chapter of data.chapters) {
      flat.push({ id: `toc-${chapter.index}`, label: chapter.label, chapterIndex: chapter.index, level: 0 })
    }
  }
  return flat
}

/**
 * localStorage 的**内存兜底**。
 *
 * 安卓 WebView 上 localStorage 可能不可用或被系统清掉（隐私模式、清理数据等），
 * 那样统计页就会一条记录都没有（用户反馈过"全新安装也是空的"）。
 * 所以所有读写都再镜像一份到内存：localStorage 里有就用它，没有就用内存里的。
 */
const memoryProgress: Record<string, Progress> = {}
const memorySessions: Array<{ bookId: string; day: string; seconds: number }> = []

function readProgress(): Record<string, Progress> {
  let stored: Record<string, Progress> = {}
  try {
    stored = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, Progress>
  } catch {
    stored = {}
  }
  return { ...memoryProgress, ...stored }
}

function writeProgress(all: Record<string, Progress>): void {
  for (const [id, item] of Object.entries(all)) memoryProgress[id] = item
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all))
  } catch {
    /* 存不进去也无妨，内存里有一份 */
  }
}

function readSessions(): Array<{ bookId: string; day: string; seconds: number }> {
  let stored: Array<{ bookId: string; day: string; seconds: number }> = []
  try {
    stored = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '[]') as Array<{
      bookId: string
      day: string
      seconds: number
    }>
  } catch {
    stored = []
  }
  // 按 bookId+day 合并内存与本地存储，内存里的兜底记录不会被丢掉
  const merged = new Map(stored.map((row) => [`${row.bookId}|${row.day}`, row]))
  for (const row of memorySessions) {
    const key = `${row.bookId}|${row.day}`
    if (!merged.has(key)) merged.set(key, row)
  }
  return [...merged.values()]
}

function writeSessions(rows: Array<{ bookId: string; day: string; seconds: number }>): void {
  for (const row of rows) {
    const existing = memorySessions.find((item) => item.bookId === row.bookId && item.day === row.day)
    if (existing) existing.seconds = row.seconds
    else memorySessions.push({ ...row })
  }
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(rows))
  } catch {
    /* 内存里有 */
  }
}

const dayKey = (): string => new Date().toISOString().slice(0, 10)

function defaultSettings(): Settings {
  return {
    deviceId: 'mobile-local',
    deviceName: '手机',
    theme: 'light',
    librarySort: 'recent',
    libraryFilter: 'all',
    reader: {
      fontSize: 18,
      lineHeight: 1.9,
      pageWidth: 720,
      // 页边距：手机屏窄，默认 20px（桌面端的 36px 在手机上两侧会显得很宽）
      padding: 20,
      fontFamily: 'system',
      mode: 'scroll',
      // 这个字段漏过：设置页要按 theme 查阅读主题色，查不到就 undefined.bg 崩掉（整页卡死）
      theme: 'paper'
    },
    appearance: {
      accent: '#3b6fd4',
      backgroundImage: null,
      backgroundOpacity: 0.18,
      readerBackgroundImage: null
    },
    sync: {
      provider: 'local',
      localCloudDir: null,
      webdav: { url: '', username: '' },
      remoteDir: 'DshReader',
      auto: false,
      onReaderClose: true,
      intervalMinutes: 30,
      conflictPolicy: 'ask',
      uploadBooks: false,
      autoDownloadBooks: false
    }
  } as unknown as Settings
}

/**
 * 设置对象必须**缓存同一个引用**：每次 get 都新建对象的话，
 * 依赖 settings 的 effect 会因为引用变化反复重跑（设置页就这样卡死过）。
 */
let settingsCache: Settings | null = null

function readSettings(): Settings {
  if (settingsCache) return settingsCache
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    settingsCache = raw ? { ...defaultSettings(), ...(JSON.parse(raw) as Settings) } : defaultSettings()
  } catch {
    settingsCache = defaultSettings()
  }
  return settingsCache
}

const idleSync: SyncState = {
  phase: 'idle',
  loggedIn: true,
  account: '本地模式',
  lastSyncAt: null,
  tasks: [],
  transferred: 0,
  total: 0,
  message: '手机端本地模式：网盘同步尚未接入'
}

export function createLocalApi(): unknown {
  const listeners = new Set<() => void>()

  return {
    app: {
      info: async () => ({
        version: '0.9.4',
        dataDir: '本地数据（导出）',
        booksDir: 'data/',
        coversDir: 'data/',
        cacheDir: '—',
        platform: 'android'
      }),
      openPath: async () => '',
      pathForFile: () => ''
    },

    settings: {
      get: async () => readSettings(),
      set: async (patch: Partial<Settings>) => {
        const next = { ...readSettings(), ...patch }
        settingsCache = next
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
        return next
      }
    },

    dialog: {
      chooseFolder: async () => null,
      chooseImage: async () => null,
      confirm: async () => window.confirm('确认执行该操作？')
    },

    appearance: {
      pickBackdrop: async () => null
    },

    library: {
      list: async () => [toBook(await loadLibrary())],
      importDialog: async () => ({ books: [], errors: [] }),
      importFolderDialog: async () => ({ books: [], errors: [] }),
      importPaths: async () => ({ books: [], errors: [] }),
      remove: async () => undefined,
      update: async () => undefined,
      markSyncUpload: async () => [],
      reveal: async () => false,
      onChanged: (callback: () => void) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      // 下面两个宿主接口（导出/清理缓存）手机端用不到，但 store 初始化时会调用，给个空实现
      ensureExtracted: async () => '',
      clearCache: async () => undefined
    },

    reader: {
      open: async (bookId: string): Promise<BookOpenPayload> => {
        const data = await loadLibrary()
        const book = toBook(data)
        const progress = readProgress()[bookId] ?? null
        return {
          book: { ...book, id: bookId },
          toc: toToc(data),
          chapters: data.chapters.map((chapter) => ({
            index: chapter.index,
            label: chapter.label,
            href: `chapter-${chapter.index}`
          })),
          progress
        }
      },
      chapter: async (_bookId: string, index: number): Promise<ChapterPayload> => {
        const data = await loadLibrary()
        const chapter = data.chapters[index] ?? data.chapters[0]
        return {
          index: chapter.index,
          label: chapter.label,
          total: data.chapters.length,
          html: chapter.html
        }
      },
      setProgress: async (bookId: string, patch: Partial<Progress>) => {
        const all = readProgress()
        const current = all[bookId]
        const next: Progress = {
          bookId,
          percent: patch.percent ?? current?.percent ?? 0,
          chapterIndex: patch.chapterIndex ?? current?.chapterIndex ?? 0,
          chapterTitle: patch.chapterTitle ?? current?.chapterTitle ?? '',
          scrollRatio: patch.scrollRatio ?? current?.scrollRatio ?? 0,
          updatedAt: Date.now(),
          deviceId: 'mobile-local',
          rev: (current?.rev ?? 0) + 1
        }
        all[bookId] = next
        writeProgress(all)
        return next
      },
      tick: async (bookId: string, seconds: number) => {
        if (seconds < 1) return false
        const rows = readSessions()
        const day = dayKey()
        const row = rows.find((item) => item.bookId === bookId && item.day === day)
        if (row) row.seconds += Math.round(seconds)
        else rows.push({ bookId, day, seconds: Math.round(seconds) })
        writeSessions(rows)
        return true
      }
    },

    stats: {
      get: async (): Promise<StatsPayload> => {
        const data = await loadLibrary()
        const book = toBook(data)
        const progress = readProgress()[book.id]
        const sessions = readSessions()
        const today = dayKey()
        const totalSeconds = sessions.reduce((total, row) => total + row.seconds, 0)
        const daysMap = new Map<string, { seconds: number; bookIds: string[] }>()
        for (const row of sessions) {
          const entry = daysMap.get(row.day) ?? { seconds: 0, bookIds: [] }
          entry.seconds += row.seconds
          if (!entry.bookIds.includes(row.bookId)) entry.bookIds.push(row.bookId)
          daysMap.set(row.day, entry)
        }
        const percent = progress?.percent ?? 0
        return {
          bookCount: 1,
          finishedCount: percent >= 0.99 ? 1 : 0,
          totalSeconds,
          averageSeconds: totalSeconds,
          books: [
            {
              bookId: book.id,
              title: book.title,
              percent,
              seconds: totalSeconds,
              lastAt: progress?.updatedAt ?? 0
            }
          ],
          days: [...daysMap.entries()].map(([day, entry]) => ({
            day,
            seconds: entry.seconds,
            bookIds: entry.bookIds
          })),
          todaySeconds: daysMap.get(today)?.seconds ?? 0,
          todayBookId: sessions.some((row) => row.day === today) ? book.id : null,
          todayRemainingSeconds: null
        } as unknown as StatsPayload
      }
    },

    sync: {
      status: async () => idleSync,
      connect: async () => idleSync,
      run: async () => idleSync,
      cancel: async () => idleSync,
      downloadAll: async () => idleSync,
      conflicts: async () => [],
      resolve: async () => idleSync,
      configureWebdav: async () => idleSync,
      logout: async () => idleSync,
      afterReading: async () => undefined,
      onChanged: () => () => undefined
    }
  }
}
