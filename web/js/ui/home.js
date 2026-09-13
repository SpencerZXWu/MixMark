/**
 * MixMark · 首页（仓库列表）
 * ===============================================================
 * 一个仓库 = 一份文档数据 + 一套属于它自己的工作台状态（见 core/repos.js）。
 * 首页把已有的仓库列成卡片，点一个就进去；「新建本地仓库」走
 * MM.reposOps.create（选文件夹 → 起名字 → 登记进列表）。
 *
 * 卡片上**同时显示名称和地址**：两个仓库都叫「笔记」时，
 * 只有那行地址能把它们分开。
 *
 * 浏览器里（双击 index.html）选不了真实文件夹，所以那个按钮不显示，
 * 只留下「本机文档库」一张卡片 —— 与其摆一个点了没反应的按钮，
 * 不如根本不摆。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var app = null;
  var root = null;
  var listNode = null;

  function el(id) {
    return document.getElementById(id);
  }

  function isHome() {
    return !!(app && app.classList.contains('is-home'));
  }

  function show() {
    if (!app || isHome()) return;
    render();
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

  /* ------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------ */

  /** 桌面端才有「选真实文件夹」这回事；浏览器里点了也没反应，就别摆出来 */
  function canPickFolder() {
    return !!(MM.desktopBridge && MM.desktopBridge.available());
  }

  function makeCard(repo) {
    var node = document.createElement('button');
    node.type = 'button';
    node.className = 'repo-card' + (repo.active ? ' is-active' : '');
    node.setAttribute('data-repo-id', repo.id);

    var name = document.createElement('span');
    name.className = 'repo-card__name';
    name.textContent = repo.label;

    var path = document.createElement('span');
    path.className = 'repo-card__path';
    path.textContent = repo.store;
    path.title = repo.store;

    node.appendChild(name);
    node.appendChild(path);

    if (repo.active) {
      var badge = document.createElement('span');
      badge.className = 'repo-card__badge';
      badge.textContent = MM.i18n.t('repoCurrent');
      node.appendChild(badge);
    }

    return node;
  }

  function render() {
    if (!listNode || !MM.repos) return;

    listNode.textContent = '';
    MM.repos.list().forEach(function (repo) {
      listNode.appendChild(makeCard(repo));
    });

    var add = el('btn-add-repo');
    if (add) add.hidden = !canPickFolder();
  }

  /* ------------------------------------------------------------------
     交互
     ------------------------------------------------------------------ */

  function enter(repo) {
    if (!repo) return;
    if (repo.id === MM.repos.currentId()) {
      hide();
      return;
    }

    MM.reposOps.enter(repo).then(function (done) {
      // 切失败（比如文件夹被挪走了）就留在首页 —— 卡片上的「当前」还指着旧库，
      // 重画一次免得两条都亮着
      if (done) hide();
      else render();
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

    // 卡片是动态渲染的，用事件委托
    if (listNode) {
      listNode.addEventListener('click', function (e) {
        var node = e.target && e.target.closest ? e.target.closest('.repo-card') : null;
        if (!node) return;
        enter(MM.repos.raw(node.getAttribute('data-repo-id')));
      });
    }

    var add = el('btn-add-repo');
    if (add) {
      add.addEventListener('click', function () {
        MM.reposOps.create();
      });
    }

    // 仓库列表变了（新建 / 改名 / 移除）就重画。
    // repo:changed 也要听：首页比仓库层先初始化完，启动时那一次渲染是空的，
    // 仓库层就绪后会发这个事件，正好补上首屏
    MM.bus.on('repo:list', render);
    MM.bus.on('repo:changed', render);
  }

  function init() {
    app = el('app');
    root = el('home');
    if (!app || !root) return;

    listNode = el('home-repos');
    bind();
    render();

    // 首启**不停在仓库列表**，直接进编辑器 —— 那里躺着欢迎文档。
    //
    // 列表本身随时可看：点左上角的品牌名，或者侧栏仓库浮层里的「所有仓库」。
    // 把新手拦在这里本来就没什么用 —— 第一次打开时本机文档库是空的，
    // 本地仓库一个都还没建，列表上只有一张卡片。
    app.classList.remove('is-home');
    root.hidden = true;
  }

  MM.home = {
    init: init,
    show: show,
    hide: hide,
    render: render,
    isHome: isHome
  };
})();
 