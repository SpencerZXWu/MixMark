/**
 * MixMark · 渲染管线
 * ===============================================================
 *   Markdown 源码
 *     → 保护数学公式（避免 _ * \ 被当成 Markdown 语法）
 *     → marked 按顶层块逐块渲染，每块包一层 [data-line]
 *     → DOMPurify 净化
 *     → 代码块高亮
 *     → 回填 KaTeX 公式
 *     → 建立行号索引（交给 line-map）
 *
 * 为什么按顶层块逐块渲染：
 *   同步滚动需要「预览区元素 ↔ 源码行号」的映射。marked 不提供行号，
 *   但它给出的 token 带有 raw 原文，可以累加换行数推算出每块的起始行。
 *   逐块渲染再包一层容器，是最直接、零猜测的做法。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var container = null;
  var renderTimer = null;
  var lastSrc = '';
  /** 上一次渲染记录的公式原文，DOM 回填阶段要用 */
  var lastMathStore = [];
  /**
   * 渲染代次。
   *
   * 图表（mermaid）是异步的：它渲染完再回头改 DOM。而每次 renderNow 都会
   * 整体换掉 container.innerHTML —— 如果不记代次，一个慢吞吞的图表回来时
   * 可能把结果写进**已经不属于它的那一版** DOM，或者往一个断开的节点上挂。
   * 异步回调开工前先比一下这个数。
   */
  var renderToken = 0;

  /** 单次渲染耗时超过这个值就提示降级（大文档保护） */
  var SLOW_RENDER_MS = 300;
  /** 超过这个长度不再做代码语言自动识别（highlightAuto 在大块上很慢） */
  var AUTO_DETECT_LIMIT = 5000;

  var MATH_OPEN = '\uE000';
  var MATH_CLOSE = '\uE001';

  /* ------------------------------------------------------------------
     数学公式保护
     ------------------------------------------------------------------ */

  /**
   * 把 $...$ / $$...$$ 换成占位符并记录原文。
   *
   * 为什么必须保护：如果直接交给 marked，公式里的 `x_1` 会被当成
   * 强调语法、`*` 会变成列表、反斜杠会被吃掉，渲染结果就废了。
   *
   * 必须跳过围栏代码块与行内代码 —— 那里的 $ 是字面量。
   * 用逐字符扫描而不是正则，因为要正确跟踪代码围栏的开合状态。
   *
   * 占位符后面补上与原公式等量的换行，保证行号映射不偏移。
   */
  function protectMath(src, store) {
    var out = '';
    var i = 0;
    var len = src.length;
    var fence = null; // 当前处于 '`' 或 '~' 围栏中
    var atLineStart = true;

    while (i < len) {
      var ch = src.charAt(i);

      /* ---- 行首：检查围栏开合 ---- */
      if (atLineStart) {
        // 窗口取 8 字符：要容得下「最多 3 个缩进 + 3 个围栏符」
        var head = src.slice(i, i + 8);

        /* 这里必须用 [ \t] 而不是 \s！
           \s 包含换行符，而 head 是一个可能跨越行边界的窗口：
           对 "\n```" 这种输入，\s{0,3} 会吃掉那个换行，让正则匹配成功，
           于是「空行」被误判成围栏行 ——
           后果是真正的开围栏被当成闭合、真正的闭合围栏反而打开了围栏，
           此后整篇文档都被当作代码，公式全部失效。（已踩过） */
        var fm = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(head);

        if (fm) {
          var marker = fm[1].charAt(0);
          if (!fence) fence = marker;
          else if (marker === fence) fence = null;

          var lineEnd = src.indexOf('\n', i);
          if (lineEnd === -1) {
            out += src.slice(i);
            break;
          }
          out += src.slice(i, lineEnd + 1);
          i = lineEnd + 1;
          atLineStart = true;
          continue;
        }
      }

      /* ---- 代码围栏内原样复制 ---- */
      if (fence) {
        var nl = src.indexOf('\n', i);
        if (nl === -1) {
          out += src.slice(i);
          break;
        }
        out += src.slice(i, nl + 1);
        i = nl + 1;
        atLineStart = true;
        continue;
      }

      /* ---- 行内代码原样复制 ---- */
      if (ch === '`') {
        // 只在「当前这一行」里找配对的闭合反引号。
        // 若用 src.indexOf 全篇搜索，一个未配对的反引号会把后面整篇文档
        // 都吞进代码段，公式与语法高亮全部失效。
        var curLineEnd = src.indexOf('\n', i);
        if (curLineEnd === -1) curLineEnd = len;

        var ticks = /^`+/.exec(src.slice(i, curLineEnd))[0];
        var close = src.indexOf(ticks, i + ticks.length);

        if (close === -1 || close >= curLineEnd) {
          // 本行内没有闭合，按普通字符处理，不吞后续内容
          out += ch;
          i += 1;
          atLineStart = false;
          continue;
        }

        out += src.slice(i, close + ticks.length);
        i = close + ticks.length;
        atLineStart = false;
        continue;
      }

      /* ---- 转义字符：跳过两个字符，\$ 不算公式 ---- */
      if (ch === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
        atLineStart = false;
        continue;
      }

      /* ---- 公式 ---- */
      if (ch === '$') {
        var isBlock = src.charAt(i + 1) === '$';
        var delim = isBlock ? '$$' : '$';
        var from = i + delim.length;
        var end = src.indexOf(delim, from);

        if (end !== -1) {
          var tex = src.slice(from, end);
          // 行内公式不允许跨行；块级公式允许
          var okInline = isBlock || tex.indexOf('\n') === -1;

          if (okInline && tex.trim()) {
            var idx = store.length;
            store.push({ tex: tex, block: isBlock });

            var newlines = tex.match(/\n/g);
            out +=
              MATH_OPEN + idx + MATH_CLOSE + (newlines ? new Array(newlines.length + 1).join('\n') : '');

            i = end + delim.length;
            atLineStart = false;
            continue;
          }
        }
      }

      out += ch;
      atLineStart = ch === '\n';
      i += 1;
    }

    return out;
  }

  /* ------------------------------------------------------------------
     逐块渲染
     ------------------------------------------------------------------ */

  /**
   * 把「裸 Windows 路径」补成 file:// URL。
   *
   * 从资源管理器复制来的路径长这样：C:\Users\me\a.png。
   * 它能直接当 img 的 src 用吗？不能 —— 浏览器只认
   * file:///C:/Users/me/a.png。而且 DOMPurify 会先把不合规的 src 洗掉，
   * 所以必须赶在净化之前改写。
   *
   * 反斜杠一并换成斜杠：实测 file:///E:\x\y.png 浏览器也能认，
   * 但换成正斜杠更规范，也不会在某些解析路径上出意外。
   */
  function normalizeLocalPaths(html) {
    return html.replace(/(src|href)="([A-Za-z]:[\\/][^"]*)"/g, function (all, attr, raw) {
      var url = raw.replace(/\\/g, '/');
      if (url.charAt(0) !== '/') url = '/' + url;
      return attr + '="file://' + url + '"';
    });
  }

  /**
   * 文本文档的预览：整篇当纯文本，一个 Markdown 语法都不认。
   *
   * 不这么做的话，一篇 .txt 里写 `# 配置` 会变成一级标题、
   * `- item` 会变成列表 —— 那不是用户写的东西。
   *
   * 仍然包一层 .mm-block[data-line="1"]：滚动同步靠这个选择器建行号映射，
   * 一个块也给它一个，映射退化成「指向文档开头」，但不会因为找不到块而报错。
   */
  function renderPlain(src) {
    var text = String(src == null ? '' : src);
    var esc = text.replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });

    return {
      html:
        '<div class="mm-block mm-block--plain" data-line="1">' +
        '<pre class="mm-plain">' +
        esc +
        '</pre></div>',
      blockCount: 1,
      mathCount: 0
    };
  }

  function renderHtml(src) {
    // 文本文档不解析 Markdown
    if (MM.store.get().format === 'txt') return renderPlain(src);
    if (!window.marked) {
      console.error('[preview] window.marked 不存在');
      return { html: '', blockCount: 0, mathCount: 0 };
    }

    var opts = {
      gfm: true,
      breaks: MM.settings.get('breaks') !== false
    };

    var mathStore = [];
    lastMathStore = mathStore;
    var protectedSrc = protectMath(src, mathStore);

    var tokens;
    try {
      tokens = window.marked.lexer(protectedSrc, opts);
    } catch (err) {
      console.error('[preview] 词法分析失败', err);
      return { html: '<p class="mm-math-error">Markdown 解析失败</p>', blockCount: 0, mathCount: 0 };
    }

    var parts = [];
    var line = 1;
    var blockCount = 0;

    for (var t = 0; t < tokens.length; t++) {
      var token = tokens[t];
      var startLine = line;
      var raw = token.raw || '';
      var newlines = raw.match(/\n/g);
      line += newlines ? newlines.length : 0;

      // 纯空白 token 只占行，不产出内容
      if (token.type === 'space') continue;

      var html;
      try {
        html = window.marked.parser([token], opts);
      } catch (err) {
        console.error('[preview] 块渲染失败，已跳过', token.type, err);
        continue;
      }

      if (!html) continue;

      var extraClass = token.type === 'table' ? ' mm-block--table' : '';
      parts.push(
        '<div class="mm-block' + extraClass + '" data-line="' + startLine + '">' + html + '</div>'
      );
      blockCount++;
    }

    var joined = parts.join('\n');

    // 净化：显式打开 data-* 属性，否则 data-line 会被清掉、滚动同步失效
    var clean = joined;
    if (window.DOMPurify) {
      clean = window.DOMPurify.sanitize(normalizeLocalPaths(joined), {
        ADD_ATTR: ['data-line', 'data-lang', 'target'],
        ALLOW_DATA_ATTR: true,
        /* 只禁真正有风险的类型。
           注意不要把 input 写进来 —— marked 的 GFM 任务列表就是靠
           <input type="checkbox" disabled> 渲染的，禁掉它会让
           「- [x] 事项」全部退化成纯文本。 */
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick'],
        /* 允许 file: 与 blob: 形式的 URI。
           DOMPurify 默认白名单里没有 file:，会把
           <img src="file:///C:/.../a.png"> 的 src 直接洗掉，
           表现就是图片静默消失 —— 这是「用系统路径引图」必须过的一关。
           blob: 留给拖拽引用（句柄转 blob URL）用。 */
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|file|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
      });
    } else {
      console.warn('[preview] DOMPurify 未加载，已跳过净化（存在注入风险）');
    }

    return { html: clean, blockCount: blockCount, mathCount: mathStore.length };
  }

  /* ------------------------------------------------------------------
     渲染后处理
     ------------------------------------------------------------------ */

  function highlightCode(root) {
    if (!window.hljs) return;

    var blocks = root.querySelectorAll('pre > code');
    for (var i = 0; i < blocks.length; i++) {
      var codeEl = blocks[i];
      var pre = codeEl.parentElement;
      var raw = codeEl.textContent;

      var cls = codeEl.className || '';
      var m = /language-([\w+#-]+)/.exec(cls);
      var lang = m ? m[1].toLowerCase() : '';

      // mermaid 的源码要原样交给 mermaid 自己解析。走了 hljs 只会
      // 把 graph TD 这类写法涂得花花绿绿，对渲染一点帮助都没有。
      if (lang === 'mermaid') continue;

      try {
        if (lang && window.hljs.getLanguage(lang)) {
          codeEl.innerHTML = window.hljs.highlight(raw, {
            language: lang,
            ignoreIllegals: true
          }).value;
        } else if (raw.length <= AUTO_DETECT_LIMIT && raw.trim()) {
          var auto = window.hljs.highlightAuto(raw);
          codeEl.innerHTML = auto.value;
          if (!lang && auto.language) lang = auto.language;
        }
      } catch (err) {
        // 高亮失败不影响内容展示，保留纯文本即可
        console.warn('[preview] 代码高亮失败', err);
      }

      // 语言标签显示在块右上角（配合 preview.css 的 [data-lang]::before）
      if (pre) pre.setAttribute('data-lang', lang || '');
    }
  }

  /**
   * 把占位符换成 KaTeX 渲染结果。
   * 在 DOM 上做而不是在 HTML 字符串上做 —— 字符串替换容易踩到
   * 属性值里恰好含占位符的坑，遍历文本节点则精准无误。
   */
  function renderMath(root, mathStore) {
    if (!window.katex || !mathStore.length) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var targets = [];

    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (node.nodeValue && node.nodeValue.indexOf(MATH_OPEN) !== -1) targets.push(node);
    }

    var re = new RegExp(MATH_OPEN + '(\\d+)' + MATH_CLOSE, 'g');

    targets.forEach(function (node) {
      var text = node.nodeValue;
      var frag = document.createDocumentFragment();
      var cursor = 0;
      var match;

      re.lastIndex = 0;
      while ((match = re.exec(text)) !== null) {
        if (match.index > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        }

        var item = mathStore[Number(match[1])];
        frag.appendChild(mathNode(item));

        cursor = match.index + match[0].length;
      }

      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }

      node.parentNode.replaceChild(frag, node);
    });
  }

  function mathNode(item) {
    if (!item) return document.createTextNode('');

    var span = document.createElement('span');
    try {
      span.innerHTML = window.katex.renderToString(item.tex, {
        displayMode: !!item.block,
        throwOnError: false,
        strict: false,
        output: 'htmlAndMathml'
      });
    } catch (err) {
      // 语法错误时把原始 TeX 显示出来，用户能直接看到问题在哪
      span.className = 'mm-math-error';
      span.textContent = item.tex;
    }
    return span;
  }

  /* ------------------------------------------------------------------
     UML / 流程图（Mermaid）
     ------------------------------------------------------------------ */

  var MERMAID_SRC = 'vendor/mermaid.bundle.js';
  var mermaidPromise = null;
  var mermaidTheme = null;

  /**
   * 按需读 mermaid。
   *
   * 产物 5MB（含 dagre / cytoscape 等布局引擎），而绝大多数文档里一个图表
   * 都没有，所以刻意**不写进 index.html** —— 第一次真的遇到 ```mermaid 才去读。
   * 它是经典脚本，`file://` 下插 script 标签不受 CORS 限制。
   */
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (mermaidPromise) return mermaidPromise;

    mermaidPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = MERMAID_SRC;
      s.onload = function () {
        if (window.mermaid) resolve(window.mermaid);
        else reject(new Error('mermaid 没有挂到 window 上'));
      };
      s.onerror = function () {
        mermaidPromise = null; // 允许下次再试（比如当时文件读不到）
        reject(new Error('读不到 ' + MERMAID_SRC));
      };
      document.head.appendChild(s);
    });

    return mermaidPromise;
  }

  /**
   * 让图表配色跟上当前主题。切主题后重新 initialize 一次即可换色。
   *
   * securityLevel 必须是 strict：图表内容来自文档，而文档可能是别人给的。
   * strict 下 mermaid 会用自己的 DOMPurify 洗一遍，`click` 这类能挂钩
   * 到 JS 的写法也会被禁掉。
   *
   * htmlLabels 关掉：默认用 <foreignObject> 包 HTML 来排版文字，那东西在
   * 导出成单文件、或打印成 PDF 时渲染很不稳定；改用 <text> 一劳永逸，
   * 顺带也不再受应用样式影响。
   */
  function configureMermaid() {
    var dark = (MM.settings.DARK_THEMES || []).indexOf(MM.settings.get('theme')) !== -1;
    var theme = dark ? 'dark' : 'default';
    if (mermaidTheme === theme) return;

    window.mermaid.initialize({
      startOnLoad: false, // 我们自己调 render，不需要它扫 DOM
      securityLevel: 'strict',
      theme: theme,
      fontFamily: 'inherit',
      flowchart: { htmlLabels: false, useMaxWidth: true },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      er: { useMaxWidth: true }
    });
    mermaidTheme = theme;
  }

  /**
   * 把 ```mermaid 代码块换成渲染好的 SVG。
   *
   * 只能异步（mermaid 要往 body 里插临时节点量文字宽度），所以它没法像
   * KaTeX 那样住在同步的 renderMath 里，而是渲染完再回头改 DOM ——
   * 于是必须用一个代次号挡住「回来时文档已经换了」。
   */
  function renderDiagrams(root, token) {
    var codes = root.querySelectorAll('pre > code.language-mermaid');
    if (!codes.length) return;

    var jobs = [];
    for (var i = 0; i < codes.length; i++) jobs.push({ el: codes[i], index: i });

    loadMermaid()
      .then(function () {
        if (token !== renderToken) return null;
        configureMermaid();

        return Promise.all(
          jobs.map(function (job) {
            var pre = job.el.parentElement;
            var code = job.el.textContent;
            var id = 'mm-mermaid-' + token + '-' + job.index;

            return window.mermaid
              .render(id, code)
              .then(function (res) {
                if (token !== renderToken || !pre.isConnected) return;
                var box = document.createElement('div');
                box.className = 'mm-mermaid';
                box.innerHTML = res.svg;
                pre.parentNode.replaceChild(box, pre);
              })
              .catch(function (err) {
                // mermaid 出错时会往 body 上挂一个 id 为 d<id> 的临时容器，
                // 它不一定自己收干净 —— 留着会随着每次重渲染越积越多
                var stray = document.getElementById('d' + id);
                if (stray && stray.parentNode) stray.parentNode.removeChild(stray);

                if (token !== renderToken || !pre.isConnected) return;

                // 语法错误时留着原始代码块，只加个标记 ——
                // 用户得能看到自己写错在哪，而不是一片空白
                pre.classList.add('mm-mermaid-failed');

                var hint = document.createElement('div');
                hint.className = 'mm-mermaid-error';
                hint.textContent = MM.i18n.t('previewDiagramError');
                pre.parentNode.insertBefore(hint, pre.nextSibling);

                console.warn('[preview] 图表渲染失败', err);
              });
          })
        );
      })
      .catch(function (err) {
        console.warn('[preview] mermaid 加载失败', err);
      });
  }

  /* ------------------------------------------------------------------
     对外接口
     ------------------------------------------------------------------ */

  function mount(el) {
    container = el;
  }

  /**
   * 主题换了要重新画一遍图表。
   *
   * 预览里别的元素都是 CSS 变量驱动的，改 data-theme 就自动跟着变；
   * 唯独 mermaid 是把颜色**固化在 SVG 属性里**的 —— 不重画的话，切到深色
   * 主题后图表还是白底黑字，在一片深色里格外扎眼。
   *
   * 只监听一次：这个 IIFE 只跑一遍，而 mount() 有可能被调多次。
   */
  if (MM.settings && MM.settings.onChange) {
    MM.settings.onChange(function (s, changed) {
      if (changed.indexOf('theme') !== -1 && lastSrc) renderNow(lastSrc);
    });
  }

  /**
   * 立即渲染一版。返回渲染统计，供大文档降级判断与调试使用。
   */
  function renderNow(src) {
    if (!container) return null;

    var started = performance.now();
    var result = renderHtml(src);

    container.innerHTML = result.html;
    highlightCode(container);
    renderMath(container, lastMathStore);
    // 图表是异步的，把代次号递进去：回来时它要先确认自己还是当班的那个
    renderDiagrams(container, ++renderToken);

    var elapsed = performance.now() - started;

    return {
      elapsed: elapsed,
      slow: elapsed > SLOW_RENDER_MS,
      blockCount: result.blockCount,
      mathCount: result.mathCount
    };
  }

  /** 防抖渲染。编辑器每次敲键都会调用这里，所以必须便宜。 */
  function schedule(src) {
    lastSrc = src;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      var info = renderNow(lastSrc);
      MM.bus.emit('preview:rendered', info);
    }, 80);
  }

  /** 跳过防抖立即渲染（切换文档、切换主题等场景） */
  function renderImmediate(src) {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    lastSrc = src;
    return renderNow(src);
  }

  MM.preview = {
    mount: mount,
    schedule: schedule,
    renderNow: renderImmediate,
    /** 供冒烟测试使用 */
    _renderHtml: renderHtml
  };
})();
