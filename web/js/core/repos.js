/**
 * MixMark · 仓库注册表
 * ===============================================================
 * 一个「仓库」= 一份文档数据 + 一套属于它自己的工作台状态。
 *
 *   本地仓库   kind='electron'           一个真实文件夹（桌面端）
 *   本地仓库   kind='fsa'                一个真实文件夹（浏览器 http 下）
 *   本机文档库 kind='local' / 'idb'      浏览器存储里的文档库（固定一个）
 *
 * 为什么要有这一层：以前「文档库」只是 provider 的一次性选择 ——
 * 换一个文件夹就把上一个忘了，想切回去只能重新选一遍。现在每个仓库
 * 都被记住（名字 + 地址），首页列出卡片，随时切回去。
 *
 * 谁跟着仓库走、谁全局共用（用户定的）：
 *   跟着仓库：上次打开的文档、展开的文件夹、打开的标签页、当前选中的文件夹
 *   全局共用：主题 / 强调色 / 字体 / 字号 / 阅读栏宽 / API Key 与模型
 *
 * 理由：前者是「我在这堆资料里干到哪儿了」，换一堆资料就该从头看；
 * 后者是「我怎么看东西」，人在哪儿都一样。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var KEY = 'mixmark:repos:v1';
  var WB_PREFIX = 'mixmark:workbench:';

  /** 本机文档库的固定 id：它永远只有一个，也不允许删掉 */
  var LOCAL_ID = 'local';

  var state = { active: null, items: [] };

  /* ------------------------------------------------------------------
     读写
     ------------------------------------------------------------------ */

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch (err) {
      console.warn('[repos] 仓库列表损坏，已重置', err);
      return null;
    }
  }

  function write() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[repos] 仓库列表写入失败', err);
    }
  }

  function newId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /**
   * 「本机文档库」用哪个后端，取决于运行环境：
   * http(s) 下有 IndexedDB 就用它，file:// 下只剩 localStorage。
   */
  function localKind() {
    var env =
      MM.provider && MM.provider.detectEnvironment ? MM.provider.detectEnvironment() : 'unknown';
    return env === 'http' ? 'idb' : 'local';
  }

  function find(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  /**
   * 列表变了（新增 / 改名 / 移除 / 当前项换人）。
   * 统一在这里发，别指望调用方记得发 —— 漏一次就是「新建了仓库但界面上没出现」。
   */
  function notify() {
    if (MM.bus && MM.bus.emit) MM.bus.emit('repo:list');
  }

  /** 本机文档库永远在列表里 */
  function ensure() {
    if (!find(LOCAL_ID)) {
      state.items.unshift({
        id: LOCAL_ID,
        kind: localKind(),
        label: null, // null = 用系统默认名（跟随语言，也便于以后改文案）
        path: null,
        system: true,
        addedAt: Date.now(),
        lastOpenedAt: 0
      });
    }
    if (!state.active || !find(state.active)) {
      state.active = LOCAL_ID;
    }
  }

  function init() {
    state = read() || { active: null, items: [] };
    ensure();
    write();
    // 列表就绪也算一次变化：界面模块比这一层先初始化完，
    // 它们当时画的是空列表，得有人叫它们重画一次
    notify();
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------
     展示用的字段
     ------------------------------------------------------------------ */

  /** 从路径里取最后一段当默认名字（`D:\我的笔记` → `我的笔记`） */
  function basename(p) {
    var s = String(p == null ? '' : p).replace(/[\\/]+$/, '');
    if (!s) return '';
    var parts = s.split(/[\\/]/);
    return parts[parts.length - 1] || s;
  }

  function labelOf(repo) {
    if (!repo) return '';
    if (repo.label) return repo.label;
    if (repo.system) return MM.i18n.t('repoLocalName');
    return basename(repo.path) || MM.i18n.t('repoUntitled');
  }

  /**
   * 卡片上那行小字：本地仓库显示真实地址（用户就是靠它区分两个同名文件夹的），
   * 本机文档库没有地址可言，就说明白数据存在哪儿。
   */
  function pathOf(repo) {
    if (!repo) return '';
    if (repo.path) return repo.path;
    return MM.i18n.t('repoStoreBrowser');
  }

  /* ------------------------------------------------------------------
     列表操作
     ------------------------------------------------------------------ */

  /** 本机文档库排第一（它是默认仓库），其余按最近打开倒序 */
  function list() {
    var rest = state.items
      .filter(function (r) {
        return r.id !== LOCAL_ID;
      })
      .sort(function (a, b) {
        return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
      });

    var head = state.items.filter(function (r) {
      return r.id === LOCAL_ID;
    });

    return head.concat(rest).map(function (r) {
      return {
        id: r.id,
        kind: r.kind,
        system: !!r.system,
        path: r.path || '',
        label: labelOf(r),
        // 名字是不是用户自己起的（没起过就允许卡片直接改）
        named: !!r.label,
        store: pathOf(r),
        active: r.id === state.active
      };
    });
  }

  function raw(id) {
    return find(id || state.active);
  }

  function current() {
    return raw(state.active);
  }

  function currentId() {
    return state.active;
  }

  function isLocal(repo) {
    return !repo || !repo.path;
  }

  /** 同一个文件夹不该在列表里出现两次（拼写/大小写不同也算同一个） */
  function findByPath(p) {
    var key = String(p || '').replace(/[\\/]+$/, '').toLowerCase();
    for (var i = 0; i < state.items.length; i++) {
      var r = state.items[i];
      if (!r.path) continue;
      if (r.path.replace(/[\\/]+$/, '').toLowerCase() === key) return r;
    }
    return null;
  }

  function add(opts) {
    opts = opts || {};
    var repo = {
      id: opts.id || newId(),
      kind: opts.kind || localKind(),
      label: opts.label || null,
      path: opts.path || null,
      system: false,
      addedAt: Date.now(),
      lastOpenedAt: 0
    };
    state.items.push(repo);
    write();
    notify();
    return repo;
  }

  /** 改名 / 改地址（改地址只用于「文件夹被挪走了，重新指一个」） */
  function patch(id, fields) {
    var repo = find(id);
    if (!repo) return null;
    Object.assign(repo, fields || {});
    write();
    notify();
    return repo;
  }

  function remove(id) {
    if (id === LOCAL_ID) return false; // 本机文档库不允许删
    var before = state.items.length;
    state.items = state.items.filter(function (r) {
      return r.id !== id;
    });
    if (state.items.length === before) return false;

    // 光删注册项，**不动磁盘上的任何文件** —— 这是「从列表移除」，不是删除数据
    try {
      window.localStorage.removeItem(WB_PREFIX + id);
    } catch (err) {
      /* 忽略 */
    }
    if (state.active === id) state.active = LOCAL_ID;
    write();
    notify();
    return true;
  }

  function setCurrent(id) {
    if (!find(id)) return false;
    state.active = id;
    var repo = find(id);
    if (repo) repo.lastOpenedAt = Date.now();
    write();
    notify();
    return true;
  }

  /* ------------------------------------------------------------------
     工作台状态：跟着仓库走的那几项
     ------------------------------------------------------------------ */

  function workbench(id) {
    try {
      var rawJson = window.localStorage.getItem(WB_PREFIX + (id || state.active));
      var parsed = rawJson ? JSON.parse(rawJson) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function patchWorkbench(id, fields) {
    var next = Object.assign(workbench(id), fields || {});
    try {
      window.localStorage.setItem(WB_PREFIX + (id || state.active), JSON.stringify(next));
    } catch (err) {
      console.warn('[repos] 工作台状态写入失败', err);
    }
    return next;
  }

  MM.repos = {
    LOCAL_ID: LOCAL_ID,
    init: init,
    list: list,
    raw: raw,
    current: current,
    currentId: currentId,
    labelOf: labelOf,
    pathOf: pathOf,
    isLocal: isLocal,
    findByPath: findByPath,
    add: add,
    patch: patch,
    remove: remove,
    setCurrent: setCurrent,
    workbench: workbench,
    patchWorkbench: patchWorkbench
  };
})();
