import { CapacitorHttp } from '@capacitor/core'
import type { Progress, SyncState } from '@shared/types'

/**
 * 手机端 WebDAV 同步（v1：进度 + 阅读时长 双向合并）。
 *
 * 为什么要走 CapacitorHttp：WebView 里的 fetch 受 CORS 限制，
 * WebDAV 的 PROPFIND/PUT 请求浏览器根本发不出去（服务端不会给 CORS 头），
 * 必须用原生的 HTTP 通道绕过去。
 *
 * 同步文件：<WebDAV 目录>/dsh-mobile-sync.json
 * 合并规则：同一本书取 rev 更大（进度更靠后）的那份；每日阅读时长取较大值。
 */

const CONFIG_KEY = 'dsh.davConfig'
const STATE_KEY = 'dsh.syncState'
const FILE_NAME = 'dsh-mobile-sync.json'

export interface DavConfig {
  url: string
  username: string
  password: string
}

export interface SyncPayload {
  version: 1
  deviceId: string
  updatedAt: number
  progress: Record<string, Progress>
  sessions: Array<{ bookId: string; day: string; seconds: number }>
}

/* ---------------- 配置与状态 ---------------- */

export function readDavConfig(): DavConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DavConfig
    return parsed.url ? parsed : null
  } catch {
    return null
  }
}

export function writeDavConfig(config: DavConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    /* 忽略 */
  }
}

export function clearDavConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY)
    localStorage.removeItem(STATE_KEY)
  } catch {
    /* 忽略 */
  }
}

export function readSyncState(): SyncState {
  const base: SyncState = {
    phase: 'idle',
    loggedIn: false,
    account: null,
    lastSyncAt: null,
    tasks: [],
    transferred: 0,
    total: 0,
    message: null
  }
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return base
    return { ...base, ...(JSON.parse(raw) as Partial<SyncState>) }
  } catch {
    return base
  }
}

export function writeSyncState(patch: Partial<SyncState>): SyncState {
  const next = { ...readSyncState(), ...patch }
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(next))
  } catch {
    /* 忽略 */
  }
  return next
}

/* ---------------- HTTP ---------------- */

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function fileUrl(config: DavConfig): string {
  return `${normalize(config.url)}/${FILE_NAME}`
}

async function request(
  method: string,
  url: string,
  config: DavConfig,
  data?: string
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`
  }
  if (data !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  const response = await CapacitorHttp.request({
    url,
    method,
    headers,
    data,
    connectTimeout: 15000,
    readTimeout: 20000
  })
  const body =
    typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
  return { status: response.status, body }
}

/**
 * 连接测试。
 *
 * **不能用 PROPFIND**：Capacitor 的原生 HTTP 桥只允许
 * OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/PATCH —— 发 PROPFIND 或 MKCOL 会被桥直接拒绝
 * （报 "Expected one of [...] but was PROPFIND"，实测过）。
 * 所以这里用 GET 同步文件代替：404 = 目录可达但还没同步过；200 = 已有同步文件。
 */
export async function davTest(config: DavConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const { status } = await request('GET', fileUrl(config), config)
    if (status === 200) return { ok: true, message: '连接成功（云端已有同步文件）' }
    if (status === 404) return { ok: true, message: '连接成功（目录可达，还没有同步文件）' }
    if (status === 401 || status === 403)
      return { ok: false, message: '认证失败：账号要填完整邮箱，密码要用「应用密码」而不是登录密码' }
    if (status === 409) return { ok: false, message: '上级目录不存在：请先在网盘里建好这个文件夹' }
    return { ok: false, message: `服务器返回 ${status}` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function davRead(config: DavConfig): Promise<SyncPayload | null> {
  const { status, body } = await request('GET', fileUrl(config), config)
  if (status === 404) return null
  if (status < 200 || status >= 300) throw new Error(`读取云端失败：HTTP ${status}`)
  if (!body.trim()) return null
  return JSON.parse(body) as SyncPayload
}

async function davWrite(config: DavConfig, payload: SyncPayload): Promise<void> {
  const { status } = await request('PUT', fileUrl(config), config, JSON.stringify(payload))
  if (status < 200 || status >= 300) {
    if (status === 401 || status === 403) throw new Error('上传被拒（401/403）：检查账号与应用密码')
    if (status === 409) throw new Error('上传失败（409）：同步目录不存在，请先在网盘里新建文件夹')
    throw new Error(`写入云端失败：HTTP ${status}`)
  }
}

/* ---------------- 合并 ---------------- */

function deviceId(): string {
  try {
    const key = 'dsh.deviceId'
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const next = `mobile-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(key, next)
    return next
  } catch {
    return 'mobile'
  }
}

export function buildPayload(
  progress: Record<string, Progress>,
  sessions: Array<{ bookId: string; day: string; seconds: number }>
): SyncPayload {
  return { version: 1, deviceId: deviceId(), updatedAt: Date.now(), progress, sessions }
}

/** 合并云端与本地：进度取 rev 更大者，每日时长取较大值 */
export function mergePayload(
  local: SyncPayload,
  cloud: SyncPayload | null
): SyncPayload {
  if (!cloud) return local
  const progress: Record<string, Progress> = { ...cloud.progress }
  for (const [bookId, mine] of Object.entries(local.progress)) {
    const theirs = progress[bookId]
    if (!theirs) {
      progress[bookId] = mine
      continue
    }
    const mineRev = mine.rev ?? 0
    const theirsRev = theirs.rev ?? 0
    // rev 相同（或都没有）时，取更新时间较晚的一份
    progress[bookId] =
      mineRev > theirsRev || (mineRev === theirsRev && (mine.updatedAt ?? 0) > (theirs.updatedAt ?? 0))
        ? mine
        : theirs
  }

  const merged = new Map<string, number>()
  for (const row of [...cloud.sessions, ...local.sessions]) {
    const key = `${row.bookId}|${row.day}`
    merged.set(key, Math.max(merged.get(key) ?? 0, row.seconds))
  }

  return {
    version: 1,
    deviceId: local.deviceId,
    updatedAt: Date.now(),
    progress,
    sessions: [...merged.entries()].map(([key, seconds]) => {
      const [bookId, day] = key.split('|')
      return { bookId, day, seconds }
    })
  }
}

/** 一次完整同步：合并云端 → 写回云端 → 返回合并结果（调用方负责写回本地） */
export async function syncOnce(
  config: DavConfig,
  local: SyncPayload
): Promise<{ ok: boolean; message: string; merged: SyncPayload | null }> {
  try {
    const cloud = await davRead(config)
    const merged = mergePayload(local, cloud)
    await davWrite(config, merged)
    return { ok: true, message: cloud ? '同步完成（已合并云端）' : '同步完成（首次上传）', merged }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      merged: null
    }
  }
}
