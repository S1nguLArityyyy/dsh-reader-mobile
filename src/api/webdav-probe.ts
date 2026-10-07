import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * WebDAV 探路测试。
 *
 * 要验证的是**最大的不确定性**：安卓侧能不能发出 WebDAV 的专用动词。
 *   - GET / PUT / DELETE 是标准动词，肯定没问题；
 *   - PROPFIND（列目录）与 MKCOL（建目录）是 WebDAV 扩展动词，
 *     浏览器 fetch 发不出去，必须走原生 HTTP（CapacitorHttp）—— 通不通要实测。
 *
 * 结论怎么用：
 *   - 全绿 → 手机端可以直连坚果云，同步逻辑照搬桌面端的引擎；
 *   - PROPFIND 挂了 → 走兜底设计：云端放一个 index.json，只用 GET/PUT 读写它，
 *     不列目录（代价是要自己维护索引一致性）。
 */

export interface ProbeStep {
  /** 步骤名（就是要验证的动词） */
  name: string
  detail: string
  ok: boolean
  status: number | null
  ms: number
  note: string
}

export interface ProbeOptions {
  /** 服务器根地址，例如 https://dav.jianguoyun.com/dav */
  baseUrl: string
  username: string
  password: string
  /** 应用在云端的目录名 */
  remoteDir: string
}

interface RawResponse {
  status: number
  body: string
}

/** 当前走的是哪条网络通道：安卓原生（无 CORS、可自定义动词）还是浏览器 fetch */
export function transportName(): string {
  return Capacitor.isNativePlatform()
    ? `原生 HTTP（${Capacitor.getPlatform()}，不受 CORS 限制）`
    : '浏览器 fetch（受 CORS 限制，PROPFIND 会被挡）'
}

/** UTF-8 安全的 base64（密码里可能有中文） */
function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

async function send(
  method: string,
  url: string,
  options: ProbeOptions,
  body?: string,
  extraHeaders?: Record<string, string>
): Promise<RawResponse> {
  const headers: Record<string, string> = {
    Authorization: basicAuth(options.username, options.password),
    Depth: '1',
    ...(extraHeaders ?? {})
  }

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: body,
      connectTimeout: 20000,
      readTimeout: 20000
    })
    const data = response.data
    return {
      status: response.status,
      body: typeof data === 'string' ? data : JSON.stringify(data ?? '')
    }
  }

  const response = await fetch(url, { method, headers, body })
  return { status: response.status, body: await response.text() }
}

/** 数一下 PROPFIND 返回了几个条目 */
function countEntries(body: string): number {
  return (body.match(/<[^>]*response[\s>]/gi) ?? []).length
}

/** 把状态码翻译成人话，失败时用户要知道下一步怎么办 */
function explain(status: number): string {
  if (status === 401) return '401 认证失败：账号或应用密码不对（坚果云要用「应用密码」，不是登录密码）'
  if (status === 403) return '403 拒绝访问：账号没权限或路径不对'
  if (status === 404) return '404 路径不存在'
  if (status === 405) return '405 服务器不接受这个动词'
  if (status === 409) return '409 父目录不存在（要先建上一级）'
  if (status === 507) return '507 云端空间不足'
  if (status === 0) return '请求没发出去（网络或 CORS）'
  if (status >= 500) return `${status} 服务端错误，稍后重试`
  return `HTTP ${status}`
}

export async function runWebDavProbe(
  options: ProbeOptions,
  onStep: (step: ProbeStep) => void
): Promise<void> {
  const root = options.baseUrl.trim().replace(/\/+$/, '')
  const dirName = (options.remoteDir || 'DshReader').replace(/^\/+|\/+$/g, '')
  const dir = `${root}/${dirName}`
  const probeDir = dir
  const probeFile = `${probeDir}/probe.json`
  const payload = JSON.stringify({ app: 'Dsh Reader', platform: 'android', at: new Date().toISOString() })

  const step = async (
    name: string,
    detail: string,
    run: () => Promise<RawResponse>,
    judge: (response: RawResponse) => { ok: boolean; note: string }
  ): Promise<void> => {
    const started = performance.now()
    try {
      const response = await run()
      const verdict = judge(response)
      onStep({
        name,
        detail,
        ok: verdict.ok,
        status: response.status,
        ms: Math.round(performance.now() - started),
        note: verdict.note
      })
    } catch (err) {
      onStep({
        name,
        detail,
        ok: false,
        status: null,
        ms: Math.round(performance.now() - started),
        note: err instanceof Error ? err.message : String(err)
      })
    }
  }

  // 1) PROPFIND：整个方案的命门（列目录）
  await step(
    'PROPFIND',
    `${root}/ 列根目录`,
    () => send('PROPFIND', `${root}/`, options),
    (response) =>
      response.status === 207
        ? { ok: true, note: `207 Multi-Status，返回 ${countEntries(response.body)} 个条目` }
        : { ok: false, note: explain(response.status) }
  )

  // 2) MKCOL：建应用目录
  await step(
    'MKCOL',
    dir,
    () => send('MKCOL', dir, options),
    (response) =>
      response.status === 201
        ? { ok: true, note: '201 建目录成功' }
        : response.status === 405
          ? { ok: true, note: '405 已存在（等同于成功）' }
          : { ok: false, note: explain(response.status) }
  )

  // 3) MKCOL：建测试子目录
  await step(
    'MKCOL',
    probeDir,
    () => send('MKCOL', probeDir, options),
    (response) =>
      response.status === 201
        ? { ok: true, note: '201 建目录成功' }
        : response.status === 405
          ? { ok: true, note: '405 已存在（等同于成功）' }
          : { ok: false, note: explain(response.status) }
  )

  // 4) PUT：写一个文件
  await step(
    'PUT',
    `${dirName}/probe.json`,
    () => send('PUT', probeFile, options, payload, { 'Content-Type': 'application/json; charset=utf-8' }),
    (response) =>
      [200, 201, 204].includes(response.status)
        ? { ok: true, note: `${response.status} 写入成功` }
        : { ok: false, note: explain(response.status) }
  )

  // 5) GET：读回来，并核对内容
  await step(
    'GET',
    `${dirName}/probe.json`,
    () => send('GET', probeFile, options),
    (response) =>
      response.status !== 200
        ? { ok: false, note: explain(response.status) }
        : response.body.includes('Dsh Reader')
          ? { ok: true, note: '200 内容与写入一致（往返无损）' }
          : { ok: false, note: '200 但内容对不上，可能是缓存或代理' }
  )

  // 6) DELETE：清理
  await step(
    'DELETE',
    `${dirName}/probe.json`,
    () => send('DELETE', probeFile, options),
    (response) =>
      [200, 204].includes(response.status)
        ? { ok: true, note: `${response.status} 已删除` }
        : response.status === 404
          ? { ok: true, note: '404 已经不在了（幂等）' }
          : { ok: false, note: explain(response.status) }
  )

  // 7) 再列一次目录，确认前面的操作真的落到了云端
  await step(
    'PROPFIND',
    `${dirName}/ 复查`,
    () => send('PROPFIND', `${probeDir}/`, options),
    (response) =>
      response.status === 207
        ? { ok: true, note: `207 复查通过，目录下有 ${countEntries(response.body)} 个条目` }
        : { ok: false, note: explain(response.status) }
  )
}
