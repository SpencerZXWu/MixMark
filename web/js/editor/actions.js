/**
 * MixMark · 编辑动作
 * ===============================================================
 * 所有 Markdown 格式化命令集中在这里。
 *
 * 每个命令同时声明 toolbar 元数据，编辑器工具栏会据此自动生成 ——
 * 加一个格式化功能只需要在这里注册一次，工具栏、快捷键、命令面板
 * 三处同时生效，不需要改 UI 代码。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /* ------------------------------------------------------------------
     注册辅助
     ------------------------------------------------------------------ */

  /**
   * @param {string} name     命令名（会自动补上 format. 前缀）
   * @param {string} titleKey i18n key
   * @param {string} label    工具栏上显示的短标签（也是下拉项里的图标）
   * @param {Function} run    执行体
   * @param {object} [opts]   { key, order, variant, svg, group }
   *                          toolbar.group 相同的「连续命令」会被合并成一个下拉按钮
   */
  function fmt(name, titleKey, label, run, opts) {
    opts = opts || {};
    return MM.commands.register({
      id: 'format.' + name,
      titleKey: titleKey,
      // 注意：这个 group 是命令面板里的分类，与 toolbar.group 不是一回事
      group: 'format',
      key: opts.key,
      run: run,
      toolbar: {
        label: label,
        order: opts.order || 0,
        /** 工具栏分组 id，相同则合并为下拉按钮 */
        group: opts.group || null,
        /** 特殊标签的呈现方式，由 CSS 决定 */
        variant: opts.variant || null,
        /** 可选：用 SVG 代替文字标签（避免彩色 emoji 破坏工具栏的单调统一） */
        svg: opts.svg || null
      }
    });
  }

  /* ------------------------------------------------------------------
     工具栏分组
     合并后工具栏从 17 个按钮缩到 10 个，同类功能收在同一个入口里。
     组的元数据在这里声明一次，命令只需声明自己属于哪一组。
     ------------------------------------------------------------------ */

  MM.commands.registerGroup('heading', { label: 'H', titleKey: 'tbHeading' });
  MM.commands.registerGroup('code', { label: '</>', titleKey: 'tbCode' });
  MM.commands.registerGroup('list', { label: '•', titleKey: 'tbList' });

  /* ------------------------------------------------------------------
     标题
     ------------------------------------------------------------------ */

  var H_RE = /^#{1,6}\s+/;

  function heading(level) {
    return function () {
      MM.editor.toggleLinePrefix(new Array(level + 1).join('#') + ' ', H_RE);
    };
  }

  fmt('h1', 'fmtH1', 'H1', heading(1), { key: 'Mod+Alt+1', order: 10, group: 'heading' });
  fmt('h2', 'fmtH2', 'H2', heading(2), { key: 'Mod+Alt+2', order: 11, group: 'heading' });
  fmt('h3', 'fmtH3', 'H3', heading(3), { key: 'Mod+Alt+3', order: 12, group: 'heading' });

  /* ------------------------------------------------------------------
     行内标记
     ------------------------------------------------------------------ */

  fmt(
    'bold',
    'fmtBold',
    'B',
    function () {
      MM.editor.wrapSelection('**', '**', MM.i18n.t('fmtBold'));
    },
    { key: 'Mod+B', order: 20, variant: 'bold' }
  );

  fmt(
    'italic',
    'fmtItalic',
    'I',
    function () {
      MM.editor.wrapSelection('*', '*', MM.i18n.t('fmtItalic'));
    },
    { key: 'Mod+I', order: 21, variant: 'italic' }
  );

  fmt(
    'strike',
    'fmtStrike',
    'S',
    function () {
      MM.editor.wrapSelection('~~', '~~', MM.i18n.t('fmtStrike'));
    },
    { key: 'Mod+Shift+X', order: 22, variant: 'strike' }
  );

  fmt(
    'code',
    'fmtInlineCode',
    '</>',
    function () {
      MM.editor.wrapSelection('`', '`', 'code');
    },
    { key: 'Mod+E', order: 23, variant: 'mono', group: 'code' }
  );

  fmt(
    'codeblock',
    'fmtCodeBlock',
    '{ }',
    function () {
      var selected = MM.editor.getSelectionText();
      var body = selected || '';
      // 围栏语言留空，用户可自行补 js / python
      MM.editor.insertBlock('```\n' + body + '\n```', 3);
    },
    { key: 'Mod+Shift+K', order: 24, variant: 'mono', group: 'code' }
  );

  fmt(
    'link',
    'fmtLink',
    '链接',
    function () {
      // 有选中文本时把它变成链接文字，并选中 URL 部分方便直接粘贴；
      // 没有选中则插入空链接，光标落在方括号里
      var selected = MM.editor.getSelectionText();
      if (selected) {
        MM.editor.insertAndSelect(
          '[' + selected + '](https://)',
          selected.length + 3,
          selected.length + 11
        );
      } else {
        MM.editor.insertAndSelect('[](https://)', 1, 1);
      }
    },
    {
      key: 'Mod+K',
      order: 24,
      // 用单色 SVG 而不是 emoji，保证工具栏视觉统一
      svg:
        '<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 006 .5l2-2a4 4 0 00-5.7-5.7l-1 1"/>' +
        '<path d="M14 11a4 4 0 00-6-.5l-2 2A4 4 0 0011.7 18l1-1"/></svg>'
    }
  );

  /* ------------------------------------------------------------------
     块级
     ------------------------------------------------------------------ */

  var LIST_RE = /^\s*(?:[-*+]|\d+\.)\s+/;
  var TASK_RE = /^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s*)?/;

  fmt(
    'quote',
    'fmtQuote',
    '❝',
    function () {
      MM.editor.toggleLinePrefix('> ', /^>\s?/);
    },
    { key: 'Mod+Shift+.', order: 30 }
  );

  fmt(
    'ul',
    'fmtUl',
    '•',
    function () {
      MM.editor.toggleLinePrefix('- ', LIST_RE);
    },
    { key: 'Mod+Shift+8', order: 31, group: 'list' }
  );

  fmt(
    'ol',
    'fmtOl',
    '1.',
    function () {
      MM.editor.toggleLinePrefix('1. ', LIST_RE);
    },
    { key: 'Mod+Shift+7', order: 32, group: 'list' }
  );

  fmt(
    'task',
    'fmtTask',
    '☑',
    function () {
      MM.editor.toggleLinePrefix('- [ ] ', TASK_RE);
    },
    { order: 33, group: 'list' }
  );

  fmt(
    'table',
    'fmtTable',
    '▦',
    function () {
      // 用 A / B 这类占位表头：不涉及文案翻译，且各行语言用户都能看懂
      MM.editor.insertBlock('| A | B |\n| --- | --- |\n|  |  |', 2);
    },
    { order: 34 }
  );

  fmt(
    'hr',
    'fmtHr',
    '—',
    function () {
      MM.editor.insertBlock('---');
    },
    { order: 35 }
  );

  /* ------------------------------------------------------------------
     数学公式
     ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------
     公式符号面板

     这里原来是「行内公式 / 块级公式」两条命令，现在换成一个符号面板：
     分类（数学 / 物理 / 化学 / 统计学 / 工程技术）+ 成片的符号格子，
     点一下插进正文，光标不在 $...$ 里会自动帮忙包上。

     两百多个符号塞不进横向下拉区，所以它不是一个「分组」
     而是一个自定义控件 —— 面板本体在 ui/symbol-panel.js，
     这里只登记入口（命令面板与快捷键），保证加功能不用改 UI 代码。
     ------------------------------------------------------------------ */

  MM.commands.register({
    id: 'math.symbols',
    titleKey: 'cmdMathSymbols',
    group: 'format',
    key: 'Mod+Shift+M',
    run: function () {
      MM.symbolPanel.toggle('math');
    },
    toolbar: {
      label: 'fx',
      order: 40,
      variant: 'mono',
      widget: 'math'
    }
  });

  // 语言与功能符号：标点、货币、序号、图形、键盘键、单位……
  // 它们是正文字符，所以既不走 KaTeX 渲染，也不在插入时包 $ $
  MM.commands.register({
    id: 'text.symbols',
    titleKey: 'cmdTextSymbols',
    group: 'format',
    key: 'Mod+Shift+U',
    run: function () {
      MM.symbolPanel.toggle('text');
    },
    toolbar: {
      label: '¶',
      order: 41,
      widget: 'text'
    }
  });
})();
