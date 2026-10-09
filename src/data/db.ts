import type { TocNode } from '../shared/types'

/**
 * 手机端本地书库存储（IndexedDB）。
 *
 * 为什么不落地文件：Capacitor 的 WebView 里直接读 File 字节最省事，
 * 存原始 EPUB 字节 + 解析好的元数据，打开书时再解包。
 * 用 IndexedDB 而不是 localStorage —— 一本书几十 MB，localStorage 存不下。
 */

const DB_NAME = 'dsh-reader'
const DB_VERSION = 1
const STORE = 'books'

export interface StoredBook {
  id: string
  title: string
  author: string
  description: string
  fileName: string
  volume?: string | null
  fileSize: number
  cover: Blob | null
  coverExt: string | null
  /** 封面主色（导入时算好 ✓ 详情页渐变用 ✓） */
  coverColor: string | null
  /** 原始 EPUB 字节（打开书时再解包） */
  epub: ArrayBuffer
  chapterHrefs: string[]
  opfPath: string
  opfDir: string
  toc: TocNode[]
  wordCount: number
  /**
   * 每章可见字符数：整书进度必须按它加权，
   * 否则前置彩页（几乎没字）会按"章节序号"吃掉一大截进度。
   * v 是算字算法版本，与当前版本不一致时会重算（老数据没有这个字段，也会被补算）。
   */
  chapterChars?: StoredChapterChars
  addedAt: number
  /** 用户手动标记为已读完 */
  finished?: boolean
}

/** 每章字数 + 算法版本（版本变了要重算，否则两端进度口径不一致） */
export interface StoredChapterChars {
  v: number
  counts: number[]
}

/** 当前算字算法版本：改 countVisibleChars 的实现时必须 +1，否则旧数据不会重算 */
export const CHARS_ALGO_VERSION = 2

/** 读每章字数：兼容早期的纯数组格式 */
export function readChapterChars(stored: StoredChapterChars | number[] | undefined): number[] | null {
  if (!stored) return null
  if (Array.isArray(stored)) return stored.length > 0 ? stored : null
  if (stored.v !== CHARS_ALGO_VERSION) return null
  return stored.counts.length > 0 ? stored.counts : null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('打开本地书库失败'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('本地书库操作失败'))
      })
  )
}

export const putBook = (book: StoredBook): Promise<IDBValidKey> => tx('readwrite', (s) => s.put(book))

export const getBook = (id: string): Promise<StoredBook | undefined> =>
  tx<StoredBook | undefined>('readonly', (s) => s.get(id) as IDBRequest<StoredBook | undefined>)

export const listBooks = (): Promise<StoredBook[]> =>
  tx<StoredBook[]>('readonly', (s) => s.getAll() as IDBRequest<StoredBook[]>)

export const deleteBook = (id: string): Promise<undefined> =>
  tx<undefined>('readwrite', (s) => s.delete(id) as IDBRequest<undefined>)

/** 文件 sha1（和桌面端一致：id 用 sha1:<hash>，以后网盘同步不会重复导入） */
export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  // 类型体操：TS 5.7 起 Uint8Array 带泛型，运行时直接传字节即可
  const digest = await crypto.subtle.digest('SHA-1', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
