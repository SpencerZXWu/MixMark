/**
 * MixMark · 命令面板
 * ===============================================================
 * 列出 MM.commands 里注册的全部命令，支持模糊搜索。
 * 这是「功能可被发现」的关键 —— 用户不必记住快捷键，
 * 敲两个字母就能找到功能。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var handle = null; // 当前浮层句柄
  var overlay = null;
  var inputEl = null;
  var listEl = null;
  var items = []; // 当前筛选项 [{ def, title, groupLabel, index }]
  var selected = 0;

  /* ------------------------------------------------------------------
     模糊匹配
     返回 null 表示不匹配；数字越小排越前。
     ------------------------------------------------------------------ */

  function fuzzyScore(text, query) {
    if (!query) return 0;

    var t = text.toLowerCase();
    var q = query.toLowerCase();

    // 完整子串命中优先，位置越靠前越好
    var idx = t.indexOf(q);
    if (idx !== -1) return idx;

    // 退化为「按顺序出现的字符」匹配
    var ti = 0;
    var gaps = 0;
    var lastHit = -1;

    for (var qi = 0; qi < q.length; qi++) {
      var found = t.indexOf(q.charAt(qi), ti);
      if (found === -1) return null;
      if (lastHit !== -1) gaps += found - lastHit - 1;
      lastHit = found;
      ti = found + 1;
    }

    return 1000 + gaps;
  }

  /* ------------------------------------------------------------------
     构建
     ------------------------------------------------------------------ */

  function collect(query) {
    var defs = MM.commands.all();
    var out = [];

    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      if (def.hidden) continue;

      var title = MM.commands.titleOf(def);

      // 半角/全角与中英文混排场景下，同时用 i18n key 参与匹配，
      // 让英文用户也能用中文功能名搜到（反之亦然）
      var haystack = title + ' ' + (def.titleKey || '') + ' ' + def.id;

      var score = fuzzyScore(haystack, query);
      if (score === null) continue;

      out.push({ def: def, title: title, score: score });
    }

    out.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return MM.commands.titleOf(a.def).localeCompare(MM.commands.titleOf(b.def));
    });

    return out.slice(0, 60);
  }

  var GROUP_LABEL = {
    file: 'paletteGroupFile',
    edit: 'paletteGroupEdit',
    view: 'paletteGroupView',
    format: 'paletteGroupFormat',
    export: 'paletteGroupExport',
    app: 'paletteGroupApp'
  };

  /* ------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------ */

  function render() {
    var query = inputEl.value.trim();
    items = collect(query);
    if (selected >= items.length) selected = Math.max(0, items.length - 1);

    if (!items.length) {
      listEl.innerHTML = '';
      var empty = document.createElement('li');
      empty.className = 'palette__empty';
      empty.textContent = MM.i18n.t('paletteEmpty');
      listEl.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();

    items.forEach(function (item, i) {
      var li = document.createElement('li');
      li.className = 'palette__item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === selected ? 'true' : 'false');

      var title = document.createElement('span');
      title.className = 'palette__item-title';
      title.textContent = item.title;

      var group = document.createElement('span');
      group.className = 'palette__item-group';
      group.textContent = MM.i18n.t(GROUP_LABEL[item.def.group] || 'paletteGroupApp');

      li.appendChild(title);

      if (item.def.key) {
        var kbd = document.createElement('kbd');
        kbd.className = 'mm-kbd';
        kbd.textContent = MM.commands.formatKey(item.def.key);
        li.appendChild(kbd);
      }

      li.appendChild(group);

      // 用 mousedown 而不是 click：避免输入框失焦引起的时序问题
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        runAt(i);
      });
      li.addEventListener('mousemove', function () {
        if (selected === i) return;
        selected = i;
        updateSelection();
      });

      frag.appendChild(li);
    });

    listEl.innerHTML = '';
    listEl.appendChild(frag);
    updateSelection();
  }

  function updateSelection() {
    var nodes = listEl.querySelectorAll('.palette__item');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('aria-selected', i === selected ? 'true' : 'false');
    }
    var active = nodes[selected];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------------
     执行
     ------------------------------------------------------------------ */

  function runAt(index) {
    var item = items[index];
    if (!item) return;

    var id = item.def.id;
    close();
    // 关闭后再执行：命令可能会再开新浮层（设置页），
    // 若先执行再关闭会把新浮层一起关掉
    setTimeout(function () {
      MM.commands.run(id);
    }, 0);
  }

  /* ------------------------------------------------------------------
     开关
     ------------------------------------------------------------------ */

  function isOpen() {
    return !!handle;
  }

  function open() {
    if (overlay) {
      close();
      return;
    }

    var box = document.createElement('div');
    box.className = 'palette';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var wrap = document.createElement('div');
    wrap.className = 'palette__input-wrap';
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

    inputEl = document.createElement('input');
    inputEl.className = 'palette__input';
    inputEl.type = 'text';
    inputEl.placeholder = MM.i18n.t('palettePlaceholder');
    inputEl.autocomplete = 'off';
    inputEl.spellcheck = false;
    wrap.appendChild(inputEl);

    listEl = document.createElement('ul');
    listEl.className = 'palette__list';
    listEl.setAttribute('role', 'listbox');

    box.appendChild(wrap);
    box.appendChild(listEl);

    // 关闭回调里统一清理状态。Esc、点遮罩、执行命令三条路径都会走到这里，
    // 因此不需要在各个分支里各写一遍。
    handle = MM.dialogs.custom(box, {
      position: 'top',
      onClose: function () {
        handle = null;
        overlay = null;
        inputEl = null;
        listEl = null;
        items = [];
      }
    });
    overlay = handle.overlay;

    selected = 0;
    render();

    inputEl.addEventListener('input', function () {
      selected = 0;
      render();
    });

    inputEl.addEventListener('keydown', function (e) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          selected = Math.min(selected + 1, items.length - 1);
          updateSelection();
          break;
        case 'ArrowUp':
          e.preventDefault();
          selected = Math.max(selected - 1, 0);
          updateSelection();
          break;
        case 'Home':
          e.preventDefault();
          selected = 0;
          updateSelection();
          break;
        case 'End':
          e.preventDefault();
          selected = items.length - 1;
          updateSelection();
          break;
        case 'Enter':
          e.preventDefault();
          runAt(selected);
          break;
      }
    });

    requestAnimationFrame(function () {
      inputEl.focus();
    });
  }

  function close() {
    if (handle) handle.close(null);
  }

  MM.palette = {
    open: open,
    close: close,
    isOpen: isOpen
  };
})();
