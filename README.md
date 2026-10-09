# Dsh Reader 手机端（安卓）

> **本项目由 AI 编写**


Dsh Reader 的安卓客户端，基于 Capacitor + React + TypeScript。

> **同步功能需要配合电脑端使用。** 手机端本身是一个纯本地阅读器 —— 书存在手机里、
> 进度和书签存在手机里，**不需要注册任何账号，也不会把书或阅读记录上传到互联网**。
> 只有当你主动点「同步」时，它才会在**同一个 WiFi 下**和电脑端的 Dsh Reader 交换数据。
>
> 电脑端项目：<https://github.com/S1nguLARityyyy/dsh-reader>

## 和电脑端的关系

| 项目 | 技术栈 | 仓库 |
|---|---|---|
| 电脑端（主项目） | Electron + React + TS | [dsh-reader](https://github.com/S1nguLARityyyy/dsh-reader) |
| **手机端（本仓库）** | **Capacitor + React + TS** | 本仓库 |

两端**共用同一套渲染层**（书库 / 统计 / 设置 / 阅读器），只替换 `window.api` 这一层：
电脑端走 Electron IPC，手机端直接读写本机存储（IndexedDB / localStorage）。

## 同步是怎么工作的

不需要服务器、不需要网盘、不需要账号：

```
┌─────────────┐        同一 WiFi        ┌─────────────┐
│   手机端     │ ◄─────────────────────► │   电脑端     │
│  (本 App)    │   http://<电脑IP>:8787  │  Dsh Reader  │
└─────────────┘                         └─────────────┘
      书存在手机本地                        书存在电脑本地
```

电脑端启动后会监听 `0.0.0.0:8787`，提供三个接口：

| 接口 | 方向 | 作用 |
|---|---|---|
| `GET /books.json` | 电脑 → 手机 | 书目清单（书名、卷号、指纹） |
| `GET /books/<file>` | 电脑 → 手机 | 下载整本 EPUB |
| `GET /records` | 电脑 → 手机 | 导出电脑端的阅读进度、阅读时长、「已读完」标记 |
| `POST /records` | 手机 → 电脑 | 把手机的记录推给电脑合并 |

**怎么用**：在手机端「设置 → 同步」里填电脑的局域网地址（电脑端设置页会显示），
然后点同步即可。两端记录按「同一本书取更新的那份」合并，**时长按设备分开统计后相加**，
所以两端都不会覆盖对方的阅读进度。

**冲突处理**：如果同一本书在两端都读过且进度不同，电脑端会弹窗让你逐本选择保留哪一边，
没有选择之前**不会写入任何数据**。

## 功能

- 书架：系列自动归组、整组勾选、多选管理、搜索、排序
- 阅读器：滚动 / 翻页两种模式、字号与主题、目录跳转、章内位置记忆
- 阅读记录：进度、阅读时长、阅读日历、「已读完」标记
- 书签与划线笔记：原文摘录、备注、跳回原文位置
- 同步：局域网直传书目与阅读记录（见上）

## 构建

### 环境要求

| 项 | 说明 |
|---|---|
| Node.js | 18+ |
| JDK | **21**（Capacitor 7 的 Gradle 8.11 + AGP 8.7 撑不住 Java 25，别用 Android Studio 自带的 JBR） |
| Android SDK | platform 36+、build-tools、cmdline-tools |

### 命令

```bash
npm install

# 浏览器里看界面（最快，不用装安卓环境）
npm run dev            # http://127.0.0.1:5200

# 出 debug APK
npm run android:apk    # 产物：android/app/build/outputs/apk/debug/app-debug.apk

# 装到手机 + 热更新开发（装一次，之后改代码只刷新）
npm run android:live
```

构建 APK 时需要指定 JDK 与 SDK：

```powershell
$env:JAVA_HOME = '<你的 JDK 21 路径>'
$env:ANDROID_HOME = '<你的 Android SDK 路径>'
npm run android:apk
```

## 目录结构

```
src/
  api/          window.api 的手机端实现（本机存储 + 局域网同步）
  components/   界面组件
  pages/        书库 / 阅读器 / 统计 / 设置 / 书签
  store/        全局状态（zustand）
  data/         数据层：IndexedDB、EPUB 解析、局域网传输
  lib/          工具函数
  shared/       与电脑端共享的类型定义
android/        Capacitor 生成的原生工程
```

## 版本

当前 **1.0**。

> 仓库内的 `android/app/build.gradle` 另有一个 `versionCode`（内部构建编号），
> 每次打包递增 —— Android 靠它判断能否覆盖安装。它和对外显示的版本号是两回事。

## 说明

- 只出安卓 APK，不涉及 iOS。
- 应用启动时是**空书架**，书需要你自己导入 —— 包里不附带任何书籍。
- 所有数据都在你的手机上；同步是点对点局域网传输，不经过任何第三方服务器。
