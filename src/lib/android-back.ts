import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useApp } from '../store/app'

/**
 * 安卓物理返回键 / 手势返回。
 *
 * 踩过的坑：Capacitor 核心**完全没有接管返回键**（源码里连 onBackPressed 都没有），
 * 所以默认行为就是「finish 掉 Activity」= 直接退回桌面，WebView 有没有历史都不管。
 * 我一开始用 history.pushState + popstate 自己模拟，原理上就不可能生效。
 *
 * 正解：装 `@capacitor/app` 插件，注册 `backButton` 监听 —— 一旦注册了监听，
 * 默认的退出行为就会被拦下来，由我们决定怎么退。
 *
 * 层级顺序：先关弹窗 → 再退出阅读器 → 都关完了再按才退出应用（符合安卓习惯）。
 */
export function installAndroidBack(): void {
  if (!Capacitor.isNativePlatform()) return

  void App.addListener('backButton', ({ canGoBack }) => {
    const state = useApp.getState()

    if (state.detailBookId) {
      state.closeDetail()
      return
    }
    if (state.route === 'reader') {
      state.closeReader()
      return
    }
    // 先给页面一个处理返回的机会（例如书库的多选状态）——
    // 事件被 preventDefault() 就说明页面已处理，不要再往上层退
    const backEvent = new CustomEvent('dshr:back', { cancelable: true })
    if (!window.dispatchEvent(backEvent)) return
    if (canGoBack) {
      window.history.back()
      return
    }
    // 已经在最外层：这才是真的退出
    void App.exitApp()
  })
}
