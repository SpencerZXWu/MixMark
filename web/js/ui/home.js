/**
 * MixMark · 首页
 * ===============================================================
 * 第一次打开应用先落到这里，让人看清「文档能放在哪」，选一个再进工作区。
 * 之后启动直接进文档库；想回来点左上角的品牌名即可。
 *
 * 为什么「本地仓库」这一步只给提示、没有真的做：
 * 它需要 File System Access API 才能拿到真实文件夹，而这个 API 在
 * file:// 下（双击 index.html 的用法）被浏览器直接拒绝。
 * 与其给一个点了没反应的按钮，不如把话说清楚 —— 等 M4 桌面版。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var app = null;
  var root = null;

  function el(id) {
    return document.getElementById(id);
  }

  function isHome() {
    return !!(app && app.classList.contains('is-home'));
  }

  function show() {
    if (!app || isHome()) return;
    app.classList.add('is-home');
    if (root) root.hidden = false;
  }

  function hide() {
    if (!app || !isHome()) return;
    app.classList.remove('is-home');
    if (root) root.hidden = true;

    // 工作区刚从 display:none 里出来，尺寸要等这一帧结束才量得准；
    // 顺手把焦点交回编辑器，出来就能直接打字
    MM.scrollSync.afterLayout(function () {
      MM.scrollSync.remeasure();
      if (MM.editor) MM.editor.focus();
    });
  }

  function bind() {
    // 品牌名：悬停时文案换成「回到首页」（切换样式负责），点击就回来
    var brand = el('brand');
    if (brand) {
      brand.addEventListener('click', function () {
        show();
      });
    }

    var repo = el('btn-create-repo');
    if (repo) {
      repo.addEventListener('click', function () {
        // 不装作能创建：直接说清为什么现在不行、什么时候行
        MM.toast.show(MM.i18n.t('homeRepoSoon'));
      });
    }

    var lib = el('btn-open-library');
    if (lib) {
      lib.addEventListener('click', function () {
        hide();
      });
    }
  }

  function init() {
    app = el('app');
    root = el('home');
    if (!app || !root) return;

    bind();

    if (!MM.settings.get('homeSeen')) {
      // 只在第一次启动停在这儿，之后直接进文档库
      MM.settings.set({ homeSeen: true });
      show();
    } else {
      app.classList.remove('is-home');
      root.hidden = true;
    }
  }

  MM.home = {
    init: init,
    show: show,
    hide: hide,
    isHome: isHome
  };
})();
 