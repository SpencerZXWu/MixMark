/**
 * MixMark · 预览 DOM → Markdown
 * ===============================================================
 * 「反向修改」的回写环节：用户在预览里改完，把一个 .mm-block 的 DOM
 * 重新序列化成 Markdown，再替换回源码里那几行。
 *
 * 为什么是「整块重写」而不是「按字符 diff」：
 *   DOM 里的文字和源码里的文字不是一回事 —— `**粗**` 在 DOM 里就是「粗」
 *   两个字，靠比对文字根本推不出中间那两个星号该不该留。要做得准，就得
 *   把 DOM 结构本身译回 Markdown。代价是**被编辑过的那一块**里的手工排版
 *   会被规范化（比如表格竖线对齐），块与块之间的空行、缩进、注释都不受影响。
 *
 * 覆盖 marked 能产出的全部块级结构 + 常用行内结构。
 * 认不出来的标签一律退化成它的纯文本，不丢内容。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 行内需要转义的字符。`>` 不在这儿 —— 它只有出现在行首才是引用。 */
  var INLINE_ESC = /([\\`*_~[\]<])/g;
  /** 行首有特殊含义，必须转义，否则一个普通段落会被读成标题 / 列表 / 引用 */
  var LEADING_ESC = /^([#>+\-]|\d+\.)(\s)/;

  function escapeText(s) {
    return String(s).replace(INLINE_ESC, '\\$1');
  }

  function protectLeading(s) {
    return s.replace(LEADING_ESC, '\\$1$2');
  }

  /** 把内容套上标记；内容两端的空格要挪到标记外面，否则 **不会** 被识别 */
  function wrap(marker, inner) {
    if (!inner) return '';
    var lead = /^\s*/.exec(inner)[0];
    var tail = /\s*$/.exec(inner)[0];
    var core = inner.slice(lead.length, inner.length - tail.length);
    if (!core) return inner;
    return lead + marker + core + marker + tail;
  }

  /** 反引号内容里如果本身有反引号，外面要多包几层 */
  function codeSpan(text) {
    var longest = 0;
    var runs = String(text).match(/`+/g);
    if (runs) for (var i = 0; i < runs.length; i++) longest = Math.max(longest, runs[i].length);
    var fence = new Array(longest + 2).join('`');
    var pad = /^`|`$/.test(text) ? ' ' : '';
    return fence + pad + text + pad + fence;
  }

  /**
   * 从渲染好的公式里把原始 TeX 挖出来。
   *
   * KaTeX 会把输入原封不动地存一份在 MathML 的
   * `<annotation encoding="application/x-tex">` 里（就是为了「复制公式能粘回
   * 去」这件事）。不取它的话，回写会把 `.katex` 里的文字全部拉平 ——
   * 而那是 HTML 与 MathML 两套渲染的叠加，`$E = mc^2$` 会变成
   * `E=mc2E = mc^2E=mc2`，公式当场就毁了。
   */
  function texOf(el) {
    var ann = el.querySelector && el.querySelector('annotation[encoding="application/x-tex"]');
    return ann ? ann.textContent : '';
  }

  function hasClass(el, name) {
    return !!(el.classList && el.classList.contains(name));
  }

  /**
   * 块级公式整块地看。
   *
   * `$$…$$` 经 protectMath 变成单行占位符，marked 于是给它包了一层 `<p>`。
   * 如果那个 `<p>` 里除去空白就只剩一条 katex-display，那它本来就是块级公式，
   * 要写成「单独成行」的三行形式，而不能挤进段落里。
   */
  function displayMathOnly(el) {
    var kids = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && !n.nodeValue.trim()) continue;
      kids.push(n);
    }
    if (kids.length !== 1 || kids[0].nodeType !== 1) return null;
    if (!hasClass(kids[0], 'katex-display')) return null;
    var tex = texOf(kids[0]);
    return tex || null;
  }

  /* ------------------------------------------------------------------
     行内
     ------------------------------------------------------------------ */

  function inline(node) {
    var out = '';

    for (var i = 0; i < node.childNodes.length; i++) {
      var n = node.childNodes[i];

      if (n.nodeType === 3) {
        out += escapeText(n.nodeValue);
        continue;
      }
      if (n.nodeType !== 1) continue;

      // 公式要在最前面拦下来：`.katex` 里面的东西不是 Markdown
      if (hasClass(n, 'katex-display')) {
        var dt = texOf(n);
        if (dt) out += '$$' + dt + '$$';
        continue;
      }
      if (hasClass(n, 'katex') || hasClass(n, 'mm-math-error')) {
        var it = texOf(n) || n.textContent;
        if (it) out += '$' + it + '$';
        continue;
      }

      var tag = n.tagName.toLowerCase();

      switch (tag) {
        case 'strong':
        case 'b':
          out += wrap('**', inline(n));
          break;

        case 'em':
        case 'i':
          out += wrap('*', inline(n));
          break;

        case 'del':
        case 's':
        case 'strike':
          out += wrap('~~', inline(n));
          break;

        case 'code':
          out += codeSpan(n.textContent);
          break;

        case 'a':
          out += link(n);
          break;

        case 'img':
          out += image(n);
          break;

        case 'br':
          /* 开了 breaks 时，源码里的**单个换行**就渲染成 <br> ——
             所以对它要写回普通换行，那才能真正对上。
             一律写 `  \n`（硬换行）的话，每编辑一次就给每行尾巴添两个
             空格，文档会越改越脏。
             breaks 关着时 <br> 只可能来自显式硬换行，那就得写两个空格。 */
          out += MM.settings && MM.settings.get('breaks') !== false ? '\n' : '  \n';
          break;

        case 'input':
          // 任务列表的勾选框在列表项那一层处理，这里跳过
          break;

        case 'script':
        case 'style':
          break;

        default:
          // kbd / mark / sub / sup / span … 没有等价语法，保留文字
          out += inline(n);
      }
    }

    return out;
  }

  function link(n) {
    var text = inline(n);
    var href = n.getAttribute('href') || '';
    if (!href) return text;
    // 纯文字等于地址时用尖括号写法，省一层括号
    if (text === escapeText(href)) return '<' + href + '>';
    return '[' + text + '](' + href.replace(/[()]/g, '\\$&') + ')';
  }

  function image(n) {
    var alt = escapeText(n.getAttribute('alt') || '');

    /* 拖拽引用会把裸文件名换成 blob: URL（见 ui/drop-assets.js），
       那是当下这一次会话才有效的地址，写进文档就永久坏了。
       所以优先用它换之前记下的那个原始写法。 */
    var src = (n.dataset && n.dataset.mdSrc) || n.getAttribute('src') || '';

    if (!src) return alt;
    return '![' + alt + '](' + src.replace(/[()]/g, '\\$&') + ')';
  }

  /* ------------------------------------------------------------------
     块级
     ------------------------------------------------------------------ */

  var HEADING = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

  function blockOf(el) {
    var tag = el.tagName.toLowerCase();

    if (HEADING[tag]) {
      var text = inline(el).trim();
      return new Array(HEADING[tag] + 1).join('#') + ' ' + text;
    }

    // 块级公式：单独占一段，不要被当成普通段落里的行内内容
    var displayTex = displayMathOnly(el);
    if (displayTex) return '$$\n' + displayTex + '\n$$';

    switch (tag) {
      case 'p':
        return protectLeading(indentLines(inline(el).trim(), ''));

      case 'ul':
        return listMarkdown(el, false, 0);

      case 'ol':
        return listMarkdown(el, true, 0);

      case 'blockquote':
        return quoteMarkdown(el);

      case 'pre':
        return fenceMarkdown(el);

      case 'hr':
        return '---';

      case 'table':
        return tableMarkdown(el);

      case 'div':
        // 浏览器在 contenteditable 里用 <div> 表示换行：当成一组块接着走
        return blocks(el);

      default:
        return protectLeading(indentLines(inline(el).trim(), ''));
    }
  }

  function indentLines(text, indent) {
    if (!indent) return text;
    return text.split('\n').map(function (l) {
      return l ? indent + l : l;
    }).join('\n');
  }

  /* ---- 列表 ---- */

  function listMarkdown(el, ordered, depth) {
    var pad = new Array(depth + 1).join('  ');
    var lines = [];
    var index = parseInt(el.getAttribute('start'), 10) || 1;

    for (var i = 0; i < el.children.length; i++) {
      var li = el.children[i];
      if (li.tagName.toLowerCase() !== 'li') continue;

      var marker = ordered ? (index++ + '. ') : '- ';

      // 勾选框：GFM 任务列表。它必须是列表项里的**第一个**元素
      var checkbox = null;
      for (var c = 0; c < li.children.length; c++) {
        var kid = li.children[c];
        if (kid.tagName === 'INPUT' && kid.getAttribute('type') === 'checkbox') {
          checkbox = kid;
          break;
        }
        if (kid.tagName !== 'P' || kid.children.length) break;
      }
      if (checkbox) marker += checkbox.checked ? '[x] ' : '[ ] ';

      // 拆成「自己的行内内容」和「嵌套的子列表」
      var own = [];
      var nested = [];

      for (var k = 0; k < li.childNodes.length; k++) {
        var n = li.childNodes[k];
        if (n === checkbox) continue;
        if (n.nodeType === 1) {
          var t = n.tagName.toLowerCase();
          if (t === 'ul' || t === 'ol') {
            nested.push({ el: n, ordered: t === 'ol' });
            continue;
          }
          // <p> 里如果只有勾选框和文字，取它的行内内容
          if (t === 'p') {
            own.push(inline(n));
            continue;
          }
          if (t === 'input') continue;
        }
        if (n.nodeType === 3) {
          own.push(escapeText(n.nodeValue));
          continue;
        }
        own.push(inline({ childNodes: [n] }));
      }

      var text = own.join('').trim();
      lines.push(pad + marker + text);

      for (var q = 0; q < nested.length; q++) {
        lines.push(listMarkdown(nested[q].el, nested[q].ordered, depth + 1));
      }
    }

    return lines.join('\n');
  }

  /* ---- 引用 ---- */

  function quoteMarkdown(el) {
    var inner = blocks(el);
    if (!inner) return '>';
    return inner.split('\n').map(function (l) {
      return l ? '> ' + l : '>';
    }).join('\n');
  }

  /* ---- 围栏代码块 ---- */

  function fenceMarkdown(el) {
    var code = el.querySelector('code');
    var text = (code || el).textContent.replace(/\n$/, '');

    var lang = '';
    if (code) {
      var m = /language-([\w+#-]+)/.exec(code.className || '');
      if (m) lang = m[1];
    }

    // 内容里出现更长的反引号串时要加长外围围栏，否则会把代码截断
    var longest = 0;
    var runs = text.match(/`+/g);
    if (runs) for (var i = 0; i < runs.length; i++) longest = Math.max(longest, runs[i].length);
    var fence = new Array(Math.max(3, longest + 1) + 1).join('`');

    return fence + lang + '\n' + text + '\n' + fence;
  }

  /* ---- 表格 ---- */

  function cellText(cell) {
    // 竖线在表格里是分隔符，内容里的必须转义
    return inline(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function tableMarkdown(el) {
    var head = el.querySelector('thead tr');
    var bodyRows = el.querySelectorAll('tbody tr');
    var lines = [];

    var headCells = head ? head.children : (bodyRows[0] ? bodyRows[0].children : []);
    if (!headCells.length) return '';

    var cols = [];
    for (var i = 0; i < headCells.length; i++) cols.push(cellText(headCells[i]));

    lines.push('| ' + cols.join(' | ') + ' |');

    /* 对齐不能丢。
       `:---:` 这些是写在分隔行里的，而渲染后它变成了 th 上的
       align / style。不读回来的话，改一次表格就把三列对齐全部拍平 ——
       而且是一去不回的那种丢。 */
    var marks = [];
    for (var c = 0; c < cols.length; c++) {
      var align = cellAlign(headCells[c]);
      marks.push(
        align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---'
      );
    }
    lines.push('| ' + marks.join(' | ') + ' |');

    // thead 缺失时第一行正文已经被当成表头用掉了，别再输出一遍
    var start = head ? 0 : 1;
    for (var r = start; r < bodyRows.length; r++) {
      var cells = bodyRows[r].children;
      var row = [];
      for (var k = 0; k < cols.length; k++) {
        row.push(cells[k] ? cellText(cells[k]) : '');
      }
      lines.push('| ' + row.join(' | ') + ' |');
    }

    return lines.join('\n');
  }

  /** 单元格的对齐方式，marked 写在 align 或 style 上（两种都可能） */
  function cellAlign(cell) {
    if (!cell || !cell.getAttribute) return '';
    var a = (cell.getAttribute('align') || '').toLowerCase();
    if (!a && cell.style && cell.style.textAlign) a = String(cell.style.textAlign).toLowerCase();
    if (a === 'middle') a = 'center';
    return a;
  }

  /* ------------------------------------------------------------------
     对外
     ------------------------------------------------------------------ */

  /** 把一个 .mm-block（或任意容器）序列化回 Markdown */
  function blocks(container) {
    var out = [];

    for (var i = 0; i < container.childNodes.length; i++) {
      var n = container.childNodes[i];
      if (n.nodeType === 3) {
        var text = n.nodeValue.trim();
        if (text) out.push(protectLeading(escapeText(text)));
        continue;
      }
      if (n.nodeType !== 1) continue;
      if (n.hasAttribute && n.hasAttribute('data-mm-ui')) continue;

      var md = blockOf(n);
      if (md && md.trim()) out.push(md);
    }

    return out.join('\n\n');
  }

  /** 只取行内文本（标题栏、表格单元格等场景） */
  function textOf(el) {
    return inline(el).trim();
  }

  MM.mdOut = {
    blocks: blocks,
    textOf: textOf,
    escapeText: escapeText
  };
})();
