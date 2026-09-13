# MixMark · 项目约定

> 本文件记录项目的铁律、约定与踩过的坑。改代码前先读一遍。

## 一、核心架构约束

### 1. 运行期零构建
`web/` 是纯静态目录，**双击 `web/index.html` 就能运行**，不需要 npm install、不需要打包。
- 只有 `web/vendor/` 是构建产物（用 esbuild 把 npm 包转成 IIFE）
- 升级依赖才需要跑 `npm.cmd run vendor`
- 产物**入库**（`.gitignore` 故意不忽略 `web/vendor/`）

### 2. `file://` 协议的硬限制（决定了整个架构）
| 能力 | `file://` 下 | 后果 |
|---|---|---|
| `<script type="module">` | ❌ CORS 拒绝 | 所有 vendor 必须是 IIFE 经典脚本 |
| `fetch()` / `XHR` 本地文件 | ❌ 拒绝 | 配置、模板、示例文档一律内联进 JS |
| Web Worker | ❌ 起不来 | 解析只能在主线程做，靠防抖 + 分片保护 |
| IndexedDB | ❌ 拒绝 | 浏览器兜底存储只能用 localStorage |
| File System Access API | ❌ 不可用 | 双击模式无法读写真实文件夹 |
| `localStorage` | ✅ 可用 | Tier A 的唯一可靠存储 |
| `@font-face` 加载 woff2 | ✅ 实测正常 | KaTeX 字体未被 CORS 拦截 |

### 3. 存储分级
```
Electron → Capacitor → FSA → IndexedDB → localStorage
（✅ M4）    （未做）  （✅ M2）  （✅ M2）    （✅ 兜底）
```
UI 层**永远不直接调用平台 API**，只走 `MM.provider.get()`。

仓库（`core/repos.js`）是 provider 外面的一层：
```
一个仓库 = 一份文档数据 + 一套属于它自己的工作台状态
    本地仓库 kind=electron/fsa   电脑上的一个真实文件夹
    本机文档库 kind=local/idb    浏览器存储，固定一个、不可移除
```
**谁跟着仓库走、谁全局共用**（用户拍板的划分）：
- 跟着仓库：上次打开的文档、展开的文件夹、打开的标签页、当前选中的文件夹
  （存 `mixmark:workbench:<repoId>`）
- 全局：主题 / 强调色 / 字体 / 字号 / 阅读栏宽 / 分栏比例 / API Key 与模型

判据是「这是数据的一部分，还是人的偏好」—— 前者换一堆资料就该重新算，
后者人在哪都一样。新增一个状态项时先问自己它属于哪边。

切仓库的顺序**不能变**：先让主进程连上文件夹（失败就到此为止），再改「当前仓库」
（工作台状态按它取存），最后才 `docs.reload({repoChanged:true})`。
四个入口（首页卡片 / 侧栏下拉 / 状态栏 / 设置页）都走 `MM.reposOps` 这一个出口。

桌面端这边多一条约定：**磁盘层不许 `require('electron')`**。
`desktop/lib/library-fs.js` 是纯 Node 的，所以能脱离壳单测
（`desktop/tools/check-fs.js`，42 项）—— 一个只在 Electron 里跑得起来的
文件系统层，等于每次改动都只能靠点界面去验。

两条容易踩的规矩：
- **能用 ≠ 现在可用。** 选路模块先对所有候选者调 `prepare()`（异步，允许它去读回状态），
  再调 `isAvailable()` 问“你现在能不能用”。FSA 就是这个例子：API 存在，但没连过目录
  （或权限已失效）就不算可用。把这两步合成一个同步判断，一定会在冷启动时选错后端。
- **切后端要拒绝“切过去也不能用”的选项。** `provider.use('fsa')` 在未连目录时必须抛错，
  否则用户会被扔进一个空空的新库，看起来像数据全丢了。

### 4. 数据模型（Tier A 的 localStorage 布局）

以下键名是 **localStorage 后端自己的编码方式**；上层看到的永远是逻辑键
（`docs` / `folders` / `doc:<id>`），换后端换介质时上层代码一行不用改。
下划线开头的键（如 `mixmark:__meta`）是后端内部状态，不算数据。

| 键 | 内容 |
|---|---|
| `mixmark:settings:v1` | 设置。含 `expandedFolders`（文件夹展开状态）与 `split` |
| `mixmark:docs:index` | 文档元数据 `[{ id, title, ctime, mtime, size, autoTitle, folderId }]` |
| `mixmark:folders:index` | 文件夹 `[{ id, name, parentId, ctime, mtime }]` |
| `mixmark:doc:<id>` | 正文明文，一篇一个键 |
| `mixmark:recovery` | 崩溃恢复快照（只留 1 份，覆盖写） |
| `mixmark:last-doc` | 上次打开的文档 id |

约定：
- 文件夹是**虚拟的**（Tier A 没有真实目录），靠 `parentId` 组成树；`parentId === null` 即根目录
- **展开状态属于视图偏好，存 settings 而不进文档数据** —— 换台设备打开不该继承别人的折叠状态
- 移动文件夹**必须防环**（不能移进自己的后代），否则整棵子树会脱树、界面上再也看不到
- `moveDoc` 用独立方法而不是 `touch()`：`touch` 会改 `mtime`，导致「只是换个位置」的文档跳到列表顶部

## 二、代码约定

- 全局命名空间：源码挂 `window.MM.*`，vendor 挂 `window.CM` / `marked` / `DOMPurify` / `katex` / `hljs`
- 每个文件是一个 IIFE，不导出模块，不做 tree-shaking 假设
- `index.html` 里的 `<script>` **顺序即依赖顺序**，不可随意调换
- 新增文案必须中英双语同时补齐（`js/i18n.js` 的 `STR.zh` / `STR.en`）
- 禁止硬编码面向用户的字符串，一律走 `MM.i18n.t()`
- 不用 `t` 作局部变量名（会遮蔽全局翻译函数）
- CSS 只允许引用设计令牌变量，不写字面量颜色

### 加一个格式化功能的正确姿势
在 `js/editor/actions.js` 里调用一次 `fmt(...)` 即可。工具栏按钮、快捷键、命令面板三处会自动出现，
**不要**单独去改 `shell.js` 或 `index.html`。

需要一整块面板而不是一个按钮时（如公式符号面板），改用自定义控件：
命令声明 `toolbar.widget`，实现在 `js/ui/symbol-panel.js` 那样的独立模块里 ——
入口仍然只有一处声明，只是内容自己画。

### 加一套主题 / 一个强调色 / 一档字体

三份清单的**唯一来源**是 `js/core/settings.js`：`THEMES` / `ACCENTS` / `FONT_STACKS`。
设置页、主题循环命令都从这里取。以前 shell.js 里也抄了一份主题名单，漏改过一次。

**加一个强调色**（不用碰任何主题）：在 `css/theme.css` 里补一组变量即可。
每个颜色只声明四档，映射规则在文件末尾统一决定哪个主题取哪一档：

| 档 | 给谁用 | 说明 |
|---|---|---|
| `--mm-accent-base` | 白昼 | 纯白底 |
| `--mm-accent-deep` | 雾灰 | 浅灰底，**只压深、不改色相** |
| `--mm-accent-warm` | 羊皮纸 | 暖底，色相往棕靠。**可选**，不写就回落 `deep` |
| `--mm-accent-lift` | 墨夜 / 纯黑 / 深海 | 深底，必须提亮否则被底色吞掉 |

`--mm-accent-weak` / `--mm-accent-ring` / `--mm-syn-link` 全部由映射规则用
`color-mix` 从强调色派生，**不要**再各写一份 rgba。

**加一个底色主题**：在 `theme.css` 里照着现有块补一份完整令牌，
再把 id 加进 `settings.js` 的 `THEMES`；若它是深底，还要加进 `DARK_THEMES`
（决定强调色走 lift 档、以及导出件的代码高亮用哪一套）和映射规则的选择器列表。
别忘了 `i18n.js` 里的 `themeXxx`（中英双语）。

**加一档字体**：`FONT_STACKS` 里加一项，界面与正文各给一套字族。
两者诉求不同 —— 界面 13px 要求一眼认出，正文要耐读，所以可以不一致
（「典雅」就是界面中文走雅黑、正文走楷体）。

映射规则里的选择器**刻意不写 `html` 前缀**（`[data-accent]` 而不是 `html[data-accent]`），
这样任意元素只要带上 `data-theme` + `data-accent` 就能局部渲染成那套配色 ——
设置页的主题缩略图靠的就是这一点，不用把色值在 JS 里再抄一份。

新配色必须过对比度审计：正文 ≥ 7:1、次要信息 / 链接 / 代码高亮 ≥ 4.5:1、
占位 ≥ 3:1、边框与选中底色也要量可见性（做法见坑 29）。

## 三、命令

```powershell
npm.cmd run vendor    # 重建 web/vendor（仅升级依赖时）
npm.cmd run check     # 全量检查：JS 语法 + CSS 注释/花括号配对，改完必跑
npm.cmd run serve     # 本地静态服务器（Tier B 环境，可测 IndexedDB / FSA）

# 桌面端（在 desktop/ 里跑）
npm.cmd install       # 仅首次
npm.cmd run check-fs  # 磁盘层自测：纯 Node，不启动 Electron（先跑这个）
npm.cmd run build     # copy-web（web/ → app/）+ electron-builder → 安装器
npm.cmd run build:dir # 只出 release/win-unpacked，不出安装器（快）

# 调试桌面端（--library 启动即连，也是唯一能脚本化的入口，见坑 39）
.\node_modules\electron\dist\electron.exe . --library "D:\笔记" --remote-debugging-port=9333

# 冒烟测试（含三个关键风险验证，长期保留作回归用例）
#   直接双击打开 → tools/experiments/m1-smoke.html

# 浏览器里手动验证前注意：
#   内置浏览器不合成帧时 CSS 过渡不会推进，getComputedStyle 会一直返回
#   过渡的**起始值**（例如 display 切换后仍读到 visibility:hidden）。
#   测这类“展开/渐变”状态时先注入：
#     *,*::before,*::after{transition:none !important;animation:none !important}
```

## 四、缓存铁律

改完 `css/*` 或 `js/*` 后，把 `web/index.html` 里所有 `?v=N` **全部 +1**。

## 五、已踩过的坑（都是真金白银）

1. **`\s` 会吃掉换行符**
   围栏代码块检测必须用 `[ \t]{0,3}` 表示缩进，不能用 `\s{0,3}`。
   `head = src.slice(i, i+8)` 这种窗口可能跨行边界，`\s` 匹配到换行后会让空行被误判成围栏，
   进而「开围栏被当成闭合、闭合围栏反而打开围栏」，导致整篇文档的公式全部失效。

2. **`doc.sliceDoc` 不存在**
   `view.state.doc` 是 `Text` 对象，只有 `length` / `line()` 等；
   取文本要用 `view.state.sliceDoc(from, to)`。

3. **DOMPurify 的 `FORBID_TAGS` 里不要写 `input`**
   任务列表靠 `<input type="checkbox">` 渲染，禁掉它会整段退化成纯文本。

4. **防抖任务必须校验文档身份**
   `scheduleStats` / `scheduleSave` 都要记住「这次任务属于哪个 docId」，回调时比对，
   否则「编辑 A → 立刻切到 B」会把 A 的字数大纲贴到 B 上，A 的修改还会永久丢失。
   切换文档前一律先 `MM.docs.flushPending()`。

5. **`document.fonts.check()` 会假阴性**
   字体是按需懒加载的，公式没用到某个字号字体就不会去请求，check() 返回 false。
   判断字体是否可用要遍历 `[...document.fonts]` 看 `status === 'loaded'`。

6. **`performance.getEntriesByType('resource')` 在 `file://` 下恒为 0 条**
   Chrome 不为 file:// 子资源记录 resource timing，不能用它判断「有没有发起请求」。

7. **行内代码的反引号搜索不能跨行**
   用 `src.indexOf('`')` 全篇搜索会因一个未配对的反引号吞掉整篇文档。
   必须限制在当前行内查找。

8. **预览滚动容器的定位上下文**
   `.preview-scroll` 必须 `position: relative`，否则 `.mm-block` 的 `offsetTop`
   不是相对滚动容器的，同步滚动坐标全错。

9. **编辑工具可能插错位置或吞掉边界字符**
   用 `replace_string_in_file` 做大段替换后，**务必重跑 `npm.cmd run check`** 并读回上下文确认。
   本项目已遇到 3 次：两次是替换块被插到别的函数里，一次是 CSS 注释的结束符
   被一起删掉 —— 后者会让后面几十行规则整段变成注释，而浏览器不报任何错，
   只表现为「样式莫名其妙没生效」。改完 CSS 一定要跑 `check`（已加入注释配对
   与花括号配平校验）。另外别在块注释里写出注释符号本身，否则会提前结束注释。

10. **编辑区不做「居中阅读栏」**
    `.cm-scroller` 是 flex 容器，子项依次是 `[.cm-gutters 行号][.cm-content 正文]`。
    若给正文设 `max-width` + `margin: auto`，宽屏下正文会被推到中间，
    行号栏却被留在最左边 —— 两者间空出两百多像素，看起来像排版错乱。

    本项目的决定是**不居中**：`#editor-host .cm-content` 不设 `max-width`，
    从行号栏右侧铺满整个编辑区。`--mm-measure`（阅读栏宽）只控制预览区。
    理由：编辑区是「写」的地方，铺满更好用；预览区是「读」的地方，需要控行宽。

    如果将来确实要做居中，必须给分组**两端**各加一个 auto 外边距
    （行号栏 `margin-left: auto` + 正文 `margin-right: auto`），
    否则单侧的 auto 外边距会独占剩余空间、把兄弟项甩在原地。
    验证方法：`getBoundingClientRect()` 量两者间距是否为 0。

11. **绝不用终端文本命令改源码文件**
    `Get-Content -Raw` 会按 ANSI 读、`Set-Content -Encoding UTF8` 再写一次，
    中文立刻变成双重编码的乱码。本项目已经把 `index.html` 这样弄坏过一次。
    改文件只用编辑工具；PowerShell 只用来跑命令、看输出。

12. **IndexedDB 要等 `req.onsuccess`，不是 `tx.oncomplete`**
    用事务的 `oncomplete` 当完成信号，再 `req.result ?? req` 取值，
    对**不存在的键**会返回 `IDBRequest` 对象本身，序列化时就变成
    `"[object IDBRequest]" is not valid JSON` —— 表现为“索引莫名其妙判定损坏并重置”。
    每个请求自己都有 `onsuccess`/`onerror`，等它们就不会错。

13. **选区高光不能用「弱化色」**
    `--mm-accent-weak`（10%）当选中背景，屏幕上几乎看不出选中了哪一段。
    选中态需要的是**明量的底色**，另开一个令牌（`--mm-selection`，26%）用
    `color-mix` 从强调色派生，这样换主题自动跟随。深色主题要更浓（34%）。
    另外编辑器有「聚焦/非聚焦」两套选区规则，只覆盖其中一套会让切到预览区时高光“白掉”。

14. **靠 `box-shadow` 溢出的「接缝圆角」会盖住下一个容器的内容**
    侧栏标签的凹形圆角是伪元素 + `box-shadow` 向下方多铺 10px 补出来的，
    必然越过接缝进到面板里。面板若**不是定位元素**、标签按钮是，按绘制顺序
    定位元素画得更晚 —— 那 10px 补色就压在面板顶部内容上。
    文档/大纲页的首行是透明图标按钮，所以一直没暴露；搜索框有自己的底色
    （`--mm-bg-sub`），立刻显出两个半圆。
    修法：给 `.sidebar__panel` 加 `position: relative; z-index: 1`，
    溢出的补色被同色面板挡住（本来就是重复填色），凹弧画在标签行内部不受影响。
    别用 `overflow: hidden` 裁 —— 那会连带把键盘焦点环的底边一起切掉。
    判断这类问题别靠 `elementsFromPoint`（它走命中测试，而伪元素多半
    `pointer-events: none`），直接量两者的 `getBoundingClientRect()` 看几何重叠，
    再把补色临时改成醒目色截图，一眼就能看出有没有越界。

15. **注册全局快捷键会抢走输入框里的原生行为**
    `commands.handleKeydown` 是挂在 `document` 上的**捕获**监听，命中就
    `preventDefault` + `stopPropagation`，而且全项目就这一个派发入口。
    所以「在 contenteditable 里本来就有正确行为」的操作（撤销、剪切、复制、粘贴）
    一律只登记 `menuKey`（仅供菜单展示），不登记 `key`。
    确实需要全局注册时（如 Ctrl+F），务必配 `enabled()` 把输入框场景排除掉：
    `handleKeydown` 对 `!enabled` 是 `continue`，不会拦截，原生行为得以保留。

16. **FSA 在 `file://` 下是「函数存在但调用被拒」**
    浏览器照样把 `showOpenFilePicker` / `showDirectoryPicker` 挂在 window 上，
    只看 `typeof === 'function'` 会误判为可用 —— 表现就是「点了没反应」。
    判据必须是 `typeof === 'function' && (protocol === 'http:' || 'https:')`。
    `provider/fsa.js` 与 `provider/diskfile.js` 现在共用这一条。

17. **`[hidden]` 会被自己的 `display` 盖掉**
    UA 样式表里的 `[hidden] { display: none }` 打不过作者样式里的
    `.x { display: flex }`（作者样式优先于 UA 样式），于是 hidden 失效。
    凡是「用 flex 布局又要能 hidden」的容器，必须补一条
    `.x[hidden] { display: none }`。

18. **内联样式压得住类选择器**
    品牌启动动画要把前缀宽度收到 0。起始宽度是量出来的、CSS 里写不出来，
    只能写内联；而内联优先级高于 `.brand.is-settled .brand__welcome`，
    于是「收到 0」那一步也得写内联。只写一半的后果很隐蔽：
    类里写了 `width: 0` 也被内联的起始宽度压着，过渡压根不触发。
    另外记得在改宽度前后读一次 `offsetWidth`，否则同一个任务里的两次
    变更会被合并成一次更新，动画仍然不会跑。

19. **删当前文档前先 `save({force:true})`，否则它会“复活”**
    `docs.remove()` 删掉当前文档后会去 `open()` 下一篇，而 `open()` 开头
    要调 `flushPending()`。此时 `current` 还指着刚被删的那篇、`dirty` 还是 true，
    于是 `flushPending()` → `save({force:true})` → `provider.write(已删的 id, ...)`，
    又把文档写回去了（FSA 后端下就是真在磁盘上重新出现一个文件）。
    所以先 force save 把文档库那份刷成“不脏”，再 remove。

20. **`MM.editor.setContent` 只改视图，不改模型**
    它走的是 `view.setState`（为的是清空撤销栈），**不做脏标记**，
    所以它只适合用在模型与视图本来就一致的时候（如 `doc:opened` 之后）。
    用它“伪造”一段内容、紧接着又触发一次编辑，那次编辑会把视图里的
    内容写进**当前文档**的模型 —— 测试时可把我坑到过：
    把测试文本写进了欢迎文档，重启后才发现正文被换了。
    调试时改内容请走 `view.dispatch({changes})`，那是正常编辑路径。

21. **工具栏自定义控件走 `toolbar.widget`**
    命令声明 `toolbar: { widget: '名字' }`，实现在 `MM.toolbarWidgets['名字'](def, flyout, wrap)`。
    外壳（悬浮展开/点击钉住/外点关闭）由 shell.js 统一给，控件只填 `flyout` 内容。
    面板比触发按钮宽得多时**不要指望 CSS 定位**：下拉区的包含块是只有几十像素宽的
    `.tb-group`，左右对齐都可能把它甩出编辑区（窄窗口尤其明显）。
    正确做法是展开前按编辑区实际宽度算一次、写内联 `width`/`left`。
    另外 `scrollWidth` 的最小值就是容器自身宽度，
    判断“内容放不下”必须量子元素的宽度，否则每个格子都会被判成放不下。

22. **`view.hasFocus` 会假阴性**
    CodeMirror 的 `view.hasFocus` 基于 `document.hasFocus()`，页面不在前台
    （VS Code 内置浏览器、工具窗口、内嵌预览）就恒为 false。
    凡是「有焦点才做事」的逻辑（如公式补全）都得看
    `document.activeElement` 是否落在 `view.dom` 里，否则表现为
    「明明在打字，功能死活不触发」，而且本地开个真窗口测不出来。

23. **`dispatch` 是同步的，抑制标记必须写在它之前**
    `view.dispatch()` 会同步跑完 updateListener。公式补全插入模板后若想
    「别把刚插入的这条又提示一遍」，标记必须在 dispatch **之前**写好，
    否则那一次 update 读到的是旧标记。
    有占位符的模板（`\dfrac{x}{y}`）刚好能掩盖这个顺序错误 —— 光标落在 `{}`
    里，正则不匹配；只有 `\alpha`、`\forall` 这种**没有占位符**的模板才会暴露。

24. **别引用别的模块没导出的函数**
    `MM.symbolPanel` 只导出了 `parseTemplate` 等几个，`stripMarkers` 是内部函数。
    引用它会报 `is not a function`，而且是在**渲染时**炸（整个候选列表空白，
    位置也不对），而非启动时。需要去占位标记直接用 `parseTemplate(tpl).text`——
    它本来就顺手去掉 `«»`，改占位符语法也只需改一处。

25. **`requestAnimationFrame` 可能永远不执行**
    VS Code 内置浏览器实测：rAF **0 次/600ms**，而 `setTimeout` 正常 ——
    页面不合成帧时 rAF 根本不推进。凡是「绑在 rAF 上」的功能（滚动同步、
    过渡收尾、延迟测量）在这些环境里会**静默失效**，表现为「有时候好、
    有时候完全不动」，而且本地开个真窗口测不出来。
    要么直接做（滚动同步就该同步算，最多按时间戳去重），
    要么走 `MM.scrollSync.afterLayout()` 那种 rAF + setTimeout 双保险。

    另一个连带后果：这个环境下 **scroll 事件也不派发** ——
    手动设 `scrollTop` 会真的滚，但不触发事件。所以验证滚动类逻辑时
    必须自己 `dispatchEvent(new Event('scroll'))` 把事件补上。

26. **测量前先问「量得到吗」**
    元素 `display:none` 时 `offsetTop` / `offsetHeight` **恒为 0**，
    `ResizeObserver` 又会因为尺寸归零而触发回调 —— 两者一碰上，
    缓存的好索引就被一整排 0 覆盖，回来后再也对不上。
    测量函数入口必须挡住这种状态（`offsetParent !== null` 或尺寸 > 0），
    宁可什么都不做。

27. **缓存的几何要有「过期」判据**
    靠事件通知重测总会漏（图片加载、字体到位、外部改样式）。
    自校准的比法最稳：测量时记下「容器内容总高 − 最后一个元素底边」
    这个固定差值，之后拿同样的差值一比就知道有没有变 ——
    不需要对 CSS 的 padding / margin 做任何假设。

28. **带防抖的写入必须在退出前 flush**
    `settings.persist()` 有 300ms 防抖（拖字号滑块会高频触发，不防抖会写爆）。
    但「换个主题 → 马上关标签页」正好落在那个窗口里，改动凭空消失。
    所以 settings.js 同时挂了 `beforeunload` 与 `visibilitychange → hidden` 两处 flush，
    并把 `flush` 导出成 `MM.settings.flush()` 以便测试。
    以后凡是「写 localStorage 且带防抖」的地方，都要照这个补一遍。

    （同一类坑还提醒一件事：**测试时的「旧代码」**。改完 `js/*` 只升 `?v=N`，
    浏览器里**已经打开的那个页面**还跑着旧脚本；要在上面做回归，
    必须先刷新一次再操作，否则会把「旧代码的行为」当成新 bug 排查半天。）

29. **量对比度要先把 CSS 变量套到真实属性上**
    `getComputedStyle(el).getPropertyValue('--mm-x')` 对自定义属性返回的是
    **替换过 var() 但没求值 color-mix() 的 token 串**，直接当颜色用会解析失败。
    正确做法：造一个探针元素，`el.style.color = 'var(--mm-x)'`，
    再读 `getComputedStyle(el).color` —— 那才是求值后的 `rgba()`。
    另外新版 Chrome 对半透明混合结果可能返回 `color(srgb r g b / a)`
    （分量是 0~1），只认 `rgb(`/`rgba(` 的解析器会把它当成「解析失败」，
    于是把好配色误报成不达标。审计脚本两种格式都要认。

30. **CodeMirror 的 StateField 必须自己列进 extensions**
    只在别人的回调里**引用**它不算注册。行引用复选框就是这么踩的：
    `CM.gutter({ markers: view => view.state.field(f) })` 里引用了字段，
    gutter 画出来了、`state.field(f)` 却取不到，一个复选框都不出现。
    正确写法是返回一个数组 `[f, CM.gutter({...})]`。
    同理，gutter 想给**每一行**都放东西（哪怕是个空壳），就必须每行都加一个
    marker —— gutters 只给「有 marker 的行」生成 DOM，没 marker 的行连
    可点的元素都没有。代价是 O(行数) 的 RangeSet，长文档要么设上限，要么别这么用。

31. **从 marker 反推状态时要认值，别把占位符算进去**
    上一条的那个 RangeSet 里，**没勾的行也有 marker**（空复选框）。
    文档变化后用 `iter()` 回读行号时，如果不判 `iter.value.checked`，
    会把整篇都算成「已勾选」—— 而且只在编辑过一次之后才显形。

32. **gutter 事件回调里的 `line` 没有 `number`**
    `CM.gutter({ domEventHandlers: { mousedown(view, line, event) } })` 的第二个
    参数是**视口里的块信息**（只有 `from` / `to` / `top` / `bottom`），
    不是 `@codemirror/state` 那个带 `number` 的 `Line`。
    `line.number` 恒为 `undefined`；行号要用
    `view.state.doc.lineAt(line.from).number` 自己算。

    这个坑的可怕之处在于**它不改都能用**：写代码时看着像对的，
    一路 `undefined` 变成 `NaN` 进了状态，最后表现为「芯片写着第 NaN 行」
    加「复选框全部不亮」两个看起来毫不相干的症状。
    凡是从外部接口拿数字的入口，都补一道 `Number.isFinite` 护栏。

33. **`t.list` 覆盖整个列表项，不只是那个 `-`**
    在 HighlightStyle 里把 `tags.list` 映射成「记号色」（浅灰），
    会把**列表正文**一起涂淡 —— 而 `tags.processingInstruction` 才是
    `-` / `#` / `**` 这些记号的标签。两者别混。
    教训：给某个 tag 上色前，先在浏览器里量一下它到底盖住了哪些文字，
    别照着名字猜。

34. **「正文先落盘、索引后写」会让文件名丢掉标题**
    库层的写入顺序是「先写正文、后写索引」—— 这个顺序本身是对的
    （索引写失败时不会留下一打开就空白的文档）。但磁盘层要按标题定文件名，
    而那一刻索引里还没有这条，于是退回用 id 命名，用户的文件夹里就出现
    一堆 `dmtz9d5xo3lx56.md`。

    修法：给 `set()` 加一个**可选的第三参 meta**，磁盘层先查索引、
    查不到就用调用方带过来的那份。其他后端忽略这个参数即可。
    教训：只要「写正文」这个动作依赖索引里的信息，就得把那份信息显式传下去，
    不能指望它已经在索引里。

35. **文件名后缀别写死**
    `fileNameFor` 原来固定拼 `.md`，结果收编进来的 `.txt` 一被对齐就改名成 `.md`。
    现在后缀跟着 `format` 走。注意这是两处改动：推导后缀要改，
    **收编时也得把格式记进索引** —— 只改前者，下次对齐又会被索引里的旧值改回去。

36. **结构变化后要主动触发一次磁盘对齐，删除路径最容易被漏掉**
    改名 / 换文件夹 / 删除之后，磁盘上的 `.md` 不会自己跟着走。
    库层的 create / rename / moveDoc / moveFolder / remove / renameFolder /
    removeFolder 末尾都调一次 `alignDisk()`，它是**可选调用**
    （`typeof backend.sync === 'function'`），浏览器那几个后端没有这一步，跳过即可。

    漏掉删除路径的后果特别隐蔽：文件删了，**空目录留在磁盘上**，
    界面上完全看不出来 —— 得 `Get-ChildItem -Recurse` 才看得见。

37. **Windows 上第一次打包会卡在 winCodeSign 的符号链接**
    报 `Cannot create symbolic link : ...\darwin\10.12\lib\libcrypto.dylib`
    —— electron-builder 的 `winCodeSign` 包里带了两个 macOS 符号链接，
    解压它们需要管理员权限或开发者模式，而它们跟 Windows 打包毫无关系。
    手动铺缓存即可（跳过 `darwin`）：
    ```powershell
    $za = 'desktop\node_modules\7zip-bin\win\x64\7za.exe'
    & $za x "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\<hash>.7z" `
         "-o$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0" `
         -x!darwin -y
    ```
    目录名必须是 `winCodeSign-2.6.0`（app-builder 按「名字-版本」找），
    里面补齐 `rcedit-x64.exe` 与 `windows-10\x64\signtool.exe` 就算成。

38. **杀终端 ≠ 杀应用**
    `kill_terminal` 只结束 PowerShell，Electron 的子进程会留着继续跑，
    占着 `--remote-debugging-port` 和单实例锁 —— 下次启动会**静默直接退出**，
    日志里只有一行 `bind() returned an error`。

    检测残留时别刚 `Stop-Process` 就下结论：那一瞬间 `Get-Process` 还能看到
    "终止中"的进程，而 `taskkill` 反而会说 not found。要么查两次，要么直接换端口。

39. **桌面端唯一能脚本化的入口是命令行参数**
    「选文件夹」的系统对话框没法自动点，所以「连上 → 读 → 写 → 落盘」这条链路
    本来根本验不了。加了 `--library <文件夹>`（本身就是有用功能：快捷方式带路径）
    之后，配合 `--remote-debugging-port` + CDP 就能把整条链路跑一遍：
    启动 → 问状态 → 建文档 → 看磁盘上有没有那个文件、叫什么名字。

    这一步立刻抓出三个只在「真跑起来」时才显形的问题（id 当文件名、
    `.txt` 被改名、空目录残留）—— 全靠浏览器端自测一个都发现不了。
    以后凡是「多端/多环境」的改动，都先想一下有没有可脚本化的入口。

40. **递归扫用户磁盘的代码，先想「最坏会扫到什么」**
    `adoptExisting()` 会递归扫用户选的文件夹。实测把仓库根当库时，
    一个 `node_modules` 就收进来 676 篇第三方 README/LICENSE，文档树直接淹掉。
    现在按目录名跳过 `.git` / `.hg` / `.svn` / `node_modules` / `__pycache__` /
    `.venv` 这一类（用 `toLowerCase()` 比，任何一层都生效），
    并给结果加了上限（`MAX_ADOPT = 3000`）。

    连带教训：**`.mixmark/` 要写进 `.gitignore`**。用 MixMark 打开一个文件夹就会
    长出这个元数据目录，拿仓库（或它上层的任何目录）当库时，它会被
    `git add -A` 一起提交进去 —— 本项目就这幺误提交过一次 11184 行。

41. **桌面端自测会直接写进用户的真实数据里**
    `%APPDATA%\mixmark-desktop` 是**用户的**数据（localStorage 里的仓库登记与文档、
    `desktop.json` 里的上次连接）。用 CDP 跑自测脚本时，任何一次
    `MM.reposOps.enter()` / `MM.repos.add()` 都会真的改到它 ——
    本项目已经因此把用户的「当前仓库」切走过一次，还往他的列表里塞了一个
    临时文件夹。

    指望 `--user-data-dir` 隔离是**没用的**：实测传了它，localStorage 照样
    读到了用户已有的仓库（`app.getPath('userData')` 仍是默认值）。
    要真正隔离，只能在主进程 `ready` 之前 `app.setPath('userData', ...)`，
    而那是改产品代码。

    所以规矩是：
    - 能不在桌面端测的就别在桌面端测。`npm run serve` 换个端口就是另一个
      origin，localStorage 天然隔离（端口不同即不同源），零风险。
    - 非要在桌面端测，先 `Copy-Item` 一份 `%APPDATA%\mixmark-desktop` 到临时目录，
      测完再覆盖回去；脚本里**只读**优先，写操作明确列出来。
    - 测试用的 `--library` 目录别用真实笔记文件夹，用 `$env:TEMP` 下的。

42. **`app.getPath()` 在模块顶层就求值了**
    `main.js` 里 `const CONFIG_FILE = path.join(app.getPath('userData'), ...)`
    这样的写法意味着**之后**再改 `userData` 也没用，路径已经定死了。
    要支持「换个数据目录」这类开关，得让路径变成函数现算，或者保证
    `setPath` 发生在模块加载之前。

43. **mermaid 那套东西全是「跟别处不一样」的**
    图表（UML / 流程 / 时序 / 状态 / ER / 甘特）都走 mermaid，它和预览里
    其他渲染有四处根本差别，改管线前先记住：

    - **它 5MB，所以按需加载。** `web/vendor/mermaid.bundle.js` **刻意不写进
      `index.html`**，由 `pipeline.js` 在第一次真的遇到 ```mermaid 时动态插
      `<script>`。也幸亏它是经典脚本 —— `file://` 下拒的是
      `type="module"`，插普通 script 标签没事。
    - **它是异步的，所以必须有代次号。** `renderMath` 那趟是同步的，
      而 mermaid 要往 body 里插临时节点量文字宽度，只能 `await`。
      于是它渲染完才回头改 DOM —— 而 `renderNow` 每次都整体换掉
      `container.innerHTML`。`renderToken` 就是防这个：异步回调开工前先
      比一下自己还是不是当班的那批，不然结果会写进不属于它的那一版。
    - **DOMPurify 不管它。** 图表是在净化之后才生成的 DOM，`FORBID_TAGS`
      里有 `style` —— 真让它过一遍，渲染出来就是「有图无色」。安全靠
      mermaid 自己的 `securityLevel: 'strict'`。
    - **主题换了要重画。** 预览里别的元素都跟着 CSS 变量走，唯独 mermaid
      把颜色固化在 SVG 属性里。`pipeline.js` 监听 `settings.onChange` 里
      的 `theme` 重新渲染一遍，否则切深色后图表还是白底黑字。

    另外两条小的：`highlightCode` 必须跳过 `language-mermaid`（不然 hljs 会把
    `graph TD` 涂得花花绿绿），以及关掉 `htmlLabels`（默认拿
    `<foreignObject>` 包 HTML 排版，导出与打印时很不稳）。

44. **示例文档别塞进 i18n.js**
    欢迎文档又长又双语，但它是**一篇 Markdown 正文**，不是界面文案：
    它出现在文档树里、会被用户顺手改掉。放在 `core/welcome.js`，
    `docs.js` 只管调。标题判定要**两种语言都认** —— 顶栏拿它决定
    「标题位留不留空」，而「中文标题 + 英文界面」这种组合是会出现的。

## 六、术语

| 词 | 含义 |
|---|---|
| Tier A/B/C/D | 运行环境分级：file:// / http(s) / Electron / Capacitor |
| 仓库（repo） | 一份文档数据 + 它自己的工作台状态。本地仓库 = 一个真实文件夹；本机文档库 = 浏览器存储 |
| 工作台状态 | 跟着仓库走的那几项：上次打开的文档、展开的文件夹、标签页、当前选中的文件夹 |
| 块（block） | 预览区里被 `.mm-block` 包裹的一个顶层 Markdown 元素 |
| 行号索引 | `.mm-block[data-line]` → 源码行号的映射，同步滚动的基础 |
