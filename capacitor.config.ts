import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.dshreader.app',
  appName: 'Dsh Reader',
  webDir: 'dist',
  android: {
    // 阅读器要滚动长文，允许 WebView 覆盖层滚动；混合内容保持关闭
    allowMixedContent: false,
    /**
     * Android 15+ 对 targetSdk 35 强制 edge-to-edge：WebView 会铺到状态栏/手势条下面，
     * 结果阅读器顶栏被状态栏压住、点不着（踩过）。'force' 让原生侧给 WebView 留出系统栏边距。
     * 用 'auto' 不生效 —— 它只在 Android 15 且 windowOptOutEdgeToEdgeEnforcement 为 false 时才调。
     */
    adjustMarginsForEdgeToEdge: 'force'
  },
  plugins: {
    /**
     * 关键开关：让 fetch / XMLHttpRequest 走**原生网络栈**。
     *
     * 为什么必须开：
     *  1. WebView 里的 fetch 受 CORS 限制，而坚果云这类 WebDAV 服务不带 CORS 头；
     *  2. WebDAV 的 PROPFIND / MKCOL 是**非标准动词**，浏览器 fetch 根本发不出去。
     * 走原生（安卓侧 OkHttp）两个问题一起解决 —— 这正是探路页要验证的事。
     */
    CapacitorHttp: {
      enabled: true
    }
  }
}

export default config
