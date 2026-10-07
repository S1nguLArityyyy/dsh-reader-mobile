# Dsh Reader 手机端（安卓 APK）

与桌面端**分开存放**的开发项目：

| 项目 | 位置 | 技术栈 |
|---|---|---|
| 桌面端 | `D:\DshReaderV2` | Electron + React + TS |
| **手机端（本项目）** | `D:\DshReaderMobile` | **Capacitor + React + TS** |

## 为什么这样选

- **界面代码整体复用桌面渲染层**（书库 / 统计 / 设置 / 阅读器 + 手机布局），
  只替换 `window.api` 这一层：桌面端走 Electron IPC，手机端直连 WebDAV；
- **不需要服务器**：云端就是用户在坚果云（或任何 WebDAV）上的一个目录，
  格式与桌面端完全一致（`/DshReader/{manifest.json, progress/, sessions/, devices/, books/}`），
  所以两端的进度、阅读时长、书籍文件天然互通；
- **不碰 iOS**：只出安卓 APK。

## 目录结构

```
src/
  api/
    types.ts          window.api 的类型（从桌面端 preload 抽出，两边同一份定义）
    webdav-probe.ts   探路测试：逐个动词打真实 WebDAV（重点 PROPFIND / MKCOL）
  probe/              探路页 UI（悬浮 WD 按钮进入）
  components/ pages/ store/ lib/ styles/    ← 从桌面端搬来的渲染层
  shared/              ← 从桌面端搬来的共享类型
  main.tsx            挂载入口（现在 window.api 仍是内存示例数据）
android/              由 `npm run android:add` 生成（原生工程，需要提交）
```

## 现在能跑什么

- ✅ 界面：手机布局（底部导航 / 系列胶囊 / 滑动翻页），数据为**内存示例数据**
- ✅ 探路页：在真机上实测 WebDAV 的 7 个请求（PROPFIND ×2、MKCOL ×2、PUT、GET、DELETE）
- ⬜ 真实数据：等 WebDAV 版 `api` 接完

## 怎么跑

```powershell
npm install

# 1) 浏览器里先看界面（最快，不用装任何东西）
npm run dev            # http://127.0.0.1:5200 → F12 → Ctrl+Shift+M 切手机模拟

# 2) 生成安卓工程（只需一次）
npm run android:add    # 需要 JAVA_HOME / ANDROID_HOME，或用 Android Studio 打开

# 3) 装到手机/模拟器 + 热更新开发（装一次，之后改代码只刷新，不重装）
npm run android:live

# 4) 出一份 debug APK
npm run android:apk    # 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

### 环境要求（本机实测配置）

| 项 | 本机实际值 |
|---|---|
| Android Studio | `D:\AndroidStudio`（**非默认安装路径**） |
| Android SDK | `D:\AndroidStudio\Sdk`（platform 36 / 37、build-tools、cmdline-tools 齐全）；<br>已在 `android/local.properties` 里写 `sdk.dir` 告诉 Gradle |
| 构建 JDK | **`D:\java\java21`** —— Studio 自带的 JBR 是 **Java 25**，而 Capacitor 7 生成的工程是 Gradle 8.11.1 + AGP 8.7.2，撑不住 25 |
| Gradle 发行包 | wrapper 指向**腾讯云镜像** `gradle-8.11.1-bin.zip`（`services.gradle.org` 下载会超时）；<br>`dl.google.com` / `repo1.maven.org` 本身通，Maven 依赖没改 |

构建命令（本机实测通过，约 1 分 46 秒出包）：

```powershell
$env:JAVA_HOME = 'D:\java\java21'
$env:ANDROID_HOME = 'D:\AndroidStudio\Sdk'
npm run android:apk     # → android\app\build\outputs\apk\debug\app-debug.apk
```

## 下一步

1. **WebDAV 版 `api`**：用探路页验证过的通道实现 `window.api` 的各个方法
   （设置里的连接信息、书库列表、进度读写、书籍文件上传下载）；
2. **阅读器接真实数据**：EPUB 解压与解析在手机上本地做（`fflate` + `fast-xml-parser` 已在依赖里）；
3. **导入本地文件**：手机上没有拖拽，要用原生文件选择器（Capacitor Filesystem / FilePicker）；
4. **安卓返回键**：阅读器返回书库、关闭弹窗（`@capacitor/app` 的 backButton 事件）；
5. **同步**：桌面端那套引擎（进度 / 时长 / 书籍文件）搬到手机端，云端格式不变。

## 已知问题

- **统计页在手机宽度下横向溢出**（4 张卡片一行放不下、月历与右侧卡片两列挤在一起）——
  桌面端不受影响，属于手机端要单独修的布局；
- 导入书籍在手机上还没有入口（需要原生文件选择器）；
- `window.api` 目前仍是内存示例数据，重启即失。
