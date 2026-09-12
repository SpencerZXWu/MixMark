/**
 * MixMark · 同步滚动
 * ===============================================================
 * 双向同步：滚编辑器，预览跟着走；滚预览，编辑器跟着走。
 *
 * 最大的坑是「回声」：A 触发 B，B 的滚动事件又反过来触发 A，两边互相
 * 推着越滚越远。这里用「方向锁 + 时间窗」解决：
 *   谁主动发起滚动，就在接下来的一小段时间里独占控制权，
 *   期间对方的滚动事件一律忽略。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 锁的持有者：null | 'editor' | 'preview' */
  var lockOwner = null;
  var lockUntil = 0;
  var LOCK_MS = 140;

  var blocks = [];
  var editorScroller = null;
  var previewScroller = null;
  var previewContainer = null;
  var enabled = true;

  /** 当前索引是否来自一次「量得到」的测量。隐藏状态下量出来的全是 0 */
  var measured = false;
  /** 上一次做过「索引是否过期」校验的时间 */
  var lastCheck = 0;
  /**
   * 自校准基准：滚动内容总高 与「最后一个块底边」之间的固定差值。
   * 这个差值在布局不变时是常数，拿它比对就能发现内容高度变了
   * —— 不需要对 CSS 的 padding 做任何假设。
   */
  var baseline = null;

  /* ------------------------------------------------------------------
     锁
     ------------------------------------------------------------------ */

  function acquire(owner) {
    lockOwner = owner;
    lockUntil = Date.now() + LOCK_MS;
  }

  function isLockedFor(owner) {
    return lockOwner !== null && lockOwner !== owner && Date.now() < lockUntil;
  }

  /* ------------------------------------------------------------------
     索引维护
     ------------------------------------------------------------------ */

  /**
   * 预览区此刻量得到吗？
   *
   * display:none 时 offsetTop 恒为 0，这时候测量不是「不准」而是
   * 「把好索引写成坏索引」—— 切到编辑模式或进首页都会走到这一步，
   * 于是回到分栏后同步就失效了。宁可什么都不做。
   */
  function measurable() {
    return !!(previewScroller && previewContainer && previewScroller.offsetParent !== null);
  }

  /**
   * 等这一帧的布局尘埃落定后再执行。
   *
   * 为什么不直接用裸 requestAnimationFrame：它只在页面**合成帧**时才推进。
   * 后台标签页、最小化的窗口、不合成帧的内嵌视图（VS Code 内置浏览器实测
   * rAF 一次都不跑）里，rAF 回调可能永远不来 —— 该做的事就永远没做。
   * 所以补一个 setTimeout 兜底，两条路谁先到谁执行，另一个自动让路。
   */
  function afterLayout(fn) {
    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      fn();
    };

    requestAnimationFrame(run);
    setTimeout(run, 80);
  }

  /** 唯一会写 blocks 的地方：重建索引并测量，量不到就什么都不动 */
  function measureNow() {
    if (!measurable()) {
      measured = false;
      return false;
    }

    blocks = MM.lineMap.buildAndMeasure(previewContainer);

    var last = blocks[blocks.length - 1];
    baseline = last ? previewScroller.scrollHeight - (last.top + last.height) : null;
    measured = true;
    lastCheck = Date.now();
    return true;
  }

  /** 预览重渲染后调用：块元素全换了，旧引用全部失效 */
  function refresh() {
    measureNow();
  }

  /** 几何可能变了就调用它（窗口、分栏、字号…）。量不到时静默跳过 */
  function remeasure() {
    measureNow();
  }

  /**
   * 索引还算不算数。
   *
   * 除了「没量过 / 量的时候是隐藏的」，还比对内容高度与上次测量的基准：
   * 图片加载完、公式字体到位、换行点变动，都会让块高度变，
   * 而这个比对只要一次同步读就能发现 —— 放在滚动回调里完全划得来。
   * 这就是「时刻都能同步」的兜底：发现自己不准就先重测，再继续同步。
   */
  function stale() {
    if (!measured || !blocks.length || baseline === null) return true;

    // 校验要读 scrollHeight，会强制一次布局。滚动时每帧都读太贵，
    // 而内容高度变化（图片、字体）也不需要毫秒级发现，隔一会儿查一次就够。
    var now = Date.now();
    if (now - lastCheck < 120) return false;
    lastCheck = now;

    var last = blocks[blocks.length - 1];
    var gap = previewScroller.scrollHeight - (last.top + last.height);
    return Math.abs(gap - baseline) > 2;
  }

  /* ------------------------------------------------------------------
     双向同步
     ------------------------------------------------------------------ */

  function syncFromEditor() {
    if (!enabled || !previewScroller) return;
    if (isLockedFor('editor')) return;

    // 分栏模式下预览区不可见时不做无谓计算
    if (!previewScroller.offsetParent) return;

    // 自己先体检：索引过期或压根没量过，先重测再同步
    if (stale() && !measureNow()) return;
    if (!blocks.length) return;

    var line = MM.editor.topVisibleLine();
    var target = MM.lineMap.offsetForLine(blocks, line);

    acquire('editor');
    previewScroller.scrollTop = target;
  }

  function syncFromPreview() {
    if (!enabled || !previewScroller) return;
    if (isLockedFor('preview')) return;
    if (!previewScroller.offsetParent) return;

    if (stale() && !measureNow()) return;
    if (!blocks.length) return;

    var i = MM.lineMap.findByTop(blocks, previewScroller.scrollTop + 2);
    if (i < 0) return;

    acquire('preview');
    MM.editor.scrollLineToTop(blocks[i].line);
  }

  /* ------------------------------------------------------------------
     装配
     ------------------------------------------------------------------ */

  function attach(opts) {
    editorScroller = opts.editorScroller;
    previewScroller = opts.previewScroller;
    previewContainer = opts.previewContainer;

    var rafPending = false;

    /**
     * 滚动同步直接算，不用 rAF 绕一圈。
     *
     * 原来用 rAF 是想「合并到一帧一次」，代价却是把自己绑在渲染循环上：
     * 后台标签页、最小化窗口、不合成帧的内嵌视图里 rAF 不推进，
     * 同步就彻底哑了 —— 而滚动同步恰恰是「越跟手越好」的那类逻辑，
     * 本身不需要等帧。这里只按时间做去重，滚动再密也只跑 60 次/秒。
     */
    var lastEditorRun = 0;

    function onEditorScroll() {
      var now = Date.now();
      if (now - lastEditorRun < 16) return;
      lastEditorRun = now;
      syncFromEditor();
    }

    var lastPreviewRun = 0;

    function onPreviewScroll() {
      var now = Date.now();
      if (now - lastPreviewRun < 16) return;
      lastPreviewRun = now;
      syncFromPreview();
    }

    editorScroller.addEventListener('scroll', onEditorScroll, { passive: true });
    previewScroller.addEventListener('scroll', onPreviewScroll, { passive: true });

    // 容器尺寸变化 → 重新测量（用 ResizeObserver 比 window.resize 更准，
    // 侧栏折叠、分栏拖动都会改变预览区宽度）
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        remeasure();
      });
      ro.observe(previewContainer);
    }
  }

  function setEnabled(v) {
    enabled = !!v;
  }

  MM.scrollSync = {
    attach: attach,
    refresh: refresh,
    remeasure: remeasure,
    setEnabled: setEnabled,
    afterLayout: afterLayout,
    /** 主动同步一次。程序化滚动（跳行、搜索定位）之后不必等用户的滚动事件 */
    syncFrom: function (owner) {
      if (owner === 'preview') syncFromPreview();
      else syncFromEditor();
    },
    isEnabled: function () {
      return enabled;
    }
  };
})();
