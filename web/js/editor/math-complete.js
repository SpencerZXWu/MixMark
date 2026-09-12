/**
 * MixMark · 公式命令补全
 * ===============================================================
 * 在 $...$ 里敲一个反斜杠，光标下方就冒出候选；每敲一个字母筛一次，
 * ↑↓ 选择、回车 / Tab 插入、Esc 关掉。
 *
 * 什么时候消失 —— 这条决定了整个手感，务必守住：
 *   · 光标前的 `\命令` 不再成立：删掉反斜杠，或者敲了空格 / { } / $ 之类
 *     —— 「命令打完了」不需要额外判断，那个正则自然会不匹配
 *   · 一条候选都没有
 *   · 光标不在公式里、选中了别的文本、切了文档、编辑器失焦
 *
 * 数据来源是 MM.symbolCatalogs.math（数学/物理/化学/统计/工程五个分类
 * 共用一份目录），所以符号面板里加一条新公式，这里自动就能补全，
 * 不用另外维护词表。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 一次最多列几条。多了挡视线，每敲一键全量重排也更贵 */
  var MAX_ITEMS = 12;

  var commands = null; // 惰性构建：目录在别的文件里，启动时可能还没就绪
  var box = null;
  var listEl = null;
  var items = [];
  var active = 0;
  var visible = false;
  var ctx = null; // { view, from, to, pos }

  /** 刚插入的那条命令，别紧接着又把自己提示一遍 */
  var insertedAt = -1;
  var insertedName = '';

  /**
   * 被 Esc 关掉时的那段命令。
   * 只要用户还在同一条命令上继续敲（query 仍以它开头），就别再冒出来；
   * 换了命令、或删掉反斜杠重来，就清掉。
   */
  var dismissed = null;
  var lastQuery = '';

  /**
   * 在此之前不再弹候选。
   * 从符号面板里选过一条公式之后用：那条命令已经写好了，
   * 再弹一次候选只是干扰。
   */
  var mutedUntil = 0;

  var boundScroll = null;

  /* ------------------------------------------------------------------
     候选表
     ------------------------------------------------------------------ */

  /**
   * 把目录里的模板收成「命令名 + 模板」。
   *
   * 同名只留第一条：目录里顺序即优先级，重复项没有意义。
   * 只收以 \ 开头的模板 —— 其余是纯片段（如 «a»/«b»），没有命令名可匹配。
   */
  function build() {
    var out = [];
    var seen = {};
    var catalog = MM.symbolCatalogs && MM.symbolCatalogs.math;
    if (!catalog) return out;

    (catalog.categories || []).forEach(function (cat) {
      (cat.sections || []).forEach(function (sec) {
        (sec.items || []).forEach(function (tpl) {
          var m = /^\\([a-zA-Z]+)/.exec(tpl);
          if (!m) return;
          if (seen[m[1]]) return;
          seen[m[1]] = true;
          // 顺手把纯文本（去掉 «» 占位标记）算好，渲染时不必再拆一遍。
          // 用已导出的 parseTemplate，而不是另找一份去标记的实现 ——
          // 占位符语法以后改了也只需要改一处
          out.push({ name: m[1], tpl: tpl, plain: MM.symbolPanel.parseTemplate(tpl).text });
        });
      });
    });

    return out;
  }

  function all() {
    if (!commands) commands = build();
    return commands;
  }

  /** 「以它开头」优先，其次「包含它」；两组内部都维持目录里的原始顺序 */
  function match(query) {
    var starts = [];
    var contains = [];

    all().forEach(function (c) {
      if (c.name.indexOf(query) === 0) starts.push(c);
      else if (query && c.name.indexOf(query) !== -1) contains.push(c);
    });

    return starts.concat(contains).slice(0, MAX_ITEMS);
  }

  /* ------------------------------------------------------------------
     候选框
     ------------------------------------------------------------------ */

  function ensureBox() {
    if (box) return;

    box = document.createElement('div');
    box.className = 'acbox';
    box.hidden = true;

    listEl = document.createElement('div');
    listEl.className = 'acbox__list';
    box.appendChild(listEl);
    document.body.appendChild(box);

    // 鼠标划过就换高亮
    listEl.addEventListener('mousemove', function (e) {
      var row = e.target.closest ? e.target.closest('.acbox__item') : null;
      if (!row) return;
      var idx = Number(row.dataset.idx);
      if (idx !== active) setActive(idx);
    });

    // 用 mousedown 而不是 click：click 之前编辑器会先失焦，
    // 失焦就会把候选框关掉，click 根本等不到
    listEl.addEventListener('mousedown', function (e) {
      var row = e.target.closest ? e.target.closest('.acbox__item') : null;
      if (!row) return;
      e.preventDefault();
      insert(Number(row.dataset.idx));
    });
  }

  function render() {
    listEl.innerHTML = '';

    items.forEach(function (c, i) {
      var row = document.createElement('div');
      row.className = 'acbox__item' + (i === active ? ' is-active' : '');
      row.dataset.idx = String(i);

      var name = document.createElement('span');
      name.className = 'acbox__name';
      name.textContent = '\\' + c.name;

      var tpl = document.createElement('span');
      tpl.className = 'acbox__tpl';
      tpl.textContent = c.plain;

      row.appendChild(name);
      row.appendChild(tpl);
      listEl.appendChild(row);
    });
  }

  /** 把框摆到光标正下方；贴边就翻转，别让它跑到屏幕外 */
  function reposition() {
    if (!visible || !ctx || !box) return;

    var coords;
    try {
      coords = ctx.view.coordsAtPos(ctx.pos);
    } catch (err) {
      return;
    }
    if (!coords) return;

    var rect = box.getBoundingClientRect();
    var left = Math.round(coords.left);
    var top = Math.round(coords.bottom + 4);

    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - rect.width);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, coords.top - 4 - rect.height);
    }

    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }

  function show(view, from, to, matched) {
    ensureBox();

    ctx = { view: view, from: from, to: to, pos: to };
    items = matched;
    active = 0;
    visible = true;

    box.hidden = false;
    render();
    // 尺寸要等渲染完才量得到，所以摆位置放在 render 之后
    reposition();
  }

  function hide() {
    if (!visible) return;

    visible = false;
    ctx = null;
    items = [];
    active = 0;
    if (box) box.hidden = true;
  }

  function setActive(idx) {
    active = idx;
    var rows = listEl.children;
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('is-active', i === idx);
    }
    if (rows[idx] && rows[idx].scrollIntoView) {
      rows[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  function move(step) {
    if (!items.length) return;
    setActive((active + step + items.length) % items.length);
  }

  /* ------------------------------------------------------------------
     插入
     ------------------------------------------------------------------ */

  function insert(idx) {
    var c = items[idx];
    if (!c || !ctx) return;

    var view = ctx.view;
    var from = ctx.from;
    var to = ctx.to;

    var parsed = MM.symbolPanel.parseTemplate(c.tpl);
    var mark = parsed.first || { from: parsed.text.length, to: parsed.text.length };

    // 先关掉再改文档：dispatch 会同步触发 updateListener，
    // 那时框还开着的话会按旧上下文闪一下。
    // 抑制标记也必须在 dispatch **之前**写好 —— 它俩是给
    // 紧接着那次 update 看的：没有占位符的模板（\alpha、\infty）
    // 插完之后光标左边仍是 `\命令`，不拦一下就会立刻又弹出候选。
    hide();
    insertedAt = from + mark.to;
    insertedName = c.name;

    view.dispatch({
      changes: { from: from, to: to, insert: parsed.text },
      // anchor ≠ head 即「选中」占位符，接着输入就把它替换掉
      selection: { anchor: from + mark.from, head: from + mark.to },
      scrollIntoView: true
    });
    view.focus();
  }

  /* ------------------------------------------------------------------
     跟随光标
     ------------------------------------------------------------------ */

  /** 滚动会让坐标失效；第一次 update 时顺手把滚动监听挂上 */
  function bindScroll(view) {
    if (boundScroll === view || !view.scrollDOM) return;
    boundScroll = view;
    view.scrollDOM.addEventListener('scroll', reposition, { passive: true });
  }

  /**
   * 每次编辑器状态变化后调用。
   * 判断依据全部来自「光标左边的文本」，不维护额外状态，
   * 所以撤销 / 粘贴 / 换行都能自然得出正确结论。
   */
  function update(view) {
    if (!view || !MM.symbolPanel) return;

    // 纯文本文档里没有公式这回事，别在这儿弹 LaTeX 候选。
    // 放在最前面：连滚动监听都不必挂
    if (MM.store.get().format === 'txt') return hide();

    // 刚从符号面板选了公式，别接着把它提示一遍
    if (Date.now() < mutedUntil) return hide();

    bindScroll(view);

    // 不用 view.hasFocus：它依赖 document.hasFocus()，
    // 页面不在前台（工具窗口、多窗口、内嵌预览）就会假阴性，
    // 表现为「明明在打字，候选死活不出来」。
    // 看 activeElement 是否落在编辑器里，结论更稳。
    var active = document.activeElement;
    if (active && !view.dom.contains(active)) return hide();

    var sel = view.state.selection.main;
    if (!sel.empty) return hide();

    var pos = sel.head;
    if (!MM.symbolPanel.insideMath(view.state, pos)) return hide();

    // 只认「光标紧挨着的」\命令：中间隔了空格 / 括号就不算，
    // 「命令打完了自动收起来」正是靠这一条实现的
    var line = view.state.doc.lineAt(pos);
    var before = view.state.sliceDoc(line.from, pos);
    var m = /\\([a-zA-Z]*)$/.exec(before);
    if (!m) return hide();

    var query = m[1];
    lastQuery = query;

    // Esc 关掉之后，同一条命令继续敲也不再弹（否则 Esc 等于白按）
    if (dismissed !== null) {
      if (query.indexOf(dismissed) === 0) return hide();
      dismissed = null;
    }

    // 刚插进来的那条别再提示自己一遍（它插完还停在原地）
    if (pos === insertedAt && query === insertedName) return hide();
    insertedAt = -1;

    var matched = match(query);
    if (!matched.length) return hide();

    show(view, pos - m[0].length, pos, matched);
  }

  /* ------------------------------------------------------------------
     键盘
     ------------------------------------------------------------------ */

  function onKeydown(e) {
    if (!visible) return;

    var k = e.key;

    if (k === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      move(1);
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      move(-1);
    } else if (k === 'Enter' || k === 'Tab') {
      // 回车在这里是「选中候选」，不是「插入换行」
      e.preventDefault();
      e.stopPropagation();
      insert(active);
    } else if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // 记住当前这段命令：接着敲它不该再弹出来
      dismissed = lastQuery;
      hide();
    }
  }

  /* ------------------------------------------------------------------
     装配
     ------------------------------------------------------------------ */

  // 捕获阶段：抢在 CodeMirror 自己处理方向键 / 回车之前
  document.addEventListener('keydown', onKeydown, true);

  window.addEventListener('resize', function () {
    if (visible) reposition();
  });

  if (MM.bus) {
    // 切文档走的是 setState，不产生 ViewUpdate，得手动收起来
    MM.bus.on('doc:opened', hide);
  }

  MM.mathComplete = {
    update: update,
    hide: hide,
    /** 接下来一段时间不再弹候选（面板选完公式后调） */
    mute: function (ms) {
      mutedUntil = Date.now() + (ms || 600);
      hide();
    },
    /** 目录是别的文件提供的，改了目录要让它重建词表 */
    reset: function () {
      commands = null;
    }
  };
})();
