/**
 * MixMark · 仓库切换浮层
 * ===============================================================
 * 侧栏顶部那个按钮、状态栏上的仓库名，点的都是它。
 *
 * 为什么是浮层而不是原生 <select>：每一项要同时显示**名字和地址**，
 * 而地址可能很长（`D:\资料\2026\课程\……`），原生下拉放不下也不给截断。
 *
 * 交互跟工具栏的悬浮面板保持一致：点外面关、Esc 关、只保留一个。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var node = null;
  var anchorNode = null;

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function close() {
    if (!node) return;
    if (node.parentNode) node.parentNode.removeChild(node);
    node = null;
    anchorNode = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
  }

  function onDocDown(e) {
    if (node && node.contains(e.target)) return;
    if (anchorNode && anchorNode.contains(e.target)) return;
    close();
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  /* ------------------------------------------------------------------
     内容
     ------------------------------------------------------------------ */

  function makeItem(repo) {
    var item = el('button', 'repo-item' + (repo.active ? ' is-active' : ''));
    item.type = 'button';

    var name = el('span', 'repo-item__name');
    name.textContent = repo.label;

    var path = el('span', 'repo-item__path');
    path.textContent = repo.store;
    path.title = repo.store;

    item.appendChild(name);
    item.appendChild(path);

    if (repo.active) {
      var dot = el('span', 'repo-item__dot');
      item.appendChild(dot);
    }

    item.addEventListener('click', function () {
      close();
      if (repo.active) return;
      MM.reposOps.enter(repo);
    });

    return item;
  }

  function build() {
    var box = el('div', 'repo-menu');

    var list = el('div', 'repo-menu__list');
    MM.repos.list().forEach(function (repo) {
      list.appendChild(makeItem(repo));
    });
    box.appendChild(list);

    var foot = el('div', 'repo-menu__foot');

    if (MM.desktopBridge && MM.desktopBridge.available()) {
      var add = el('button', 'repo-menu__action');
      add.type = 'button';
      add.textContent = MM.i18n.t('setRepoAdd');
      add.addEventListener('click', function () {
        close();
        MM.reposOps.create();
      });
      foot.appendChild(add);
    }

    var manage = el('button', 'repo-menu__action');
    manage.type = 'button';
    manage.textContent = MM.i18n.t('setReposTitle');
    manage.addEventListener('click', function () {
      close();
      MM.commands.run('app.settings');
    });
    foot.appendChild(manage);

    box.appendChild(foot);
    return box;
  }

  /**
   * 在某个元素下面弹出仓库列表。
   * 宽度取锚点宽度和 260px 里的大者 —— 侧栏按钮本来就够宽，
   * 状态栏上那一小块则太窄，照着它做会把地址挤成一团。
   */
  function open(anchor) {
    if (node) close();
    if (!anchor || !MM.repos) return;

    anchorNode = anchor;
    node = build();
    node.style.visibility = 'hidden';
    document.body.appendChild(node);

    var r = anchor.getBoundingClientRect();
    var width = Math.max(r.width, 260);
    var h = node.offsetHeight;

    var left = r.left;
    // 右边溢出就往左收（侧栏在左边时不会发生，状态栏那一端全靠它）
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;

    var top = r.bottom + 6;
    // 下面放不开就翻到上面
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);

    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
    node.style.width = Math.round(width) + 'px';
    node.style.visibility = '';

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
  }

  function toggle(anchor) {
    if (node) {
      close();
      return;
    }
    open(anchor);
  }

  MM.repoMenu = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () {
      return !!node;
    }
  };
})();
