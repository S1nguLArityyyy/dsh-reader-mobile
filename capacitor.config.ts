import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.dshreader.app',
  appName: 'Dsh Reader',
  webDir: 'dist',
  android: {
    // 阅读器要滚动长文，允许 WebView 覆盖层滚动；混合内容保持关闭
    allowMixedContent: false,
    /**
     * 全面屏适配：'disable' = WebView 铺满整屏（内容延伸到状态栏/手势条下面），
     * 由 CSS 自己让出状态栏与手势条的位置。
     * 用 'force' 时原生会给 WebView 留边距，屏幕上就会出现上下白边（用户反馈过）。
     */
    adjustMarginsForEdgeToEdge: 'disable'
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
