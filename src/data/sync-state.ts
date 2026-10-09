import type { SyncState } from '@shared/types'

/**
 * 同步状态的读写（与传输方式无关：手机端现在只有局域网直传）。
 *
 * 为什么单独一个文件：这段代码原来和已经废弃的 WebDAV 实现挤在 data/sync.ts 里，
 * 拆开后传输层（data/lan.ts）与状态层各管各的。
 */

const STATE_KEY = 'dsh.syncState'

/**
 * 内存兜底：安卓 WebView 上 localStorage 可能不可用或被清掉，
 * 只写 localStorage 的话状态会**静默丢失**（表现是面板上的最后同步时间莫名回到空）。
 */
let memoryState: SyncState | null = null

export function readSyncState(): SyncState {
  if (memoryState) return memoryState
  const base: SyncState = {
    phase: 'idle',
    connected: false,
    deviceName: null,
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

/** 清空同步状态（退出登录 / 重置用） */
export function clearSyncState(): void {
  memoryState = null
  try {
    localStorage.removeItem(STATE_KEY)
  } catch {
    /* 忽略 */
  }
}
