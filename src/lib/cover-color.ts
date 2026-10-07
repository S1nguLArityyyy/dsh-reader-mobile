/**
 * 从封面图取"主色"（用于详情页渐变、书架点缀）。
 *
 * 规则（关键是"忽略掉不该当选的颜色"）：
 *   · 跳过近黑（l<0.18）近白（l>0.88）与低饱和（s<0.18）的像素 —— 白底、黑线、灰阴影都不算主色 ✓
 *   · 把颜色量化到粗格子统计出现次数 ✓
 *   · 打分 = 出现次数 × (0.35 + 饱和度) × (1 - |明度 - 0.55|) ✓
 *     → 又常见、又鲜艳、明度居中的颜色胜出 ✓（正好适合做深色背景 + 白字 ✓）
 */
export async function dominantColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 48
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        const buckets = new Map<string, { n: number; r: number; g: number; b: number }>()
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]
          if (a < 200) continue
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const l = (max + min) / 510
          const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
          if (l < 0.18 || l > 0.88 || s < 0.18) continue
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`
          const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
          cur.n += 1
          cur.r += r
          cur.g += g
          cur.b += b
          buckets.set(key, cur)
        }
        let best: { score: number; r: number; g: number; b: number } | null = null
        for (const value of buckets.values()) {
          const r = value.r / value.n
          const g = value.g / value.n
          const b = value.b / value.n
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const l = (max + min) / 510
          const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
          const score = value.n * (0.35 + s) * (1 - Math.abs(l - 0.55))
          if (!best || score > best.score) best = { score, r, g, b }
        }
        if (!best) {
          resolve(null)
          return
        }
        const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
        resolve(`#${hex(best.r)}${hex(best.g)}${hex(best.b)}`)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}