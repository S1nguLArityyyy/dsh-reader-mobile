import { unzipSync } from 'fflate'
import { readEpubMetaFromBytes } from './epub'
import { putBook, sha1Hex, type StoredBook } from './db'

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

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length
}

/** 解析并入库；重复导入同一文件会按 sha1 覆盖（不会产生两本） */
export async function importEpubFile(file: File): Promise<ImportResult> {
  try {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const id = `sha1:${await sha1Hex(bytes)}`

    const meta = await readEpubMetaFromBytes(bytes)
    const files = unzipSync(bytes)
    // 粗略统计字数：只解压 spine 里的 html 条目，避免整本解压（大书会卡）
    let wordCount = 0
    for (const href of meta.chapterHrefs) {
      const key = meta.opfDir ? `${meta.opfDir}/${href}` : href
      const entry = files[key]
      if (entry) wordCount += countWords(new TextDecoder().decode(entry))
    }

    const record: StoredBook = {
      id,
      title: meta.title || file.name.replace(/\.epub$/i, ''),
      author: meta.author,
      description: meta.description,
      fileName: file.name,
      fileSize: file.size,
      cover: meta.coverData ? new Blob([meta.coverData as unknown as BlobPart]) : null,
      coverExt: meta.coverExt,
      epub: buf,
      chapterHrefs: meta.chapterHrefs,
      opfPath: meta.opfPath,
      opfDir: meta.opfDir,
      toc: meta.toc,
      wordCount,
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
    let wordCount = 0
    for (const href of meta.chapterHrefs) {
      const key = meta.opfDir ? `${meta.opfDir}/${href}` : href
      const entry = files[key]
      if (entry) wordCount += countWords(new TextDecoder().decode(entry))
    }
    const record: StoredBook = {
      id,
      title: meta.title || fileName.replace(/\.epub$/i, ''),
      author: meta.author,
      description: meta.description,
      fileName,
      fileSize: bytes.byteLength,
      cover: meta.coverData ? new Blob([meta.coverData as unknown as BlobPart]) : null,
      coverExt: meta.coverExt,
      epub: buf,
      chapterHrefs: meta.chapterHrefs,
      opfPath: meta.opfPath,
      opfDir: meta.opfDir,
      toc: meta.toc,
      wordCount,
      addedAt: Date.now()
    }
    await putBook(record)
    return { book: record, error: null }
  } catch (error) {
    return { book: null, error: error instanceof Error ? error.message : String(error) }
  }
}