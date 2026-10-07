/**
 * 纯 JS MD5（RFC 1321）。
 *
 * 为什么要自己写：安卓 WebView 没有内置 md5 ✗（crypto.subtle 只有 SHA 系列 ✓）
 * 而百度上传接口的 block_list 需要每一片的 md5 ✓
 * 之前的占位实现（32 个 0 ✗）导致 precreate/create 报 errno=10 ✓ —— 上传全部失败 ✓
 *
 * 用法：md5Hex(uint8Array) → 32 位小写十六进制
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]

/** K[i] = floor(abs(sin(i + 1)) * 2^32) —— 现算 ✓ 不硬编码 64 个常量 ✓ */
const K: number[] = []
for (let i = 0; i < 64; i += 1) {
  K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296))
}

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c))
}

export function md5Hex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const len = bytes.length
  // 补位：0x80 + 0x00…… 直到长度 ≡ 56 (mod 64) ✓ 末尾 8 字节小端写原始比特长度 ✓
  const withOne = len + 1
  const total = withOne + ((56 - (withOne % 64)) + 64) % 64 + 8
  const buffer = new Uint8Array(total)
  buffer.set(bytes)
  buffer[len] = 0x80
  const bitLen = len * 8
  const view = new DataView(buffer.buffer)
  view.setUint32(total - 8, bitLen >>> 0, true)
  view.setUint32(total - 4, Math.floor(bitLen / 4294967296) >>> 0, true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const M = new Uint32Array(16)
  for (let chunk = 0; chunk < total; chunk += 64) {
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(chunk + i * 4, true)
    let A = a0
    let B = b0
    let C = c0
    let D = d0
    for (let i = 0; i < 64; i += 1) {
      let F = 0
      let g = 0
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      F = (F + A + K[i] + M[g]) | 0
      A = D
      D = C
      C = B
      B = (B + rotl(F, S[i])) | 0
    }
    a0 = (a0 + A) | 0
    b0 = (b0 + B) | 0
    c0 = (c0 + C) | 0
    d0 = (d0 + D) | 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0 >>> 0, true)
  outView.setUint32(4, b0 >>> 0, true)
  outView.setUint32(8, c0 >>> 0, true)
  outView.setUint32(12, d0 >>> 0, true)
  let hex = ''
  for (const byte of out) hex += byte.toString(16).padStart(2, '0')
  return hex
}