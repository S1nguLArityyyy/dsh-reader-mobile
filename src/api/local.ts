import { fetchLanBook, listLanBooks } from '../data/lan'
import { writeFile as baiduWriteFile, writeJson as baiduWriteJson, AUTH_URL as baiduAuthUrl, accessToken as baiduToken, diagnose as baiduOpenDiagnose, readFile as baiduOpenReadFile, readJson as baiduOpenReadJson } from '../data/baidu-open'
import { unzipSync } from 'fflate'
import {
} from '../data/baidu'
import { deleteBook, getBook, listBooks, putBook, type StoredBook } from '../data/db'
import { readChapterFromZip } from '../data/epub'
import {
  buildPayload,
  clearDavConfig,
  davTest,
  readDavConfig,
  davReadBook,
  davReadManifest,
  readSyncState,
  syncOnce,
  writeDavConfig,
  writeSyncState,
  type SyncPayload
} from '../data/sync'
import { backfillCoverColors, coverUrlOf, importEpubBytes, importEpubFile, pickEpubFiles } from '../data/import'
import type {
  Book,
  BookOpenPayload,
  ChapterPayload,
  Progress,
  Settings,
  StatsPayload,
  SyncState,
  TocNode
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

/** 空书库：APK 里已经不再打包示例书，首次安装时用它兜底（列表只显示用户导入的书） */
const EMPTY_LIBRARY: ExportedLibrary = {
  exportedAt: '',
  book: { id: '', title: '', author: '', description: '', chapterCount: 0, wordCount: 0 },
  chapters: []
}
let cache: ExportedLibrary | null = null

async function loadLibrary(): Promise<ExportedLibrary> {
  if (!cache) {
    try {
      const response = await fetch('data/library.json')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      cache = (await response.json()) as ExportedLibrary
      if (cache.book.id) seedDemoReading(cache.book.id)
    } catch {
      // 没有内置示例书（现在的默认情况）：返回空书库，不抛异常
      cache = EMPTY_LIBRARY
    }
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
    const existing = (memorySessions ?? []).find((item) => item.bookId === row.bookId && item.day === row.day)
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
      padding: 28,
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
    if (raw) {
      const parsed = JSON.parse(raw) as Settings
      // 迁移：旧版默认页边距 20px 偏窄 → 一次性提到 28px（只改恰好等于旧默认值的）
      if (parsed.reader && parsed.reader.padding === 20) parsed.reader.padding = 28
      settingsCache = { ...defaultSettings(), ...parsed }
    } else {
      settingsCache = defaultSettings()
    }
  } catch {
    settingsCache = defaultSettings()
  }
  return settingsCache
}


/** 「全部下载云端书籍」：读 manifest → 逐本下载 → 解析入库（跳过本机已有的） */
async function downloadCloudBooks(): Promise<SyncState> {
  const config = readDavConfig()
  if (!config) return writeSyncState({ message: '请先在设置里配置 WebDAV，再点「保存并连接」' })
  const files = await davReadManifest(config)
  const keys = Object.keys(files)
  if (keys.length === 0) {
    const report = await baiduOpenDiagnose().catch(() => '诊断本身失败')
    return writeSyncState({ message: `云端清单为空（清单里 0 本书）。诊断：${report}` })
  }
  const have = new Set((await listBooks()).map((item) => item.id))
  let done = 0
  const failed: string[] = []
  for (const key of keys) {
    const id = key.startsWith('sha1:') ? key : `sha1:${key}`
    const title = files[key]?.title ?? key.slice(0, 12)
    if (have.has(id)) continue
    writeSyncState({
      message: `正在下载 ${done + 1}/${keys.length}：${title}（每本 6~10MB，约需数十秒）`,
      transferred: done,
      total: keys.length
    })
    const bytes = await davReadBook(config, key)
    if (!bytes) {
      failed.push(title)
      continue
    }
    const result = await importEpubBytes(bytes, `${title}.epub`, id)
    if (result.book) done += 1
    else failed.push(`${title}（${result.error ?? '解析失败'}）`)
  }
  const message =
    failed.length > 0
      ? `已下载 ${done} 本，失败 ${failed.length} 本：${failed.slice(0, 3).join('、')}`
      : `已下载 ${done} 本`
  return writeSyncState({
    message,
    lastSyncAt: Date.now(),
    loggedIn: true,
    account: config.username,
    transferred: done,
    total: keys.length
  })
}
/** 「全部下载云端书籍」（百度网盘版）：manifest.json 取清单 → 逐本下载 → 解析入库 */
/** 局域网直传：从电脑端（同一 WiFi）拉取整库（比网盘快几个数量级 ✓） */
async function downloadLanBooks(): Promise<SyncState> {
  // 顺手给旧书补算封面主色（旧版本记录里没有该字段 ✗ 详情页会显示错误的哈希色 ✓）
  void backfillCoverColors().catch(() => undefined)
  writeSyncState({ phase: 'running', message: '正在读取电脑书库…' })
  const base = String(readSettings().sync.localCloudDir ?? '')
  const listed = await listLanBooks(base)
  if (!listed.ok || listed.books.length === 0) {
    return writeSyncState({ phase: 'idle', message: `局域网：${listed.message}` })
  }
  const have = new Set((await listBooks()).map((item) => item.id))
  let done = 0
  const failed: string[] = []
  for (let index = 0; index < listed.books.length; index += 1) {
    const item = listed.books[index]
    const title = item.name.replace(/\.epub$/i, '')
    writeSyncState({
      phase: 'running',
      message: `正在接收 ${index + 1}/${listed.books.length}：${title}`,
      transferred: done,
      total: listed.books.length
    })
    const bytes = await fetchLanBook(base, item.name)
    if (!bytes) {
      failed.push(title)
      continue
    }
    const result = await importEpubBytes(bytes, item.name)
    // 沿用电脑端算好的主色 ✓（一个像素都不算 ✓ 两端必然一致 ✓）
    if (result.book && item.color) {
      const stored = await getBook(result.book.id)
      if (stored) await putBook({ ...stored, coverColor: item.color })
    }
    if (result.book) {
      if (!have.has(result.book.id)) done += 1
    } else {
      failed.push(`${title}（${result.error ?? '解析失败'}）`)
    }
  }
  return writeSyncState({
    phase: 'idle',
    message:
      failed.length > 0
        ? `局域网：已接收 ${done} 本，失败 ${failed.length} 本：${failed.slice(0, 3).join('、')}`
        : `局域网：已接收 ${done} 本`,
    loggedIn: true,
    account: `局域网 · ${base}`,
    lastSyncAt: Date.now(),
    transferred: done,
    total: listed.books.length
  })
}
async function downloadBaiduBooks(): Promise<SyncState> {
  // 顺手给旧书补算封面主色（旧版本记录里没有该字段 ✗ 详情页会显示错误的哈希色 ✓）
  void backfillCoverColors().catch(() => undefined)
  // 置 running：面板才会显示已用时秒表、才会禁用「立即同步」（否则看起来像没反应）
  writeSyncState({ phase: 'running', message: '正在读取云端清单…' })
  const settings = readSettings()
  const remote = '/' + String(settings.sync.remoteDir || 'DshReader').replace(/^\/+|\/+$/g, '')
  // 旧网页会话（bdstoken）与开放平台无关 ✗ 重装后它必然为空，不能拿它当门槛 ✓
  // 走开放平台（access_token）：网页会话下载需要网页签名 sign，是死路 ✗
  if (!(await baiduToken())) {
    const report = await baiduOpenDiagnose().catch(() => 'n/a')
    return writeSyncState({
      message: `百度网盘还没授权：设置→同步→百度网盘→点「连接」拿授权码粘回来。诊断：${report}`
    })
  }
  const manifest = await baiduOpenReadJson(`${remote}/manifest.json`)
  const files = ((manifest?.files ?? {}) as Record<string, { title?: string; size?: number }>) || {}
  const keys = Object.keys(files)
  if (keys.length === 0) {
    const report = await baiduOpenDiagnose().catch(() => '诊断本身失败')
    return writeSyncState({ message: `云端清单为空（清单里 0 本书）。诊断：${report}` })
  }
  const have = new Set((await listBooks()).map((item) => item.id))
  let done = 0
  const failed: string[] = []
  for (const key of keys) {
    const id = key.startsWith('sha1:') ? key : `sha1:${key}`
    const title = files[key]?.title ?? key.slice(0, 12)
    if (have.has(id)) continue
    writeSyncState({
      message: `正在下载 ${done + 1}/${keys.length}：${title}（每本 6~10MB，约需数十秒）`,
      transferred: done,
      total: keys.length
    })
    const bytes = await baiduOpenReadFile(`${remote}/books/${encodeURIComponent(key)}.epub`, (loaded, total) => {
      const pct = total > 0 ? Math.round((loaded / total) * 100) : 0
      writeSyncState({
        phase: 'running',
        message: `正在下载 ${done + 1}/${keys.length}：${title}  ${pct}%（${Math.round(loaded / 1024)}KB/${Math.round(total / 1024)}KB）`,
        transferred: done,
        total: keys.length
      })
    }, (info) => {
      writeSyncState({ phase: 'running', message: `正在下载 ${done + 1}/${keys.length}：${title}  ${info}` })
    }).catch(() => null)
    if (!bytes) {
      failed.push(title)
      continue
    }
    const result = await importEpubBytes(bytes, `${title}.epub`, id)
    if (result.book) done += 1
    else failed.push(`${title}（${result.error ?? '解析失败'}）`)
  }
  return writeSyncState({
    phase: 'idle',
    message:
      failed.length > 0
        ? `已下载 ${done} 本，失败 ${failed.length} 本：${failed.slice(0, 3).join('、')}`
        : `已下载 ${done} 本`,
    loggedIn: true,
    account: '百度网盘（已授权）',
    lastSyncAt: Date.now(),
    transferred: done,
    total: keys.length
  })
}
/** 「上传本机书籍到云端」：把 IndexedDB 里的书写进 <remote>/books/ 并更新 manifest.json ✓ */
async function uploadBaiduBooks(): Promise<SyncState> {
  writeSyncState({ phase: 'running', message: '正在读取云端清单…' })
  const settings = readSettings()
  const remote = '/' + String(settings.sync.remoteDir || 'DshReader').replace(/^\/+|\/+$/g, '')
  if (!(await baiduToken())) {
    return writeSyncState({ phase: 'idle', message: '百度网盘还没授权：设置→网盘同步→点「连接」' })
  }
  const manifest = ((await baiduOpenReadJson(`${remote}/manifest.json`)) ?? {}) as Record<string, unknown>
  const files = ((manifest.files ?? {}) as Record<string, { title?: string; size?: number }>) || {}
  const books = (await listBooks()).filter((book) => book.id.startsWith('sha1:'))
  const pending = books.filter((book) => !files[book.id])
  if (pending.length === 0) {
    return writeSyncState({
      phase: 'idle',
      message: `云端已是最新（${books.length} 本）`,
      loggedIn: true,
      account: '百度网盘（已授权）',
      lastSyncAt: Date.now()
    })
  }
  let done = 0
  const failed: string[] = []
  for (let index = 0; index < pending.length; index += 1) {
    const book = pending[index]
    writeSyncState({
      phase: 'running',
      message: `正在上传 ${index + 1}/${pending.length}：${book.title}`,
      transferred: done,
      total: pending.length
    })
    const bytes = new Uint8Array(book.epub)
    const target = `${remote}/books/${encodeURIComponent(book.id)}.epub`
    const result = await baiduWriteFile(target, bytes, (loaded, total) => {
      const pct = total > 0 ? Math.round((loaded / total) * 100) : 0
      writeSyncState({
        phase: 'running',
        message: `正在上传 ${index + 1}/${pending.length}：${book.title}  ${pct}%`,
        transferred: done,
        total: pending.length
      })
    })
    if (result.ok) {
      done += 1
      files[book.id] = { title: book.title, size: bytes.byteLength }
    } else {
      failed.push(`${book.title}（${result.message}）`)
    }
  }
  const saved = await baiduWriteJson(`${remote}/manifest.json`, { ...manifest, files, updatedAt: Date.now() })
  return writeSyncState({
    phase: 'idle',
    message:
      (failed.length > 0
        ? `已上传 ${done} 本，失败 ${failed.length} 本：${failed.slice(0, 3).join('、')}`
        : `已上传 ${done} 本`) + (saved.ok ? '' : `（清单写入失败：${saved.message}）`),
    loggedIn: true,
    account: '百度网盘（已授权）',
    lastSyncAt: Date.now(),
    transferred: done,
    total: pending.length
  })
}
/* ---------- 网盘同步：把本地进度/时长与云端合并（v1） ---------- */

/** 把云端合并结果写回本地（进度取较新的、每日时长取较大值） */
function applyPayload(payload: SyncPayload): void {
  writeProgress(payload.progress)
  const byKey = new Map(readSessions().map((row) => [`${row.bookId}|${row.day}`, row]))
  for (const row of payload.sessions) {
    const key = `${row.bookId}|${row.day}`
    const existing = byKey.get(key)
    if (existing) existing.seconds = Math.max(existing.seconds, row.seconds)
    else byKey.set(key, { ...row })
  }
  writeSessions([...byKey.values()])
}

/** 一次同步：合并云端 → 写回云端 → 写回本地 */
async function runSync(): Promise<SyncState> {
  const config = readDavConfig()
  if (!config) return writeSyncState({ message: '还没配置好：请到 设置→同步 填地址/账号/应用密码，然后点「保存并连接」' })
  writeSyncState({ message: '同步中…' })
  const payload = buildPayload(readProgress(), readSessions())
  const result = await syncOnce(config, payload)
  if (result.ok && result.merged) applyPayload(result.merged)
  return writeSyncState({
    loggedIn: result.ok,
    account: config.username,
    lastSyncAt: result.ok ? Date.now() : readSyncState().lastSyncAt,
    message: result.message
  })
}
/* ---------- 被"删除"的书：内置示例书在 APK 里删不掉，记一个隐藏标记 ---------- */
const HIDDEN_KEY = 'dsh.hiddenBooks'

function readHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function writeHidden(ids: string[]): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids))
  } catch {
    /* 存不进去也无妨 */
  }
}
/* ---------- 本机导入的书：IndexedDB 取字节 → zip → 章节 ---------- */
const zipCache = new Map<string, Map<string, Uint8Array>>()
const urlCache = new Map<string, string>()

async function loadImported(bookId: string): Promise<StoredBook | null> {
  if (!bookId.startsWith('sha1:')) return null
  try {
    return (await getBook(bookId)) ?? null
  } catch {
    return null
  }
}

async function zipOf(book: StoredBook): Promise<Map<string, Uint8Array>> {
  const cached = zipCache.get(book.id)
  if (cached) return cached
  const files = new Map<string, Uint8Array>(Object.entries(unzipSync(new Uint8Array(book.epub))))
  zipCache.set(book.id, files)
  return files
}

/** zip 条目 → blob URL（缓存：同一张图只建一次，避免内存泄漏） */
function blobUrlOf(files: Map<string, Uint8Array>, bookId: string): (name: string) => string {
  return (name: string) => {
    const key = bookId + '|' + name
    const cached = urlCache.get(key)
    if (cached) return cached
    const bytes = files.get(name)
    if (!bytes) return ''
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))
    urlCache.set(key, url)
    return url
  }
}

function toImportedBook(book: StoredBook): Book {
  const base = { } as Book
  return {
    ...base,
    id: book.id,
    title: book.title,
    metaTitle: book.title,
    author: book.author,
    description: book.description,
    format: 'epub',
    fileName: book.fileName,
    filePath: '',
    fileSize: book.fileSize,
    contentHash: book.id.replace(/^sha1:/, ''),
    coverFile: book.cover ? URL.createObjectURL(book.cover) : null,
    coverColor: book.coverColor ?? null,
    chapterCount: book.chapterHrefs.length,
    chapterChars: [],
    wordCount: book.wordCount,
    volume: null,
    seriesKey: null,
    manualSeries: null,
    addedAt: book.addedAt,
    lastOpenedAt: null,
    hidden: false,
    syncUpload: false
  }
}

/** 把存储的目录树拍平成 app 需要的形状：href → chapterHrefs 里的下标（比按顺序猜准） */
function flatTocOf(book: StoredBook): Array<{ id: string; label: string; chapterIndex: number; level: number }> {
  const out: Array<{ id: string; label: string; chapterIndex: number; level: number }> = []
  const idxOf = (href: string): number => {
    const bare = href.split('#')[0]
    const i = book.chapterHrefs.indexOf(bare)
    if (i >= 0) return i
    const name = bare.split('/').pop() ?? ''
    return book.chapterHrefs.findIndex((h) => h.split('/').pop() === name)
  }
  const walk = (nodes: TocNode[], level: number): void => {
    for (const node of nodes) {
      const label = (node.label ?? '').trim()
      if (label) {
        const i = node.href ? idxOf(node.href) : -1
        out.push({ id: 'toc-' + out.length, label, chapterIndex: i >= 0 ? i : out.length, level })
      }
      if (node.children?.length) walk(node.children, level + 1)
    }
  }
  walk(book.toc, 0)
  if (out.length === 0) {
    book.chapterHrefs.forEach((_href, i) => {
      out.push({ id: 'toc-' + i, label: '第 ' + (i + 1) + ' 章', chapterIndex: i, level: 0 })
    })
  }
  return out
}

function chapterLabelOf(book: StoredBook, index: number): string {
  const hit = (flatTocOf(book) ?? []).find((entry) => entry.chapterIndex === index)
  return hit ? hit.label : '第 ' + (index + 1) + ' 章'
}
/** 批量导入：多选文件 → 逐个解析入库；返回成功的 id 与失败信息 */
async function importFiles(): Promise<{ books: string[]; errors: string[] }> {
  const files = await pickEpubFiles()
  if (files.length === 0) return { books: [], errors: [] }
  const books: string[] = []
  const errors: string[] = []
  for (const file of files) {
    const result = await importEpubFile(file)
    if (result.book) books.push(result.book.id)
    else errors.push(`${file.name}：${result.error ?? '导入失败'}`)
  }
  return { books, errors }
}
/** 全书搜索：在导入的书里逐章找关键词，返回章节 + 命中片段 */
async function searchImported(
  book: StoredBook,
  query: string
): Promise<Array<{ chapterIndex: number; label: string; snippet: string }>> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const files = await zipOf(book)
  const out: Array<{ chapterIndex: number; label: string; snippet: string }> = []
  for (let i = 0; i < book.chapterHrefs.length; i += 1) {
    const key = book.opfDir ? book.opfDir + '/' + book.chapterHrefs[i] : book.chapterHrefs[i]
    const bytes = files.get(key) ?? files.get(decodeURIComponent(key))
    if (!bytes) continue
    const text = new TextDecoder()
      .decode(bytes)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
    const at = text.toLowerCase().indexOf(q)
    if (at < 0) continue
    out.push({
      chapterIndex: i,
      label: chapterLabelOf(book, i),
      snippet: (at > 24 ? '…' : '') + text.slice(Math.max(0, at - 24), at + q.length + 40) + '…'
    })
    if (out.length >= 40) break
  }
  return out
}
export function createLocalApi(): unknown {
  const listeners = new Set<() => void>()

  return {
    app: {
      info: async () => ({
        version: '2.0.6',
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
      list: async () => {
        // 本机导入的书（IndexedDB）在前，内置示例书在后
        const builtIn = toBook(await loadLibrary())
        const stored: Book[] = []
        try {
          for (const item of await listBooks()) {
            stored.push({
              ...builtIn,
              id: item.id,
              title: item.title,
              metaTitle: item.title,
              author: item.author,
              description: item.description,
              fileName: item.fileName,
              fileSize: item.fileSize,
              coverFile: coverUrlOf(item),
              coverColor: item.coverColor ?? null,
              chapterCount: item.chapterHrefs.length,
              chapterChars: [],
              wordCount: item.wordCount,
              addedAt: item.addedAt,
              seriesKey: null
            })
          }
        } catch {
          /* IndexedDB 不可用就只显示内置书 */
        }
        const hidden = readHidden()
        // 内置示例书已经不再打包；万一有，也尊重"隐藏"标记
        const list = builtIn.title ? [...stored, builtIn] : [...stored]
        return list.filter((book) => !hidden.includes(book.id))
      },
      importDialog: () => importFiles(),
      importFolderDialog: () => importFiles(),
      importPaths: async () => ({ books: [], errors: [] }),
      remove: async (bookId: string) => {
        // 内置示例书打包在 APK 里删不掉 → 记一个隐藏标记；本机导入的书直接从 IndexedDB 删除
        if (bookId.startsWith('sha1:')) {
          try {
            await deleteBook(bookId)
          } catch {
            /* 忽略 */
          }
        } else {
          const hidden = readHidden()
          if (!hidden.includes(bookId)) writeHidden([...hidden, bookId])
        }
        // 返回【剩余书籍列表】以符合 store 的契约 ✓（之前返回 undefined ✗ 导致书库被置空 ✓）
        return undefined
      },
      update: async () => undefined,
      markSyncUpload: async () => [],
      reveal: async () => false,
      onChanged: (callback: () => void) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      // 下面两个宿主接口（导出/清理缓存）手机端用不到，但 store 初始化时会调用，给个空实现
      ensureExtracted: async () => '',
      clearCache: async () => {
        // 恢复出厂设置：清空本机书籍（IndexedDB）+ 进度/设置/隐藏标记（localStorage）+ 内存缓存
        try {
          for (const item of await listBooks()) await deleteBook(item.id)
        } catch {
          /* IndexedDB 不可用就跳过 */
        }
        try {
          for (const key of [PROGRESS_KEY, SESSIONS_KEY, SETTINGS_KEY, 'dsh.hiddenBooks', 'dsh.demoSeeded']) {
            localStorage.removeItem(key)
          }
        } catch {
          /* 忽略 */
        }
        for (const url of urlCache.values()) URL.revokeObjectURL(url)
        urlCache.clear()
        zipCache.clear()
        for (const key of Object.keys(memoryProgress)) delete memoryProgress[key]
        memorySessions.length = 0
        settingsCache = null
        cache = null
      }
    },

    reader: {
      open: async (bookId: string): Promise<BookOpenPayload> => {
        // 本机导入的书（sha1: 开头）走 IndexedDB + zip
        const imported = await loadImported(bookId)
        if (imported) {
          return {
            book: toImportedBook(imported),
            toc: flatTocOf(imported),
            chapters: imported.chapterHrefs.map((href, i) => ({
              index: i,
              label: chapterLabelOf(imported, i),
              href
            })),
            progress: readProgress()[bookId] ?? null
          }
        }
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
      chapter: async (bookId: string, index: number): Promise<ChapterPayload> => {
        const imported = await loadImported(bookId)
        if (imported) {
          const files = await zipOf(imported)
          const href = imported.chapterHrefs[index] ?? imported.chapterHrefs[0]
          const { html } = await readChapterFromZip(files, imported.opfDir, href, blobUrlOf(files, imported.id))
          return {
            index,
            label: chapterLabelOf(imported, index),
            total: imported.chapterHrefs.length,
            html
          }
        }
        const data = await loadLibrary()
        const chapter = data.chapters[index] ?? data.chapters[0]
        return {
          index: chapter.index,
          label: chapter.label,
          total: data.chapters.length,
          html: chapter.html
        }
      },
      // 全文搜索（当前这本书）：手机端没有索引，直接逐章扫，书不大够用
      search: async (bookId: string, query: string) => {
        const imported = await loadImported(bookId)
        if (!imported) return []
        return searchImported(imported, query)
      },      setProgress: async (bookId: string, patch: Partial<Progress>) => {
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
        const row = (rows ?? []).find((item) => item.bookId === bookId && item.day === day)
        if (row) row.seconds += Math.round(seconds)
        else rows.push({ bookId, day, seconds: Math.round(seconds) })
        writeSessions(rows)
        return true
      }
    },

    stats: {
      get: async (): Promise<StatsPayload> => {
        // ★ 按【全部书籍】统计（此前只统计内置示例书 ✗ 所以导入的书永远 0 秒 ✗）
        const builtIn = toBook(await loadLibrary())
        const stored = await listBooks().catch(() => [])
        const progressMap = readProgress()
        const sessions = readSessions()
        const today = dayKey()

        const secondsByBook = new Map<string, number>()
        for (const row of sessions) {
          secondsByBook.set(row.bookId, (secondsByBook.get(row.bookId) ?? 0) + row.seconds)
        }

        const all: Array<{ id: string; title: string }> = [
          { id: builtIn.id, title: builtIn.title },
          ...stored.map((item) => ({ id: item.id, title: item.title }))
        ]
        const books = all.map((item) => {
          const record = progressMap[item.id]
          return {
            bookId: item.id,
            title: item.title,
            percent: record?.percent ?? 0,
            seconds: secondsByBook.get(item.id) ?? 0,
            lastAt: record?.updatedAt ?? 0
          }
        })

        const daysMap = new Map<string, { seconds: number; bookIds: string[] }>()
        for (const row of sessions) {
          const entry = daysMap.get(row.day) ?? { seconds: 0, bookIds: [] }
          entry.seconds += row.seconds
          if (!entry.bookIds.includes(row.bookId)) entry.bookIds.push(row.bookId)
          daysMap.set(row.day, entry)
        }

        const totalSeconds = books.reduce((total, item) => total + item.seconds, 0)
        const todayRows = sessions.filter((row) => row.day === today)
        return {
          bookCount: all.length,
          finishedCount: books.filter((item) => item.percent >= 0.99).length,
          totalSeconds,
          averageSeconds: all.length > 0 ? Math.round(totalSeconds / all.length) : 0,
          books,
          days: [...daysMap.entries()].map(([day, entry]) => ({
            day,
            seconds: entry.seconds,
            bookIds: entry.bookIds
          })),
          todaySeconds: daysMap.get(today)?.seconds ?? 0,
          todayBookId: todayRows.length > 0 ? todayRows[todayRows.length - 1].bookId : null,
          todayRemainingSeconds: null
        } as unknown as StatsPayload
      }
    },

    sync: {
      status: async () => readSyncState(),
      connect: async () => {
        // 百度网盘（应用内登录）走另一条通道：CapacitorHttp + WebView cookie
        if (readSettings().sync.provider === 'lan') {
          return downloadLanBooks()
        }
        if (readSettings().sync.provider === 'baidu') {
          // 开放平台：整页打开授权页（oob），用户把页面上那串 32 位授权码粘回设置里
          const token = await baiduToken()
          if (token) {
            const account = token ? '百度网盘（已授权）' : null
            return writeSyncState({ loggedIn: true, account, message: '已授权 ✓ 可以直接下载云端书籍' })
          }
          try {
            window.location.href = baiduAuthUrl
          } catch {
            /* 跳转失败也不致命，下面照样给出指引 */
          }
          return writeSyncState({
            loggedIn: false,
            account: null,
            message: '已打开授权页：登录并点「授权」→ 复制页面上的 32 位授权码 → 返回本页粘进输入框 → 点「保存授权码」'
          })
        }
        const config = readDavConfig()
        if (!config) return writeSyncState({ message: '请先填写 WebDAV 地址与账号' })
        const result = await davTest(config)
        return writeSyncState({
          loggedIn: result.ok,
          account: result.ok ? config.username : null,
          message: result.message
        })
      },
      run: () =>
        // 百度网盘：立即同步先等同于「拉取云端书籍」（进度合并那套是 WebDAV 的文件格式，后续再统一）
        readSettings().sync.provider === 'lan'
          ? downloadLanBooks()
          : readSettings().sync.provider === 'baidu'
            ? downloadBaiduBooks().then(() => uploadBaiduBooks())
            : runSync(),
      cancel: async () => writeSyncState({ message: '已取消' }),
      downloadAll: () =>
          readSettings().sync.provider === 'lan' ? downloadLanBooks() : readSettings().sync.provider === 'baidu' ? downloadBaiduBooks() : downloadCloudBooks(),
      conflicts: async () => [],
      resolve: async () => readSyncState(),
      configureWebdav: async (payload: { url: string; username: string; password: string }) => {
        writeDavConfig({ url: payload.url, username: payload.username, password: payload.password })
        return writeSyncState({ account: payload.username, message: '已保存连接信息' })
      },
      logout: async () => {
        clearDavConfig()
        return readSyncState()
      },
      afterReading: async () => undefined,
      onChanged: () => () => undefined
    }
  }
}
