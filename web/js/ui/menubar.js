/**
 * MixMark · 菜单栏
 * ===============================================================
 * 顶栏上的「文件 / 编辑」下拉菜单。
 *
 * 设计要点：
 *   1. 菜单只声明「命令 id」，标题与快捷键一律从命令注册表取 ——
 *      菜单、命令面板、快捷键三处的文案永远同源，不会各自漂移。
 *   2. 每次展开时重新问一遍 isEnabled()，所以「没有可撤销的内容」这类状态
 *      是实时的，不会出现灰着却点得动的情况。
 *   3. 键盘可达：← → 换菜单，↑ ↓ 走条目，Enter 执行，Esc 收起并交还焦点。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /**
   * 菜单结构。'-' 表示分隔线。
   *
   * 这一层只负责「哪些命令出现在哪个菜单里、以什么顺序」，
   * 具体某个命令能不能点、叫什么名字，全部由命令注册表决定。
   */
  var MENUS = [
    {
      id: 'file',
      labelKey: 'menuFile',
      items: [
        'file.new',
        'file.newFolder',
        '-',
        'file.open',
        'storage.pickFolder',
        '-',
        'file.save',
        'file.saveAs',
        'file.saveAll',
        '-',
        'export.md',
        'export.html',
        '-',
        'export.all',
        '-',
        'file.importFolder',
        '-',
        'app.quit'
      ]
    },
    {
      id: 'edit',
      labelKey: 'menuEdit',
      items: [
        'edit.undo',
        'edit.redo',
        '-',
        'edit.cut',
        'edit.copy',
        'edit.paste',
        '-',
        'edit.find',
        'edit.replace'
      ]
    }
  ];

  var root = null;
  /** 当前展开的菜单 id */
  var openId = null;
  /** 菜单 id → { btn, popup } */
  var nodes = Object.create(null);
  var bound = false;

  /* ------------------------------------------------------------------
     构建
     ------------------------------------------------------------------ */

  function shortcutText(id) {
    var def = MM.commands.get(id);
    if (!def) return '';
    // menuKey 是「只展示、不注册」的快捷键。
    // 撤销/剪切/复制/粘贴都交给 CodeMirror 自己的 keymap 处理 ——
    // 全局拦截 Ctrl+C 会在对话框输入框里也把复制抢走，得不偿失。
    var spec = def.key || def.menuKey;
    return spec ? MM.commands.formatKey(spec) : '';
  }

  function buildItem(id) {
    var def = MM.commands.get(id);

    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'menubar__item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-command', id);

    var label = document.createElement('span');
    label.className = 'menubar__label';
    label.textContent = def ? MM.commands.titleOf(def) : id;

    var key = document.createElement('span');
    key.className = 'menubar__key';
    key.textContent = shortcutText(id);

    item.appendChild(label);
    item.appendChild(key);

    item.addEventListener('click', function () {
      if (item.disabled) return;
      close();
      MM.commands.run(id);
    });

    return item;
  }

  function buildMenu(menu) {
    var wrap = document.createElement('div');
    wrap.className = 'menubar__menu';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menubar__btn';
    btn.textContent = MM.i18n.t(menu.labelKey);
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('data-menu', menu.id);

    var popup = document.createElement('div');
    popup.className = 'menubar__popup';
    popup.setAttribute('role', 'menu');
    popup.hidden = true;

    menu.items.forEach(function (id) {
      if (id === '-') {
        var sep = document.createElement('div');
        sep.className = 'menubar__sep';
        sep.setAttribute('role', 'separator');
        popup.appendChild(sep);
        return;
      }
      popup.appendChild(buildItem(id));
    });

    /* ---- 交互 ---- */

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (openId === menu.id) close();
      else openMenu(menu.id, false);
    });

    // 已经展开了某个菜单时，划过另一个标签直接切过去（桌面菜单栏的惯例）
    btn.addEventListener('mouseenter', function () {
      if (openId && openId !== menu.id) openMenu(menu.id, false);
    });

    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu(menu.id, true);
      }
    });

    popup.addEventListener('keydown', function (e) {
      onPopupKeydown(e, menu.id, popup);
    });

    wrap.appendChild(btn);
    wrap.appendChild(popup);
    nodes[menu.id] = { btn: btn, popup: popup };

    return wrap;
  }

  /* ------------------------------------------------------------------
     开合
     ------------------------------------------------------------------ */

  /** 可聚焦的条目：原生 disabled 的按钮拿不到焦点，正好用来过滤 */
  function enabledItems(popup) {
    return [].filter.call(popup.querySelectorAll('.menubar__item'), function (el) {
      return !el.disabled;
    });
  }

  /** 每次展开都重新核对一遍可用性 —— 撤销栈深度、选区是否存在随时在变 */
  function syncEnabled(popup) {
    [].forEach.call(popup.querySelectorAll('.menubar__item'), function (el) {
      var id = el.getAttribute('data-command');
      var def = MM.commands.get(id);
      var ok = !!def && MM.commands.isEnabled(def);
      el.disabled = !ok;
      el.setAttribute('aria-disabled', ok ? 'false' : 'true');
    });
  }

  function openMenu(id, focusFirst) {
    if (openId && openId !== id) {
      var prev = nodes[openId];
      if (prev) {
        prev.btn.setAttribute('aria-expanded', 'false');
        prev.popup.hidden = true;
      }
    }

    var node = nodes[id];
    if (!node) return;

    openId = id;
    syncEnabled(node.popup);
    node.popup.hidden = false;
    node.btn.setAttribute('aria-expanded', 'true');

    if (focusFirst) {
      var items = enabledItems(node.popup);
      if (items.length) items[0].focus();
    }
  }

  function close(refocus) {
    if (!openId) return;

    var node = nodes[openId];
    if (node) {
      node.btn.setAttribute('aria-expanded', 'false');
      node.popup.hidden = true;
      if (refocus) node.btn.focus();
    }
    openId = null;
  }

  /** ← → 在菜单之间横移；没有展开的菜单时什么都不做 */
  function moveMenu(delta) {
    var ids = MENUS.map(function (m) {
      return m.id;
    });
    var i = ids.indexOf(openId);
    if (i === -1) return;
    openMenu(ids[(i + delta + ids.length) % ids.length], true);
  }

  function onPopupKeydown(e, id, popup) {
    var items = enabledItems(popup);
    var current = items.indexOf(document.activeElement);

    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      moveMenu(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      var step = e.key === 'ArrowDown' ? 1 : -1;
      var next = current === -1 ? 0 : (current + step + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (!items.length) return;
      items[e.key === 'Home' ? 0 : items.length - 1].focus();
      return;
    }
    if (e.key === 'Tab') close();
    void id;
  }

  /* ------------------------------------------------------------------
     生命周期
     ------------------------------------------------------------------ */

  function rebuild() {
    if (!root) return;

    close();
    root.innerHTML = '';
    nodes = Object.create(null);

    MENUS.forEach(function (menu) {
      root.appendChild(buildMenu(menu));
    });
  }

  function bindGlobal() {
    if (bound) return;
    bound = true;

    // 点空白处收起。用 mousedown 而不是 click：
    // click 要等 mouseup，拖选文字时松手在别处也会被当成一次点击
    document.addEventListener('mousedown', function (e) {
      if (!openId) return;
      if (root && root.contains(e.target)) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openId) close(true);
    });
  }

  function init() {
    root = document.getElementById('menubar');
    if (!root) return false;

    rebuild();
    bindGlobal();
    return true;
  }

  MM.menubar = {
    init: init,
    rebuild: rebuild,
    close: close,
    MENUS: MENUS
  };
})();
