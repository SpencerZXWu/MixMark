/**
 * MixMark · 反向修改（实验性）
 * ===============================================================
 * 在预览区直接改内容，改完写回源码。
 *
 * 三条设计原则：
 *
 * 1. **默认只读。** 开关刻意不持久化 —— 每次启动都回到只读。预览区可编辑
 *    这件事一旦残留，用户下次点的第一下就会莫名其妙地改动文档。
 *
 * 2. **只回写「被改过的那一块」。** 靠 .mm-block 上的 data-line /
 *    data-line-end 定位到源码里的那几行，整块替换。块与块之间的空行、
 *    缩进、注释一律不动。代价是被编辑的那一块内部的手工排版会被规范化
 *    （比如表格竖线对齐），这个取舍写在 CHANGELOG 里。
 *
 * 3. **编辑期间不重建预览 DOM。** 每敲一下都写回源码，而源码变化会触发
 *    重新渲染 —— 那一重建就把正在编辑的元素连同光标整个换掉，字根本没法打。
 *    所以编辑期间调 MM.preview.setHold(true)，光标离开预览时再对齐一版。
 *    期间块的行号靠 shiftBlocks() 手动平移，保证紧接着编辑下一块时定位还对。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 模式开关。不持久化：每次启动都必须回到只读 */
  var on = false;
  var container = null;
  var bar = null;
  var active = null;

  var writeTimer = null;
  var releaseTimer = null;

  var WRITE_DEBOUNCE = 350;
  var RELEASE_DELAY = 260;

  /* ------------------------------------------------------------------
     小工具
     ------------------------------------------------------------------ */

  function closest(el, sel) {
    if (!el || el.nodeType !== 1) return null;
    return el.closest ? el.closest(sel) : null;
  }

  function blockOf(node) {
    return closest(node, '.mm-block');
  }

  /**
   * 图表块进来不打字 —— 里面是 SVG（或还没渲染完的围栏）。
   *
   * 两个判据都要认：mermaid 是异步渲染的，重渲染刚结束时 DOM 里还只有
   * `pre > code.language-mermaid`，此时若把它当成普通块，用户点一下就能
   * 直接改 mermaid 源码文本 —— 与图表面板职责重叠且极易写坏。
   */
  function isDiagramBlock(el) {
    if (!el) return false;
    return !!el.querySelector('.mm-mermaid, pre > code.language-mermaid');
  }

  function toast(key, vars) {
    if (MM.toast && MM.toast.show) MM.toast.show(MM.i18n.t(key, vars));
  }

  /** 源码里 [from, to] 这几行拼成的文本 */
  function linesText(from, to) {
    var parts = [];
    for (var n = from; n <= to; n++) parts.push(MM.editor.lineText(n));
    return parts.join('\n');
  }

  /** 把块上记的行号范围读出来，并把末尾的空行剔掉 */
  function rangeOf(block) {
    var from = parseInt(block.getAttribute('data-line'), 10);
    var to = parseInt(block.getAttribute('data-line-end'), 10);
    if (!isFinite(from) || !isFinite(to)) return null;
    if (to < from) to = from;

    // 末尾的空行不属于这一块。留着它们，块与块之间才有呼吸 ——
    // 一起替换掉的话，每改一次就少一个空行，文档会越改越紧。
    while (to > from && MM.editor.lineText(to).trim() === '') to--;

    return { from: from, to: to };
  }

  /**
   * 写回之后，把后面那些块的 data-line 一起平移。
   * 不这么做的话，紧接着编辑下一块时会把内容写到错误的行上。
   */
  function shiftBlocks(block, delta) {
    if (!delta) return;

    var own = parseInt(block.getAttribute('data-line-end'), 10);
    if (isFinite(own)) block.setAttribute('data-line-end', own + delta);

    var els = container.querySelectorAll('.mm-block[data-line]');
    var passed = false;

    for (var i = 0; i < els.length; i++) {
      if (els[i] === block) {
        passed = true;
        continue;
      }
      if (!passed) continue;

      var a = parseInt(els[i].getAttribute('data-line'), 10);
      var b = parseInt(els[i].getAttribute('data-line-end'), 10);
      if (isFinite(a)) els[i].setAttribute('data-line', a + delta);
      if (isFinite(b)) els[i].setAttribute('data-line-end', b + delta);
    }
  }

  /* ------------------------------------------------------------------
     回写
     ------------------------------------------------------------------ */

  /** 把当前正在编辑的那一块序列化成 Markdown 写回源码 */
  function flush() {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    if (!on) return;

    var block = active;
    if (!block || isDiagramBlock(block)) return;

    /* 块已经不在了就别写。
       重渲染之后旧元素会脱离文档，而它身上的 data-line 是上一版的 ——
       照着它去改，改的是别的段落。这种事一旦发生，用户看到的是
       「我改的是 A，B 变了」。 */
    if (block.isConnected === false) {
      active = null;
      return;
    }

    var range = rangeOf(block);
    if (!range) return;

    var md = MM.mdOut.blocks(block);
    if (linesText(range.from, range.to) === md) return;

    var res = MM.editor.replaceLines(range.from, range.to, md);
    if (!res) return;

    shiftBlocks(block, res.delta);
  }

  /* ------------------------------------------------------------------
     行内语法的点击切换
     ------------------------------------------------------------------ */

  /**
   * 勾选框 → 翻转源码里的 `- [ ]` / `- [x]`。
   *
   * 按「这是块里第几个勾选框」去找「源码里的第几个任务行」——
   * 比拿文字去匹配可靠，任务文字重复是很常见的（好几条「待办」）。
   */
  function toggleTask(box) {
    var block = blockOf(box);
    if (!block) return;

    var boxes = block.querySelectorAll('input[type=checkbox]');
    var index = Array.prototype.indexOf.call(boxes, box);
    if (index < 0) return;

    var range = rangeOf(block);
    if (!range) return;

    var TASK = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/;
    var seen = -1;

    for (var n = range.from; n <= range.to; n++) {
      var text = MM.editor.lineText(n);
      var m = TASK.exec(text);
      if (!m) continue;

      seen++;
      if (seen !== index) continue;

      var checked = m[2].toLowerCase() === 'x';
      var next = m[1] + '[' + (checked ? ' ' : 'x') + ']' + text.slice(m[0].length);

      MM.editor.replaceLines(n, n, next);
      return;
    }

    // 源码里找不到对应任务行：多半是列表被折叠成了别的写法，别硬改
    toast('liveEditTaskMiss');
  }

  /** 点删除线 → 摘掉 `~~`，恢复成普通文字 */
  function unwrapDel(del) {
    var block = blockOf(del);
    if (!block) return;

    var dels = block.querySelectorAll('del');
    var index = Array.prototype.indexOf.call(dels, del);
    if (index < 0) return;

    var range = rangeOf(block);
    if (!range) return;

    var text = linesText(range.from, range.to);
    var re = /~~([^~\n]+)~~/g;
    var m;
    var seen = -1;

    while ((m = re.exec(text)) !== null) {
      seen++;
      if (seen !== index) continue;

      // 换行是行分隔符，得换算成行号才能只替换那一行
      var before = text.slice(0, m.index);
      var line = range.from + (before.match(/\n/g) || []).length;

      MM.editor.replaceLines(line, line, MM.editor.lineText(line).replace(m[0], m[1]));
      return;
    }
  }

  /* ------------------------------------------------------------------
     工具条
     ------------------------------------------------------------------ */

  /** 预览区当前选中的文字（必须落在某个块里） */
  function previewSelection() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    var text = sel.toString();
    if (!text || !text.trim()) return null;

    var block = blockOf(sel.anchorNode && sel.anchorNode.nodeType === 1
      ? sel.anchorNode
      : sel.anchorNode && sel.anchorNode.parentNode);
    if (!block) return null;

    return { text: text, block: block };
  }

  /**
   * 给选中的文字套上 / 摘掉一对标记。
   *
   * 定位办法是「拿选中的文字去块的源码里找」—— 简单但够用：DOM 里的文字
   * 和源码里的文字在纯文本场景下是一样的。找不到就什么都不做，
   * 而不是猜一个位置乱插。
   */
  function toggleInline(marker) {
    var picked = previewSelection();
    if (!picked) {
      toast('liveEditSelectFirst');
      return;
    }

    var range = rangeOf(picked.block);
    if (!range) return;

    var source = linesText(range.from, range.to);
    var needle = picked.text;

    var at = source.indexOf(needle);
    if (at === -1) {
      toast('liveEditMapFail');
      return;
    }

    var len = marker.length;
    var end = at + needle.length;
    var wrapped =
      source.slice(at - len, at) === marker && source.slice(end, end + len) === marker;

    var replaced;
    if (wrapped) {
      // 已经有这层标记了，再点一次就是摘掉
      replaced = source.slice(0, at - len) + needle + source.slice(end + len);
    } else {
      replaced = source.slice(0, at) + marker + needle + marker + source.slice(end);
    }

    var res = MM.editor.replaceLines(range.from, range.to, replaced);
    if (res) {
      shiftBlocks(picked.block, res.delta);
      // 源码变了但预览按住了不重建，先把 DOM 上这一块的字改掉，
      // 让用户立刻看到效果（重建会在离开预览时发生）
      flush();
    }
  }

  /** 把光标所在块改成指定级别的标题；level 为 0 表示还原成普通段落 */
  function setHeading(level) {
    var block = active || blockOf(window.getSelection() && window.getSelection().anchorNode);
    if (!block) {
      toast('liveEditClickBlockFirst');
      return;
    }

    var range = rangeOf(block);
    if (!range) return;

    var PREFIX = /^#{1,6}\s+/;

    for (var n = range.from; n <= range.to; n++) {
      var text = MM.editor.lineText(n);
      if (!text.trim()) continue;

      var stripped = text.replace(PREFIX, '');
      var next = level ? new Array(level + 1).join('#') + ' ' + stripped : stripped;

      var res = MM.editor.replaceLines(n, n, next);
      if (res) shiftBlocks(block, res.delta);
      break;
    }
  }

  function insertTask() {
    var block = active || blockOf(window.getSelection() && window.getSelection().anchorNode);
    if (!block) {
      MM.editor.insertBlock('- [ ] ');
      return;
    }
    var range = rangeOf(block);
    if (!range) return;

    var res = MM.editor.replaceLines(range.to, range.to, MM.editor.lineText(range.to) + '\n- [ ] ');
    if (res) shiftBlocks(block, res.delta);
  }

  function buildBar() {
    var el = document.createElement('div');
    el.className = 'live-bar';
    el.setAttribute('data-mm-ui', '1');
    el.hidden = true;

    var title = document.createElement('span');
    title.className = 'live-bar__title';
    title.textContent = MM.i18n.t('liveEditBarTitle');
    el.appendChild(title);

    var group = document.createElement('div');
    group.className = 'live-bar__group';

    function button(labelKey, text, titleKey, run) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'live-bar__btn';
      b.textContent = text;
      b.title = MM.i18n.t(titleKey);
      b.setAttribute('data-i18n-title', titleKey);
      b.addEventListener('mousedown', function (e) {
        // 别把预览里的选区点没了 —— 一失焦选区就没了，格式也就无从施加
        e.preventDefault();
      });
      b.addEventListener('click', function (e) {
        e.preventDefault();
        run();
      });
      group.appendChild(b);
      return b;
    }

    button('fmtBold', 'B', 'fmtBold', function () {
      toggleInline('**');
    });
    button('fmtItalic', 'I', 'fmtItalic', function () {
      toggleInline('*');
    });
    button('fmtStrike', 'S', 'fmtStrike', function () {
      toggleInline('~~');
    });
    button('fmtInlineCode', '</>', 'fmtInlineCode', function () {
      toggleInline('`');
    });

    el.appendChild(group);

    var heads = document.createElement('div');
    heads.className = 'live-bar__group';
    el.appendChild(heads);

    [1, 2, 3, 0].forEach(function (level) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'live-bar__btn';
      b.textContent = level ? 'H' + level : '¶';
      b.title = level ? MM.i18n.t('liveEditHeading', { n: level }) : MM.i18n.t('liveEditParagraph');
      b.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
      b.addEventListener('click', function (e) {
        e.preventDefault();
        setHeading(level);
      });
      heads.appendChild(b);
    });

    var extra = document.createElement('div');
    extra.className = 'live-bar__group';
    el.appendChild(extra);

    function plain(text, titleKey, run) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'live-bar__btn live-bar__btn--wide';
      b.textContent = text;
      b.title = MM.i18n.t(titleKey);
      b.setAttribute('data-i18n-title', titleKey);
      b.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
      b.addEventListener('click', function (e) {
        e.preventDefault();
        run();
      });
      extra.appendChild(b);
      return b;
    }

    plain('☑', 'fmtTask', function () {
      insertTask();
      flush();
    });
    plain(MM.i18n.t('liveEditDiagram'), 'liveEditDiagramTitle', function () {
      if (MM.diagramPanel) MM.diagramPanel.openNearest(active);
    });

    var spacer = document.createElement('span');
    spacer.className = 'live-bar__spacer';
    el.appendChild(spacer);

    var exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'live-bar__btn live-bar__btn--exit';
    exit.textContent = MM.i18n.t('liveEditExit');
    exit.title = MM.i18n.t('liveEditExitTitle');
    exit.setAttribute('data-i18n-title', 'liveEditExitTitle');
    exit.addEventListener('click', function () {
      MM.liveEdit.setEnabled(false);
    });
    el.appendChild(exit);

    return el;
  }

  /* ------------------------------------------------------------------
     模式开关
     ------------------------------------------------------------------ */

  function applyEditable() {
    if (!container) return;

    var els = container.querySelectorAll('.mm-block');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];

      if (isDiagramBlock(el)) {
        // 图表不进来打字 —— 里面是 SVG。点它开属性面板。
        el.removeAttribute('contenteditable');
        el.classList.add('mm-block--diagram');
        continue;
      }

      el.classList.remove('mm-block--diagram');
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
    }
  }

  function releaseAll() {
    if (!container) return;
    var els = container.querySelectorAll('.mm-block[contenteditable]');
    for (var i = 0; i < els.length; i++) els[i].removeAttribute('contenteditable');
    var editing = container.querySelectorAll('.mm-block--editing');
    for (var j = 0; j < editing.length; j++) editing[j].classList.remove('mm-block--editing');
  }

  function setEnabled(next) {
    next = !!next;
    if (next === on) return;

    if (!next) flush();

    on = next;
    document.body.classList.toggle('live-edit', on);

    if (bar) bar.hidden = !on;

    if (on) {
      applyEditable();
    } else {
      releaseAll();
      active = null;
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      // 解除挂起时会自己对齐一版，把编辑期间攒下的改动一次性渲染出来
      MM.preview.setHold(false);
    }

    MM.bus.emit('liveedit:changed', { on: on });
  }

  /* ------------------------------------------------------------------
     事件
     ------------------------------------------------------------------ */

  function onFocusIn(e) {
    if (!on) return;

    var block = blockOf(e.target);
    if (!block || isDiagramBlock(block)) return;
    activate(block);
  }

  /**
   * 把某一块设为「正在编辑」，并挂起预览重建。
   *
   * 不能只指望 focusin：页面不在前台时（VS Code 内置浏览器、工具窗口、
   * 内嵌预览）程序化聚焦不一定派发它。所以真正的主入口是 pointerdown ——
   * 真人本来也是先点一下再打字。
   */
  function activate(block) {
    if (!on || !block) return;
    if (releaseTimer) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    if (block === active) return;

    // 换块之前先把上一块落地，否则它的改动会随 DOM 重建一起丢
    flush();

    active = block;
    block.classList.add('mm-block--editing');
    MM.preview.setHold(true);
  }

  function onPointerDown(e) {
    if (!on) return;
    var block = blockOf(e.target);
    if (!block || isDiagramBlock(block)) return;
    activate(block);
  }

  /**
   * 点/按到预览外面去 → 落地并解除挂起。
   *
   * focusout 在无前台焦点的环境里同样不可靠，而「挂起」永远不解开
   * 后果很重 —— 预览区从此再也不跟着源码更新。所以再拿外层点击押一刀。
   */
  function onDocumentDown(e) {
    if (!on || !active) return;
    if (container && container.contains(e.target)) return;
    if (bar && bar.contains(e.target)) return;

    flush();
    if (active) active.classList.remove('mm-block--editing');
    active = null;
    MM.preview.setHold(false);
  }

  function onFocusOut() {
    if (!on) return;

    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      releaseTimer = null;

      // 焦点还在预览里就别解除 —— 一块接一块地改是很正常的操作，
      // 中间每停一次都重建 DOM 的话，光标会一直被打断
      var focused = document.activeElement;
      if (focused && container && container.contains(focused) && !isDiagramBlock(blockOf(focused) || focused)) {
        return;
      }

      flush();
      if (active) active.classList.remove('mm-block--editing');
      active = null;

      MM.preview.setHold(false);
    }, RELEASE_DELAY);
  }

  function onInput(e) {
    if (!on) return;

    // 兜底：万一没有先经过 pointerdown / focusin，就从事件目标本身认领
    if (!active) {
      var hit = blockOf(e.target);
      if (hit && !isDiagramBlock(hit)) activate(hit);
    }
    if (!active) return;

    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, WRITE_DEBOUNCE);
  }

  function onClick(e) {
    if (!on) return;

    var diagram = closest(e.target, '.mm-mermaid');
    if (diagram) {
      if (MM.diagramPanel) MM.diagramPanel.openFor(diagram, e.target);
      return;
    }

    var box = closest(e.target, 'input[type=checkbox]');
    if (box) {
      // 不让浏览器自己勾 —— 勾选框的真相在源码里，先改源码再由渲染决定
      e.preventDefault();
      toggleTask(box);
      return;
    }

    if (e.target && e.target.tagName === 'DEL') {
      // 只在「光标不在里面」时切换，否则用户想改删除线里的字都点不进去
      var sel = window.getSelection();
      var inside = sel && sel.anchorNode && closest(sel.anchorNode.parentNode || sel.anchorNode, 'del');
      if (!inside) unwrapDel(e.target);
    }
  }

  function onKeyDown(e) {
    if (!on) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setEnabled(false);
    }
  }

  /* ------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------ */

  function init(previewContainer) {
    container = previewContainer;
    if (!container) return;

    bar = buildBar();

    // 工具条要挂在**滚动区外面**（.pane--preview 的第一个孩子），
    // 不然滚动文档时它会跟着一起滚走
    var pane = (container.closest && container.closest('.pane--preview')) || container.parentNode;
    pane.insertBefore(bar, pane.firstChild);

    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    container.addEventListener('pointerdown', onPointerDown, true);
    container.addEventListener('input', onInput);
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onDocumentDown, true);

    // 每次重渲染 DOM 都换了新的块，可编辑属性和监听（事件委托挂在
    // container 上所以监听不用重挂）都得重新过一遍
    MM.bus.on('preview:rendered', function () {
      if (on) applyEditable();
    });

    MM.bus.on('doc:opened', function () {
      // 换文档时预览整个换掉，正在编辑的那一块已经不存在了
      active = null;
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      MM.preview.setHold(false);
    });
  }

  MM.liveEdit = {
    init: init,
    isOn: function () {
      return on;
    },
    setEnabled: setEnabled,
    toggle: function () {
      setEnabled(!on);
    },
    /** 写回一次（命令面板 / 退出前用） */
    flush: flush,
    /** 当前正在编辑的块，供图表面板定位用 */
    activeBlock: function () {
      return active;
    }
  };
})();
