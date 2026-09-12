/**
 * MixMark · 编辑器标签页
 * ===============================================================
 * 编辑区最上面那条横向标签栏：每打开一篇文档就多一个标签，
 * 点标签切换、点标签上的小叉关掉（只关标签，不删文档）。
 *
 * 数据来源是 store 里的 openTabs（文档层维护），这里只负责画和派发动作 ——
 * 标签栏坏掉也不会影响文档的正常读写。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var bar = null;
  /** 正被拖动的那条标签的文档 id。null = 这次拖拽不是从标签栏发起的 */
  var dragId = null;

  function tabEl(id) {
    if (!bar) return null;
    var kids = bar.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute('data-doc-id') === id) return kids[i];
    }
    return null;
  }

  /**
   * 换位置时补一段动画（FLIP）：先记下旧位置，改完 DOM 再把每条标签
   * 反向平移回去，然后放开让它自己滑到 0。直接 insertBefore 是瞬移，
   * 看着像闪一下，分不清到底换了没有。
   *
   * 刻意不依赖 requestAnimationFrame —— 内置浏览器里 rAF 一帧都不跑，
   * 靠读 offsetWidth 强制一次重排，同样能让「起始位置」真的落到样式里。
   */
  function flip(mutate) {
    var kids = Array.prototype.slice.call(bar.children);
    var before = kids.map(function (n) {
      return n.getBoundingClientRect().left;
    });

    mutate();

    kids.forEach(function (n, i) {
      if (!n.isConnected) return;
      var dx = before[i] - n.getBoundingClientRect().left;
      if (!dx) return;

      n.style.transition = 'none';
      n.style.transform = 'translateX(' + dx + 'px)';
      void n.offsetWidth;
      n.style.transition = '';
      n.style.transform = '';
    });
  }

  /** 把 DOM 里的顺序交回文档层（那里才是 openTabs 的真身） */
  function commitOrder() {
    if (!bar) return;
    var ids = Array.prototype.slice.call(bar.children).map(function (n) {
      return n.getAttribute('data-doc-id');
    });
    if (ids.join(',') === (MM.store.get().openTabs || []).join(',')) return;
    MM.docs.reorderTabs(ids);
  }

  function build() {
    var pane = document.querySelector('.pane--edit');
    if (!pane) return false;

    bar = document.createElement('div');
    bar.className = 'etabs';
    bar.id = 'editor-tabs';
    bar.setAttribute('role', 'tablist');

    // 插在工具栏之上：工具栏整体下沉，标签条顶到编辑区最上面
    pane.insertBefore(bar, pane.firstChild);

    // 用事件委托而不是逐个绑定：标签会被整条重画，
    // 绑在元素上的监听重画一次就全失效了
    bar.addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('.etab') : null;
      if (!tab) return;

      var id = tab.getAttribute('data-doc-id');

      if (e.target.closest('.etab__close')) {
        MM.docs.closeTab(id);
        return;
      }
      // 刚拖完的那一下不该被当成「点了一下切换」——
      // 否则把标签拖到别处松手，文档也跟着跳了。
      // 用时间窗而不是布尔标记：标记一旦没被消费就会卡住，
      // 把下一次真实点击也吃掉；时间窗会自己过期
      if (Date.now() - dragEndedAt < 250) return;
      // 已激活的标签再点一次不做任何事，免得白白重读一遍文档
      if (id !== MM.store.get().docId) MM.docs.open(id);
    });

    // 中键关闭：与浏览器标签的习惯一致
    bar.addEventListener('mousedown', function (e) {
      if (e.button !== 1) return;
      var tab = e.target.closest ? e.target.closest('.etab') : null;
      if (!tab) return;
      e.preventDefault();
      MM.docs.closeTab(tab.getAttribute('data-doc-id'));
    });

    /* ---- 拖动：既能调顺序，也能拖出去当引用 ---- */

    bar.addEventListener('dragstart', function (e) {
      var tab = e.target.closest ? e.target.closest('.etab') : null;
      if (!tab) return;

      dragId = tab.getAttribute('data-doc-id');
      tab.classList.add('is-dragging');

      // 侧栏与 AI 面板认的就是 text/plain 里的 "doc:<id>"。
      // 沿用同一套约定，标签才能直接拖进 AI 区域当引用
      try {
        e.dataTransfer.setData('text/plain', 'doc:' + dragId);
      } catch (err) {
        /* 只读的 dataTransfer 会抛错，忽略即可 */
      }
      // 在标签栏内部是「挪位置」，拖到 AI 面板是「给它看一份」，
      // 两种都要允许，所以不能写死成 move
      e.dataTransfer.effectAllowed = 'copyMove';
    });

    bar.addEventListener('dragover', function (e) {
      // 不是从标签栏发起的（比如侧栏拖一篇文档过来）就不管，
      // 这里只负责调顺序，不负责"接住"别的拖拽来源
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      var over = e.target.closest ? e.target.closest('.etab') : null;
      if (!over || over.getAttribute('data-doc-id') === dragId) return;

      var dragged = tabEl(dragId);
      if (!dragged) return;

      // 落在左半边就插到它前面，右半边就插到后面 —— 与直觉一致
      var r = over.getBoundingClientRect();
      var after = e.clientX > r.left + r.width / 2;

      flip(function () {
        bar.insertBefore(dragged, after ? over.nextSibling : over);
      });
    });

    bar.addEventListener('drop', function (e) {
      if (!dragId) return;
      e.preventDefault();
      dragEndedAt = Date.now();
      commitOrder();
    });

    bar.addEventListener('dragend', function () {
      var tab = bar.querySelector('.etab.is-dragging');
      if (tab) tab.classList.remove('is-dragging');
      if (dragId) {
        dragEndedAt = Date.now();
        commitOrder();
      }
      dragId = null;
    });

    return true;
  }

  /** 最近一次拖动结束的时刻，用来抑制紧随其后的那一次 click */
  var dragEndedAt = 0;

  function titleOf(id, metas) {
    for (var i = 0; i < metas.length; i++) {
      if (metas[i].id === id) return metas[i].title || MM.i18n.t('untitled');
    }
    return MM.i18n.t('untitled');
  }

  function render() {
    if (!bar) return;

    var state = MM.store.get();
    var ids = state.openTabs || [];
    var metas = state.docs || [];

    bar.innerHTML = '';

    ids.forEach(function (id) {
      var active = id === state.docId;

      var tab = document.createElement('div');
      tab.className = 'etab' + (active ? ' is-active' : '');
      tab.setAttribute('data-doc-id', id);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      // 可拖：横着拖是换位置，拖到 AI 区域就是「让它读这篇」
      tab.setAttribute('draggable', 'true');

      var label = document.createElement('button');
      label.type = 'button';
      label.className = 'etab__label';
      label.textContent = titleOf(id, metas);
      label.title = label.textContent;

      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'etab__close';
      close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
      close.title = MM.i18n.t('tabClose');
      close.setAttribute('aria-label', close.title);

      tab.appendChild(label);
      tab.appendChild(close);
      bar.appendChild(tab);
    });
  }

  function init() {
    if (!build()) return false;

    // 标题变了（重命名、自动标题跟随）也得重画，所以连 docs 一起订阅
    MM.store.watch(['openTabs', 'docId', 'docs'], render);
    render();
    return true;
  }

  MM.tabs = { init: init, render: render };
})();
