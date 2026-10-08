import {} from 'react'
import {
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Info,
  Palette,
  Plus,
} from 'lucide-react'
import { useApp } from '../store/app'
import { SegmentedControl, Slider, Switch } from '../components/ui'

const ACCENT_PRESETS = ['#3b6fd4', '#2fa36b', '#d97757', '#8b5cf6', '#e0a028', '#e05b7a', '#0ea5a5']

export function SettingsPage() {
  const settings = useApp((s) => s.settings)
  const info = useApp((s) => s.info)
  const sync = useApp((s) => s.sync)
  const saveSettings = useApp((s) => s.saveSettings)
  const refreshAll = useApp((s) => s.refreshAll)
  const setSyncModal = useApp((s) => s.setSyncModal)
  const runSync = useApp((s) => s.runSync)
  const toast = useApp((s) => s.toast)


  if (!settings) return <div className="page" />

  const syncSettings = settings.sync
  const appearance = settings.appearance

  const patchSync = (patch: Partial<typeof syncSettings>): void => {
    void saveSettings({ sync: { ...syncSettings, ...patch } })
  }

  const patchAppearance = (patch: Partial<typeof appearance>): void => {
    void saveSettings({ appearance: { ...appearance, ...patch } })
  }

  const pickImage = async (field: 'backgroundImage' | 'readerBackgroundImage'): Promise<void> => {
    const kind = field === 'backgroundImage' ? 'app' : 'reader'
    // 由主进程复制进数据目录：协议只允许读取数据目录内的文件
    const stored = await window.api.appearance.pickBackdrop(kind)
    if (stored) {
      patchAppearance({ [field]: stored } as Partial<typeof appearance>)
      toast('success', '背景图已应用')
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">设置</h1>
      </div>

      <div className="settings-wrap">

        {/* ---------- 外观 ---------- */}
        <section className="setting-card">
          <h3>
            <Palette size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
            外观
          </h3>
          <div className="setting-hint">主题色会应用到按钮、进度环、选中状态；背景图会铺在主界面后面。</div>

          <div className="setting-row">
            <div>
              <div className="setting-label">主题色</div>
              <div className="setting-desc">点击色块选择，或用取色器自定义</div>
            </div>
            <div className="setting-control">
              <div className="accent-swatches">
                {ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    className={`accent-swatch${appearance.accent.toLowerCase() === color.toLowerCase() ? ' active' : ''}`}
                    style={{ background: color }}
                    title={color}
                    onClick={() => patchAppearance({ accent: color })}
                  />
                ))}
                <label className="accent-swatch accent-custom" title="自定义颜色">
                  <input
                    type="color"
                    value={appearance.accent}
                    onChange={(e) => patchAppearance({ accent: e.target.value })}
                  />
                  <Plus size={13} />
                </label>
              </div>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">应用背景图</div>
              <div className="setting-desc">
                {appearance.backgroundImage ? appearance.backgroundImage : '未设置，使用纯色背景'}
              </div>
            </div>
            <div className="setting-control">
              <button className="btn btn-ghost btn-sm" onClick={() => void pickImage('backgroundImage')}>
                <ImageIcon size={14} />
                选择图片
              </button>
              {appearance.backgroundImage ? (
                <button className="btn btn-ghost btn-sm" onClick={() => patchAppearance({ backgroundImage: null })}>
                  清除
                </button>
              ) : null}
            </div>
          </div>

          {appearance.backgroundImage ? (
            <div className="setting-row">
              <div>
                <div className="setting-label">背景浓度</div>
                <div className="setting-desc">背景图的显示强度</div>
              </div>
              <div className="setting-control">
                <Slider
                  value={appearance.backgroundOpacity}
                  min={0.05}
                  max={0.9}
                  step={0.05}
                  onChange={(v) => patchAppearance({ backgroundOpacity: v })}
                />
                <span className="range-value">{Math.round(appearance.backgroundOpacity * 100)}%</span>
              </div>
            </div>
          ) : null}

          <div className="setting-row">
            <div>
              <div className="setting-label">阅读器背景图</div>
              <div className="setting-desc">
                {appearance.readerBackgroundImage ? appearance.readerBackgroundImage : '未设置，使用阅读主题的底色'}
              </div>
            </div>
            <div className="setting-control">
              <button className="btn btn-ghost btn-sm" onClick={() => void pickImage('readerBackgroundImage')}>
                <ImageIcon size={14} />
                选择图片
              </button>
              {appearance.readerBackgroundImage ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => patchAppearance({ readerBackgroundImage: null })}
                >
                  清除
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {/* ---------- 阅读 ---------- */}
        <section className="setting-card">
          <h3>阅读</h3>
          <div className="setting-row">
            <div>
              <div className="setting-label">自动跳过封面</div>
              <div className="setting-desc">
                打开后，第一次打开一本书会自动跳到正文第一章（跳过封面与目录）。
                默认关闭 —— 从第 1 页开始，封面也能看到
              </div>
            </div>
            <div className="setting-control">
              <Switch
                checked={settings?.reader?.skipFrontMatter === true}
                onChange={(v) =>
                  void saveSettings({ reader: { ...(settings?.reader ?? {}), skipFrontMatter: v } } as never)
                }
              />
            </div>
          </div>
        </section>

        {/* ---------- 局域网同步 ---------- */}
        <section className="setting-card">
          <h3>
            局域网同步
          </h3>
          <div className="setting-hint">
            手机和电脑连同一个 WiFi 时，直接通过局域网交换阅读记录和书籍，不经过任何网盘。
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">电脑地址</div>
              <div className="setting-desc">电脑端设置里显示的地址，例如 http://192.168.0.102:8787</div>
            </div>
            <div className="setting-control">
              <input
                className="input"
                style={{ width: 230 }}
                placeholder="http://192.168.0.102:8787"
                value={syncSettings.localCloudDir ?? ''}
                onChange={(e) => patchSync({ localCloudDir: e.target.value })}
              />
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">同步状态</div>
              <div className="setting-desc">{sync.message || '还没有同步过'}</div>
            </div>
            <div className="setting-control">
              <button className="btn btn-ghost btn-sm" onClick={() => void runSync()}>
                立即同步
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSyncModal(true)}>
                同步面板
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">自动同步</div>
              <div className="setting-desc">打开应用后同步一次，之后按间隔定时同步</div>
            </div>
            <div className="setting-control">
              <Switch checked={syncSettings.auto} onChange={(v) => patchSync({ auto: v })} />
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">同步间隔</div>
              <div className="setting-desc">自动同步的时间间隔</div>
            </div>
            <div className="setting-control">
              <select
                className="input"
                style={{ width: 120 }}
                disabled={!syncSettings.auto}
                value={syncSettings.intervalMinutes}
                onChange={(e) => patchSync({ intervalMinutes: Number(e.target.value) })}
              >
                {[5, 10, 15, 30, 60, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} 分钟
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">自动下载电脑新书</div>
              <div className="setting-desc">打开后同步时自动把电脑上有、手机没有的书拉过来</div>
            </div>
            <div className="setting-control">
              <Switch
                checked={syncSettings.autoDownloadBooks}
                onChange={(v) => patchSync({ autoDownloadBooks: v })}
              />
            </div>
          </div>
        </section>

        {/* ---------- 数据与存储 ---------- */}
        <section className="setting-card">
          <h3>
            <HardDrive size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
            数据与存储
          </h3>
          <div className="setting-hint">书库、封面、阅读进度与统计都保存在本机这个目录，关机重启不会丢失。</div>

          <div className="setting-row">
            <div>
              <div className="setting-label">清空所有阅读记录</div>
              <div className="setting-desc">删除所有书的进度与阅读时长（书本身全部保留）</div>
            </div>
            <div className="setting-control">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const api = window.api as unknown as { dialog: { confirm: (o: { title: string; message: string }) => Promise<boolean> }; library: { clearAllRecords: () => Promise<unknown> } }
                  void api.dialog.confirm({ title: '清空阅读记录', message: '删除所有书的进度与阅读时长？书会保留，此操作不可撤销。' }).then((ok) => {
                    if (!ok) return
                    void api.library.clearAllRecords().then(() => {
                      toast('success', '已清空所有阅读记录')
                      void refreshAll()
                    })
                  })
                }}
              >
                清空
              </button>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">数据目录</div>
              <div className="setting-path" style={{ marginTop: 8 }}>
                {info?.dataDir ?? '—'}
              </div>
            </div>
            <div className="setting-control">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => info && void window.api.app.openPath(info.dataDir)}
              >
                <FolderOpen size={14} />
                打开目录
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">界面主题</div>
              <div className="setting-desc">应用整体外观</div>
            </div>
            <div className="setting-control">
              <SegmentedControl<'light' | 'dark'>
                value={settings.theme}
                onChange={(v) => void saveSettings({ theme: v })}
                options={[
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' }
                ]}
              />
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">本机设备名</div>
              <div className="setting-desc">同步时用于标记进度来自哪台设备</div>
            </div>
            <div className="setting-control">
              <span className="setting-path">{settings.deviceName}</span>
            </div>
          </div>
        </section>

        {/* ---------- 关于 ---------- */}
        <section className="setting-card">
          <h3>
            <Info size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
            关于
          </h3>
          <div className="setting-row">
            <div>
              <div className="setting-label">版本</div>
            </div>
            <div className="setting-control">
            <span className="setting-hint">v{info?.version ?? '0.1.0'} · 正式版</span>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">支持格式</div>
            </div>
            <div className="setting-control">
              <span className="setting-hint">当前版本仅支持 EPUB，其余格式将在后续版本补充</span>
            </div>
          </div>
        </section>

        {/* ---------- 设计阶段预览入口 ---------- */}

        {/* ---------- 数据 ---------- */}
        <section className="setting-card">
          <h3>
            <HardDrive size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
            数据
          </h3>
          <div className="setting-row">
            <div>
              <div className="setting-label">恢复出厂设置</div>
              <div className="setting-hint">清空本机的书籍、阅读进度与设置（网盘上的数据不受影响）</div>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => {
                const ok = window.confirm('确定恢复出厂设置吗？本机导入的书籍与阅读进度都会被清空，且无法撤销。')
                if (!ok) return
                // clearCache 只在手机端实现里存在，公共类型没声明它 —— 这里局部断言，避免改公共类型
                const api = window.api.library as unknown as { clearCache: () => Promise<void> }
                void api.clearCache().then(() => window.location.reload())
              }}
            >
              恢复出厂
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
