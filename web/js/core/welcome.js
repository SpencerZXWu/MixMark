/**
 * MixMark — 首启示例文档（欢迎文档）
 * ===============================================================
 * 为什么单独一个文件，而不是塞进 i18n.js：
 * 这是一篇**很长的 Markdown 正文**，不是界面上的零碎文案。它还会出现在
 * 文档树里被用户随手改掉 —— 跟「换个按钮文字」完全不是一类东西。
 *
 * 但它仍然是双语的：首启时按当时的界面语言给一份。语言之后再改，
 * 已经生成的那篇不会跟着变（它已经是一篇真文档了，改它等于改用户内容）。
 *
 * 内容刻意把每种语法都放一遍 —— 它同时是渲染管线的冒烟样本：
 * 打开它就等于把代码高亮、公式、图表、表格、任务列表全跑了一遍。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var TITLES = ['欢迎使用 MixMark', 'Welcome to MixMark'];

  var ZH = [
    '# ' + TITLES[0],
    '',
    '一个极简的 Markdown 编辑器。所有内容都保存在**你自己的设备**上。',
    '',
    '## 快速上手',
    '',
    '- 左侧输入，右侧实时预览',
    '- `Ctrl + S` 立即保存（平时会自动保存）',
    '- `Ctrl + Shift + P` 打开命令面板，可以搜索所有功能',
    '- 左侧侧栏可以切换「文档」和「大纲」两个面板',
    '- 点左上角的仓库名可以切换仓库 —— 每个仓库的文档彼此独立',
    '',
    '## 支持的语法',
    '',
    '行内代码 `const a = 1`，**加粗**，*斜体*，~~删除线~~，还有[链接](https://example.com)。',
    '',
    '> 引用块：适合放摘录或提示。',
    '',
    '```js',
    '// 代码块会按语言高亮',
    'function greet(name) {',
    '  return `你好，${name}`;',
    '}',
    '```',
    '',
    '### 数学公式',
    '',
    '行内公式 $E = mc^2$，块级公式：',
    '',
    '$$',
    '\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}',
    '$$',
    '',
    '### 图表',
    '',
    '把围栏标成 `mermaid`，就会渲染成 UML 与各种流程图 —— 类图、时序图、',
    '状态图、ER 图、甘特图都支持。一个类图：',
    '',
    '```mermaid',
    'classDiagram',
    '  class Document {',
    '    +String title',
    '    +String folderId',
    '    +save()',
    '  }',
    '  class Repository {',
    '    +String path',
    '    +open()',
    '  }',
    '  Repository "1" --> "*" Document : 存放',
    '```',
    '',
    '一个时序图：',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  participant 你',
    '  participant 编辑器',
    '  participant 预览区',
    '  你->>编辑器: 敲下字符',
    '  编辑器->>预览区: 80ms 防抖后渲染',
    '  预览区-->>你: 实时看到结果',
    '```',
    '',
    '### 表格',
    '',
    '| 功能 | 快捷键 |',
    '| --- | --- |',
    '| 加粗 | Ctrl + B |',
    '| 斜体 | Ctrl + I |',
    '| 保存 | Ctrl + S |',
    '| 命令面板 | Ctrl + Shift + P |',
    '',
    '### 任务列表',
    '',
    '- [x] 打开 MixMark',
    '- [x] 读到这里',
    '- [ ] 写下你的第一篇笔记',
    '',
    '---',
    '',
    '把这段内容全选删掉，就可以开始你自己的写作了。'
  ].join('\n');

  var EN = [
    '# ' + TITLES[1],
    '',
    'A minimal Markdown editor. Everything stays on **your own device**.',
    '',
    '## Getting started',
    '',
    '- Type on the left, see it rendered on the right',
    '- `Ctrl + S` saves immediately (it also autosaves as you go)',
    '- `Ctrl + Shift + P` opens the command palette — every feature is searchable',
    '- The sidebar switches between the document tree and the outline',
    '- Click the repository name in the top-left corner to switch repositories —',
    '  each one keeps its documents to itself',
    '',
    '## What you can write',
    '',
    'Inline code `const a = 1`, **bold**, *italic*, ~~strikethrough~~, and [links](https://example.com).',
    '',
    '> Blockquotes work well for excerpts or asides.',
    '',
    '```js',
    '// Fenced code is highlighted per language',
    'function greet(name) {',
    '  return `Hello, ${name}`;',
    '}',
    '```',
    '',
    '### Math',
    '',
    'Inline math $E = mc^2$, and display math:',
    '',
    '$$',
    '\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}',
    '$$',
    '',
    '### Diagrams',
    '',
    'Tag a fence as `mermaid` and it renders as UML or any of the usual diagram',
    'types — class, sequence, state, ER, Gantt. A class diagram:',
    '',
    '```mermaid',
    'classDiagram',
    '  class Document {',
    '    +String title',
    '    +String folderId',
    '    +save()',
    '  }',
    '  class Repository {',
    '    +String path',
    '    +open()',
    '  }',
    '  Repository "1" --> "*" Document : holds',
    '```',
    '',
    'A sequence diagram:',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  participant You',
    '  participant Editor',
    '  participant Preview',
    '  You->>Editor: keystroke',
    '  Editor->>Preview: render after 80ms debounce',
    '  Preview-->>You: you see it live',
    '```',
    '',
    '### Tables',
    '',
    '| Feature | Shortcut |',
    '| --- | --- |',
    '| Bold | Ctrl + B |',
    '| Italic | Ctrl + I |',
    '| Save | Ctrl + S |',
    '| Command palette | Ctrl + Shift + P |',
    '',
    '### Tasks',
    '',
    '- [x] Open MixMark',
    '- [x] Read this far',
    '- [ ] Write your first note',
    '',
    '---',
    '',
    'Select all of this, delete it, and start writing.'
  ].join('\n');

  /** 当前界面语言下的那份 */
  function content() {
    return MM.i18n.getLocale() === 'en' ? EN : ZH;
  }

  /**
   * 判断一篇文档是不是欢迎文档 —— 两种语言的标题都算。
   *
   * 顶栏要用它：这份示例叫「欢迎使用 MixMark」，而顶栏最左边本来就写着
   * MixMark，摆在一起就是同一句话说了两遍，所以标题位留空。
   * 两种都认是为了「中文标题 + 英文界面」这种组合也不露馅。
   */
  function isTitle(title) {
    return TITLES.indexOf(title) !== -1;
  }

  MM.welcome = {
    TITLES: TITLES,
    content: content,
    isTitle: isTitle
  };
})();
