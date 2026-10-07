import { useState } from 'react'
import { runWebDavProbe, transportName, type ProbeStep } from '../api/webdav-probe'
import './probe.css'

/** 探路页：验证安卓侧能不能直连 WebDAV（重点看 PROPFIND / MKCOL） */
export function ProbePage({ onClose }: { onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('probe.baseUrl') ?? '')
  const [username, setUsername] = useState(() => localStorage.getItem('probe.username') ?? '')
  const [password, setPassword] = useState('')
  const [remoteDir, setRemoteDir] = useState('DshReader')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<ProbeStep[]>([])

  const passed = steps.filter((step) => step.ok).length
  const failed = steps.filter((step) => !step.ok).length
  const done = steps.length >= 7 && !running
  const critical = steps.filter((step) => step.name === 'PROPFIND')
  const criticalOk = critical.length > 0 && critical.every((step) => step.ok)

  const start = async (): Promise<void> => {
    localStorage.setItem('probe.baseUrl', baseUrl)
    localStorage.setItem('probe.username', username) // 密码不存：探路用的凭据不该留在手机上
    setSteps([])
    setRunning(true)
    try {
      await runWebDavProbe({ baseUrl, username, password, remoteDir }, (step) => {
        setSteps((prev) => [...prev, step])
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="probe">
      <div className="probe-head">
        <div>
          <div className="probe-title">WebDAV 探路测试</div>
          <div className="probe-sub">通道：{transportName()}</div>
        </div>
        <button className="btn btn-ghost" onClick={onClose}>
          关闭
        </button>
      </div>

      <div className="probe-body">
        <label className="probe-field">
          <span>服务器地址</span>
          <input
            className="input"
            placeholder="https://dav.jianguoyun.com/dav"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <label className="probe-field">
          <span>账号</span>
          <input
            className="input"
            placeholder="坚果云登录邮箱"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <label className="probe-field">
          <span>应用密码</span>
          <input
            className="input"
            type="password"
            placeholder="坚果云 → 安全选项 → 添加应用密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="probe-field">
          <span>云端目录</span>
          <input className="input" value={remoteDir} onChange={(e) => setRemoteDir(e.target.value)} />
        </label>

        <button className="btn btn-primary probe-run" disabled={running || !baseUrl || !username || !password} onClick={() => void start()}>
          {running ? '测试中…' : '开始测试'}
        </button>

        <p className="probe-hint">
          只写入 <code>{remoteDir || 'DshReader'}/mobile-probe/probe.json</code> 并立即删掉，不会碰你的书。
          应用密码只留在内存里，不存手机。
        </p>

        {steps.length > 0 ? (
          <div className="probe-list">
            {steps.map((step, index) => (
              <div className={`probe-row${step.ok ? ' ok' : ' fail'}`} key={`${step.name}-${index}`}>
                <div className="probe-row-head">
                  <span className="probe-mark">{step.ok ? '✓' : '✗'}</span>
                  <span className="probe-name">{step.name}</span>
                  <span className="probe-status">
                    {step.status === null ? '未响应' : step.status} · {step.ms}ms
                  </span>
                </div>
                <div className="probe-detail">{step.detail}</div>
                <div className="probe-note">{step.note}</div>
              </div>
            ))}
          </div>
        ) : null}

        {done ? (
          <div className={`probe-verdict${criticalOk ? ' ok' : ' fail'}`}>
            {criticalOk
              ? `通过 ${passed} 项、失败 ${failed} 项。PROPFIND / MKCOL 都通 —— 手机端可以像桌面端一样直连 WebDAV，同步引擎照搬即可。`
              : `PROPFIND 这一步没过（通过 ${passed} 项、失败 ${failed} 项）。改用兜底方案：云端维护一个 index.json，只用 GET/PUT 读写它，不列目录。`}
          </div>
        ) : null}
      </div>
    </div>
  )
}
