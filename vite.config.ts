import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 手机端（安卓）用 Vite 构建 Web 资源，再由 Capacitor 套壳成 APK。
 *
 * 界面代码整体复用桌面渲染层（断点 768px 的手机布局）；
 * 唯一要换掉的是 `window.api`：手机端直连 WebDAV，不走 Electron IPC。
 * 构建必须用相对路径（`base: './'`），因为 Capacitor 用 file:// 加载页面。
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve('src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5200,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022'
  }
})
