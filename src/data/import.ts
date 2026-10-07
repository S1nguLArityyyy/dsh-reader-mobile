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

/** 让用户选文件（返回 null 表示用户取消） */
export function pickEpubFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.epub,application/epub+zip'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      input.remove()
      resolve(file)
    }
    // 部分机型取消选择不会触发 change，靠 focus 兜底（简单起见只在 change 里清理）
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
