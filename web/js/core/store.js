/**
 * MixMark · 状态层
 * ===============================================================
 * 极简发布订阅。刻意不引任何状态库 —— 本应用的状态规模不需要。
 *
 *   MM.store  应用状态（可序列化的数据），变更后通知订阅者
 *   MM.bus    一次性事件（如「聚焦编辑器」），不进入状态
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /* ------------------------------------------------------------------
     状态
     ------------------------------------------------------------------ */

  var initialState = {
    /** 文档索引：[{ id, title, ctime, mtime, size, folderId }] */
    docs: [],
    /** 文件夹索引：[{ id, name, parentId, ctime, mtime }] */
    folders: [],
    /** 新建文档 / 文件夹的落点（null = 根目录） */
    activeFolderId: null,
    /** 当前打开的文档 id */
    docId: null,
    /** 当前文档标题 */
    title: '',
    /** 有未落盘的修改 */
    dirty: false,
    /** 正在写盘 */
    saving: false,
    /** 上次成功保存的时间戳 */
    lastSaved: 0,

    /** 视图模式：edit | split | preview */
    mode: 'split',
    /** 侧栏是否展开 */
    sidebarOpen: true,
    /** 侧栏当前面板：docs | outline */
    sidebarTab: 'docs',
    /** 分栏比例（0.2 ~ 0.8） */
    split: 0.5,

    /** 当前文档的标题大纲：[{ level, text, line }] */
    outline: [],
    /** 光标所在行号 */
    cursorLine: 1,
    /** 统计信息 */
    stats: { words: 0, chars: 0, lines: 1 },

    /** 存储层标识：local | idb | fsa | electron | capacitor */
    tier: 'local',
    /** 就绪状态 */
    ready: false
  };

  var state = Object.assign({}, initialState);
  var subscribers = new Set();

  function get() {
    return state;
  }

  /**
   * 浅合并更新。只有真正发生变化时才通知订阅者，
   * 避免编辑器每次敲键都触发全量重渲染。
   */
  function set(patch) {
    var changedKeys = [];
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      if (!Object.is(state[k], patch[k])) changedKeys.push(k);
    }
    if (changedKeys.length === 0) return;

    var prev = state;
    var next = Object.assign({}, state);
    for (var i = 0; i < changedKeys.length; i++) {
      next[changedKeys[i]] = patch[changedKeys[i]];
    }
    state = next;

    subscribers.forEach(function (fn) {
      try {
        fn(state, prev, changedKeys);
      } catch (err) {
        console.error('[store] 订阅者执行出错：', err);
      }
    });
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return function unsubscribe() {
      subscribers.delete(fn);
    };
  }

  /** 订阅指定字段，只在它变化时回调 —— 比手写比较清爽 */
  function watch(keys, fn) {
    var list = Array.isArray(keys) ? keys : [keys];
    return subscribe(function (next, prev, changed) {
      for (var i = 0; i < list.length; i++) {
        if (changed.indexOf(list[i]) !== -1) {
          fn(next, prev);
          return;
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     事件总线：用于「做一件事」而非「记录一个状态」
     ------------------------------------------------------------------ */

  var handlers = Object.create(null);

  function on(evt, fn) {
    (handlers[evt] || (handlers[evt] = [])).push(fn);
    return function off() {
      var list = handlers[evt];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    };
  }

  function emit(evt, payload) {
    var list = handlers[evt];
    if (!list) return;
    // 复制一份，允许回调内部反注册
    list.slice().forEach(function (fn) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[bus] 事件处理出错：' + evt, err);
      }
    });
  }

  MM.store = {
    get: get,
    set: set,
    subscribe: subscribe,
    watch: watch
  };

  MM.bus = {
    on: on,
    emit: emit
  };
})();
