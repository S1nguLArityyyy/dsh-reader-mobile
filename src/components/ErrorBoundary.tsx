import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 错误边界：任何组件抛异常时，不要让整棵树被卸载成白屏 ✗
 * 而是把真实错误显示出来（方便定位 ✓ 也方便截图反馈 ✓）。
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: String(info.componentStack ?? '').slice(0, 600) })
    console.error('[crash]', error, info)
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6, position: 'fixed', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--bg, #fff)', zIndex: 9999 }}>
        <h2 style={{ margin: '8px 0 12px' }}>出错了（已拦截，不再白屏）</h2>
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
          把下面这段发给开发者即可定位 ✓ 数据没有损坏 ✓
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: 'rgba(127,127,127,0.12)',
            padding: 12,
            borderRadius: 10,
            fontSize: 12
          }}
        >
          {error.name}: {error.message}
          {'\n\n'}
          {String(error.stack ?? '').slice(0, 1200)}
          {'\n\n组件栈：\n'}
          {info}
        </pre>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              this.setState({ error: null, info: '' })
            }}
          >
            返回继续用
          </button>
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    )
  }
}