/**
 * MixMark · CodeMirror 装配
 * ===============================================================
 * 手工装配而不是直接用 basicSetup，原因有三：
 *   ① 行号 / 自动换行要能被设置项动态开关（Compartment）
 *   ② basicSetup 会带上我们不需要的扩展（如自动闭合标签），体积与行为都要控
 *   ③ 快捷键一律走 MM.commands 全局派发，编辑器不再单独注册一套，
 *      避免同一个快捷键在两条路径上重复触发
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var view = null;
  var host = null;

  /** 创建时使用的扩展列表。切换文档时要重建 state，需复用同一份。 */
  var extensions = null;

  /** 程序化写入内容时置位，避免把「打开文档」误判成用户编辑 */
  var applyingExternal = false;

  /** 可动态重配置的部分 */
  var compartments = {};

  var listeners = {
    change: [],
    scroll: []
  };

  /* ------------------------------------------------------------------
     创建
     ------------------------------------------------------------------ */

  function buildExtensions() {
    var CM = window.CM;

    compartments.lineNumbers = new CM.Compartment();
    compartments.lineWrapping = new CM.Compartment();
    compartments.readOnly = new CM.Compartment();

    return [
      /* 行引用复选框槽。**必须排在 lineNumbers 之前** ——
         gutter 的先后 = 扩展的先后，放在后面就会跑到行号右边。
         它与「显示行号」开关无关：关掉行号也还想引用某几行 */
      MM.aiPanel && MM.aiPanel.lineSelectExtension ? MM.aiPanel.lineSelectExtension : [],

      compartments.lineNumbers.of(
        MM.settings.get('lineNumbers') ? [CM.lineNumbers(), CM.highlightActiveLineGutter()] : []
      ),

      CM.highlightSpecialChars(),
      CM.history(),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.EditorState.allowMultipleSelections.of(true),
      CM.indentOnInput(),
      CM.bracketMatching(),
      CM.highlightActiveLine(),
      CM.highlightSelectionMatches(),

      /* 刻意不启用 @codemirror/autocomplete 的 closeBrackets 与 autocompletion：
         写 Markdown 时输入 **、`、[ 是家常便饭，自动补出的右半部分会打乱
         输入节奏（比如想打 **bold** 却先得到一对 ** 再把光标夹在中间）。
         少一层「贴心」反而更顺手，同时也省下这部分体积。 */

      // 默认高亮样式打底，我们的 Markdown 样式覆盖其上
      CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
      MM.mdSyntax.style ? CM.syntaxHighlighting(MM.mdSyntax.style) : [],

      CM.markdown(),

      // AI 改文档时的内联差异高亮（扩展定义在 js/ui/ai-panel.js）。
      // 那个文件在本文件之后加载，但这里是在 create() 时才求值 —— 那时它一定在
      MM.aiPanel && MM.aiPanel.diffExtension ? MM.aiPanel.diffExtension : [],

      compartments.lineWrapping.of(CM.EditorView.lineWrapping),

      CM.keymap.of(
        [].concat(
          CM.defaultKeymap || [],
          CM.searchKeymap || [],
          CM.historyKeymap || [],
          CM.foldKeymap || []
        )
      ),

      CM.EditorView.updateListener.of(function (update) {
        if (update.docChanged && !applyingExternal) {
          var text = update.state.doc.toString();
          MM.docs.setContent(text);
          listeners.change.forEach(function (fn) {
            fn(text);
          });
        }
        if (update.selectionSet || update.docChanged) {
          var line = update.state.doc.lineAt(update.state.selection.main.head).number;
          if (line !== MM.store.get().cursorLine) MM.store.set({ cursorLine: line });
        }

        // 公式命令补全：候选是按「光标左边的文本」算的，
        // 所以每次 update 都要重算，不能只看 docChanged
        if (MM.mathComplete) MM.mathComplete.update(update.view);
      })
    ];
  }

  function create(hostEl) {
    host = hostEl;

    if (!window.CM) {
      throw new Error('CodeMirror 未加载：window.CM 不存在');
    }

    MM.mdSyntax.style = MM.mdSyntax.build();

    extensions = buildExtensions();

    view = new window.CM.EditorView({
      doc: '',
      extensions: extensions,
      parent: host
    });

    view.scrollDOM.addEventListener(
      'scroll',
      function () {
        listeners.scroll.forEach(function (fn) {
          fn(view.scrollDOM.scrollTop);
        });
      },
      { passive: true }
    );

    return view;
  }

  /* ------------------------------------------------------------------
     内容读写
     ------------------------------------------------------------------ */

  function setContent(text) {
    if (!view) return;
    if (view.state.doc.toString() === text) return;

    applyingExternal = true;
    try {
      // 用 setState 而不是 dispatch 替换全文。
      // 切换文档时必须丢弃撤销历史，否则用户在新文档里按 Ctrl+Z
      // 会撤回到上一篇文档的内容。setState 重建整个 state，
      // 历史随之清空，光标与滚动也自然归位。
      view.setState(
        window.CM.EditorState.create({
          doc: text,
          extensions: extensions
        })
      );
    } finally {
      applyingExternal = false;
    }

    view.scrollDOM.scrollTop = 0;
    MM.store.set({ cursorLine: 1 });
  }

  function getContent() {
    return view ? view.state.doc.toString() : '';
  }

  function focus() {
    if (view) view.focus();
  }

  /* ------------------------------------------------------------------
     选区操作（供 actions.js 使用）
     ------------------------------------------------------------------ */

  function getSelectionText() {
    if (!view) return '';
    var sel = view.state.selection.main;
    return view.state.sliceDoc(sel.from, sel.to);
  }

  /**
   * 用标记包裹选区。已包裹时再次调用会「脱掉」标记（实现切换语义）。
   * @param {string} before  前缀标记，如 '**'
   * @param {string} after   后缀标记，默认同 before
   * @param {string} placeholder 选区为空时填入的占位文本
   */
  function wrapSelection(before, after, placeholder) {
    if (!view) return;
    after = after === undefined ? before : after;

    var sel = view.state.selection.main;
    var state = view.state;
    var doc = state.doc; // Text 对象，只有 length / line 等，取文本要用 state.sliceDoc
    var from = sel.from;
    var to = sel.to;

    // 情况一：选区外侧已经就是标记 → 脱掉
    var outerFrom = Math.max(0, from - before.length);
    var outerTo = Math.min(doc.length, to + after.length);
    var outerText = state.sliceDoc(outerFrom, outerTo);

    if (outerText === before + state.sliceDoc(from, to) + after) {
      view.dispatch({
        changes: { from: outerFrom, to: outerTo, insert: state.sliceDoc(from, to) },
        selection: { anchor: outerFrom, head: outerFrom + (to - from) }
      });
      view.focus();
      return;
    }

    // 情况二：选区内侧已经带着标记 → 脱掉（常见于用户含标记一起选中）
    var innerText = state.sliceDoc(from, to);
    if (
      innerText.length >= before.length + after.length &&
      innerText.slice(0, before.length) === before &&
      innerText.slice(innerText.length - after.length) === after
    ) {
      var stripped = innerText.slice(before.length, innerText.length - after.length);
      view.dispatch({
        changes: { from: from, to: to, insert: stripped },
        selection: { anchor: from, head: from + stripped.length }
      });
      view.focus();
      return;
    }

    // 情况三：正常包裹
    var selected = innerText || placeholder || '';
    var insertText = before + selected + after;

    view.dispatch({
      changes: { from: from, to: to, insert: insertText },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selected.length
      }
    });
    view.focus();
  }

  /**
   * 在每行行首增删前缀（用于标题、列表、引用）。
   * 若所有行都已有该前缀则移除，否则统一加上。
   * @param {string} prefix   要加的前缀，如 '## ' 或 '- '
   * @param {RegExp} stripRe  匹配「已有同类前缀」的正则，用于先清后加
   */
  function toggleLinePrefix(prefix, stripRe) {
    if (!view) return;

    var sel = view.state.selection.main;
    var doc = view.state.doc;
    var startLine = doc.lineAt(sel.from);
    var endLine = doc.lineAt(sel.to);

    var lines = [];
    for (var n = startLine.number; n <= endLine.number; n++) {
      lines.push(doc.line(n));
    }

    // 严格判定「是否已全部带有该前缀」，不要用 stripRe 代劳：
    // 否则把「- 事项」转成任务列表时会被误判成「已有前缀」而反向清除。
    var allHave = lines.every(function (l) {
      return l.text.indexOf(prefix) === 0;
    });

    var changes = lines.map(function (l) {
      // stripRe 只负责清掉「已有的同类但不同形态」的前缀（如 # → ##，- → - [ ]）
      var text = stripRe ? l.text.replace(stripRe, '') : l.text;
      if (!allHave) text = prefix + text;
      return { from: l.from, to: l.to, insert: text };
    });

    view.dispatch({ changes: changes });
    view.focus();
  }

  /**
   * 在光标处插入文本块（表格、公式等）。
   * @param {string} text        要插入的内容
   * @param {number} [caretOffset] 光标落在 text 内的第几个字符处，
   *                               默认末尾。插入公式时用于把光标放到中间。
   */
  function insertBlock(text, caretOffset) {
    if (!view) return;

    var sel = view.state.selection.main;
    var doc = view.state.doc;
    var line = doc.lineAt(sel.from);

    var before = line.text.slice(0, sel.from - line.from);
    var after = line.text.slice(sel.from - line.from);

    // 块级内容需要与上下文隔开，否则会被解析成段落的一部分
    var needLeading = before.trim() !== '' ? '\n\n' : '';
    var needTrailing = after.trim() !== '' ? '\n\n' : '\n';

    var insert = needLeading + text + needTrailing;
    var offset = caretOffset === undefined ? text.length : caretOffset;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insert },
      selection: { anchor: sel.from + needLeading.length + offset }
    });
    view.focus();
  }

  /**
   * 用文本替换选区，并把光标或选区落到指定位置。
   * 「插入后还要用户继续填」的命令需要它（插入链接后选中 URL、
   * 插入表格后把光标放进第一个表头单元格）。
   * @param {string} text
   * @param {number} [selStart] 相对 text 起点的偏移，默认末尾
   * @param {number} [selEnd]   默认同 selStart（即只放光标不选中）
   */
  function insertAndSelect(text, selStart, selEnd) {
    if (!view) return;

    var sel = view.state.selection.main;
    var start = selStart === undefined ? text.length : selStart;
    var end = selEnd === undefined ? start : selEnd;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + start, head: sel.from + end }
    });
    view.focus();
  }

  /** 光标所在行号（1 起） */
  function cursorLine() {
    if (!view) return 1;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  }

  /**
   * 视口顶部对应的源码行号。
   *
   * 不用 scrollTop + lineBlockAtHeight 的坐标换算（依赖 documentTop 的
   * 语义，容易算错），而是直接问编辑器「屏幕这个点上是什么位置」，
   * 语义明确、无歧义。
   */
  function topVisibleLine() {
    if (!view) return 1;

    var rect = view.scrollDOM.getBoundingClientRect();
    var pos = view.posAtCoords({ x: rect.left + 8, y: rect.top + 2 });

    if (pos == null) return 1;
    return view.state.doc.lineAt(pos).number;
  }

  /** 把指定行滚动到视口顶部附近 */
  function scrollToLine(lineNumber) {
    if (!view) return;

    var doc = view.state.doc;
    var n = Math.max(1, Math.min(lineNumber, doc.lines));
    var pos = doc.line(n).from;

    view.dispatch({
      selection: { anchor: pos },
      effects: window.CM.EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 })
    });
  }

  /**
   * 只滚动，不移动光标。
   * 预览区反向同步时用 —— 在预览区滚动不应该把用户的编辑光标拽走。
   */
  function scrollLineToTop(lineNumber) {
    if (!view) return;

    var doc = view.state.doc;
    var n = Math.max(1, Math.min(lineNumber, doc.lines));
    var pos = doc.line(n).from;

    view.dispatch({
      effects: window.CM.EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 })
    });
  }

  /** 跳到指定行：移动光标并滚动，用于大纲点击与外部跳转 */
  function gotoLine(lineNumber) {
    scrollToLine(lineNumber);
    view.focus();
  }

  /* ------------------------------------------------------------------
     动态设置
     ------------------------------------------------------------------ */

  function reconfigure(patch) {
    if (!view) return;
    var effects = [];

    if (patch.lineNumbers !== undefined) {
      var CM = window.CM;
      effects.push(
        compartments.lineNumbers.reconfigure(
          patch.lineNumbers ? [CM.lineNumbers(), CM.highlightActiveLineGutter()] : []
        )
      );
    }

    if (effects.length) view.dispatch({ effects: effects });
  }

  function onChange(fn) {
    listeners.change.push(fn);
  }

  function onScroll(fn) {
    listeners.scroll.push(fn);
  }

  MM.editor = {
    create: create,
    setContent: setContent,
    getContent: getContent,
    focus: focus,
    reconfigure: reconfigure,

    getSelectionText: getSelectionText,
    wrapSelection: wrapSelection,
    toggleLinePrefix: toggleLinePrefix,
    insertBlock: insertBlock,
    insertAndSelect: insertAndSelect,

    cursorLine: cursorLine,
    topVisibleLine: topVisibleLine,
    scrollToLine: scrollToLine,
    scrollLineToTop: scrollLineToTop,
    gotoLine: gotoLine,

    onChange: onChange,
    onScroll: onScroll,

    /** 原始 view，仅供 preview 的滚动同步使用 */
    raw: function () {
      return view;
    }
  };
})();
