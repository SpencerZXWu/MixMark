/**
 * MixMark · 设置
 * ===============================================================
 * 持久化在 localStorage，与应用文档库同一存储介质（Tier A 环境）。
 * 改动后立即生效：写 CSS 变量 + <html> 上的 data-* 属性。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var KEY = 'mixmark:settings:v1';

  var DEFAULTS = {
    locale: null, // null = 首次启动时按浏览器语言猜
    theme: 'light', // 见下面的 THEMES
    accent: 'ink', // 见下面的 ACCENTS
    /** 界面字体档位，见 FONT_STACKS */
    uiFont: 'classic',
    /** 正文（编辑器 + 预览）字体档位，与界面字体分开 ——
        界面小字要求易认，正文要求耐读，未必是同一个好选项 */
    textFont: 'classic',
    fontSize: 15, // 编辑器字号 px
    measure: 74, // 正文栏宽 ch
    autoSave: true,
    autoSaveDelay: 1500, // ms
    syncScroll: true,
    lineNumbers: true,
    /** 单个换行符即视为换行（符合笔记类用户直觉，而非 CommonMark 的合并段落） */
    breaks: true,
    sidebarOpen: true,
    mode: 'split',
    /**
     * 分栏比例，0.2 ~ 0.8。全局共用一份，**不按文档区分** ——
     * 每篇各记一套会让「打开不同文档宽度乱跳」，试过，已退回。
     *
     * 注意：settings.set 会丢弃没在这里声明的键（见下面的 set），
     * 新增设置项务必先在这里登记，否则是静默失效。
     */
    split: 0.5,
    /** 侧栏宽度（px）。初值需与 tokens.css 的 --mm-sidebar-w 保持一致 */
    sidebarW: 264,
    /** 已展开的文件夹 id 列表（视图状态，不属于文档数据） */
    expandedFolders: [],
    /** 是否已经看过首页。只有第一次启动停在那儿，之后直接进文档库 */
    homeSeen: false,
    /** DeepSeek API Key。只存在这台设备的浏览器存储里 */
    aiKey: '',
    aiModel: 'deepseek-chat',
    /** AI 面板是否展开（视图偏好，跟文档无关） */
    aiOpen: true,
    /**
     * AI 面板高度（px）。0 = 没拖过，用 CSS 里的默认比例。
     * 存像素而不是比例：用户拖的是「想要多高」，不是「占几成」。
     */
    aiHeight: 0
  };

  var state = Object.assign({}, DEFAULTS);
  var listeners = [];

  /* ------------------------------------------------------------------
     可选清单
     ------------------------------------------------------------------
     这里是「有哪些主题 / 强调色 / 字体」的唯一来源，设置页与主题
     循环命令都从这里取。真值（色值、字族）不在 JS 里，在
     css/theme.css 与 FONT_STACKS 下面 —— 这里只列 id 的集合与顺序。
     ------------------------------------------------------------------ */

  /** 底色主题。顺序即「循环主题」命令的遍历顺序：由浅到深 */
  var THEMES = ['light', 'sepia', 'mist', 'dark', 'night', 'navy'];

  /** 深底主题。theme.css 里用同一组选择器切到强调色的 lift 档 */
  var DARK_THEMES = ['dark', 'night', 'navy'];

  /**
   * 强调色。color 仅供设置页画色板（用浅底那一档），
   * 真值在 theme.css 的 [data-accent] 块里。
   * 顺序即色板顺序，末尾新增不影响已有取值。
   */
  var ACCENTS = [
    { id: 'ink', color: '#2f5fd0' },
    { id: 'emerald', color: '#1f7a55' },
    { id: 'ocean', color: '#0e7490' },
    { id: 'wine', color: '#8a3a46' },
    { id: 'ginger', color: '#8a5f16' },
    { id: 'violet', color: '#6b3fc0' },
    { id: 'graphite', color: '#4a5260' },
    { id: 'rose', color: '#b5305f' }
  ];

  /**
   * 字体档位。同一档位下「界面」与「正文」各用一套字族：
   * 两者诉求不同，不能简单共用一份。
   *
   *   界面：字小（13px）又要求一眼认出，所以中英文都只用最清晰的那些，
   *         不把宋体 / 楷体放进来 —— 它们的笔画在 13px 下发虚，试过，退了。
   *   正文：15~18px 且要读很久，可以使用更有「书卷气」的字族。
   *
   * 一律不引外部字体文件：双击打开也能离线用（file:// 下的硬约束）。
   */
  var FONT_STACKS = {
    /* 复古衬线：英文 Georgia（小字号不发虚、有印刷味）+ 中文雅黑 */
    classic: {
      ui: 'Georgia, "Book Antiqua", Palatino, "Times New Roman", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", system-ui, sans-serif',
      text: 'Georgia, "Songti SC", "SimSun", "Times New Roman", "Microsoft YaHei", serif'
    },
    /* 现代无衬线：直接用系统 UI 字体，最中性 */
    modern: {
      ui: '"Segoe UI", -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, "Helvetica Neue", Arial, sans-serif',
      text: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, "Helvetica Neue", Arial, sans-serif'
    },
    /* 打字机等宽：写技术笔记时中英混排不会“参差不齐” */
    typewriter: {
      ui: '"Cascadia Code", "JetBrains Mono", Consolas, "SF Mono", "Microsoft YaHei", "Microsoft YaHei Mono", monospace',
      text: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", "Microsoft YaHei", "Microsoft YaHei Mono", monospace'
    },
    /* 典雅：英文用 Palatino（比 Georgia 更瘦、更书卷）
       + 中文正体用楷体，最接近“手写阅读”的感觉。
       注意界面中文仍走雅黑 —— 楷体在 13px 下太细。 */
    elegant: {
      ui: 'Palatino, "Book Antiqua", "Palatino Linotype", Georgia, "Microsoft YaHei", "PingFang SC", sans-serif',
      text: 'Palatino, "Book Antiqua", "Palatino Linotype", Georgia, "KaiTi", "STKaiti", "Kaiti SC", "Songti SC", serif'
    }
  };

  var FONTS = ['classic', 'modern', 'typewriter', 'elegant'];

  function fontStack(id, role) {
    var f = FONT_STACKS[id] || FONT_STACKS.classic;
    return role === 'ui' ? f.ui : f.text;
  }

  /* ------------------------------------------------------------------
     持久化
     ------------------------------------------------------------------ */

  function load() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (err) {
      console.warn('[settings] 无法读取 localStorage，使用默认设置', err);
    }

    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        // 逐项合并：只接受已知的 key，避免历史脏数据污染
        Object.keys(DEFAULTS).forEach(function (k) {
          if (parsed[k] !== undefined) state[k] = parsed[k];
        });

        // 一次性迁移：0.5.5 一度按文档记分栏，拖动时会把全局 split 顺手覆盖成
        // 「最后一次拖的宽度」。那份残留会让之后每篇文档都开出同一个怪比例
        // （表现为「一打开预览就占大半」）。清掉并归位五五开。
        if (parsed.docSplits !== undefined) {
          state.split = DEFAULTS.split;
          persist();
        }
      } catch (err) {
        console.warn('[settings] 设置解析失败，回退默认值', err);
      }
    }

    if (!state.locale) state.locale = MM.i18n.detect();
    return state;
  }

  var saveTimer = null;

  /** 真正的落盘，幂等 */
  function writeNow() {
    saveTimer = null;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[settings] 设置保存失败', err);
    }
  }

  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    // 合并短时间内的多次改动（拖字号滑块时会高频触发）
    saveTimer = setTimeout(writeNow, 300);
  }

  /**
   * 把防抖队列里的待写内容立刻落盘。
   * 退出前必须调一次 —— 防抖窗口是 300ms，而「换个主题然后马上关掉标签页」
   * 完全可能落在这个窗口里，那次改动会凭空消失（本地实测到过）。
   */
  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      writeNow();
    }
  }

  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  /* ------------------------------------------------------------------
     应用到界面
     ------------------------------------------------------------------ */

  function apply() {
    var root = document.documentElement;

    root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-accent', state.accent);
    // 明暗基调单独给一个属性，供导出件（css/theme.css 不在它里面）判断用哪套代码高亮
    root.setAttribute('data-scheme', DARK_THEMES.indexOf(state.theme) !== -1 ? 'dark' : 'light');

    var css = root.style;
    css.setProperty('--mm-font-ui', fontStack(state.uiFont, 'ui'));
    css.setProperty('--mm-font-text', fontStack(state.textFont, 'text'));
    css.setProperty('--mm-fs-editor', state.fontSize + 'px');
    css.setProperty('--mm-measure', state.measure + 'ch');
    // 预览字号跟随编辑器字号微调，保持两侧视觉重量一致
    css.setProperty('--mm-fs-preview', Math.round(state.fontSize * 1.07) + 'px');

    document.body.classList.toggle('no-line-numbers', !state.lineNumbers);

    MM.i18n.setLocale(state.locale);
  }

  /* ------------------------------------------------------------------
     对外接口
     ------------------------------------------------------------------ */

  function get(key) {
    return key === undefined ? state : state[key];
  }

  function set(patch, opts) {
    var changed = [];
    Object.keys(patch).forEach(function (k) {
      if (!(k in DEFAULTS)) return;
      if (Object.is(state[k], patch[k])) return;
      state[k] = patch[k];
      changed.push(k);
    });
    if (!changed.length) return changed;

    apply();
    if (!opts || opts.persist !== false) persist();

    listeners.forEach(function (fn) {
      try {
        fn(state, changed);
      } catch (err) {
        console.error('[settings] 监听器出错', err);
      }
    });

    return changed;
  }

  function reset() {
    return set(Object.assign({}, DEFAULTS, { locale: state.locale }));
  }

  function onChange(fn) {
    listeners.push(fn);
    return function off() {
      var i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  MM.settings = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    THEMES: THEMES,
    DARK_THEMES: DARK_THEMES,
    ACCENTS: ACCENTS,
    FONTS: FONTS,
    load: load,
    get: get,
    set: set,
    reset: reset,
    apply: apply,
    flush: flush,
    onChange: onChange
  };
})();
