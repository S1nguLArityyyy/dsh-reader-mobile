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
  /** 电脑端给出的内容指纹 ✓ 手机端下载【之前】就能跳过已有书 ✓ */
  hash?: string | null
  /** 电脑端算好的封面主色 ✓ 手机端直接沿用 ✓ */
  color?: string | null
  /** 电脑端给的原始文件名与书名，用于推导卷号；旧版服务端不提供 */
  title?: string | null
  originalName?: string | null
  volume?: string | null
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
export async function listLanBooks(base: string, haveHashes: string[] = []): Promise<{ ok: boolean; books: LanBook[]; message: string }> {
  const root = normalizeBase(base)
  if (!root) return { ok: false, books: [], message: '请先填电脑的局域网地址（如 http://192.168.0.102:8787）' }
  try {
    const response = await CapacitorHttp.request({
      url: haveHashes.length > 0 ? `${root}/books.json?have=${encodeURIComponent(haveHashes.join(','))}` : `${root}/books.json`,
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
        color: typeof item.color === 'string' && item.color ? item.color : null,
        hash: typeof item.hash === 'string' && item.hash ? item.hash : null,
        // 电脑端给的元信息：书名、原始文件名、卷号（这里是白名单映射，漏一个就传不到下游）
        title: typeof item.title === 'string' && item.title ? item.title : null,
        originalName: typeof item.originalName === 'string' && item.originalName ? item.originalName : null,
        volume: item.volume === null || item.volume === undefined ? null : String(item.volume)
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
  /** 电脑端手动标记的「已读完」：内容指纹 → 日期 */
  finished: Record<string, string>
  message: string
}> {
  const root = normalizeBase(base)
  if (!root) return { ok: false, progress: {}, sessions: [], finished: {}, message: '请先填电脑的局域网地址' }
  try {
    const response = await CapacitorHttp.request({
      url: `${root}/records`,
      method: 'GET',
      connectTimeout: 8000,
      readTimeout: 30000
    })
    if (response.status !== 200) {
      return { ok: false, progress: {}, sessions: [], finished: {}, message: `电脑端返回 HTTP ${response.status}` }
    }
    const body = asRecord(response.data)
    const progress = (body.progress ?? {}) as Record<string, Record<string, unknown>>
    const sessions = Array.isArray(body.sessions) ? (body.sessions as Array<Record<string, unknown>>) : []
    const finished = (body.finished ?? {}) as Record<string, string>
    return {
      ok: true,
      progress,
      sessions,
      finished,
      message: `电脑端记录：进度 ${Object.keys(progress).length} 条 · 时长 ${sessions.length} 条 · 读完 ${Object.keys(finished).length} 本`
    }
  } catch (error) {
    return { ok: false, progress: {}, sessions: [], finished: {}, message: `连不上电脑：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 把本机阅读记录推给电脑（POST /records，只合并不删除） */
export async function pushLanRecords(
  base: string,
  payload: {
    progress: Record<string, unknown>
    sessions: Array<Record<string, unknown>>
    /** 本机手动标记的「已读完」：已归一化的书 id → 日期 */
    finished?: Record<string, string>
  }
): Promise<{ ok: boolean; message: string; pendingConflicts: number }> {
  const root = normalizeBase(base)
  if (!root) return { ok: false, message: '请先填电脑的局域网地址', pendingConflicts: 0 }
  try {
    const response = await CapacitorHttp.request({
      url: `${root}/records`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      connectTimeout: 8000,
      readTimeout: 30000
    })
    const body = asRecord(response.data)
    if (response.status !== 200 || body.ok !== true) {
      return { ok: false, message: `电脑端返回 HTTP ${response.status}`, pendingConflicts: 0 }
    }
    // 电脑端把有冲突的那批记录暂缓了（等用户在电脑上裁决），这里如实告诉用户
    const pendingConflicts = Number(body.pendingConflicts ?? 0)
    if (pendingConflicts > 0) {
      return {
        ok: true,
        message: `电脑端有 ${pendingConflicts} 处进度冲突待你确认（去电脑上选完再同步）`,
        pendingConflicts
      }
    }
    return {
      ok: true,
      message: `已推给电脑：进度 +${String(body.progressMerged ?? 0)} · 时长 +${String(body.sessionsMerged ?? 0)}`,
      pendingConflicts: 0
    }
  } catch (error) {
    return { ok: false, message: `连不上电脑：${error instanceof Error ? error.message : String(error)}`, pendingConflicts: 0 }
  }
}
