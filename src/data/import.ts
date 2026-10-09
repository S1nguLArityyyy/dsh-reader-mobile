import { dominantColor } from '../lib/cover-color'
import { unzipSync } from 'fflate'
import { readEpubMetaFromBytes } from './epub'
import { CHARS_ALGO_VERSION, listBooks, putBook, sha1Hex, type StoredBook, type StoredChapterChars } from './db'

/**
 * 导入一个本地 EPUB 文件。
 *
 * 手机上选文件**不需要任何插件**：`<input type="file" accept=".epub">`
 * 在 Capacitor 的 WebView 里会直接调起安卓文件选择器，拿到的 File 用
 * `arrayBuffer()` 就是 EPUB 字节。所以这里只用一个隐藏 input。
 */
export interface ImportResult {
  book: StoredBook | null
  error: string | null
}

/** 让用户选文件（支持多选批量导入；返回空数组表示取消） */
export function pickEpubFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.epub,application/epub+zip'
    input.multiple = true
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const files = [...(input.files ?? [])]
      input.remove()
      resolve(files)
    }
    input.click()
  })
}

/**
 * 统计一段 XHTML 里的可见字符数。
 * ★ 与桌面端 src/main/textstats.ts 的 countVisibleChars 保持完全一致 ★
 * 两端口径不同的话，同一个阅读位置会算出不同的整书进度（用户会看到两个百分比）。
 */
export function countVisibleChars(html: string): number {
  const withoutHidden = html.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const text = withoutHidden
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
  return text.replace(/\s+/g, '').length
}

/** 逐章统计字数（带算法版本，版本变了会被重算） */
function chapterCharsOf(meta: { chapterHrefs: string[]; opfDir: string }, files: Record<string, Uint8Array>): StoredChapterChars {
  const counts: number[] = []
  for (const href of meta.chapterHrefs) {
    const key = meta.opfDir ? `${meta.opfDir}/${href}` : href
    const entry = files[key]
    counts.push(entry ? countVisibleChars(new TextDecoder().decode(entry)) : 0)
  }
  return { v: CHARS_ALGO_VERSION, counts }
}

/** 解析并入库；重复导入同一文件会按 sha1 覆盖（不会产生两本） */
export async function importEpubFile(file: File): Promise<ImportResult> {
  try {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const id = `sha1:${await sha1Hex(bytes)}`

    const meta = await readEpubMetaFromBytes(bytes)
    const files = unzipSync(bytes)
    // ★ 每章分别统计 ★ 整书进度要按章节字数加权（按序号等分会让前置彩页虚增进度）
    const chapterChars = chapterCharsOf(meta, files)
    const wordCount = chapterChars.counts.reduce((sum, n) => sum + n, 0)

    const record: StoredBook = {
      id,
      title: meta.title || file.name.replace(/\.epub$/i, ''),
      author: meta.author,
      description: meta.description,
      fileName: file.name,
      fileSize: file.size,
      cover: meta.coverData ? new Blob([meta.coverData as unknown as BlobPart]) : null,
      coverExt: meta.coverExt,
      // 从封面图取主色（详情页渐变用）：手机端此前从未计算过 ✗ 只能回退到"按书名哈希"的伪随机色 ✗
      coverColor: meta.coverData ? await coverColorOf(meta.coverData, meta.coverExt) : null,
      epub: buf,
      chapterHrefs: meta.chapterHrefs,
      opfPath: meta.opfPath,
      opfDir: meta.opfDir,
      toc: meta.toc,
      wordCount,
      chapterChars,
      addedAt: Date.now()
    }
    await putBook(record)
    return { book: record, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { book: null, error: `导入失败：${message}` }
  }
}

/** 封面 blob → 可显示的 URL（每次列书时生成；brl 刷新后重建） */
export function coverUrlOf(book: StoredBook): string | null {
  return book.cover ? URL.createObjectURL(book.cover) : null
}

/** 从字节导入（同步下载云端书籍时用；和"选文件导入"走同一条入库路径） */
export async function importEpubBytes(
  bytes: Uint8Array,
  fileName: string,
  forcedId?: string
): Promise<ImportResult> {
  try {
    const copy = bytes.slice()
    const buf = copy.buffer as ArrayBuffer
    const id = forcedId ?? `sha1:${await sha1Hex(bytes)}`
    const meta = await readEpubMetaFromBytes(bytes)
    const files = unzipSync(bytes)
    // ★ 每章分别统计 ★ 整书进度要按章节字数加权（按序号等分会让前置彩页虚增进度）
    const chapterChars = chapterCharsOf(meta, files)
    const wordCount = chapterChars.counts.reduce((sum, n) => sum + n, 0)
    const record: StoredBook = {
      id,
      title: meta.title || fileName.replace(/\.epub$/i, ''),
      author: meta.author,
      description: meta.description,
      fileName,
      fileSize: bytes.byteLength,
      cover: meta.coverData ? new Blob([meta.coverData as unknown as BlobPart]) : null,
      coverExt: meta.coverExt,
      // 从封面图取主色（详情页渐变用）：手机端此前从未计算过 ✗ 只能回退到"按书名哈希"的伪随机色 ✗
      coverColor: meta.coverData ? await coverColorOf(meta.coverData, meta.coverExt) : null,
      epub: buf,
      chapterHrefs: meta.chapterHrefs,
      opfPath: meta.opfPath,
      opfDir: meta.opfDir,
      toc: meta.toc,
      wordCount,
      chapterChars,
      addedAt: Date.now()
    }
    await putBook(record)
    return { book: record, error: null }
  } catch (error) {
    return { book: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 由封面字节算出主色（转成对象 URL → canvas 取样 → 主色 ✓ 用完立即释放 ✓） */
async function coverColorOf(data: unknown, ext: string | null | undefined): Promise<string | null> {
  try {
    const blob = new Blob([data as BlobPart], { type: ext === 'png' ? 'image/png' : 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    const color = await dominantColor(url)
    URL.revokeObjectURL(url)
    return color
  } catch {
    return null
  }
}

/**
 * 给【还没有主色】的书补算封面主色（旧版本导入的书 ✗ 记录里没有该字段 ✓）。
 * 每本算完立即写回 IndexedDB ✓ 所以中断也不会白算 ✓。
 * 返回补算的本数。
 */
export async function backfillCoverColors(): Promise<number> {
  const books = await listBooks()
  let fixed = 0
  for (const book of books) {
    if (!book.cover) continue // 注意：不再跳过"已有颜色"的书 ✓ 这样能覆盖旧算法算错的颜色 ✓
    const url = URL.createObjectURL(book.cover)
    const color = await dominantColor(url)
    URL.revokeObjectURL(url)
    if (!color) continue
    await putBook({ ...book, coverColor: color })
    fixed += 1
  }
  return fixed
}

/**
 * 给【还没有每章字数】的书补算 chapterChars。
 *
 * 为什么必须补：整书进度按章节字数加权，缺这份数据就会退回"按章节序号等分"，
 * 于是前置彩页（几乎没字）也会各占 1/N，读几页就显示"全书过半"（用户反馈的 bug）。
 * 旧版本存的书没有这个字段，只能从存下来的 EPUB 字节重新统计一次。
 * 每本算完立即写回 ✓ 中断也不会白算 ✓ 返回补算的本数。
 */
export async function backfillChapterChars(): Promise<number> {
  const books = await listBooks()
  let fixed = 0
  for (const book of books) {
    // 已有【当前算法版本】的结果就跳过；老数据（无字段 / 旧版本 / 旧数组格式）一律重算
    const existing = book.chapterChars
    if (existing && !Array.isArray(existing) && existing.v === CHARS_ALGO_VERSION && existing.counts.length > 0) {
      continue
    }
    try {
      const files = unzipSync(new Uint8Array(book.epub))
      const stored = chapterCharsOf(book, files)
      if (stored.counts.length === 0) continue
      await putBook({
        ...book,
        chapterChars: stored,
        // 顺手把总字数校准成各章之和，和电脑端的口径保持一致
        wordCount: stored.counts.reduce((sum, n) => sum + n, 0)
      })
      fixed += 1
    } catch {
      /* 解包失败就跳过这本，不影响其它书 */
    }
  }
  return fixed
}
