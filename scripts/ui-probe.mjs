/**
 * UI 探针：在真·手机视口里打开某个页面、点某个元素、把结果和 console 报错打出来。
 *
 * 用法：
 *   node scripts/ui-probe.mjs "?route=stats" ".cal-cell:nth-child(11)" ".day-summary"
 * 参数：①页面 query ②要点击的选择器（可省略）③点击后要检查是否出现的元素（可省略）
 *
 * 为什么要它：模拟器里点不动时，光看截图分不清"没点到""点了没反应""渲染崩了"，
 * 这里能直接拿到 console 报错和 DOM 是否存在。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.PROBE_BASE ?? 'http://127.0.0.1:5200'
const query = process.argv[2] ?? ''
const clickSelector = process.argv[3] ?? ''
const expectSelector = process.argv[4] ?? ''
const port = 9444
// 浏览器 profile 必须放在项目外面：放在项目里 Vite 的 watcher 会去监听它，直接 EBUSY 崩掉
const profileDir = join(tmpdir(), 'dsh-mobile-probe')

const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => existsSync(p))
if (!edge) {
  console.error('未找到 Edge')
  process.exit(1)
}

rmSync(profileDir, { recursive: true, force: true })
const browser = spawn(
  edge,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, 'about:blank'],
  { stdio: 'ignore' }
)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 等端口 */
    }
    await sleep(250)
  }
  throw new Error('等不到 CDP 端口')
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.seq = 0
    this.pending = new Map()
    this.logs = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
        this.logs.push(`[${message.params.type}] ${text}`)
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.logs.push(`[异常] ${message.params.exceptionDetails?.exception?.description ?? '未知'}`)
      }
      const slot = this.pending.get(message.id)
      if (!slot) return
      this.pending.delete(message.id)
      if (message.error) slot.reject(new Error(message.error.message))
      else slot.resolve(message.result)
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((done, fail) => {
      socket.addEventListener('open', () => done())
      socket.addEventListener('error', (err) => fail(err))
    })
    return new Cdp(socket)
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return result.result?.value
  }
}

let failed = 0
try {
  const target = await findTarget()
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: `${base}/${query}` })
  await sleep(2200)

  const cellCount = await cdp.eval("document.querySelectorAll('.cal-cell').length")
  console.log(`[探针] 日历格子数：${cellCount}`)

  if (clickSelector) {
    const modalsBefore = await cdp.eval("document.querySelectorAll('.modal').length")
    const clicked = await cdp.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)}); if (!el) return '找不到元素'; el.click(); return '已点击：' + (el.textContent || '').trim().slice(0, 20) })()`
    )
    console.log(`[探针] 点击结果：${clicked}（点击前弹窗 ${modalsBefore} 个）`)
    await sleep(1200)
    const modals = await cdp.eval(
      "JSON.stringify(Array.from(document.querySelectorAll('.modal')).map((m) => (m.querySelector('.modal-title')?.innerText || '?') + ' :: ' + (m.querySelector('.modal-body')?.innerText || '').replace(/\\n/g, ' / ').slice(0, 120)))"
    )
    console.log(`[探针] 点击后的弹窗：${modals}`)
    const summary = await cdp.eval("document.querySelector('.day-summary')?.innerText ?? '（没有 .day-summary）'")
    console.log(`[探针] 二级页内容：${String(summary).replace(/\\n/g, ' / ')}`)
  }

  if (expectSelector) {
    const exists = await cdp.eval(`!!document.querySelector(${JSON.stringify(expectSelector)})`)
    console.log(`[探针] ${expectSelector} 存在：${exists}`)
  }

  const errors = cdp.logs.filter((line) => line.startsWith('[error]') || line.startsWith('[异常]'))
  console.log(`[探针] console 报错：${errors.length === 0 ? '无' : ''}`)
  for (const line of errors.slice(0, 8)) console.log(`   ${line}`)

  mkdirSync(join(root, 'shots'), { recursive: true })
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = join(root, 'shots', `probe-${(query || 'root').replace(/[^a-z0-9]/gi, '')}.png`)
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log(`[探针] 截图：${file}`)
} catch (err) {
  failed = 1
  console.error('[探针] 失败：', err instanceof Error ? err.message : err)
} finally {
  browser.kill()
  await sleep(300)
  rmSync(profileDir, { recursive: true, force: true })
}
process.exit(failed)
