/**
 * 从封面图取"主色"。
 *
 * ★ 本文件是桌面端 `src/main/textstats.ts` 的 `coverColorOf` 的【逐行等价移植】★
 *   桌面端: nativeImage.resize(16,16) → 逐像素打分 → 取分数最高的像素
 *   手机端: canvas 画到 16×16 → getImageData → 同样的打分 → 取分数最高的像素
 * 两边算法完全一致 ✓ 所以同一本书在两端会得到同样的主色 ✓
 *
 * 打分（与桌面端一致）：
 *   saturation = (max - min) / max          （HSV 口径）
 *   value      = max / 255
 *   score      = saturation * 2 + value - |value - 0.55| * 1.4
 * 含义：偏好在【中等明度】上取【高饱和】的颜色 ✓ 避免纯黑/纯白边缘 ✓
 */

export async function dominantColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        // 与桌面端相同的 16×16 采样（一致性优先 ✓）
        const size = 16
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        let best = { score: -1, r: 0, g: 0, b: 0 }
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0
          const g = data[i + 1] ?? 0
          const b = data[i + 2] ?? 0
          const a = data[i + 3] ?? 255
          if (a < 180) continue
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const saturation = max === 0 ? 0 : (max - min) / max
          const value = max / 255
          const score = saturation * 2 + value - Math.abs(value - 0.55) * 1.4
          if (score > best.score) best = { score, r, g, b }
        }
        if (best.score < 0) {
          resolve(null)
          return
        }
        const hex = (v: number): string =>
          Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
        resolve(`#${hex(best.r)}${hex(best.g)}${hex(best.b)}`)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}