/**
 * MixMark · 侧栏
 * ===============================================================
 * 两个面板：「文档」列出本机所有文档，「大纲」列出当前文档的标题结构。
 * 折叠状态与当前面板会持久化到设置里。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var els = {};
  var initialized = false;

  var ICON = {
    chevron: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 014.5 6h3.2l1.7 2H19a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0119 18H4.5A1.5 1.5 0 013 16.5v-9z"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M13.5 3H7a1.5 1.5 0 00-1.5 1.5v15A1.5 1.5 0 007 21h10a1.5 1.5 0 001.5-1.5V8L13.5 3z"/><path d="M13.5 3v5h5"/></svg>',
    rename:
      '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14.5 5.5l4 4"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>',
    close:
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>'
  };

  /* ------------------------------------------------------------------
     工具
     ------------------------------------------------------------------ */

  /** 列表里的时间只显示「今天 HH:MM / 其它 MM-DD」，不需要 i18n */
  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    function pad(n) {
      return n < 10 ? '0' + n : String(n);
    }

    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ------------------------------------------------------------------
     文档树
     ------------------------------------------------------------------ */

  /** 按某个字段分组，缺失的一律归到 __root__ */
  function groupBy(items, key) {
    var map = Object.create(null);
    items.forEach(function (it) {
      var k = it[key] || '__root__';
      if (!map[k]) map[k] = [];
      map[k].push(it);
    });
    return map;
  }

  function byName(a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  }

  function byRecent(a, b) {
    return (b.mtime || 0) - (a.mtime || 0);
  }

  /** 缩进：每层 14px，基础 8px。用左内边距而不是 margin，
      这样悬停/选中的底色能从最左边铺满整行。 */
  function indentPx(depth) {
    return 8 + depth * 14;
  }

  function renderDocs() {
    if (!els.tree) return;

    var state = MM.store.get();
    var folderChildren = groupBy(state.folders, 'parentId');
    var docChildren = groupBy(state.docs, 'folderId');

    els.tree.innerHTML = '';

    if (!state.folders.length && !state.docs.length) {
      var empty = document.createElement('li');
      empty.className = 'panel-empty';
      empty.textContent = MM.i18n.t('emptyDocs');
      els.tree.appendChild(empty);
      return;
    }

    els.tree.appendChild(renderLevel(null, 0, folderChildren, docChildren));
  }

  /**
   * 递归渲染一层：先文件夹（按名称），后文档（按最近修改）。
   * 同级里文件夹整体排在文档前面 —— 结构信息比时间信息更需要稳定。
   */
  function renderLevel(parent, depth, folderChildren, docChildren) {
    var frag = document.createDocumentFragment();
    var key = parent || '__root__';

    var folders = (folderChildren[key] || []).slice().sort(byName);
    var docs = (docChildren[key] || []).slice().sort(byRecent);

    folders.forEach(function (folder, i) {
      var expanded = MM.docs.isFolderExpanded(folder.id);

      var li = document.createElement('li');
      li.className = 'tree-folder';
      if (expanded) li.classList.add('is-expanded');

      // 「展开的文件夹与下一个同级文件夹之间空一行」
      if (expanded && folders[i + 1]) li.classList.add('has-gap-after');

      li.appendChild(folderRow(folder, depth, expanded));

      if (expanded) {
        var sub = document.createElement('ul');
        sub.className = 'tree-children';
        sub.appendChild(renderLevel(folder.id, depth + 1, folderChildren, docChildren));
        li.appendChild(sub);
      }

      frag.appendChild(li);
    });

    docs.forEach(function (doc) {
      var li = document.createElement('li');
      li.className = 'tree-doc' + (doc.id === MM.store.get().docId ? ' is-active' : '');
      li.setAttribute('data-doc-id', doc.id);
      li.setAttribute('draggable', 'true');
      li.appendChild(docRow(doc, depth));
      frag.appendChild(li);
    });

    return frag;
  }

  function folderRow(folder, depth, expanded) {
    var row = document.createElement('div');
    row.className = 'tree-row tree-row--folder';
    row.setAttribute('data-folder-id', folder.id);
    row.setAttribute('draggable', 'true');
    row.style.paddingLeft = indentPx(depth) + 'px';

    if (folder.id === MM.store.get().activeFolderId) row.classList.add('is-selected');

    var chev = document.createElement('span');
    chev.className = 'tree-chevron';
    chev.innerHTML = ICON.chevron;
    chev.title = MM.i18n.t(expanded ? 'tipCollapse' : 'tipExpand');

    var icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = ICON.folder;

    var name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = folder.name || MM.i18n.t('untitledFolder');
    name.title = name.textContent;

    var actions = document.createElement('span');
    actions.className = 'tree-actions';
    actions.appendChild(
      actionButton(ICON.rename, MM.i18n.t('cmdRenameFolder'), 'rename-folder', folder.id)
    );
    actions.appendChild(
      actionButton(ICON.trash, MM.i18n.t('cmdDeleteFolder'), 'delete-folder', folder.id, true)
    );

    row.appendChild(chev);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(actions);
    return row;
  }

  function docRow(doc, depth) {
    var row = document.createElement('div');
    row.className = 'tree-row tree-row--doc';
    row.style.paddingLeft = indentPx(depth) + 19 + 'px'; // 对齐文件夹图标的列

    var icon = document.createElement('span');
    icon.className = 'tree-icon tree-icon--doc';
    icon.innerHTML = ICON.doc;

    var body = document.createElement('span');
    body.className = 'tree-body';

    var name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = doc.title || MM.i18n.t('untitled');
    name.title = name.textContent;

    var meta = document.createElement('span');
    meta.className = 'tree-meta';
    meta.textContent = formatTime(doc.mtime);

    body.appendChild(name);
    body.appendChild(meta);

    var actions = document.createElement('span');
    actions.className = 'tree-actions';
    actions.appendChild(
      actionButton(ICON.rename, MM.i18n.t('cmdRenameDoc'), 'rename', doc.id)
    );
    actions.appendChild(
      actionButton(ICON.trash, MM.i18n.t('cmdDeleteDoc'), 'delete', doc.id, true)
    );

    // 绑着磁盘文件的文档多一个「在应用内关闭」。
    // 放在**行的最左侧**（借用为文件夹箭头预留的缩进槽），
    // 与右侧固定的「重命名 / 删除」分开 —— 它不是一个文档操作，
    // 而是「把这篇从应用里收起来」。
    if (MM.disk && MM.disk.isBound(doc.id)) {
      var lead = document.createElement('span');
      lead.className = 'tree-actions tree-actions--lead';
      lead.appendChild(
        actionButton(
          ICON.close,
          MM.i18n.t('cmdCloseDocHint', { name: MM.disk.labelOf(doc.id) }),
          'close',
          doc.id
        )
      );
      row.appendChild(lead);
    }

    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(actions);
    return row;
  }

  function actionButton(svg, title, action, id, danger) {
    var btn = document.createElement('button');
    btn.type = 'button';
    // is-danger 只用于配色，动作名单独传，避免把两者绑在一起
    btn.className = danger ? 'is-danger' : '';
    btn.setAttribute('data-action', action);
    btn.setAttribute('data-id', id);
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = svg;
    return btn;
  }

  /* ------------------------------------------------------------------
     树上的交互
     ------------------------------------------------------------------ */

  var ACTION_COMMAND = {
    rename: 'file.rename',
    delete: 'file.delete',
    close: 'file.close',
    'rename-folder': 'file.renameFolder',
    'delete-folder': 'file.deleteFolder'
  };

  // 磁盘绑定变化（打开 / 关闭磁盘文件）会改变文档行上的按钮组，重画一次。
  // 它不动 store，所以订阅字段的 watch 抓不到。
  MM.bus.on('disk:changed', renderDocs);

  function onTreeClick(e) {
    var btn = e.target.closest('button[data-action]');
    if (btn) {
      e.stopPropagation();
      var cmd = ACTION_COMMAND[btn.getAttribute('data-action')];
      if (cmd) MM.commands.run(cmd, btn.getAttribute('data-id'));
      return;
    }

    // 箭头只负责开合，不改变「当前文件夹」
    var chevron = e.target.closest('.tree-chevron');
    if (chevron) {
      var chevRow = chevron.closest('[data-folder-id]');
      if (chevRow) MM.docs.toggleFolder(chevRow.getAttribute('data-folder-id'));
      return;
    }

    var folderEl = e.target.closest('[data-folder-id]');
    if (folderEl) {
      var fid = folderEl.getAttribute('data-folder-id');
      // 点中文件夹 = 选中它（新建的文档会落进去）+ 展开看内容
      MM.store.set({ activeFolderId: fid });
      if (!MM.docs.isFolderExpanded(fid)) MM.docs.setFolderExpanded(fid, true);
      return;
    }

    var docEl = e.target.closest('[data-doc-id]');
    if (docEl) {
      var did = docEl.getAttribute('data-doc-id');
      if (did !== MM.store.get().docId) MM.docs.open(did);
    }
  }

  function onTreeDblClick(e) {
    var folderEl = e.target.closest('[data-folder-id]');
    if (folderEl) {
      MM.commands.run('file.renameFolder', folderEl.getAttribute('data-folder-id'));
      return;
    }
    var docEl = e.target.closest('[data-doc-id]');
    if (docEl) MM.commands.run('file.rename', docEl.getAttribute('data-doc-id'));
  }

  /* ------------------------------------------------------------------
     拖拽移动
     ------------------------------------------------------------------ */

  var dragging = null;

  /** 目标文件夹是否是 source 自身或它的后代 —— 这种情况必须拦掉，否则子树会脱树 */
  function isSelfOrDescendant(targetId, sourceId) {
    if (!targetId) return false;

    var byId = Object.create(null);
    MM.store.get().folders.forEach(function (f) {
      byId[f.id] = f;
    });

    var walk = targetId;
    var guard = 0;
    while (walk && guard++ < 500) {
      if (walk === sourceId) return true;
      walk = byId[walk] ? byId[walk].parentId : null;
    }
    return false;
  }

  function clearDropMarks() {
    if (!els.tree) return;
    els.tree.classList.remove('is-drop-root');
    els.tree.querySelectorAll('.is-drop-target').forEach(function (el) {
      el.classList.remove('is-drop-target');
    });
  }

  function onDragStart(e) {
    var el = e.target.closest('[data-folder-id], [data-doc-id]');
    if (!el) return;

    var folderId = el.getAttribute('data-folder-id');
    dragging = folderId
      ? { type: 'folder', id: folderId }
      : { type: 'doc', id: el.getAttribute('data-doc-id') };

    el.classList.add('is-dragging');

    e.dataTransfer.effectAllowed = 'copyMove';
    // Firefox 必须调用 setData，否则后续 dragover / drop 都不会触发
    try {
      e.dataTransfer.setData('text/plain', dragging.type + ':' + dragging.id);
    } catch (err) {
      /* 某些浏览器在只读 dataTransfer 上会抛错，忽略即可 */
    }
  }

  function onDragOver(e) {
    if (!dragging) return;

    var row = e.target.closest('[data-folder-id]');

    if (row) {
      var fid = row.getAttribute('data-folder-id');

      // 拖到自己或自己的后代上：不显示可放置状态，松手也不会生效
      if (dragging.type === 'folder' && isSelfOrDescendant(fid, dragging.id)) {
        clearDropMarks();
        return;
      }
      // 已经在这个文件夹里，没必要再放一次
      if (dragging.type === 'doc') {
        var meta = MM.docs.findMeta(dragging.id);
        if (meta && (meta.folderId || null) === fid) {
          clearDropMarks();
          return;
        }
      }

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      row.classList.add('is-drop-target');
      return;
    }

    // 落在空白处 → 移到根目录
    if (dragging.type === 'doc') {
      var m = MM.docs.findMeta(dragging.id);
      if (m && !m.folderId) {
        clearDropMarks();
        return;
      }
    } else if (!MM.docs.folderById(dragging.id) || MM.docs.folderById(dragging.id).parentId === null) {
      clearDropMarks();
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    els.tree.classList.add('is-drop-root');
  }

  function onDrop(e) {
    if (!dragging) return;
    e.preventDefault();

    var row = e.target.closest('[data-folder-id]');
    var targetFolder = row ? row.getAttribute('data-folder-id') : null;
    var payload = dragging;

    dragging = null;
    clearDropMarks();

    var promise =
      payload.type === 'doc'
        ? MM.docs.moveDoc(payload.id, targetFolder)
        : MM.docs.moveFolder(payload.id, targetFolder);

    Promise.resolve(promise).then(function () {
      MM.toast.show(MM.i18n.t('toastMoved'));
    });
  }

  function onDragEnd() {
    dragging = null;
    clearDropMarks();
    if (!els.tree) return;
    els.tree.querySelectorAll('.is-dragging').forEach(function (el) {
      el.classList.remove('is-dragging');
    });
  }

  /* ------------------------------------------------------------------
     面板切换与折叠
     ------------------------------------------------------------------ */

  function setTab(tab) {
    if (!els.tabs) return;

    MM.store.set({ sidebarTab: tab });

    var buttons = els.tabs.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-tab') === tab;
      buttons[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }

    els.panelDocs.classList.toggle('is-active', tab === 'docs');
    els.panelOutline.classList.toggle('is-active', tab === 'outline');
    if (els.panelSearch) els.panelSearch.classList.toggle('is-active', tab === 'search');

    // 切到搜索就把光标送进输入框，省得再点一下
    if (tab === 'search') MM.search.focus();
  }

  function setOpen(open) {
    MM.store.set({ sidebarOpen: !!open });
  }

  function toggle() {
    setOpen(!MM.store.get().sidebarOpen);
  }

  /* ------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------ */

  function init() {
    if (initialized) return;
    initialized = true;

    els.tabs = document.getElementById('sidebar-tabs');
    els.panelDocs = document.getElementById('panel-docs');
    els.panelOutline = document.getElementById('panel-outline');
    els.panelSearch = document.getElementById('panel-search');
    els.tree = document.getElementById('doc-tree');
    els.outlineList = document.getElementById('outline-list');
    els.newDocBtn = document.getElementById('btn-new-doc');
    els.newFolderBtn = document.getElementById('btn-new-folder');
    els.pickFolderBtn = document.getElementById('btn-pick-folder');

    MM.search.init();

    // 「连接文件夹」按钮只在浏览器真的支持时露出来，
    // 不支持的环境里显示一个点了没反应的按钮更让人困惑
    if (els.pickFolderBtn) {
      var fsa = MM.providers && MM.providers.fsa;
      var supported = !!(fsa && typeof fsa.supported === 'function' && fsa.supported());
      els.pickFolderBtn.hidden = !supported;

      if (supported) {
        els.pickFolderBtn.addEventListener('click', function () {
          var st = fsa.status();
          if (st.connected && st.permission !== 'granted') {
            MM.commands.run('storage.reconnectFolder');
          } else if (st.connected) {
            MM.commands.run('storage.refreshFolder');
          } else {
            MM.commands.run('storage.pickFolder');
          }
        });
      }
    }

    if (els.tree) {
      // 事件委托：树会被整体重建，逐个绑定监听器不划算
      els.tree.addEventListener('click', onTreeClick);
      els.tree.addEventListener('dblclick', onTreeDblClick);

      els.tree.addEventListener('dragstart', onDragStart);
      els.tree.addEventListener('dragover', onDragOver);
      els.tree.addEventListener('drop', onDrop);
      els.tree.addEventListener('dragend', onDragEnd);

      // 拖到侧栏其它位置就取消高亮，避免残留
      els.tree.addEventListener('dragleave', function (e) {
        if (!els.tree.contains(e.relatedTarget)) clearDropMarks();
      });
    }

    if (els.newDocBtn) {
      els.newDocBtn.addEventListener('click', function () {
        MM.commands.run('file.new');
      });
    }

    if (els.newFolderBtn) {
      els.newFolderBtn.addEventListener('click', function () {
        MM.commands.run('file.newFolder');
      });
    }

    if (els.tabs) {
      els.tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-tab]');
        if (btn) setTab(btn.getAttribute('data-tab'));
      });
    }

    var sidebarToggle = document.getElementById('btn-sidebar');
    if (sidebarToggle) sidebarToggle.addEventListener('click', toggle);

    MM.outline.init(els.outlineList);

    // 状态变化 → 局部重绘
    MM.store.watch('docs', renderDocs);
    MM.store.watch('docId', renderDocs);
    MM.store.watch('folders', renderDocs);
    MM.store.watch('activeFolderId', renderDocs);
    MM.store.watch('sidebarTab', function (s) {
      setTab(s.sidebarTab);
    });
    MM.store.watch('outline', function (s) {
      MM.outline.render(s.outline);
    });
    MM.store.watch('cursorLine', function (s) {
      MM.outline.setActive(s.cursorLine);
    });

    // 展开状态存在设置里，变了就重绘
    MM.settings.onChange(function (s, changed) {
      if (changed.indexOf('expandedFolders') !== -1) renderDocs();
    });

    setTab(MM.store.get().sidebarTab);
    renderDocs();
  }

  MM.sidebar = {
    init: init,
    setTab: setTab,
    setOpen: setOpen,
    toggle: toggle,
    renderDocs: renderDocs
  };
})();
