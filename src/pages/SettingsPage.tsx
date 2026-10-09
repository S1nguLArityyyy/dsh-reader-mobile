import { useState } from 'react'
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
  const [logOpen, setLogOpen] = useState(false)
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
              <div className="setting-desc">电脑端侧边栏左下角或「设置 - 局域网服务」里显示的地址，形如 http://192.168.0.102:8787。看不到时在电脑上执行 ipconfig，取当前上网网卡的 IPv4 地址，后面加 :8787。手机与电脑必须在同一个 WiFi 下</div>
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
              <div className="setting-label">关闭阅读时同步</div>
              <div className="setting-desc">合上书立刻把这次的进度与阅读时长推给电脑</div>
            </div>
            <div className="setting-control">
              <Switch
                checked={syncSettings.onReaderClose}
                onChange={(v) => patchSync({ onReaderClose: v })}
              />
            </div>
          </div>
        </section>

        {/* ---------- 关于 ---------- */}
        <section className="setting-card">
          <h3>关于</h3>
          <div className="setting-row">
            <div>
              <div className="setting-label">更新记录</div>
              <div className="setting-desc">查看各版本的功能变化</div>
            </div>
            <div className="setting-control">
              <button className="btn btn-ghost btn-sm" onClick={() => setLogOpen(true)}>
                查看
              </button>
            </div>
          </div>

          {logOpen ? (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 900 }}
              onClick={() => setLogOpen(false)}
            >
              <div
                style={{ position: 'absolute', left: 12, right: 12, top: 64, bottom: 48, background: 'var(--panel)', borderRadius: 16, padding: 18, overflowY: 'auto' }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3 style={{ margin: '0 0 12px' }}>更新记录</h3>
                <div className="setting-desc" style={{ lineHeight: 1.9 }}>
                  <b>204</b>
                  <br />系列标题后新增复选框：多选模式下勾一下即可选中/取消整个系列
                  <br />（「单册书籍」不是系列，不提供整组勾选）
                  <br />
                  <br />
                  <b>203</b>
                  <br />整书进度改为手机端自己按章节字数加权（不再依赖电脑端下发）
                  <br />算字口径与电脑端统一：去掉脚本/样式、解码实体，两端百分比一致
                  <br />老书会自动重算一次（含之前用旧口径算过的）
                  <br />
                  <br />
                  <b>202</b>
                  <br />修复：整书进度改为按章节字数加权，翻几页彩页不再显示「已读大半」
                  <br />（电脑端下发的权威字数优先；老书会自动补算一次）
                  <br />
                  <br />
                  <b>201</b>
                  <br />修复：从翻页切回滚动时也会回到原来的位置（之前只修好了滚动→翻页）
                  <br />
                  <br />
                  <b>200</b>
                  <br />修复：阅读中切换滚动 / 翻页模式不再跳回本章开头
                  <br />
                  <br />
                  <b>199</b>
                  <br />冲突判定放宽：两端都改过就交给你裁决，不再因时间戳太接近而被静默覆盖
                  <br />
                  <br />
                  <b>198</b>
                  <br />「取消同步」真的会停下来：不再继续下载后面的书，改完的选择也会保留
                  <br />冲突弹窗逐本生效：之前只有第一本被处理，其余选择会被丢掉
                  <br />清理网盘时代的残留：界面不再出现「云端 / 网盘」，书籍上传入口已移除
                  <br />
                  <br />
                  <b>1.0 正式版</b>
                  <br />局域网直连：同一 WiFi 下与电脑交换阅读记录和书籍，不再依赖网盘
                  <br />记录双向同步：阅读进度、阅读时长、读完标记
                  <br />书架按系列归组、按卷号排序，支持整目录批量导入
                  <br />阅读器：单栏翻页、电量实时显示、排版与主题可调
                  <br />统计：阅读日历、阅读热力图、按区间汇总
                  <br />
                  <br />
                  <b>0.9</b>
                  <br />记录同步协议完成：进度按时间取新，时长按设备分别累计
                  <br />书籍增量传输：只传手机缺少的那几本
                  <br />
                  <br />
                  <b>0.8</b>
                  <br />改用局域网直传书籍，速度提升到秒级
                  <br />移除网盘与 WebDAV 同步
                  <br />
                  <br />
                  <b>0.7</b>
                  <br />阅读器：翻页模式、目录跳转、全文搜索、样式编辑
                  <br />书库：搜索、多选管理、合集归组、导入进度
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(false)}>
                    关闭
                  </button>
                </div>
              </div>
            </div>
          ) : null}
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
              <div className="setting-hint">清空本机的书籍、阅读进度与设置（电脑上的数据不受影响）</div>
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
