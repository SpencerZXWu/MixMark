# MixMark

极简 Markdown 文档编辑器。本地优先、零构建运行、一次编写多端运行。

- 完整规划见 [`docs/PLAN.md`](docs/PLAN.md)
- 版本变更见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- 项目约定见 [`CLAUDE.md`](CLAUDE.md)

## 快速开始（用户）

直接双击 `web/index.html` 即可使用，无需安装任何东西 —— 不联网也能跑。

**写作**

- Markdown 全语法、KaTeX 数学公式（含字体）、代码高亮、表格、任务列表
- 编辑 / 分栏 / 预览三种视图，双向同步滚动，文档内查找替换
- 文档与文件夹管理、自动保存、崩溃恢复、多标签、全文搜索
- 中英双语

**外观**

- 底色主题 6 套：白昼 / 羊皮纸 / 雾灰 / 墨夜 / 纯黑 / 深海
- 强调色 8 个，与底色正交组合（新主题不用手写配色表）
- 字体 4 档，**界面字体与正文字体分开选**（界面要一眼认出，正文要耐读）
- 48 套配色全部过了对比度审计：正文 ≥ 7:1、链接与代码高亮 ≥ 4.5:1

**AI 助手**（自带 DeepSeek API Key，key 只存在本机浏览器里）

- 能读、能改、能建、能搜，也能重命名 / 移动文档与文件夹（改动可一键撤销）
- 三种「引用」来路：行号前的复选框、侧栏拖入、输入框里写「现在的文档」
- 内容改动走「先提方案、你再保留 / 撤销」，并带行级差异高亮

**存取**

- 浏览器：本机文档库（IndexedDB，`file://` 下自动回落 localStorage）
- **桌面端（Electron）：文档真的以 `.md` 落进你自己选的文件夹**，虚拟文件夹镜像成真实子目录，
  首次连接会收编文件夹里已有的 `.md` / `.txt`；安装器见 `release/`
- 还没做：安卓端外壳

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+Alt+N` | 新建文档 |
| `Ctrl+S` | 立即保存 |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+K` | 加粗 / 斜体 / 插入链接 |
| `Ctrl+E` | 行内代码 |
| `Ctrl+Shift+X` | 删除线 |
| `Ctrl+Alt+1..3` | 标题 1–3 |
| `Ctrl+Shift+K` | 代码块 |
| `Ctrl+Shift+M` / `Ctrl+Shift+E` | 行内公式 / 块级公式 |
| `Ctrl+Shift+8` / `Ctrl+Shift+7` | 无序 / 有序列表 |
| `Ctrl+Alt+V` | 循环切换 编辑 / 分栏 / 预览 |
| `Ctrl+\` | 折叠侧栏 |
| `Ctrl+Shift+P` | 命令面板（可搜索全部功能） |
| `Ctrl+Alt+,` | 设置 |
| `Ctrl+F` | 查找与替换 |
| `Ctrl+P` | 打印 / 导出 PDF |

> 为什么不绑 `Ctrl+N`？浏览器保留了这个组合键，网页无法拦截。
> 详见 `docs/PLAN.md` 的「刻意避开的按键」。

## 目录结构

```
MixMark/
├─ web/        唯一业务源码（所有平台的共同真身），运行期零构建
│  └─ vendor/  唯一的构建产物，**入库**（双击打开也能离线跑）
├─ desktop/    Electron 壳（主进程 + preload + 纯 Node 的磁盘层）
│  ├─ lib/         磁盘层，不依赖 Electron，可单独跑 `tools/check-fs.js`
│  └─ app/         `web/` 的构建期副本，由 `npm run copy-web` 生成（不入库）
├─ tools/      构建脚本 + 冒烟测试
├─ docs/       规划与变更文档
└─ CLAUDE.md   项目铁律与踩过的坑，改代码前先读
```

`web/` 是唯一真身：桌面端只是把它装进一个壳，多给了一个「真实文件夹」后端。
安卓端（Capacitor）尚未开始。

## 里程碑

| 阶段 | 状态 |
|---|---|
| M0 骨架 / M1 核心编辑 | ✅ |
| M2 文件系统（多后端存储、文件树、全文搜索） | ✅ |
| M3 导出与打磨（单文件 HTML、主题体系、查找替换、迁移链路） | ✅ |
| AI 助手（路线图外，按需求加入） | ✅ |
| M4 打包 · 桌面端（Electron + NSIS 安装器，文档真实落盘） | ✅ |
| M4 打包 · 安卓端（Capacitor APK） | ⬜ 未做 |

## 开发者命令

```powershell
npm.cmd install        # 仅首次，或依赖变更时
npm.cmd run vendor     # 重新生成 web/vendor（升级依赖时才需要）
npm.cmd run check      # 全量语法检查（改完 JS 必跑）
npm.cmd run serve      # 起本地静态服务器（Tier B，可启用完整存储能力）
```

> 日常改 `web/js`、`web/css` 后直接刷新浏览器即可，**不需要任何构建**。

### 打包桌面端

```powershell
cd desktop
npm.cmd install        # 仅首次
npm.cmd run build      # copy-web 同步 web/ → app/，再 electron-builder 出安装器
npm.cmd run check-fs   # 磁盘层自测（纯 Node，不启动 Electron）
```

产物在 `desktop/release/MixMark-<版本>-Setup.exe`。
调试时也可以 `npm.cmd start`，或带上 `--library <文件夹>` 启动即连。

## 冒烟测试

双击打开 `tools/experiments/m1-smoke.html`。

它会验证三条决定架构成败的假设：
1. `file://` 下能否加载 IIFE 经典脚本（依赖 CodeMirror 6）
2. `file://` 下 `@font-face` 字体能否加载（依赖 KaTeX 数学字体）
3. 中文输入法在编辑器内是否正常（需人工输入验证）
