import { CapacitorHttp } from '@capacitor/core'

/**
 * 局域网直传（手机 ↔ 电脑，同一个 WiFi）。
 *
 * 电脑端服务（DshReader 桌面版自动启动，端口 8787）：
 *   GET /books.json            → { count, books: [{ name, size, modifiedAt }] }
 *   GET /books/<文件名>.epub    → 文件字节
 *
 * 手机拿到 epub 后由 importEpubBytes 自己解析标题/封面/章数 ✓
 * 所以不需要清单文件、也不需要网盘 ✓ 速度就是 WiFi 的速度 ✓
 */

export interface LanBook {
  name: string
  size: number
  /** 电脑端算好的封面主色 ✓ 手机端直接沿用 ✓ */
  color?: string | null
}

function normalizeBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return `http://${trimmed}`
  return trimmed
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (value ?? {}) as Record<string, unknown>
}

/** 列出电脑书库里的书 */
export async function listLanBooks(base: string): Promise<{ ok: boolean; books: LanBook[]; message: string }> {
  const root = normalizeBase(base)
  if (!root) return { ok: false, books: [], message: '请先填电脑的局域网地址（如 http://192.168.0.102:8787）' }
  try {
    const response = await CapacitorHttp.request({
      url: `${root}/books.json`,
      method: 'GET',
      connectTimeout: 8000,
      readTimeout: 30000
    })
    if (response.status !== 200) {
      return { ok: false, books: [], message: `电脑端返回 HTTP ${response.status}（地址对吗？电脑端开着吗？）` }
    }
    const body = asRecord(response.data)
    const list = Array.isArray(body.books) ? (body.books as Array<Record<string, unknown>>) : []
    const books = list
      .map((item) => ({
        name: String(item.name ?? ''),
        size: Number(item.size ?? 0),
        color: typeof item.color === 'string' && item.color ? item.color : null
      }))
      .filter((item) => item.name.length > 0)
    return { ok: true, books, message: `电脑上有 ${books.length} 本书` }
  } catch (error) {
    return {
      ok: false,
      books: [],
      message: `连不上电脑：${error instanceof Error ? error.message : String(error)}（同一 WiFi？防火墙？）`
    }
  }
}

/** 拉一本书的字节 */
export async function fetchLanBook(base: string, name: string): Promise<Uint8Array | null> {
  const root = normalizeBase(base)
  try {
    const response = await CapacitorHttp.request({
      url: `${root}/books/${encodeURIComponent(name)}`,
      method: 'GET',
      responseType: 'arraybuffer',
      connectTimeout: 8000,
      readTimeout: 120000
    })
    if (response.status !== 200) return null
    const data = response.data as unknown
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    if (typeof data === 'string') {
      const bin = atob(data)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
      return out
    }
    return null
  } catch {
    return null
  }
}

/** 拉取电脑端的阅读记录（GET /records ✓ 只读 ✓ 毫秒级 ✓ 不经网盘 ✓） */
export async function fetchLanRecords(base: string): Promise<{
  ok: boolean
  progress: Record<string, Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
  message: string
}> {
  const root = normalizeBase(base)
  if (!root) return { ok: false, progress: {}, sessions: [], message: '请先填电脑的局域网地址' }
  try {
    const response = await CapacitorHttp.request({
      url: `${root}/records`,
      method: 'GET',
      connectTimeout: 8000,
      readTimeout: 30000
    })
    if (response.status !== 200) {
      return { ok: false, progress: {}, sessions: [], message: `电脑端返回 HTTP ${response.status}` }
    }
    const body = asRecord(response.data)
    const progress = (body.progress ?? {}) as Record<string, Record<string, unknown>>
    const sessions = Array.isArray(body.sessions) ? (body.sessions as Array<Record<string, unknown>>) : []
    return { ok: true, progress, sessions, message: `电脑端记录：进度 ${Object.keys(progress).length} 条 · 时长 ${sessions.length} 条` }
  } catch (error) {
    return { ok: false, progress: {}, sessions: [], message: `连不上电脑：${error instanceof Error ? error.message : String(error)}` }
  }
}