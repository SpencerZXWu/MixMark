/**
 * MixMark · 存储后端：桌面端（Electron）
 * ===============================================================
 * 「桌面版到底多给了什么」的答案就在这个文件：
 * 文档不再躺在浏览器的 localStorage / IndexedDB 里，而是**真的以 .md
 * 落在你自己选的文件夹**，子目录也跟着虚拟文件夹一起建出来。
 *
 * 它与其他后端不同的一点：真正干活的逻辑在主进程（desktop/lib/library-fs.js），
 * 这里只是个薄薄的转发层。这样拆的原因有两个 ——
 *   1. 渲染进程拿不到 Node 的文件 API（也不该拿）
 *   2. 那层纯 Node 的逻辑可以脱离 Electron 单测（desktop/tools/check-fs.js，37 项）
 *
 * 「可用 ≠ 现在能用」这条规矩在这里同样成立：
 * 桌面端一定有这个后端，但**用户没选过文件夹就不算可用** ——
 * 否则选路会挑中一个空空如也的新库，看起来像数据全丢了。
 * 所以 prepare() 先去问主进程「上次连的是哪个目录、还在不在」。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 主进程经 preload 暴露的桥；不在桌面端运行时为 undefined */
  var bridge = null;

  /** 当前连接的文件夹信息；null 表示还没连 */
  var state = null;

  function api() {
    if (!bridge && window.mixmark && window.mixmark.native) bridge = window.mixmark;
    return bridge;
  }

  /** 把主进程抛过来的错误转成 library.js 认的形状 */
  function wrap(promise) {
    return Promise.resolve(promise).catch(function (err) {
      var msg = String((err && err.message) || err);
      // Electron 会把主进程的 Error 包一层前缀，剥掉它，用户不该看到那些内部措辞
      msg = msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
      if (/ENOSPC|no space/i.test(msg)) return Promise.reject({ quota: true, message: 'storage-full' });
      return Promise.reject({ quota: false, message: msg });
    });
  }

  var backend = {
    init: function () {
      return Promise.resolve();
    },

    get: function (key) {
      return wrap(api().library.get(key));
    },

    set: function (key, value) {
      return wrap(api().library.set(key, value)).then(function (res) {
        // 写 doc:* 时主进程会把「这次落在磁盘哪个文件」一并带回来，
        // 记住它，状态栏与 AI 才能如实回答「存在哪」
        if (res && res.path && key.indexOf('doc:') === 0) {
          state = state || {};
          state.files = state.files || {};
          state.files[key.slice(4)] = res.path;
        }
        return undefined;
      });
    },

    remove: function (key) {
      return wrap(api().library.remove(key)).then(function () {
        if (key.indexOf('doc:') === 0 && state && state.files) delete state.files[key.slice(4)];
      });
    },

    keys: function () {
      return wrap(api().library.keys()).then(function (v) {
        return Array.isArray(v) ? v : [];
      });
    },

    /**
     * 磁盘对齐（只有桌面端有这一步）。
     *
     * 索引是权威、.md 是镜像 —— 重命名、换文件夹这些结构变化之后调一次，
     * 让磁盘上的文件名与位置跟上索引。library.js 那边是**可选调用**，
     * 所以其他后端不实现它也没关系。
     */
    sync: function () {
      return wrap(api().library.sync()).then(function (res) {
        // 挪动过的文件，磁盘位置变了，页面记住的那份映射也得刷新
        return wrap(api().library.status()).then(function (st) {
          if (st && st.connected) state = st;
          return res;
        });
      });
    }
  };

  var lib = MM.providers.createLibrary({
    backend: backend,
    kind: 'electron',
    labelKey: 'tierElectron',
    /*
      本地磁盘没有配额这回事，但也不能填 0 —— library.js 里写的是
      `config.quotaBytes || ASSUMED_QUOTA`，0 会被当成「没设」而回落到 5MB，
      于是桌面版一启动就显示「用量已经满了」。给一个足够大的数即可。
    */
    quotaBytes: 64 * 1024 * 1024 * 1024,
    isAvailable: function () {
      return !!(api() && state && state.connected);
    }
  });

  /**
   * 异步准备：问主进程当前连的是哪个目录。
   * 这一步必须与 isAvailable 分开 —— 见文件头的说明。
   */
  lib.prepare = function () {
    var b = api();
    if (!b) return Promise.resolve(false);

    return wrap(b.library.status()).then(function (st) {
      state = st && st.connected ? st : null;
      return !!state;
    });
  };

  /* ------------------------------------------------------------------
     库的管理（连接 / 断开 / 对齐 / 定位）
     ------------------------------------------------------------------ */

  /** 弹系统对话框选一个文件夹当文档库 */
  function pickRoot() {
    var b = api();
    if (!b) return Promise.reject(new Error('unsupported'));

    // 系统弹窗必须在用户手势里发起，这里不做多余的 await
    return wrap(b.library.pick()).then(function (st) {
      if (st && st.canceled) {
        var abort = new Error('canceled');
        abort.name = 'AbortError';
        throw abort;
      }
      state = st;
      return st;
    });
  }

  function forget() {
    var b = api();
    if (!b) return Promise.resolve();
    return wrap(b.library.forget()).then(function () {
      state = null;
    });
  }

  /**
   * 切换到一个**已经知道**的文件夹（配合页面里的仓库列表）。
   * 路径不存在时主进程会抛错，这里原样传上去 —— 「切不过去」必须让用户看见，
   * 悄悄失败会让他以为文档已经在那个文件夹里了。
   */
  function openPath(p) {
    var b = api();
    if (!b) return Promise.reject(new Error('unsupported'));

    return wrap(b.library.openPath(p)).then(function (st) {
      if (!st || !st.connected) throw new Error('connect-failed');
      state = st;
      return st;
    });
  }

  /**
   * 重新读一次主进程的库状态。
   *
   * 收编/扫描之后磁盘上会多出几篇文档 —— 那份「哪篇存在哪个文件」的映射
   * 也变了，不重新读一次，状态栏与 AI 会说「不知道存在哪」。
   */
  function refresh() {
    var b = api();
    if (!b) return Promise.resolve(null);

    return wrap(b.library.status()).then(function (st) {
      if (st && st.connected) state = st;
      return state;
    });
  }

  /**
   * 让磁盘上的 .md 与索引对齐。
   * 结构操作（重命名 / 移动 / 新建文件夹）之后调一次 ——
   * 索引改了而文件没跟着走，两边会慢慢飘开，最后用户看到的是「名字对不上」。
   */
  function sync() {
    var b = api();
    if (!b || !state) return Promise.resolve(null);
    return wrap(b.library.sync());
  }

  function status() {
    if (!state || !state.connected) return { connected: false };
    return {
      connected: true,
      path: state.path,
      name: state.name,
      files: state.files || {}
    };
  }

  /**
   * 某篇文档在磁盘上的绝对路径。
   * 路径只有主进程知道，所以这里用的是上一次通信带回来的快照；
   * 没快照就返回 null —— 调用方按「未知」处理，不要编一个路径出来。
   */
  function pathOf(docId) {
    if (!state || !state.files) return null;
    return state.files[docId] || null;
  }

  function reveal(docId) {
    var b = api();
    if (!b) return Promise.resolve(false);
    return wrap(b.library.reveal(docId));
  }

  MM.providers = MM.providers || {};
  MM.providers.electron = lib;

  /** 给设置页 / 首页 / AI 状态用的桌面端专用接口 */
  MM.desktopBridge = {
    available: function () {
      return !!api();
    },
    status: status,
    pickRoot: pickRoot,
    openPath: openPath,
    refresh: refresh,
    forget: forget,
    sync: sync,
    pathOf: pathOf,
    reveal: reveal,
    openRoot: function () {
      var b = api();
      return b ? wrap(b.library.openRoot()) : Promise.resolve(false);
    },
    files: {
      open: function () {
        var b = api();
        return b ? wrap(b.files.open()) : Promise.reject(new Error('unsupported'));
      }
    }
  };
})();
