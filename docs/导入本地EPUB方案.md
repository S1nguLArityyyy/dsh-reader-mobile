# 手机端导入本地 EPUB（真实数据）实施方案

目标：手机上选一个 `.epub` 文件 → 解析 → 入库 → 书架里出现，可正常阅读；重启不丢。
当前书架只有内置那一本（`public/data/library.json`，由桌面端导出）。

## 一、已经完成的第一步

桌面端**已跑通**的解析器已复制到 `src/data/epub.ts`（316 行，来自 `D:\DshReaderV2\src\main\epub.ts`）。
不重写、只移植 —— 避免引入新 bug。

## 二、移植清单（精确到行，行号为复制时的原始行）

要替换的 node 依赖（第 3–5 行）：`node:fs`、`node:fs/promises`、`node:path`
→ 需要自备小工具：`posix.dirname / join / normalize / relative`（约 20 行纯字符串实现）+ `extname`

| 原函数 | 处理方式 |
|---|---|
| `readEpubMeta(filePath)`（62 行） | 第 63 行 `readFile` 换成"传入字节"→ 改名 `readEpubMetaFromBytes(bytes: Uint8Array)`，其余逻辑不动 |
| `extractEpub(filePath, destDir)`（234 行） | **整段删除**（手机端不落地文件，全部留在内存/IndexedDB） |
| `safeJoin`（247 行） | 删除（同上） |
| `readChapter(cacheDir, opfDir, href, toUrl)`（260 行） | 第 268 行改成"从 zip 条目表取文本"→ `readChapterFromZip(files: Map<string, Uint8Array>, opfDir, href, toUrl)` |
| `sanitizeChapter(...)`（279 行） | 保留，但内部解析图片路径的 fs 辅助（293–350 行）改成"在 zip 条目表里查" |
| `parseNavHtml / parseNcx / parseOpf / IMAGE_EXT` | **全部保留**（纯逻辑，无 node 依赖） |

zip 解包继续用已有的 `fflate` 的 `unzipSync(buf)` → 得到 `{ 条目名: Uint8Array }`，
包成 `Map` 供上面两个入口使用。

## 三、入库设计（IndexedDB，不要 localStorage —— 书有几十 MB）

- `books` 表：`{ id, title, author, coverBlob, chapterCount, wordCount, addedAt, sourceName }`
- `files` 表：`{ bookId, name, bytes }`（原始 epub 字节，按需要再解包）
- 或更省事：`books` 表直接存 `{ id, meta, epubBytes }`（一本一行），打开时再 `unzipSync`
- **id 用文件 sha1**（和桌面端一致：`sha1:<hash>`）→ 以后网盘同步不会重复导入

## 四、导入入口（书库页）

`<input type="file" accept=".epub" />` —— **在 Capacitor 的 WebView 里会直接调起安卓文件选择器**，
不需要额外插件（这是关键结论，别去引 @capacitor/filesystem）。
`file.arrayBuffer()` → `Uint8Array` → 解析 → 入库 → 刷新书架。

## 五、数据层接线

`src/api/local.ts` 现在只读 `public/data/library.json`。改成分两步：
1. 先列出 IndexedDB 里的书；
2. 若为空，再回落到内置那本（保证首次安装有书可看）。
`reader.open / chapter` 对两种来源都要能用 —— 内置走 json，导入的走 IndexedDB + zip。

## 六、验证方式（每步都要做）

1. `npm run typecheck`
2. `node scripts/ui-probe.mjs "?route=library"` → 四页零报错
3. **移植正确性对比**：用桌面端同一本 EPUB（`D:\DshReaderApp\books\*.epub`），
   比较「章节数 / 各章字数 / 封面是否一致」—— 与 `export-mobile-data` 导出的
   `public/data/library.json` 对齐（那份是桌面端解析器的结果，可作为基准）
4. 真机：导入一个 epub → 书架出现 → 打开能读 → 杀进程重开仍在

## 七、风险与注意

- `sanitizeChapter` 里的图片路径处理最容易出错（相对路径、`../`、URL 编码）→ 先只支持普通 epub
- 大文件（>50MB）解包会卡 → 先给个大小上限提示
- 解析失败的 epub（zip 里套 zip、损坏记录）要有明确报错，不要静默
- 不要把 `src/data/epub.ts` 里的 node 逻辑整段删掉再手写 —— **改一块、typecheck 一次**
