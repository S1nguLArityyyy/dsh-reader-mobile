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

/** 配置不完整（缺密码）时也算"没配置好"，避免发出空密码请求换来一个看不懂的 401 */
/**
 * 内存兜底：安卓 WebView 上 localStorage 可能不可用或被清掉，
 * 只写 localStorage 的话「保存并连接」会**静默失效** —— 表现就是"填了密码、还是提示要配置 WebDAV"。
 */
let memoryConfig: DavConfig | null = null
let memoryState: SyncState | null = null

export function readDavConfig(): DavConfig | null {
  if (memoryConfig) return memoryConfig
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DavConfig
    if (!parsed.url) return null
    return {
      url: parsed.url.trim(),
      username: (parsed.username ?? '').trim(),
      password: (parsed.password ?? '').trim()
    }
  } catch {
    return null
  }
}

export function writeDavConfig(config: DavConfig): void {
  const cleanAll: DavConfig = {
    url: config.url.trim(),
    username: config.username.trim(),
    password: config.password.trim()
  }
  memoryConfig = cleanAll
  try {
    // 复制粘贴很容易带上首尾空格/换行 —— 统一清掉（这会让认证莫名失败）
    const clean: DavConfig = {
      url: config.url.trim(),
      username: config.username.trim(),
      password: config.password.trim()
    }
    memoryConfig = clean
    localStorage.setItem(CONFIG_KEY, JSON.stringify(clean))
  } catch {
    /* localStorage 不可用也没关系：内存里已经有一份 */
  }
}

export function clearDavConfig(): void {
  memoryConfig = null
  memoryState = null
  try {
    localStorage.removeItem(CONFIG_KEY)
    localStorage.removeItem(STATE_KEY)
  } catch {
    /* 忽略 */
  }
}

export function readSyncState(): SyncState {
  if (memoryState) return memoryState
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

/** 上次落盘时间：进度类更新只写内存 ✓ 落盘节流 ✓ */
let lastPersistAt = 0

export function writeSyncState(patch: Partial<SyncState>): SyncState {
  const next = { ...readSyncState(), ...patch }
  memoryState = next
  /*
   * 面板显示的进度是高频更新（每 1MB 一次 ✗）
   * 此前每次都写 localStorage ✗ → 原生桥被写操作占住 → 界面看着"不动" ✓（用户反馈 ✓）
   * 现在：内存永远是最新的 ✓（readSyncState 优先读内存 ✓）
   *       落盘节流到约 0.9 秒一次 ✓ 且同步结束（非 running）时必定落盘一次 ✓
   */
  const running = next.phase === 'running' || next.phase === 'checking'
  const now = Date.now()
  if (!running || now - lastPersistAt > 900) {
    lastPersistAt = now
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(next))
    } catch {
      /* 内存里有一份 */
    }
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
    if (status === 401 || status === 403) throw new Error('云端认证失败（401/403）：请到 设置→同步 填好应用密码后点「保存并连接」（只点「连接」不会保存密码）')
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

/* ---------------- 书籍文件（二进制） ---------------- */

/** 与桌面端的命名规则一致（已在服务器上核对）：sha1:abc… → sha1%3Aabc….epub */
export function cloudBookName(key: string): string {
  return `${encodeURIComponent(key)}.epub`
}

async function requestBinary(url: string, config: DavConfig): Promise<Uint8Array | null> {
  const response = await CapacitorHttp.request({
    url,
    method: 'GET',
    headers: { Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}` },
    responseType: 'arraybuffer',
    connectTimeout: 15000,
    readTimeout: 180000
  })
  if (response.status !== 200) return null
  const data = response.data as unknown
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === 'string') {
    // 安卓端 responseType=arraybuffer 会以 base64 字符串回来
    const bin = atob(data)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }
  return null
}

/** 云端书籍清单：manifest.json 的 files 段（key → 标题/作者/大小） */
export async function davReadManifest(
  config: DavConfig
): Promise<Record<string, { title?: string; author?: string; size?: number }>> {
  try {
    const { status, body } = await request('GET', `${normalize(config.url)}/manifest.json`, config)
    if (status !== 200 || !body.trim()) return {}
    const parsed = JSON.parse(body) as {
      files?: Record<string, { title?: string; author?: string; size?: number }>
    }
    return parsed.files ?? {}
  } catch {
    return {}
  }
}

/** 下载一本书的原始 EPUB 字节 */
export async function davReadBook(config: DavConfig, key: string): Promise<Uint8Array | null> {
  try {
    return await requestBinary(`${normalize(config.url)}/books/${cloudBookName(key)}`, config)
  } catch {
    return null
  }
}
