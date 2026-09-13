/**
 * MixMark · 应用外壳
 * ===============================================================
 * 负责把各层粘起来：
 *   - 由命令注册表自动生成编辑器工具栏（加功能不用改 UI 代码）
 *   - 视图模式切换 / 侧栏折叠 / 分栏拖拽
 *   - 全局快捷键派发（唯一入口，避免与编辑器内部快捷键重复触发）
 *   - 编辑器 ↔ 预览 ↔ 滚动同步 的连线
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var els = {};
  var initialized = false;
  /** 全局下拉收起监听只绑一次（工具栏会因语言切换而重建） */
  var toolbarDismissBound = false;

  /* ------------------------------------------------------------------
     工具栏：从命令的 toolbar 元数据生成
     ------------------------------------------------------------------ */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** 命令在工具栏上的图标：优先 SVG，其次文字标签 */
  function glyphHtml(def) {
    return def.toolbar.svg || escapeHtml(def.toolbar.label || '');
  }

  function fullTitle(def) {
    var title = MM.commands.titleOf(def);
    if (def.key) title += ' (' + MM.commands.formatKey(def.key) + ')';
    return title;
  }

  /**
   * 防止下拉区块超出编辑区右边：默认左对齐，越界时改成右对齐。
   *
   * 用 visibility 隐藏而不是 display:none，好处是未展开时也能量到真实尺寸，
   * 可以在展开之前就把方向定好，不会出现「先展开再跳一下」。
   */
  function alignFlyout(wrap) {
    var flyout = wrap.querySelector('.tb-flyout');
    var pane = document.querySelector('.pane--edit');
    if (!flyout || !pane) return;

    // 自定义面板自己按编辑区实测宽度定位（它比按钮宽得多，
    // 简单的左右翻转应付不了窄窗口），这里让开
    if (flyout.classList.contains('tb-flyout--panel')) return;

    var fr = flyout.getBoundingClientRect();
    var pr = pane.getBoundingClientRect();

    wrap.classList.toggle('is-flipped', fr.right > pr.right - 6);
  }

  function closeAllFlyouts(except) {
    var wraps = document.querySelectorAll('.tb-group.is-open');
    for (var i = 0; i < wraps.length; i++) {
      if (wraps[i] === except) continue;
      wraps[i].classList.remove('is-open');
      var trigger = wraps[i].querySelector('.tb-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  /** 单个命令按钮 */
  function buildButton(def) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'editor-toolbar__btn';
    btn.setAttribute('data-command', def.id);
    btn.innerHTML = glyphHtml(def);
    btn.title = fullTitle(def);
    btn.setAttribute('aria-label', MM.commands.titleOf(def));

    if (def.toolbar.variant) btn.setAttribute('data-variant', def.toolbar.variant);

    // 用 mousedown + preventDefault 保住编辑器里的选区：
    // 换成 click 的话，按钮会先把焦点抢走、编辑器的选区被清掉，
    // 结果就是「点了加粗却没选中任何文字」
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      MM.commands.run(def.id);
    });

    return btn;
  }

  /**
   * 分组按钮：一个触发按钮 + 下方横向选项区。
   * 悬浮即展开（纯 CSS 完成），点击可钉住（照顾触屏与纯键盘用户）。
   */
  function buildGroup(groupId, members) {
    var meta = MM.commands.getGroup(groupId) || { label: '…', titleKey: '' };

    var wrap = document.createElement('div');
    wrap.className = 'tb-group';
    wrap.setAttribute('data-group', groupId);

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'editor-toolbar__btn tb-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = meta.titleKey ? MM.i18n.t(meta.titleKey) : meta.label;
    trigger.setAttribute('aria-label', trigger.title);
    trigger.innerHTML =
      '<span class="tb-trigger__label">' +
      escapeHtml(meta.label) +
      '</span>' +
      '<svg class="tb-caret" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

    var flyout = document.createElement('div');
    flyout.className = 'tb-flyout';
    flyout.setAttribute('role', 'menu');

    members.forEach(function (def) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'tb-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-command', def.id);
      item.title = fullTitle(def);

      var glyph = document.createElement('span');
      glyph.className = 'tb-item__glyph';
      glyph.innerHTML = glyphHtml(def);

      var label = document.createElement('span');
      label.className = 'tb-item__label';
      label.textContent = MM.commands.titleOf(def);

      item.appendChild(glyph);
      item.appendChild(label);

      item.addEventListener('mousedown', function (e) {
        e.preventDefault();
        MM.commands.run(def.id);
        closeAllFlyouts();
      });

      flyout.appendChild(item);
    });

    wrap.appendChild(trigger);
    wrap.appendChild(flyout);

    wrap.addEventListener('mouseenter', function () {
      alignFlyout(wrap);
    });
    wrap.addEventListener('focusin', function () {
      alignFlyout(wrap);
    });

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      var willOpen = !wrap.classList.contains('is-open');
      closeAllFlyouts(wrap);
      alignFlyout(wrap);
      wrap.classList.toggle('is-open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    return wrap;
  }

  /**
   * 自定义工具栏控件。
   *
   * 按钮 + 下拉面板的悬浮展开、点击钉住、外点关闭、右边界翻转这一整套，
   * 与普通分组完全一致 —— 所以外壳照搬，只把面板内容留给控件自己填。
   * 实现在 MM.toolbarWidgets[名字]，由对应模块注册（见 ui/symbol-panel.js）。
   *
   * 之所以不把 buildGroup 抽成公用函数：两者的差异比看起来多
   * （分组要按 group 元数据取标签、要遍历成员生成条目），
   * 硬合并反而会把一个已经跑通的组件揉复杂。这点重复是故意留的。
   */
  function buildWidget(def) {
    var title = MM.commands.titleOf(def);
    var full = def.key ? title + ' (' + MM.commands.formatKey(def.key) + ')' : title;

    var wrap = document.createElement('div');
    wrap.className = 'tb-group';
    wrap.setAttribute('data-widget', def.toolbar.widget);

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'editor-toolbar__btn tb-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = full;
    trigger.setAttribute('aria-label', title);
    trigger.innerHTML =
      '<span class="tb-trigger__label">' +
      escapeHtml(def.toolbar.label || '…') +
      '</span>' +
      '<svg class="tb-caret" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

    var flyout = document.createElement('div');
    flyout.className = 'tb-flyout tb-flyout--panel';
    flyout.setAttribute('role', 'dialog');
    flyout.setAttribute('aria-label', title);

    wrap.appendChild(trigger);
    wrap.appendChild(flyout);

    wrap.addEventListener('mouseenter', function () {
      alignFlyout(wrap);
    });
    wrap.addEventListener('focusin', function () {
      alignFlyout(wrap);
    });

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      var willOpen = !wrap.classList.contains('is-open');
      closeAllFlyouts(wrap);
      alignFlyout(wrap);
      wrap.classList.toggle('is-open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    var mount = MM.toolbarWidgets && MM.toolbarWidgets[def.toolbar.widget];
    if (mount) mount(def, flyout, wrap);

    return wrap;
  }

  function buildToolbar() {
    var host = document.getElementById('editor-toolbar');
    if (!host) return;

    host.innerHTML = '';

    var defs = MM.commands
      .all()
      .filter(function (d) {
        return d.toolbar && !d.hidden;
      })
      .sort(function (a, b) {
        return (a.toolbar.order || 0) - (b.toolbar.order || 0);
      });

    var lastBucket = null;
    var i = 0;

    while (i < defs.length) {
      var def = defs[i];

      // order 的十位数即视觉分区：10 标题 / 20 行内 / 30 块级 / 40 公式。
      // 跨区插一条竖线，位置完全由数据驱动，不需要手工维护。
      var bucket = Math.floor((def.toolbar.order || 0) / 10);
      if (lastBucket !== null && bucket !== lastBucket) {
        var sep = document.createElement('span');
        sep.className = 'editor-toolbar__sep';
        host.appendChild(sep);
      }
      lastBucket = bucket;

      var groupId = def.toolbar.group;

      // 自定义控件（如公式符号面板）：外壳与普通分组共用一套开合逻辑，
      // 差异只在面板内容
      if (def.toolbar.widget) {
        host.appendChild(buildWidget(def));
        i++;
        continue;
      }

      if (groupId) {
        // 收集同一分区内、属于同一组的「连续」命令 —— 所以组的成员
        // 在 order 上必须挨着，否则会被拆成两个下拉按钮
        var members = [];
        while (
          i < defs.length &&
          defs[i].toolbar.group === groupId &&
          Math.floor((defs[i].toolbar.order || 0) / 10) === bucket
        ) {
          members.push(defs[i]);
          i++;
        }
        host.appendChild(buildGroup(groupId, members));
      } else {
        host.appendChild(buildButton(def));
        i++;
      }
    }

    // 点空白处 / 按 Esc 收起所有下拉。只绑一次。
    if (!toolbarDismissBound) {
      toolbarDismissBound = true;

      document.addEventListener('mousedown', function (e) {
        if (!e.target.closest('.tb-group')) closeAllFlyouts();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeAllFlyouts();
      });
    }
  }

  /* ------------------------------------------------------------------
     视图模式
     ------------------------------------------------------------------ */

  function applyMode(mode) {
    document.getElementById('app').setAttribute('data-mode', mode);

    var buttons = els.viewSwitch ? els.viewSwitch.querySelectorAll('button') : [];
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', buttons[i].getAttribute('data-mode') === mode ? 'true' : 'false');
    }
  }

  function applySidebar(open) {
    document.getElementById('app').classList.toggle('is-sidebar-collapsed', !open);
    var btn = document.getElementById('btn-sidebar');
    if (btn) btn.classList.toggle('is-active', !!open);
  }

  function applySplit(ratio) {
    document.documentElement.style.setProperty('--mm-split', (ratio * 100).toFixed(2) + '%');
  }

  /**
   * 分栏比例——**全局一份**，编辑区与预览区共用同一个值。
   *
   * 曾经按文档各记一套（settings.docSplits），结论是反直觉：
   * 打开不同文档宽度不一样，用户只会觉得「怎么又变了」。
   * 分栏是版式偏好，跟文档内容无关，一个应用一份就够。
   *
   * 真正需要独立的是**各区域自己的宽度**：
   * 侧栏走 --mm-sidebar-w（见 initSidebarSplitter），
   * 编辑/预览走 --mm-split（见 initSplitter），两条互不影响。
   */
  function currentSplit() {
    return MM.settings.get('split');
  }

  /** 侧栏宽度：覆盖 --mm-sidebar-w 这个令牌，与分栏比例互不影响 */
  function applySidebarWidth(px) {
    if (typeof px !== 'number' || !isFinite(px)) return;
    document.documentElement.style.setProperty('--mm-sidebar-w', Math.round(px) + 'px');
  }

  /* ------------------------------------------------------------------
     分栏拖拽
     ------------------------------------------------------------------ */

  function initSplitter() {
    var splitter = document.getElementById('splitter');
    var workspace = els.workspace;
    if (!splitter || !workspace) return;

    var dragging = false;
    var ratio = MM.settings.get('split');
    var startX = 0;
    var startRatio = ratio;

    function onMove(e) {
      if (!dragging) return;

      var rect = workspace.getBoundingClientRect();
      // 算「位移差」，不用鼠标绝对位置。
      // 分隔条自己占几像素、两侧还有内边框，绝对位置换算出来的比例
      // 与真实分界点总有几像素偏差；鼠标一按下就归零重算，
      // 表现就是「点一下分栏自己跑了」。
      var next = startRatio + (e.clientX - startX) / rect.width;

      // 夹在 20% ~ 80%：留够两边的最小可用宽度，避免拖到看不见
      ratio = Math.max(0.2, Math.min(0.8, next));

      applySplit(ratio);

      // 拖动过程中实时重测预览块的几何位置，
      // 否则行号索引里的 offsetTop 全是旧的，滚动同步会跳
      MM.scrollSync.remeasure();
    }

    function stop() {
      if (!dragging) return;

      dragging = false;
      splitter.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', stop);

      // 拖完才写状态与设置：拖动过程中每帧都写会把 localStorage 打爆。
      // 写全局一份，所有文档下次打开都是这个宽度
      MM.store.set({ split: ratio });
      MM.settings.set({ split: ratio });
    }

    splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      // 记下起点与当前比例，后续只按位移差算
      startX = e.clientX;
      startRatio = MM.settings.get('split');
      ratio = startRatio;
      splitter.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', stop);
    });

    // 双击恢复五五开。也要写进设置，否则刷新又弹回上次的怪宽度
    splitter.addEventListener('dblclick', function () {
      applySplit(0.5);
      MM.store.set({ split: 0.5 });
      MM.settings.set({ split: 0.5 });
      MM.scrollSync.remeasure();
    });
  }

  /**
   * 侧栏 ↔ 编辑区的分隔条。
   *
   * 与编辑区 ↔ 预览区那条完全独立：一个管侧栏宽，一个管分栏比例，
   * 互不干扰。侧栏收起时整条隐藏（否则左边会留一根多余的细线和一片抓取区）。
   */
  function initSidebarSplitter() {
    var splitter = document.getElementById('sidebar-splitter');
    var app = document.getElementById('app');
    if (!splitter || !app) return;

    var dragging = false;
    var width = MM.settings.get('sidebarW') || 264;
    var DEFAULT_W = 264;

    function onMove(e) {
      if (!dragging) return;
      // 夹在 160 ~ 480：窄了文件夹名全被截断，宽了编辑区就没地方了
      width = Math.max(160, Math.min(480, e.clientX - app.getBoundingClientRect().left));
      applySidebarWidth(width);
    }

    function stop() {
      if (!dragging) return;

      dragging = false;
      splitter.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', stop);

      MM.settings.set({ sidebarW: width });
    }

    splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      splitter.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', stop);
    });

    splitter.addEventListener('dblclick', function () {
      width = DEFAULT_W;
      applySidebarWidth(width);
      MM.settings.set({ sidebarW: width });
    });

    applySidebarWidth(width);
  }

  /* ------------------------------------------------------------------
     预览空状态
     ------------------------------------------------------------------ */

  function updatePreviewEmpty(text) {
    var isEmpty = !text || !text.trim();
    if (els.previewEmpty) els.previewEmpty.hidden = !isEmpty;
    if (els.preview) els.preview.hidden = isEmpty;
  }

  /** 顶栏标题、未保存小圆点、浏览器标签页标题 */
  function renderDocTitle() {
    var s = MM.store.get();
    var title = s.title || MM.i18n.t('untitled');

    // 首启示例文档的标题和顶栏品牌名重复（左边已经写着 MixMark 了），
    // 这时整个标题位收起来，别把同一句话摆两遍
    var duplicate = !!MM.docs.isWelcomeTitle(s.title);

    if (els.docTitle) els.docTitle.textContent = duplicate ? '' : title;
    if (els.docTitleWrap) els.docTitleWrap.hidden = duplicate;
    if (els.dirtyDot) els.dirtyDot.classList.toggle('is-dirty', !!s.dirty);

    // 浏览器标签页标题不受影响：那里没有品牌名，标题就是唯一线索
    document.title = title + ' — ' + MM.i18n.t('appName');
  }

  /** 空预览里提示命令面板的快捷键，按平台显示 Ctrl / ⌘ */
  function renderPreviewEmptyHint() {
    if (!els.previewEmptyHint) return;
    els.previewEmptyHint.textContent = MM.i18n.t('previewEmptyHint', {
      key: MM.commands.formatKey('Mod+Shift+P')
    });
  }

  /* ------------------------------------------------------------------
     品牌名启动动画
     ------------------------------------------------------------------ */

  var BRAND_HOLD_MS = 3000;

  /**
   * 刚打开时品牌位显示「欢迎使用 MixMark」，停留 3 秒后收紧为「MixMark」，
   * 同时把文档名淡入。
   *
   * 「MixMark 往左移」不是用 transform 假装位移，而是真把前缀的宽度收到 0：
   * 「MixMark」本来就紧跟在「欢迎使用」右边，前缀一收窄，它自己就落到
   * 最终位置。这样缓动结束时它和「本该在的位置」精确重合，不会差几个像素。
   *
   * 另外，开场这 3 秒里文档名是先藏起来的 —— 否则同一行会同时出现
   * 两处「欢迎使用 MixMark」（品牌位一处、欢迎文档的标题一处）。
   */
  function settleBrand() {
    if (!els.brand || !els.brandWelcome) return;

    var width = els.brandWelcome.getBoundingClientRect().width;

    // 起始宽度要写成内联样式，因为「起始值」是量出来的、CSS 里写不出来。
    // 但内联样式优先级高过 .brand.is-settled 里的声明，所以「收到 0」
    // 这一步也得由 JS 写内联样式 —— 两边都走内联，过渡才能从量到的
    // 真实宽度平滑收到 0。
    els.brandWelcome.style.width = width + 'px';

    // 读一次布局属性，逼浏览器把「起始宽度」记下来。
    // 否则在同一个任务里连续改两次宽度会被合并成一次样式更新，
    // 过渡根本不会触发，文字直接跳过去
    void els.brandWelcome.offsetWidth;

    els.brandWelcome.style.width = '0px';
    els.brand.classList.add('is-settled');

    // 前缀收起后宽度为 0 但还在 DOM 里，不该被读屏念出来
    els.brandWelcome.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('is-intro');
  }

  function initBrandIntro() {
    if (!els.brand) return;

    // 尊重系统的「减少动态效果」：直接落到终态，不陪着等 3 秒
    var reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      settleBrand();
      return;
    }

    document.documentElement.classList.add('is-intro');
    setTimeout(settleBrand, BRAND_HOLD_MS);
  }

  /* ------------------------------------------------------------------
     磁盘直连标记
     ------------------------------------------------------------------ */

  /** 磁盘直连标记：当前文档绑着磁盘上的真实文件时才出现。
      「在应用内关闭」按钮不在顶栏 —— 它在侧栏文档行上（见 sidebar.js）。 */
  function renderDiskBadge() {
    if (!els.diskBadge) return;

    var id = MM.store.get().docId;
    var bound = !!(MM.disk && MM.disk.isBound(id));

    els.diskBadge.hidden = !bound;
    els.diskBadge.title = bound
      ? MM.i18n.t('diskBoundHint', { path: MM.disk.labelOf(id) })
      : '';
  }

  /* ------------------------------------------------------------------
     命令
     ------------------------------------------------------------------ */

  /** 主题循环顺序取自设置的唯一来源（由浅到深），新增主题不用改这里 */
  function themeCycle() {
    return MM.settings.THEMES || ['light', 'dark'];
  }

  function registerCommands() {
    MM.commands.registerAll([
      {
        id: 'view.edit',
        titleKey: 'cmdViewEdit',
        group: 'view',
        run: function () {
          setMode('edit');
        }
      },
      {
        id: 'view.split',
        titleKey: 'cmdViewSplit',
        group: 'view',
        run: function () {
          setMode('split');
        }
      },
      {
        id: 'view.preview',
        titleKey: 'cmdViewPreview',
        group: 'view',
        run: function () {
          setMode('preview');
        }
      },
      {
        id: 'view.cycle',
        titleKey: 'cmdCycleView',
        group: 'view',
        key: 'Mod+Alt+V',
        run: function () {
          var order = ['edit', 'split', 'preview'];
          var i = order.indexOf(MM.store.get().mode);
          setMode(order[(i + 1) % order.length]);
        }
      },
      {
        id: 'view.liveEdit',
        titleKey: 'cmdLiveEdit',
        group: 'view',
        /**
         * 反向修改要让预览区看得见才有意义，所以编辑模式下先切到分栏。
         * 不必额外禁用它 —— 命令面板里搜到一个点了没反应的项更让人迷惑。
         */
        run: function () {
          MM.liveEdit.toggle();
          if (MM.liveEdit.isOn() && MM.store.get().mode === 'edit') setMode('split');
        }
      },
      {
        id: 'view.sidebar',
        titleKey: 'cmdToggleSidebar',
        group: 'view',
        key: 'Mod+\\',
        run: function () {
          MM.sidebar.toggle();
        }
      },
      {
        id: 'app.palette',
        titleKey: 'cmdPalette',
        group: 'app',
        key: 'Mod+Shift+P',
        run: function () {
          MM.palette.open();
        }
      },
      {
        id: 'app.settings',
        titleKey: 'cmdSettings',
        group: 'app',
        key: 'Mod+Alt+,',
        run: function () {
          MM.settingsPage.open();
        }
      },
      {
        id: 'app.theme',
        titleKey: 'cmdThemeToggle',
        group: 'app',
        key: 'Mod+Alt+T',
        run: function () {
          var list = themeCycle();
          var cur = MM.settings.get('theme');
          var i = list.indexOf(cur);
          MM.settings.set({ theme: list[(i + 1) % list.length] });
        }
      },
      {
        id: 'app.focusEditor',
        titleKey: 'cmdFocusEditor',
        group: 'app',
        run: function () {
          MM.editor.focus();
        }
      }
    ]);
  }

  function setMode(mode) {
    if (['edit', 'split', 'preview'].indexOf(mode) === -1) return;
    MM.settings.set({ mode: mode });
    MM.store.set({ mode: mode });
    // 切回分栏/预览后布局变了，几何位置需要重测
    requestAnimationFrame(function () {
      MM.scrollSync.remeasure();
    });
  }

  /* ------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------ */

  function init() {
    if (initialized) return;
    initialized = true;

    els.viewSwitch = document.getElementById('view-switch');
    els.workspace = document.getElementById('workspace');
    els.preview = document.getElementById('preview');
    els.previewEmpty = document.getElementById('preview-empty');
    els.previewEmptyHint = document.getElementById('preview-empty-hint');
    els.previewScroll = document.getElementById('preview-scroll');
    els.docTitle = document.getElementById('doc-title');
    els.docTitleWrap = document.querySelector('.doc-title');
    els.dirtyDot = document.getElementById('dirty-dot');
    els.brand = document.getElementById('brand');
    els.brandWelcome = document.getElementById('brand-welcome');
    els.diskBadge = document.getElementById('disk-badge');

    registerCommands();
    buildToolbar();
    initSplitter();
    initSidebarSplitter();
    initBrandIntro();

    // 反向修改（实验性）：把预览容器交给它，模式默认是关的
    MM.liveEdit.init(els.preview);

    /* ---- 反向修改开关 ---- */
    els.liveEditBtn = document.getElementById('btn-live-edit');
    if (els.liveEditBtn) {
      els.liveEditBtn.addEventListener('click', function () {
        MM.commands.run('view.liveEdit');
      });
    }
    MM.bus.on('liveedit:changed', function (p) {
      if (!els.liveEditBtn) return;
      els.liveEditBtn.classList.toggle('is-active', !!p.on);
      els.liveEditBtn.setAttribute('aria-pressed', p.on ? 'true' : 'false');
    });

    /* ---- 顶栏视图切换 ---- */
    if (els.viewSwitch) {
      els.viewSwitch.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-mode]');
        if (btn) setMode(btn.getAttribute('data-mode'));
      });
    }

    /* ---- 顶栏按钮 ---- */
    var paletteBtn = document.getElementById('btn-palette');
    if (paletteBtn) {
      paletteBtn.addEventListener('click', function () {
        MM.commands.run('app.palette');
      });
    }

    var settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        MM.commands.run('app.settings');
      });
    }

    /* ---- 全局快捷键：唯一派发入口 ---- */
    document.addEventListener(
      'keydown',
      function (e) {
        // 交给命令注册表匹配；命中即 preventDefault，
        // 因此 CodeMirror 内部不会再用同一组合键执行一次
        MM.commands.handleKeydown(e);
      },
      true
    );

    /* ---- 编辑器 → 预览 ---- */
    MM.editor.onChange(function (text) {
      MM.preview.schedule(text);
      updatePreviewEmpty(text);
    });

    MM.bus.on('preview:rendered', function () {
      // 预览 DOM 整个换掉了，旧的行号索引引用全部失效，必须重建
      MM.scrollSync.refresh();
    });

    MM.bus.on('doc:opened', function (payload) {
      MM.editor.setContent(payload.content);
      // 换文档必须重建：force 无视反向修改的挂起标记 ——
      // 留着上一份文档的 DOM 就不是“挂起”，是错的
      MM.preview.renderNow(payload.content, true);
      updatePreviewEmpty(payload.content);
      MM.scrollSync.refresh();

      // 分栏比例是全局的，切文档不用重新应用；
      // 但布局刚变，几何要重测，否则行号索引里的 offsetTop 全是旧的
      MM.scrollSync.afterLayout(function () {
        MM.scrollSync.remeasure();
      });
    });

    /* ---- 状态同步到 DOM ---- */
    MM.store.watch(['title', 'dirty'], renderDocTitle);
    MM.store.watch('docId', renderDiskBadge);
    MM.store.watch('mode', function (s) {
      applyMode(s.mode);
      // 切模式会让预览容器整个 display:none 再回来，几何全变；
      // 等这一帧结束再量，否则量到的还是隐藏前的旧值
      MM.scrollSync.afterLayout(function () {
        MM.scrollSync.remeasure();
      });
    });
    MM.store.watch('sidebarOpen', function (s) {
      applySidebar(s.sidebarOpen);
    });

    renderDocTitle();
    renderPreviewEmptyHint();
    renderDiskBadge();

    // 绑定 / 解绑磁盘文件后要重画标记
    MM.bus.on('disk:changed', renderDiskBadge);

    MM.settings.onChange(function (s, changed) {
      if (changed.indexOf('syncScroll') !== -1) MM.scrollSync.setEnabled(s.syncScroll);

      // 凡是会改变预览排版的设置，改完都得重测几何：
      // 主题（字体度量）、语言（文案长度→换行点）、字号、正文栏宽、软换行
      var affectsPreview = ['theme', 'locale', 'fontSize', 'measure', 'breaks'].some(function (k) {
        return changed.indexOf(k) !== -1;
      });

      if (affectsPreview) {
        MM.scrollSync.afterLayout(function () {
          MM.scrollSync.remeasure();
        });
      }

      if (changed.indexOf('locale') !== -1) {
        // 换语言后所有由 JS 生成文案的地方都要重来一遍：
        // 工具栏按钮的 tooltip、菜单栏、查找条、标题栏、空预览提示、侧栏列表
        var toolbar = document.getElementById('editor-toolbar');
        if (toolbar) toolbar.innerHTML = '';
        buildToolbar();
        MM.menubar.rebuild();
        MM.findBar.refreshLabels();
        MM.tabs.render();
        if (MM.symbolPanel) MM.symbolPanel.relabel();
        renderDocTitle();
        renderPreviewEmptyHint();
        renderDiskBadge();
        MM.sidebar.renderDocs();
        MM.outline.render(MM.store.get().outline);
      }
    });

    /* ---- 存储告警 ---- */
    MM.bus.on('storage:full', function () {
      MM.toast.danger(MM.i18n.t('toastStorageFull'));
    });
    MM.bus.on('storage:near-full', function () {
      MM.toast.show(MM.i18n.t('toastStorageFull'));
    });
  }

  /** 在文档打开、DOM 就绪之后调用：建立滚动同步的连线 */
  function attachScrollSync() {
    var view = MM.editor.raw();
    if (!view || !els.previewScroll || !els.preview) return;

    MM.scrollSync.attach({
      editorScroller: view.scrollDOM,
      previewScroller: els.previewScroll,
      previewContainer: els.preview
    });
    MM.scrollSync.setEnabled(MM.settings.get('syncScroll'));
  }

  /** 应用初始设置到界面 */
  function applyInitialState() {
    var s = MM.settings.get();
    applyMode(s.mode);
    applySidebar(s.sidebarOpen);
    // 分栏比例全局一份，任何文档打开都是同一个宽度
    applySplit(currentSplit());
    applySidebarWidth(s.sidebarW);
    MM.store.set({ mode: s.mode, sidebarOpen: s.sidebarOpen, split: s.split });
  }

  MM.shell = {
    init: init,
    attachScrollSync: attachScrollSync,
    applyInitialState: applyInitialState,
    setMode: setMode,
    updatePreviewEmpty: updatePreviewEmpty
  };
})();
