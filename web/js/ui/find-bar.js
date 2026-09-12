/**
 * MixMark · 文档内查找 / 替换
 * ===============================================================
 * 挂在编辑区顶部的细条，同时承担「查找」与「替换」两件事：
 * 从「编辑 → 查找」进来只显示一行，从「编辑 → 替换」进来多显示替换行。
 * 两者共用同一份匹配结果，切换模式不会把已输入的关键字丢掉。
 *
 * 没有用 CodeMirror 自带的 search 面板：它的样式体系（按钮、输入框、
 * 复选框）与 MixMark 的设计令牌对不上，改造成本高于自己写一个。
 * 匹配逻辑本身很朴素 —— 取全文、按子串找、把命中位置记下来。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var els = {};
  var state = {
    open: false,
    /** 'find' | 'replace' */
    mode: 'find',
    query: '',
    replacement: '',
    caseSensitive: false,
    /** [{ from, to }]，按位置升序 */
    matches: [],
    index: -1
  };

  /* ------------------------------------------------------------------
     匹配
     ------------------------------------------------------------------ */

  function docText() {
    var view = MM.editor.raw();
    return view ? view.state.doc.toString() : '';
  }

  function cursorPos() {
    var view = MM.editor.raw();
    return view ? view.state.selection.main.from : 0;
  }

  function computeMatches(query, caseSensitive) {
    var out = [];
    if (!query) return out;

    var text = docText();
    var hay = caseSensitive ? text : text.toLowerCase();
    var needle = caseSensitive ? query : query.toLowerCase();
    if (!needle) return out;

    var at = 0;
    while (at <= hay.length - needle.length) {
      var idx = hay.indexOf(needle, at);
      if (idx === -1) break;
      out.push({ from: idx, to: idx + needle.length });
      // 步长至少 1，否则空关键字的循环会原地打转
      at = idx + Math.max(1, needle.length);
    }
    return out;
  }

  /* ------------------------------------------------------------------
     选中与滚动
     ------------------------------------------------------------------ */

  function selectMatch(match) {
    var view = MM.editor.raw();
    if (!view || !match) return;

    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      // 用 scrollIntoView 效果而不是 scrollLineToTop：
      // 查找只该把命中处挪进视野，不该把整篇文档的位置搅乱
      effects: window.CM.EditorView.scrollIntoView(match.from, { y: 'center' })
    });
  }

  /* ------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------ */

  function renderCount() {
    if (!els.count) return;

    if (!state.query) {
      els.count.textContent = '';
      return;
    }
    if (!state.matches.length) {
      els.count.textContent = MM.i18n.t('findNoMatch');
      return;
    }
    els.count.textContent = MM.i18n.t('findCount', {
      i: state.index + 1,
      n: state.matches.length
    });
  }

  /** 重新算一遍匹配并把选区落到当前命中上 */
  function refresh(resetIndex) {
    state.matches = computeMatches(state.query, state.caseSensitive);

    if (!state.matches.length) {
      state.index = -1;
      renderCount();
      return;
    }

    if (resetIndex) {
      // 从光标处往后找第一个命中，找不到就回到开头 —— 和大多数编辑器的直觉一致
      var pos = cursorPos();
      var found = -1;
      for (var i = 0; i < state.matches.length; i++) {
        if (state.matches[i].from >= pos) {
          found = i;
          break;
        }
      }
      state.index = found === -1 ? 0 : found;
    } else if (state.index >= state.matches.length) {
      state.index = 0;
    } else if (state.index < 0) {
      state.index = 0;
    }

    selectMatch(state.matches[state.index]);
    renderCount();
  }

  function step(delta) {
    if (!state.matches.length) return;
    var n = state.matches.length;
    state.index = (state.index + delta + n) % n;
    selectMatch(state.matches[state.index]);
    renderCount();
  }

  /* ------------------------------------------------------------------
     替换
     ------------------------------------------------------------------ */

  function replaceCurrent() {
    var match = state.matches[state.index];
    if (!match) return;

    var view = MM.editor.raw();
    if (!view) return;

    var from = match.from;
    var insert = state.replacement;

    view.dispatch({
      changes: { from: from, to: match.to, insert: insert },
      selection: { anchor: from + insert.length }
    });

    // 文本变了，所有命中位置都要重算；重算后再落到下一个命中
    state.matches = computeMatches(state.query, state.caseSensitive);
    state.index = -1;
    var pos = from + insert.length;
    for (var i = 0; i < state.matches.length; i++) {
      if (state.matches[i].from >= pos) {
        state.index = i;
        break;
      }
    }
    if (state.index === -1) state.index = state.matches.length ? 0 : -1;

    if (state.index !== -1) selectMatch(state.matches[state.index]);
    renderCount();
  }

  function replaceAll() {
    var view = MM.editor.raw();
    if (!view || !state.matches.length) {
      MM.toast.show(MM.i18n.t('toastNoReplace'));
      return;
    }

    var n = state.matches.length;
    // ChangeSet 要求升序且互不重叠 —— computeMatches 天然满足
    var changes = state.matches.map(function (m) {
      return { from: m.from, to: m.to, insert: state.replacement };
    });

    view.dispatch({ changes: changes });

    state.matches = [];
    state.index = -1;
    renderCount();
    MM.toast.ok(MM.i18n.t('toastReplaced', { n: n }));
  }

  /* ------------------------------------------------------------------
     开合
     ------------------------------------------------------------------ */

  function setMode(mode) {
    state.mode = mode === 'replace' ? 'replace' : 'find';
    els.bar.classList.toggle('is-replace', state.mode === 'replace');
  }

  function open(mode) {
    setMode(mode);
    state.open = true;
    els.bar.hidden = false;

    // 带着编辑区里已选中的文字打开，省一次复制粘贴
    var view = MM.editor.raw();
    var selected = '';
    if (view) {
      var sel = view.state.selection.main;
      if (!sel.empty) selected = view.state.sliceDoc(sel.from, sel.to);
    }
    // 只在「单行、不像正文段落」时接管；否则查询词会被整段覆盖
    if (selected && selected.indexOf('\n') === -1 && selected.length <= 80) {
      els.input.value = selected;
    }

    state.query = els.input.value;
    els.input.focus();
    els.input.select();

    refresh(true);
  }

  function close() {
    state.open = false;
    els.bar.hidden = true;
    state.matches = [];
    state.index = -1;
    MM.editor.focus();
  }

  function toggle(mode) {
    if (state.open && state.mode === mode) close();
    else open(mode);
  }

  /* ------------------------------------------------------------------
     构建
     ------------------------------------------------------------------ */

  function iconBtn(id, title, svg) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn findbar__icon';
    b.id = id;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    return b;
  }

  function build() {
    var pane = document.querySelector('.pane--edit');
    if (!pane) return false;

    var bar = document.createElement('div');
    bar.className = 'findbar';
    bar.id = 'findbar';
    bar.hidden = true;
    bar.setAttribute('role', 'search');

    /* --- 第一行：查找 --- */
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'findbar__input';
    input.id = 'find-input';
    input.autocomplete = 'off';
    input.spellcheck = false;

    var count = document.createElement('span');
    count.className = 'findbar__count';
    count.id = 'find-count';

    var caseWrap = document.createElement('label');
    caseWrap.className = 'findbar__case';
    var caseBox = document.createElement('input');
    caseBox.type = 'checkbox';
    caseBox.id = 'find-case';
    var caseLabel = document.createElement('span');
    caseLabel.className = 'findbar__case-label';
    caseLabel.textContent = 'Aa';
    caseWrap.appendChild(caseBox);
    caseWrap.appendChild(caseLabel);

    var prev = iconBtn(
      'find-prev',
      '',
      '<svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>'
    );
    var next = iconBtn(
      'find-next',
      '',
      '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'
    );
    var closeBtn = iconBtn(
      'find-close',
      '',
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>'
    );

    /* --- 第二行：替换（仅替换模式显示） --- */
    var repInput = document.createElement('input');
    repInput.type = 'text';
    repInput.className = 'findbar__input findbar__input--replace';
    repInput.id = 'replace-input';
    repInput.autocomplete = 'off';
    repInput.spellcheck = false;

    var repOne = document.createElement('button');
    repOne.type = 'button';
    repOne.className = 'findbar__btn';
    repOne.id = 'find-replace';

    var repAll = document.createElement('button');
    repAll.type = 'button';
    repAll.className = 'findbar__btn';
    repAll.id = 'find-replace-all';

    var rowFind = document.createElement('div');
    rowFind.className = 'findbar__row';
    rowFind.appendChild(input);
    rowFind.appendChild(count);
    rowFind.appendChild(prev);
    rowFind.appendChild(next);
    rowFind.appendChild(caseWrap);
    rowFind.appendChild(closeBtn);

    var rowReplace = document.createElement('div');
    rowReplace.className = 'findbar__row findbar__row--replace';
    rowReplace.appendChild(repInput);
    rowReplace.appendChild(repOne);
    rowReplace.appendChild(repAll);

    bar.appendChild(rowFind);
    bar.appendChild(rowReplace);

    // 插在工具栏与编辑区之间：不遮挡正文，也不会被编辑区的滚动带着跑
    pane.insertBefore(bar, pane.querySelector('.editor-toolbar').nextSibling);

    els = {
      bar: bar,
      input: input,
      count: count,
      caseBox: caseBox,
      prev: prev,
      next: next,
      close: closeBtn,
      repInput: repInput,
      repOne: repOne,
      repAll: repAll
    };

    /* ---- 事件 ---- */

    input.addEventListener('input', function () {
      state.query = input.value;
      refresh(true);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    repInput.addEventListener('input', function () {
      state.replacement = repInput.value;
    });

    repInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceCurrent();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    caseBox.addEventListener('change', function () {
      state.caseSensitive = caseBox.checked;
      refresh(true);
    });

    prev.addEventListener('click', function () {
      step(-1);
    });
    next.addEventListener('click', function () {
      step(1);
    });
    closeBtn.addEventListener('click', close);
    repOne.addEventListener('click', replaceCurrent);
    repAll.addEventListener('click', replaceAll);

    refreshLabels();
    return true;
  }

  /** 语言切换后重刷所有由 JS 写入的文案 */
  function refreshLabels() {
    if (!els.bar) return;

    els.input.placeholder = MM.i18n.t('findPlaceholder');
    els.repInput.placeholder = MM.i18n.t('replacePlaceholder');
    els.prev.title = MM.i18n.t('findPrev');
    els.prev.setAttribute('aria-label', els.prev.title);
    els.next.title = MM.i18n.t('findNext');
    els.next.setAttribute('aria-label', els.next.title);
    els.close.title = MM.i18n.t('findClose');
    els.close.setAttribute('aria-label', els.close.title);
    els.caseBox.title = MM.i18n.t('findCaseSensitive');
    els.caseBox.setAttribute('aria-label', els.caseBox.title);
    els.repOne.textContent = MM.i18n.t('replaceOne');
    els.repAll.textContent = MM.i18n.t('replaceAll');

    renderCount();
  }

  function init() {
    if (!build()) return false;

    // 换文档时查找条关掉：上一篇的命中位置对新文档没有意义
    MM.bus.on('doc:opened', function () {
      if (state.open) close();
    });
    return true;
  }

  MM.findBar = {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    refreshLabels: refreshLabels,
    isOpen: function () {
      return state.open;
    }
  };
})();
