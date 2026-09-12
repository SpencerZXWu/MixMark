/**
 * MixMark · 磁盘文件直连
 * ===============================================================
 * 「打开文件 / 另存为」让某篇文档直接对应磁盘上的一个真实文件：
 * 保存时写回原文件，而不是只在文档库里留一份副本。
 *
 * 与 provider/fsa.js 的分工：
 *   fsa.js      —— 接管整个文件夹，文件夹里所有 .md 都进文档库
 *   diskfile.js —— 只接管一个文件，不要求它待在某个已连接的文件夹里
 *
 * 两者共用同一个 IndexedDB 库（mixmark-handles / handles），
 * 但键名各走各的前缀，互不干扰。
 *
 * 写盘时机：不单独提供一个「保存到磁盘」的动作，而是挂在文档的
 * dirty 标志上 —— 只要一次保存落了盘（无论是用户按 Ctrl+S 还是自动保存），
 * 就把同样的内容写回磁盘文件。这样手动保存和自动保存的行为永远一致，
 * 不会出现「自动保存只进了文档库、磁盘上还是旧内容」这种半吊子状态。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var DB_NAME = 'mixmark-handles';
  var STORE = 'handles';
  /** 键名前缀：与 fsa.js 的根目录句柄区分开 */
  var PREFIX = 'file:';
  /** 另一个前缀：正文里引用的图片 / 附件（见文件末尾的「拖入引用」） */
  var PREFIX_DROP = 'drop:';

  /** docId → { handle, name } */
  var bound = Object.create(null);
  /** docId → 上次成功写进磁盘的内容，用来跳过无意义的重复写 */
  var lastWritten = Object.create(null);
  var ready = false;
  var pending = null;

  /* ------------------------------------------------------------------
     能力检测
     ------------------------------------------------------------------ */

  /**
   * 能力检测。
   *
   * 光看 showOpenFilePicker 存不存在是不够的：`file://` 下浏览器照样把
   * 这几个函数挂在 window 上，但真正调用时会被拒绝 —— 于是表现为
   * 「点了没反应」。所以和 provider/fsa.js 用同一条判据：
   * 必须走 http(s) 才算数。
   */
  function apiSupported() {
    return (
      typeof window.showOpenFilePicker === 'function' &&
      typeof window.showSaveFilePicker === 'function' &&
      (location.protocol === 'http:' || location.protocol === 'https:')
    );
  }

  /** 能连 ≠ 现在能连：file:// 下这套 API 实际不可用 */
  function supported() {
    return apiSupported();
  }

  /* ------------------------------------------------------------------
     句柄持久化
     ------------------------------------------------------------------ */

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no-idb'));

      var req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('idb-open-failed'));
      };
    });
  }

  function put(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
        // 等请求自己的 onsuccess，不要等事务的 oncomplete ——
        // 后者在键不存在时会把 IDBRequest 对象本身当结果交出来
        req.onsuccess = function () {
          resolve(true);
        };
        req.onerror = function () {
          reject(req.error || new Error('idb-put-failed'));
        };
      });
    });
  }

  function del(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
        req.onsuccess = req.onerror = function () {
          resolve(true);
        };
      });
    });
  }

  function readAll() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var store = db.transaction(STORE, 'readonly').objectStore(STORE);
        var out = [];

        // getAllKeys + get 的组合比游标好写，也不用管游标回调的嵌套
        var keysReq = store.getAllKeys();
        keysReq.onsuccess = function () {
          var keys = (keysReq.result || []).filter(function (k) {
            return typeof k === 'string' && k.indexOf(PREFIX) === 0;
          });
          if (!keys.length) return resolve(out);

          var pendingCount = keys.length;
          keys.forEach(function (k) {
            var getReq = store.get(k);
            getReq.onsuccess = function () {
              if (getReq.result) out.push({ key: k, value: getReq.result });
              if (--pendingCount === 0) resolve(out);
            };
            getReq.onerror = function () {
              if (--pendingCount === 0) resolve(out);
            };
          });
        };
        keysReq.onerror = function () {
          reject(keysReq.error || new Error('idb-keys-failed'));
        };
      });
    });
  }

  /* ------------------------------------------------------------------
     权限
     ------------------------------------------------------------------ */

  /**
   * 写盘前必须确认拿到 readwrite 权限。
   * 冷启动后句柄还在，但权限状态是 prompt —— 这时需要用户手势才能重新授权，
   * 所以自动保存触发的那次写盘会失败得很安静，是预期行为（手动保存即可恢复）。
   */
  function ensureWrite(handle) {
    if (typeof handle.queryPermission !== 'function') return Promise.resolve(true);

    return handle.queryPermission({ mode: 'readwrite' }).then(function (state) {
      if (state === 'granted') return true;
      return handle.requestPermission({ mode: 'readwrite' }).then(function (next) {
        if (next !== 'granted') throw new Error('denied');
        return true;
      });
    });
  }

  /** 真正写文件：先写临时副本再 close 提交，中途断电不会把原文件截断 */
  function writeHandle(handle, content) {
    return ensureWrite(handle).then(function () {
      return handle.createWritable();
    }).then(function (writable) {
      return writable.write(content).then(function () {
        return writable.close();
      });
    });
  }

  /* ------------------------------------------------------------------
     对外动作
     ------------------------------------------------------------------ */

  /** 文件名去掉扩展名，作为文档标题的初值 */
  function titleFromName(name) {
    return String(name || '').replace(/\.(md|markdown|mdown|txt)$/i, '') || name || '';
  }

  /** 系统保存框不接受路径分隔符 */
  function sanitizeName(name) {
    var s = String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    return s || 'untitled.md';
  }

  function pickTypes() {
    return [
      {
        description: 'Markdown',
        accept: {
          'text/markdown': ['.md', '.markdown', '.mdown'],
          'text/plain': ['.txt']
        }
      }
    ];
  }

  /**
   * 打开磁盘上的一个文件。
   * 必须在用户手势里直接调用（点击处理器内、中间不要被 await 断开），
   * 否则浏览器会以 SecurityError 拒绝。
   */
  function open() {
    if (!apiSupported()) return Promise.reject(new Error('unsupported'));

    return window
      .showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: false,
        types: pickTypes()
      })
      .then(function (handles) {
        var handle = handles && handles[0];
        if (!handle) throw new Error('no-file');

        // 顺手把写权限要下来；要不到也不影响读取，只是保存时会再问一次
        return ensureWrite(handle)
          .catch(function () {
            return false;
          })
          .then(function () {
            return handle.getFile();
          })
          .then(function (file) {
            return file.text();
          })
          .then(function (content) {
            return { handle: handle, name: handle.name, content: content };
          });
      });
  }

  /** 另存为：选一个路径，写进去，并把文档绑到它上面 */
  function saveAs(suggestedName, content) {
    if (!apiSupported()) return Promise.reject(new Error('unsupported'));

    return window
      .showSaveFilePicker({
        suggestedName: sanitizeName(suggestedName),
        excludeAcceptAllOption: false,
        types: pickTypes()
      })
      .then(function (handle) {
        return writeHandle(handle, content).then(function () {
          return { handle: handle, name: handle.name, content: content };
        });
      });
  }

  function bind(docId, handle, name) {
    if (!docId || !handle) return Promise.resolve(false);

    bound[docId] = { handle: handle, name: name || handle.name || '' };
    lastWritten[docId] = null;

    // 界面要据此点亮「磁盘」标记，所以先播报再等持久化
    if (MM.bus) MM.bus.emit('disk:changed', { docId: docId });

    return put(PREFIX + docId, { handle: handle, name: bound[docId].name }).catch(function (err) {
      // 记不住句柄不影响本次会话直连，下次打开会退化成普通文档
      console.warn('[disk] 句柄保存失败，本次会话仍可直接编辑', err);
      return false;
    });
  }

  function unbind(docId) {
    delete bound[docId];
    delete lastWritten[docId];
    if (MM.bus) MM.bus.emit('disk:changed', { docId: docId });
    return del(PREFIX + docId);
  }

  function isBound(docId) {
    return !!(docId && bound[docId]);
  }

  function labelOf(docId) {
    return (docId && bound[docId] && bound[docId].name) || '';
  }

  /** 立刻把内容写回绑定的磁盘文件 */
  function writeNow(docId, content) {
    var entry = bound[docId];
    if (!entry) return Promise.resolve(false);
    if (lastWritten[docId] === content) return Promise.resolve(false);

    return writeHandle(entry.handle, content).then(function () {
      lastWritten[docId] = content;
      return true;
    });
  }

  /* ------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------ */

  /** 从 IndexedDB 读回上次绑定的句柄（只读权限可用，写权限要重新授权） */
  function restore() {
    if (!apiSupported()) return Promise.resolve(false);

    return readAll()
      .then(function (rows) {
        rows.forEach(function (row) {
          var value = row.value;
          if (!value || !value.handle) return;

          // drop: 是正文引用的图片，file: 是「文档直连磁盘文件」，分开装
          if (row.key.indexOf(PREFIX_DROP) === 0) {
            var assetName = value.name || value.handle.name || '';
            if (assetName) assets[assetName] = { handle: value.handle, url: null };
            return;
          }

          var docId = row.key.slice(PREFIX.length);
          bound[docId] = { handle: value.handle, name: value.name || value.handle.name || '' };
        });
        return rows.length > 0;
      })
      .catch(function (err) {
        console.warn('[disk] 读取已绑定的文件句柄失败', err);
        return false;
      });
  }

  /**
   * 保存落盘后同步写回磁盘文件。
   *
   * 用 dirty 从 true → false 这一跳作为信号，而不是在保存流程里插钩子：
   * 这样手动保存（Ctrl+S）与自动保存走的是同一条路径，不会有一边漏掉。
   */
  function watchSaves() {
    if (!MM.store || !MM.store.watch) return;

    MM.store.watch('dirty', function (s) {
      if (s.dirty || !s.docId) return;
      if (!isBound(s.docId)) return;

      var id = s.docId;
      writeNow(id, MM.docs.content()).catch(function (err) {
        // 自动保存触发的写盘失败多半是权限问题（需要用户手势重新授权），
        // 不适合弹错误框打断输入，只在控制台留痕
        console.warn('[disk] 自动写回磁盘失败', err);
      });
    });
  }

  function init() {
    if (ready) return Promise.resolve(false);
    ready = true;

    watchSaves();

    return restore().then(function (found) {
      return found;
    });
  }

  /* ------------------------------------------------------------------
     拖入引用：正文里的图片 / 附件

     与「文档直连磁盘文件」是同一件事的两个方向：那边是一篇文档认领一个文件，
     这边是正文里的一句 ![](a.png) 认领一个文件。句柄存在同一个 IndexedDB，
     只是键前缀不同（file: / drop:）。

     为什么不能直接写系统路径：浏览器拿不到 —— FileSystemFileHandle 只暴露
     name，绝对路径是隐私设计，没有开关。所以正文里只能写文件名，
     预览时再拿句柄换一个 blob URL 出来。代价是换台机器 / 换别的编辑器
     打开，图片就失效；等 M4 桌面版能用 webUtils.getPathForFile 拿到真实路径，
     这里可以升级成写绝对路径。
     ------------------------------------------------------------------ */

  /** 文件名 → { handle, url }；url 建过就留着，避免反复建 blob */
  var assets = Object.create(null);

  /** 认领一个拖进来的文件句柄 */
  function adopt(handle) {
    if (!handle || !handle.name) return Promise.resolve(null);

    var name = handle.name;
    assets[name] = { handle: handle, url: null };

    // 先播报再等持久化：预览要立刻能显示，不该等 IndexedDB
    if (MM.bus) MM.bus.emit('asset:changed', { name: name });

    return put(PREFIX_DROP + name, { handle: handle, name: name })
      .catch(function (err) {
        // 记不住不影响本次会话，只是刷新后要重新拖一次
        console.warn('[disk] 引用句柄保存失败，本次会话仍可用', err);
        return false;
      })
      .then(function () {
        return name;
      });
  }

  /** 文件名 → 可直接放进 img.src 的 blob URL；没登记过则返回 null */
  function resolveAsset(name) {
    var entry = assets[name];
    if (!entry) return Promise.resolve(null);
    if (entry.url) return Promise.resolve(entry.url);

    return entry.handle
      .getFile()
      .then(function (file) {
        entry.url = URL.createObjectURL(file);
        return entry.url;
      })
      .catch(function (err) {
        console.warn('[disk] 引用文件读取失败：' + name, err);
        return null;
      });
  }

  function releaseAsset(name) {
    var entry = assets[name];
    if (entry && entry.url) URL.revokeObjectURL(entry.url);
    delete assets[name];
    if (MM.bus) MM.bus.emit('asset:changed', { name: name });
    return del(PREFIX_DROP + name);
  }

  MM.disk = {
    supported: supported,
    init: init,
    open: open,
    saveAs: saveAs,
    bind: bind,
    unbind: unbind,
    isBound: isBound,
    labelOf: labelOf,
    writeNow: writeNow,
    titleFromName: titleFromName
  };

  /**
   * 正文引用的图片 / 附件。
   * 放在 diskfile.js 里而不是另开一个模块：句柄的存取管道
   * （openDb / put / del / readAll）完全一样，再复制一份反而容易两边走偏。
   */
  MM.disk.assets = {
    adopt: adopt,
    resolve: resolveAsset,
    release: releaseAsset,
    names: function () {
      return Object.keys(assets);
    },
    has: function (name) {
      return !!assets[name];
    }
  };
})();
