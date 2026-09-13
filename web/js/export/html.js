/**
 * MixMark · 单文件 HTML 导出
 * ===============================================================
 * 产出一个「发给别人、双击就能看」的 HTML：正文、排版样式、代码高亮、
 * 公式字体全部装在那个文件里，不依赖网络，也不依赖这台机器上的任何路径。
 *
 * 两处刻意的安排：
 *
 *   1. KaTeX 的字体是**构建期**转好的 base64（vendor/katex/katex-inline.js）。
 *      因为 file:// 下 fetch 被禁，运行时读不到 woff2 再转码。
 *      那个文件约 360KB，不写进 index.html —— 点了导出才加载一次。
 *      动态插 <script src> 在 file:// 下是允许的（经典脚本不是 module）。
 *
 *   2. 导出的排版样式是**另写一份**，没有复用 css/preview.css：
 *      预览样式建立在应用的 CSS 令牌上（换主题整体变色、字号跟随设置项），
 *      而导出件要脱离应用独立存在，还得在任何浏览器里长得一样。
 *      它只需要「当前主题的颜色值」—— 这些在运行时用
 *      getComputedStyle 读出来，写进导出件自己的 :root 里。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 字体内联产物的加载 Promise：连点两次导出也只加载一个 script */
  var fontPromise = null;

  /** 从应用当前主题里搬过来的颜色令牌 */
  var THEME_TOKENS = [
    '--mm-bg',
    '--mm-surface',
    '--mm-surface-2',
    '--mm-text-1',
    '--mm-text-2',
    '--mm-text-3',
    '--mm-border',
    '--mm-accent',
    /* 字体也一并带走：导出件不该在读者那里变成另一种字体
       （二者都是系统字体栈，不引入任何外部字体文件） */
    '--mm-font-text',
    '--mm-font-ui'
  ];

  /**
   * 导出件的排版样式。
   * 颜色一律走上面那几个令牌，所以这份规则本身与主题无关。
   */
  var DOC_CSS = [
    '*{box-sizing:border-box}',
    'body{margin:0;padding:48px 24px;background:var(--mm-bg);color:var(--mm-text-1);',
    'font:16px/1.75 var(--mm-font-text)}',
    '.mm-doc{max-width:74ch;margin:0 auto}',
    'h1,h2,h3,h4,h5,h6{margin:1.6em 0 .6em;line-height:1.3;font-weight:600}',
    'h1{font-size:1.9em;margin-top:0;padding-bottom:.3em;border-bottom:1px solid var(--mm-border)}',
    'h2{font-size:1.5em;padding-bottom:.25em;border-bottom:1px solid var(--mm-border)}',
    'h3{font-size:1.25em}',
    'h4{font-size:1.1em}',
    'p{margin:1em 0}',
    'a{color:var(--mm-accent)}',
    'ul,ol{padding-left:1.6em}',
    'li{margin:.35em 0}',
    'li>ul,li>ol{margin:.35em 0}',
    'blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid var(--mm-border);color:var(--mm-text-2)}',
    'hr{border:0;border-top:1px solid var(--mm-border);margin:2em 0}',
    'img{max-width:100%;height:auto}',
    'code{font-family:ui-monospace,"Cascadia Code",Consolas,monospace;font-size:.9em}',
    ':not(pre)>code{background:var(--mm-surface-2);padding:.15em .38em;border-radius:4px}',
    'pre{margin:1em 0;padding:14px 16px;border-radius:8px;background:var(--mm-surface-2);overflow:auto}',
    'pre code{background:none;padding:0;font-size:.875em;line-height:1.6}',
    'table{border-collapse:collapse;margin:1em 0;display:block;overflow:auto}',
    'th,td{border:1px solid var(--mm-border);padding:.5em .85em}',
    'th{background:var(--mm-surface-2);font-weight:600}',
    /* 图表：SVG 已经内联在克隆下来的预览 DOM 里，导出件**不需要任何脚本**，
       也不需要 mermaid 本体（那是 5MB）。这里只管排版。 */
    '.mm-mermaid{margin:1.2em 0;padding:12px;border:1px solid var(--mm-border);',
    'border-radius:8px;background:var(--mm-surface-2);overflow-x:auto;text-align:center}',
    '.mm-mermaid svg{max-width:100%;height:auto}',
    'pre.mm-mermaid-failed{border-color:#b3261e}',
    '.mm-mermaid-error{margin:.6em 0;padding:8px 12px;border-radius:6px;',
    'background:#fdecea;color:#b3261e;font-size:.9em}',
    /* 任务列表：去掉项目符号，只留勾选框 */
    'li.mm-task,li:has(>input[type=checkbox]){list-style:none;margin-left:-1.3em}',
    'input[type=checkbox]{margin-right:.4em}',
    /* 代码高亮：浅底一套、深底一套，靠 <html data-scheme> 切换。
       用 data-scheme 而不是逐个主题列名字：新加主题时这里不用改。
       （旧版把 sepia 归进了深底那一组，结果导出件里代码是浅灰字配
       米色底，几乎看不见 —— 已修正） */
    '.hljs{color:#24292e}',
    '.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}',
    '.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag{color:#d73a49}',
    '.hljs-string,.hljs-regexp,.hljs-addition{color:#032f62}',
    '.hljs-number,.hljs-symbol,.hljs-bullet{color:#005cc5}',
    '.hljs-title,.hljs-name,.hljs-section,.hljs-selector-id{color:#6f42c1}',
    '.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:#005cc5}',
    '.hljs-built_in,.hljs-type,.hljs-class .hljs-title{color:#e36209}',
    '.hljs-meta{color:#735c0f}',
    '.hljs-deletion{color:#b31d28;background:#ffeef0}',
    '[data-scheme=dark] .hljs{color:#c9d1d9}',
    '[data-scheme=dark] .hljs-comment,',
    '[data-scheme=dark] .hljs-quote{color:#8b949e}',
    '[data-scheme=dark] .hljs-keyword,',
    '[data-scheme=dark] .hljs-literal{color:#ff7b72}',
    '[data-scheme=dark] .hljs-string,',
    '[data-scheme=dark] .hljs-regexp{color:#a5d6ff}',
    '[data-scheme=dark] .hljs-number,',
    '[data-scheme=dark] .hljs-symbol{color:#79c0ff}',
    '[data-scheme=dark] .hljs-title,',
    '[data-scheme=dark] .hljs-name{color:#d2a8ff}',
    '[data-scheme=dark] .hljs-attr,',
    '[data-scheme=dark] .hljs-built_in{color:#ffa657}',
    /* 打印：别把白边和背景色一起打出来 */
    '@media print{body{padding:0;background:#fff;color:#000}.mm-doc{max-width:none}',
    '.mm-mermaid{padding:0;border:none;background:none}',
    'pre,blockquote,table,.mm-mermaid{page-break-inside:avoid}}'
  ].join('\n');

  /* ------------------------------------------------------------------
     资源
     ------------------------------------------------------------------ */

  /** 加载字体内联产物；失败就返回空串，让导出继续（公式退化为无字体） */
  function loadKatexCss() {
    if (window.MM_KATEX_CSS) return Promise.resolve(window.MM_KATEX_CSS);
    if (fontPromise) return fontPromise;

    fontPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'vendor/katex/katex-inline.js';
      s.onload = function () {
        resolve(window.MM_KATEX_CSS || '');
      };
      s.onerror = function () {
        resolve('');
      };
      document.head.appendChild(s);
    });

    return fontPromise;
  }

  /** 把当前主题的颜色令牌读出来，写成导出件自己的 :root */
  function themeCss() {
    var cs = getComputedStyle(document.documentElement);
    var parts = [];

    THEME_TOKENS.forEach(function (k) {
      var v = cs.getPropertyValue(k).trim();
      if (v) parts.push(k + ':' + v);
    });

    return ':root{' + parts.join(';') + '}';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------
     组装
     ------------------------------------------------------------------ */

  /** 取预览区渲染好的正文，剥掉只对应用有意义的属性 */
  function takeBody() {
    var preview = document.getElementById('preview');
    if (!preview || !preview.innerHTML.trim()) return '';

    var clone = preview.cloneNode(true);

    // data-line 是行号索引，给同步滚动用的，导出件里没有意义
    var marked = clone.querySelectorAll('[data-line]');
    for (var i = 0; i < marked.length; i++) {
      marked[i].removeAttribute('data-line');
    }

    return clone.innerHTML;
  }

  function buildHtml(title, body, katexCss) {
    var root = document.documentElement;
    var theme = root.getAttribute('data-theme') || 'light';
    var lang = root.getAttribute('lang') || 'zh-CN';
    // 明暗基调由设置模块写好；没读到就按主题名猜一个，保证代码高亮不会跟错组
    var scheme = root.getAttribute('data-scheme') || (theme === 'light' ? 'light' : 'dark');

    // CSS 里出现 </style 会提前结束样式块（虽然 KaTeX 里不会有，防一手）
    var safeKatex = katexCss.replace(/<\/style/gi, '<\\/style');

    return [
      '<!DOCTYPE html>',
      '<html lang="' + lang + '" data-theme="' + theme + '" data-scheme="' + scheme + '">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escapeHtml(title) + '</title>',
      '<style>' + themeCss() + '\n' + DOC_CSS + '</style>',
      safeKatex ? '<style>' + safeKatex + '</style>' : '',
      '</head>',
      '<body>',
      '<article class="mm-doc">',
      body,
      '</article>',
      '</body>',
      '</html>',
      ''
    ]
      .filter(function (line) {
        return line !== false && line !== null;
      })
      .join('\n');
  }

  /* ------------------------------------------------------------------
     命令
     ------------------------------------------------------------------ */

  MM.commands.registerAll([
    {
      id: 'export.html',
      titleKey: 'cmdExportHtml',
      group: 'export',
      run: function () {
        if (!MM.docs.content()) {
          MM.toast.show(MM.i18n.t('toastNothingToCopy'));
          return;
        }

        var body = takeBody();
        if (!body) {
          MM.toast.danger(MM.i18n.t('toastPreviewNotReady'));
          return;
        }

        var title = MM.docs.displayTitle() || 'untitled';

        return loadKatexCss().then(function (katexCss) {
          if (!katexCss) {
            // 不静默：字体缺席时公式会明显不对，得让用户知道为什么
            MM.toast.danger(MM.i18n.t('toastExportNoFont'));
          }

          var name = MM.exportUtil.safeFileName(title) + '.html';
          MM.exportUtil.download(name, buildHtml(title, body, katexCss), 'text/html');
          MM.toast.ok(MM.i18n.t('toastExported', { name: name }));
        });
      }
    }
  ]);
})();
