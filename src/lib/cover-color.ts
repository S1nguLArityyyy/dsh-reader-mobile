/**
 * 从封面图取"主色"（详情页渐变、书架点缀用）。
 *
 * 三条关键规则（都是被真实封面教出来的）：
 *   ① 跳过近黑/近白/低饱和的像素（白底、黑描边、灰阴影都不该当选）
 *      —— 阈值放宽到 s<0.12、l 在 0.12~0.92 之间 ✓（浅蓝背景才能入选 ✓）
 *   ② 忽略图片【底部 20%】✗ —— 出版社色条 / logo / 条码常是深红色 ✓
 *      之前正是它被选成了"主色"✓ 导致浅蓝封面的详情页变成暗红 ✗
 *   ③ 先求整图平均色，再给"色相接近平均色"的候选加分 ✓
 *      —— 整图偏冷白时，暖棕的肤色阴影就不会胜出 ✓
 *
 * 打分 = 出现次数 × (0.3 + 饱和度) × (1 - |明度 - 0.55|) × (1 + 1.2 × 色相接近度)
 */

interface Hsl {
  h: number
  s: number
  l: number
}

function toHsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 510
  const d = max - min
  const s = d === 0 ? 0 : d / (255 - Math.abs(max + min - 255))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h, s, l }
}

/** 两个色相的接近度（0~1，跨 360 度环绕） */
function hueSim(a: number, b: number): number {
  const diff = Math.abs(a - b)
  const wrapped = Math.min(diff, 360 - diff)
  return Math.max(0, 1 - wrapped / 120)
}

export async function dominantColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 56
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
        // 第一遍：收集合格像素，同时求整图平均色
        const kept: Array<{ r: number; g: number; b: number }> = []
        let sr = 0
        let sg = 0
        let sb = 0
        const bottomStart = Math.floor(size * 0.8)
        for (let y = 0; y < size; y += 1) {
          if (y >= bottomStart) continue // ② 忽略底部 20%
          for (let x = 0; x < size; x += 1) {
            const i = (y * size + x) * 4
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const a = data[i + 3]
            if (a < 200) continue
            const { s, l } = toHsl(r, g, b)
            if (l < 0.12 || l > 0.92 || s < 0.12) continue
            kept.push({ r, g, b })
            sr += r
            sg += g
            sb += b
          }
        }
        if (kept.length === 0) {
          resolve(null)
          return
        }
        const meanHue = toHsl(sr / kept.length, sg / kept.length, sb / kept.length).h
        // 第二遍：粗格子统计 + 打分
        const buckets = new Map<string, { n: number; r: number; g: number; b: number }>()
        for (const px of kept) {
          const key = `${px.r >> 5}-${px.g >> 5}-${px.b >> 5}`
          const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
          cur.n += 1
          cur.r += px.r
          cur.g += px.g
          cur.b += px.b
          buckets.set(key, cur)
        }
        let best: { score: number; r: number; g: number; b: number } | null = null
        for (const value of buckets.values()) {
          const r = value.r / value.n
          const g = value.g / value.n
          const b = value.b / value.n
          const { h, s, l } = toHsl(r, g, b)
          const score = value.n * (0.3 + s) * (1 - Math.abs(l - 0.55)) * (1 + 1.2 * hueSim(h, meanHue))
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