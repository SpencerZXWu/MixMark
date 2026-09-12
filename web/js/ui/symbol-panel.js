/**
 * MixMark · 符号面板
 * ===============================================================
 * 工具栏上 fx 按钮（公式符号）与第二个符号按钮（语言与功能符号）
 * 背后的东西。两块面板共用这一份实现，差异全部来自目录数据：
 *   MM.symbolCatalogs.<id> = { math: true|false, categories: [...] }
 * 其中 math 决定「插入时要不要自动补 $ $」。
 *
 * 三件事值得单独说清楚：
 *
 * 1. 自动补 $ $
 *    公式面板插入前先看光标在不在数学环境里（从文首扫到光标、数 $ 与 $$
 *    的配对，并跳过代码区）。不在就先把符号包成 $...$，在就只丢符号进去。
 *    语言符号面板不做这件事 —— 那些是正文字符，包上 $ 就成了公式。
 *
 * 2. 光标停在内容处
 *    符号源里用 «» 标出可替换部分（如 \dfrac{«x»}{y}），插入后把第一个
 *    «» 变成选区 —— 接着敲字就直接替换掉它，不用再挪光标删占位符。
 *
 * 3. 格子渲染成符号本身而不是源码
 *    所见即所得比让人认 \varnothing 直观得多；悬停提示才显示源码。
 *    也因此不需要给几百个符号配翻译。
 *
 * 面板状态全部关在 createPanel 的闭包里 —— 两块面板同时存在于 DOM 中，
 * 共用一份模块级变量的话，后挂载的那块会把前一块的引用顶掉。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 面板 id → 实例 API */
  var instances = Object.create(null);

  /* ------------------------------------------------------------------
     模板解析
     ------------------------------------------------------------------ */

  /**
   * 把 «x» 形式的模板拆成纯文本 + 第一处占位的位置。
   *
   * 只关心第一处：插入后光标锁到那里，其余占位符原样留下当提示。
   * 不做 Tab 逐个跳转 —— 那要给编辑器挂 keymap，为一个符号面板不值当。
   */
  function parseTemplate(tpl) {
    var text = '';
    var first = null;
    var i = 0;

    while (i < tpl.length) {
      if (tpl[i] === '«') {
        var end = tpl.indexOf('»', i + 1);
        if (end === -1) {
          text += tpl[i];
          i++;
          continue;
        }
        var inner = tpl.slice(i + 1, end);
        if (!first) first = { from: text.length, to: text.length + inner.length };
        text += inner;
        i = end + 1;
      } else {
        text += tpl[i];
        i++;
      }
    }

    return { text: text, first: first };
  }

  /** 悬停提示里不该出现占位标记 */
  function stripMarkers(tpl) {
    return tpl.replace(/[«»]/g, '');
  }

  /* ------------------------------------------------------------------
     数学环境检测
     ------------------------------------------------------------------ */

  /** 把行内代码段挖成空白（保持长度，便于继续按下标扫） */
  function blankInlineCode(text) {
    if (text.indexOf('`') === -1) return text;

    var chars = text.split('');
    var i = 0;

    while (i < text.length) {
      if (text[i] !== '`') {
        i++;
        continue;
      }
      // 反引号只在**当前行**内找配对的：全篇找会因一个孤立的
      // 反引号把后面整块内容都吞掉
      var end = text.indexOf('`', i + 1);
      if (end === -1) break;

      for (var k = i; k <= end; k++) chars[k] = ' ';
      i = end + 1;
    }

    return chars.join('');
  }

  /**
   * 光标处是否已经在 $...$ 里？
   *
   * 按行扫到光标，遇 $ 翻转一次状态（$$ 只算一次翻转，这样
   * $$...$$ 与 $...$ 的配对结论一致）。
   *
   * 必须先排除代码区：代码块里的 $ 不是数学定界符
   * （JS 模板串 `${name}`、shell 变量 `$PATH`、价格），
   * 混进来会把奇偶性算反 —— 欢迎文档里那段 ```js 就正好有一个，
   * 结果整篇末尾都被判成「在公式里」。
   * 预览管线本来就是先保护代码再解析公式，这里跟着它走才一致。
   */
  function insideMath(state, pos) {
    var inMath = false;
    var fence = '';
    // lineAt 在 Text 上，不在 EditorState 上
    var target = state.doc.lineAt(pos);
    var scan = '';

    for (var n = 1; n <= target.number; n++) {
      var line = state.doc.line(n);
      var text = line.text;

      // 围栏检测用 [ \t]{0,3} 而不是 \s —— \s 会连换行一起吃掉
      var open = /^[ \t]{0,3}(```|~~~)/.exec(text);
      if (open) {
        if (!fence) fence = open[1];
        else if (open[1] === fence) fence = '';
        continue;
      }
      if (fence) continue;

      scan = blankInlineCode(text);
      var limit = n === target.number ? pos - line.from : scan.length;

      for (var i = 0; i < limit; i++) {
        var ch = scan[i];
        if (ch === '\\') {
          i++; // 跳过被转义的那个字符，\$ 不算定界符
          continue;
        }
        if (ch === '$') {
          if (scan[i + 1] === '$') i++;
          inMath = !inMath;
        }
      }
    }

    return inMath;
  }

  /* ------------------------------------------------------------------
     插入
     ------------------------------------------------------------------ */

  function insertSymbol(panelId, tpl) {
    var view = MM.editor.raw();
    if (!view) return;

    var catalog = MM.symbolCatalogs[panelId];
    if (!catalog) return;

    var parsed = parseTemplate(tpl);
    var sel = view.state.selection.main;
    // 只有公式类目录才需要、才允许包 $：正文里的符号包上就成了公式
    var wrap = !!catalog.math && !insideMath(view.state, sel.from);

    var text = wrap ? '$' + parsed.text + '$' : parsed.text;
    // 包了 $ 之后所有偏移都要右移一位
    var shift = wrap ? 1 : 0;

    var mark = parsed.first || { from: parsed.text.length, to: parsed.text.length };

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      // anchor ≠ head 即「选中」，接着输入就替换掉占位符
      selection: { anchor: sel.from + shift + mark.from, head: sel.from + shift + mark.to },
      scrollIntoView: true
    });
    view.focus();

    // 从面板里选完一条公式，命令就已经写好了，
    // 就别再让自动补全把它接着提示一遍
    if (catalog.math && MM.mathComplete && MM.mathComplete.mute) MM.mathComplete.mute();
  }

  /* ------------------------------------------------------------------
     单个面板实例
     ------------------------------------------------------------------ */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function createPanel(panelId, flyout, wrap) {
    var catalog = MM.symbolCatalogs[panelId];
    var categories = catalog.categories;

    var tabs = Object.create(null);
    var panes = Object.create(null);
    /** 渲染过的分类 id —— 渲染不便宜，用过才渲染 */
    var rendered = Object.create(null);

    function byId(id) {
      return categories.filter(function (c) {
        return c.id === id;
      })[0];
    }

    function activeId() {
      var active = flyout.querySelector('.sympanel__tab.is-active');
      return (active && active.getAttribute('data-cat')) || categories[0].id;
    }

    /* ---------------- 渲染 ---------------- */

    function renderChip(src) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'symchip';
      chip.setAttribute('data-src', src);
      chip.title = stripMarkers(src);
      chip.setAttribute('aria-label', stripMarkers(src));

      if (catalog.math) {
        try {
          chip.innerHTML = window.katex.renderToString(stripMarkers(src), {
            throwOnError: false,
            displayMode: false,
            output: 'html'
          });
        } catch (err) {
          chip.textContent = stripMarkers(src);
          chip.classList.add('symchip--raw');
        }
      } else {
        // 语言符号就是正文字符本身，不需要 KaTeX ——
        // 跑一遍反而会把 & # % 这类当成公式语法处理，
        // 显示出来的样子和实际插入的内容对不上
        chip.textContent = stripMarkers(src);
        chip.classList.add('symchip--text');
      }

      chip.addEventListener('mousedown', function (e) {
        // 用 mousedown + preventDefault 保住编辑器里的焦点与选区，
        // 与工具栏其他按钮同一个理由
        e.preventDefault();
        insertSymbol(panelId, src);

        // 只有公式面板选完才收起。
        // 符号面板不一样：标点、货币、序号这些常常要连着点好几个，
        // 每点一次都关掉反而碍事
        if (catalog.math) close();
      });

      return chip;
    }

    /**
     * 让放不下的符号多占几列。
     *
     * 网格用等宽列是为了好扫视（不然 \alpha 和矩阵一样宽），
     * 但等宽就会把 \ce{C6H12O6} 这种长式子裁掉。所以渲染完量一遍：
     * 内容比格子宽的就跨列，既保住对齐又不会被裁。
     * 先全部清空再统一写，避免边量边改来回触发重排。
     */
    function widenLong(pane) {
      var chips = pane.querySelectorAll('.symchip');
      if (!chips.length) return;

      for (var i = 0; i < chips.length; i++) chips[i].style.gridColumn = '';

      var spans = [];
      for (var j = 0; j < chips.length; j++) {
        var chip = chips[j];
        var cell = chip.getBoundingClientRect().width;
        if (!cell) continue;

        // 必须量子元素：chip 自身是 flex 容器，
        // scrollWidth 的最小值就是它自己的宽度，量出来永远是「刚好放得下」
        var inner = chip.firstElementChild;
        var need = inner ? inner.getBoundingClientRect().width : 0;
        if (need <= cell - 2) continue;

        spans.push({ chip: chip, span: Math.min(Math.ceil((need + 6) / cell), 4) });
      }

      spans.forEach(function (item) {
        item.chip.style.gridColumn = 'span ' + item.span;
      });
    }

    /** 渲染某个分类（只做一次，之后切回来直接复用） */
    function renderCategory(cat) {
      if (rendered[cat.id]) return;

      var pane = panes[cat.id];
      if (!pane) return;

      cat.sections.forEach(function (section) {
        var box = el('div', 'sympanel__section');

        box.appendChild(el('div', 'sympanel__section-title', MM.i18n.t(section.titleKey)));

        var grid = el('div', 'sympanel__grid');
        section.items.forEach(function (src) {
          grid.appendChild(renderChip(src));
        });

        box.appendChild(grid);
        pane.appendChild(box);
      });

      rendered[cat.id] = true;
      widenLong(pane);
    }

    /**
     * 切换激活分类。
     * doRender 为假时只改标签与可见性，不渲染内容 —— 首次渲染推迟到
     * 面板真正展开之后，否则启动时就要白算上百个公式。
     */
    function activate(id, doRender) {
      Object.keys(tabs).forEach(function (key) {
        var active = key === id;
        tabs[key].classList.toggle('is-active', active);
        tabs[key].setAttribute('aria-selected', active ? 'true' : 'false');
        panes[key].hidden = !active;
      });

      if (doRender) {
        var cat = byId(id);
        if (cat) renderCategory(cat);
      }
    }

    function showCategory(id) {
      activate(id, true);
    }

    /**
     * 面板比工具栏按钮宽得多，靠 CSS 定不了位：
     * 它的包含块是只有几十像素宽的 .tb-group，无论左对齐还是右对齐都可能
     * 被甩到编辑区外面（窄窗口下尤其明显）。
     * 所以展开前按编辑区的实际宽度算一次：宽度收进编辑区，
     * 左边界再夹在编辑区范围内 —— 这样任何窗口宽度都不会跑出去。
     */
    function fit() {
      var pane = document.querySelector('.pane--edit');
      if (!pane) return;

      var pr = pane.getBoundingClientRect();
      var tr = wrap.getBoundingClientRect();

      var width = Math.max(240, Math.min(560, pr.width - 16));
      var left = Math.max(pr.left + 8, Math.min(tr.right - width, pr.right - 8 - width));

      flyout.style.width = Math.round(width) + 'px';
      flyout.style.right = 'auto';
      flyout.style.left = Math.round(left - tr.left) + 'px';
    }

    /** 上一次收起的时间点，用来挡住 hover 状态抖动引起的「刚关又开」 */
    var closedAt = 0;

    /**
     * 收起面板，而且要「看得见地收起来」。
     *
     * 面板的显示条件有两个：`.tb-group:hover .tb-flyout` 与
     * `.tb-group.is-open .tb-flyout`（任一成立就显示）。所以只移掉 is-open
     * 是不够的 —— 鼠标还悬在上面时样式照旧生效，看起来就是「点了没反应」。
     *
     * 这里直接写内联 `display:none`：内联优先级最高，任何 :hover 规则都压不过，
     * 保证此刻一定收得下去。等鼠标重新进入分组时才撤掉。
     */
    function close() {
      var trigger = wrap.querySelector('.tb-trigger');

      wrap.classList.remove('is-open');
      wrap.classList.add('is-dismissed');
      flyout.style.display = 'none';
      closedAt = Date.now();

      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    /** 撤掉「已收起」状态，把显示权交还给 hover / is-open 这两个正常条件 */
    function restore() {
      if (flyout.style.display === 'none') flyout.style.display = '';
      wrap.classList.remove('is-dismissed');
    }

    /* 鼠标重新进入分组才算「新的一次悬停」，这时才允许再展开。
       特意用 mouseenter 而不是 mouseleave：只要鼠标没真正离开，面板就一直收着，
       不会被 hover 状态的瞬间抖动绕过去（抖动时 mouseleave + mouseenter
       会连着来，用 mouseleave 清除就等于没清）。 */
    wrap.addEventListener('mouseenter', function () {
      if (Date.now() - closedAt < 350) return;
      restore();
    });

    /* 点触发按钮「关」的那一次，同样会被 :hover 撑着，得一起硬收起来。
       开合本身由 shell 统一管（它还负责 closeAllFlyouts 之类的协作），
       这里不抢它的活，只读它处理完的结果 —— 它的监听器先注册、先执行，
       所以此刻读到的 is-open 已经是点击之后的状态。 */
    var triggerEl = wrap.querySelector('.tb-trigger');
    if (triggerEl) {
      triggerEl.addEventListener('click', function () {
        if (wrap.classList.contains('is-open')) restore();
        else close();
      });
    }

    /** 命令面板/快捷键入口：钉住面板并把焦点送进去 */
    function toggle() {
      var trigger = wrap.querySelector('.tb-trigger');
      var open = wrap.classList.contains('is-open');

      var others = document.querySelectorAll('.tb-group.is-open');
      for (var i = 0; i < others.length; i++) {
        others[i].classList.remove('is-open');
        var t = others[i].querySelector('.tb-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      }

      if (open) return;

      restore();
      fit();
      showCategory(activeId());
      wrap.classList.add('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');

      var chip = wrap.querySelector('.sympanel__pane:not([hidden]) .symchip');
      if (chip) chip.focus();
    }

    /** 语言切换后重写分类标签与小节标题（这些是渲染时写死的） */
    function relabel() {
      categories.forEach(function (cat) {
        if (tabs[cat.id]) tabs[cat.id].textContent = MM.i18n.t(cat.labelKey);

        var pane = panes[cat.id];
        if (!pane) return;

        var titles = pane.querySelectorAll('.sympanel__section-title');
        for (var i = 0; i < titles.length && i < cat.sections.length; i++) {
          titles[i].textContent = MM.i18n.t(cat.sections[i].titleKey);
        }
      });
    }

    /* ---------------- 建 DOM ---------------- */

    var tabbar = el('div', 'sympanel__tabs');
    tabbar.setAttribute('role', 'tablist');

    var body = el('div', 'sympanel__body');

    categories.forEach(function (cat, index) {
      var tab = el('button', 'sympanel__tab', MM.i18n.t(cat.labelKey));
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('data-cat', cat.id);
      tab.addEventListener('mousedown', function (e) {
        e.preventDefault();
        showCategory(cat.id);
      });

      var pane = el('div', 'sympanel__pane');
      pane.setAttribute('data-cat', cat.id);
      pane.hidden = index !== 0;

      tabs[cat.id] = tab;
      panes[cat.id] = pane;

      tabbar.appendChild(tab);
      body.appendChild(pane);
    });

    flyout.appendChild(tabbar);
    flyout.appendChild(body);

    // 只把第一个分类标成激活，**先不渲染**。
    activate(categories[0].id, false);

    // 真正的渲染与定位推迟到第一次展开。
    // 这几个事件与外壳自己的监听并存，互不干扰。
    var warm = function () {
      fit();
      showCategory(activeId());
    };
    wrap.addEventListener('mouseenter', warm);
    wrap.addEventListener('focusin', warm);
    wrap.addEventListener('click', warm);

    return { toggle: toggle, relabel: relabel };
  }

  /* ------------------------------------------------------------------
     对外接口
     ------------------------------------------------------------------ */

  MM.toolbarWidgets = MM.toolbarWidgets || {};

  /**
   * 注册一块符号面板。widget 名即目录名（MM.symbolCatalogs 的键）。
   * 以后再加一类符号，只需要多一份目录 + 一条命令声明。
   */
  function register(id) {
    MM.toolbarWidgets[id] = function (def, flyout, wrap) {
      instances[id] = createPanel(id, flyout, wrap);
    };
  }

  register('math');
  register('text');

  MM.symbolPanel = {
    register: register,

    toggle: function (id) {
      var panel = instances[id];
      if (panel) panel.toggle();
    },

    relabel: function () {
      Object.keys(instances).forEach(function (id) {
        instances[id].relabel();
      });
    },

    insert: insertSymbol,
    insideMath: insideMath,
    parseTemplate: parseTemplate
  };
})();
