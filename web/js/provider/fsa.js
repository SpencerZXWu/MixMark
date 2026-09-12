/**
 * MixMark · 存储提供者：真实文件夹（File System Access API）
 * ===============================================================
 * 这是 M2 的核心：让文档以 .md 明文躺在用户自己的硬盘上，
 * 可以直接被 VSCode / Git 管理，而不是锁在浏览器里。
 *
 * 可用条件：Chrome / Edge 且运行在 http(s) 下。
 *   `file://` 下该 API 整体不可用（双击 index.html 的兜底是 localStorage）。
 *
 * 与虚拟库的差别（也是这里代码量更大的原因）：
 *   - 文档 id 就是相对路径，文件夹 id 也是相对路径（根 = null）
 *   - 没有 rename / move 原语，只能用「读 → 写新 → 删旧」模拟
 *   - 目录句柄可以存进 IndexedDB（结构化克隆），但**权限**要在用户手势里重新申请
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var MD_RE = /\.(md|markdown|mdown|txt)$/i;
  var HANDLE_DB = 'mixmark-handles';
  var HANDLE_STORE = 'handles';
  var HANDLE_KEY = 'root';

  var rootHandle = null;
  /** 权限状态：granted | prompt | denied | none */
  var permission = 'none';

  /* ------------------------------------------------------------------
     目录句柄的持久化
     句柄本身不能进 localStorage（不可序列化），但可以结构化克隆进 IndexedDB。
     ------------------------------------------------------------------ */

  function handleDb() {
    return new Promise(function (resolve, reject) {
      var req = window.indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function saveHandle(handle) {
    if (!window.indexedDB) return Promise.resolve();
    return handleDb().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(HANDLE_STORE, 'readwrite');
        t.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
        t.oncomplete = resolve;
        t.onerror = resolve; // 存不下来不算致命，只是下次要重新选目录
      });
    });
  }

  function loadHandle() {
    if (!window.indexedDB) return Promise.resolve(null);
    return handleDb()
      .then(function (db) {
        return new Promise(function (resolve) {
          var t = db.transaction(HANDLE_STORE, 'readonly');
          var req = t.objectStore(HANDLE_STORE).get(HANDLE_KEY);
          req.onsuccess = function () {
            resolve(req.result || null);
          };
          req.onerror = function () {
            resolve(null);
          };
        });
      })
      .catch(function () {
        return null;
      });
  }

  function clearHandle() {
    if (!window.indexedDB) return Promise.resolve();
    return handleDb().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(HANDLE_STORE, 'readwrite');
        t.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
        t.oncomplete = resolve;
        t.onerror = resolve;
      });
    });
  }

  /* ------------------------------------------------------------------
     路径工具
     ------------------------------------------------------------------ */

  function splitPath(path) {
    return String(path || '')
      .split('/')
      .filter(Boolean);
  }

  function joinPath(dir, name) {
    return dir ? dir + '/' + name : name;
  }

  function parentOf(path) {
    var parts = splitPath(path);
    parts.pop();
    return parts.join('/');
  }

  function baseName(path) {
    var parts = splitPath(path);
    return parts[parts.length - 1] || '';
  }

  function titleFromName(name) {
    return String(name).replace(MD_RE, '');
  }

  function safeFileName(name) {
    var s = String(name || 'untitled').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    return s.slice(0, 80) || 'untitled';
  }

  /** 逐层解析目录句柄；create 为真时缺失的层级会被创建 */
  function resolveDir(path, create) {
    // 先堵住根句柄缺失的情况，否则会一路冒泡成
    // "Cannot read properties of null" 这种看不懂的 TypeError
    if (!rootHandle) return Promise.reject(new Error('no-root'));

    var parts = splitPath(path);
    var chain = Promise.resolve(rootHandle);
    parts.forEach(function (part) {
      chain = chain.then(function (dir) {
        return dir.getDirectoryHandle(part, { create: !!create });
      });
    });
    return chain;
  }

  function resolveFile(path, create) {
    var parts = splitPath(path);
    var name = parts.pop();
    if (!name) return Promise.reject(new Error('bad-path'));
    return resolveDir(parts.join('/'), create).then(function (dir) {
      return dir.getFileHandle(name, { create: !!create });
    });
  }

  /* ------------------------------------------------------------------
     扫描：把真实目录树映射成「文档 + 文件夹」两张表
     ------------------------------------------------------------------ */

  function listEntries(dirHandle) {
    var out = [];
    var it = dirHandle.values();

    function step() {
      return it.next().then(function (res) {
        if (res.done) return out;
        out.push(res.value);
        return step();
      });
    }
    return step();
  }

  var docs = [];
  var folders = [];

  /**
   * 扫描结果是否仍然有效。
   * 每次读写都全量走盘太贵，所以用「写操作后失效」的策略：
   * 本进程内的改动我们自己清楚。外部（其它程序）的改动
   * 需要用户手动刷新 —— 这是不做轮询的代价，换来的是零后台开销。
   */
  var scanned = false;

  function walk(dirHandle, path, folderId) {
    return listEntries(dirHandle).then(function (entries) {
      var chain = Promise.resolve();

      entries.forEach(function (entry) {
        // 跳过隐藏项：.git / .obsidian / .DS_Store 之类不是用户的文档
        if (entry.name.charAt(0) === '.') return;

        var childPath = joinPath(path, entry.name);

        if (entry.kind === 'directory') {
          folders.push({
            id: childPath,
            name: entry.name,
            parentId: folderId,
            ctime: 0,
            mtime: 0
          });
          chain = chain.then(function () {
            return walk(entry, childPath, childPath);
          });
          return;
        }

        if (!MD_RE.test(entry.name)) return;

        chain = chain.then(function () {
          return entry.getFile().then(function (file) {
            docs.push({
              id: childPath,
              path: childPath,
              title: titleFromName(entry.name),
              folderId: folderId,
              ctime: file.lastModified,
              mtime: file.lastModified,
              size: file.size,
              autoTitle: false
            });
          });
        });
      });

      return chain;
    });
  }

  /**
   * 全量重扫目录树，结果会缓存。
   * list() 与 listFolders() 常被同时调用，没有缓存的话每刷新一次索引就要走两遍盘。
   */
  function rescan() {
    if (scanned) return Promise.resolve({ docs: docs, folders: folders });

    docs = [];
    folders = [];

    if (!rootHandle || permission !== 'granted') {
      scanned = true;
      return Promise.resolve({ docs: docs, folders: folders });
    }

    return walk(rootHandle, '', null).then(function () {
      docs.sort(function (a, b) {
        return (b.mtime || 0) - (a.mtime || 0);
      });
      scanned = true;
      return { docs: docs, folders: folders };
    });
  }

  /** 任何写操作之后都要调用，让下一次读取重新走盘 */
  function invalidate() {
    scanned = false;
  }

  /* ------------------------------------------------------------------
     Provider 接口
     ------------------------------------------------------------------ */

  function apiSupported() {
    return (
      typeof window.showDirectoryPicker === 'function' &&
      (location.protocol === 'http:' || location.protocol === 'https:')
    );
  }

  /**
   * 供 provider/index.js 在判断可用性**之前**调用。
   * 为什么必需：FSA 到底能不能用，取决于「上次选过的目录句柄还在不在、
   * 权限还有没有」。所以必须先异步把句柄读回来，再回答 isAvailable()。
   */
  function prepare() {
    if (!apiSupported()) return Promise.resolve();

    return loadHandle().then(function (h) {
      if (!h) {
        permission = 'none';
        return;
      }
      rootHandle = h;
      invalidate();
      // 上次授权过就是 granted；否则得让用户点一下按钮重新授权
      return h.queryPermission({ mode: 'readwrite' }).then(function (state) {
        permission = state;
      });
    });
  }

  /** 真正可用（而不是恰好被选中的条件）：API 支持 + 有目录 + 权限在手 */
  function isAvailable() {
    return apiSupported() && !!rootHandle && permission === 'granted';
  }

  function init() {
    // 准备工作已经在 prepare() 里做完了
    return Promise.resolve();
  }

  /** 选择文件夹。必须由用户手势触发（浏览器要求）。 */
  function pickRoot() {
    return window
      .showDirectoryPicker({ mode: 'readwrite', id: 'mixmark-root' })
      .then(function (handle) {
        rootHandle = handle;
        permission = 'granted';
        invalidate();
        return saveHandle(handle);
      })
      .then(function () {
        return rescan();
      });
  }

  /** 重新申请权限（同样必须由用户手势触发） */
  function requestAccess() {
    if (!rootHandle) return Promise.reject(new Error('no-root'));
    return rootHandle.requestPermission({ mode: 'readwrite' }).then(function (state) {
      permission = state;
      if (state !== 'granted') return Promise.reject(new Error('denied'));
      invalidate();
      return rescan();
    });
  }

  function disconnect() {
    rootHandle = null;
    permission = 'none';
    docs = [];
    folders = [];
    invalidate();
    return clearHandle();
  }

  /** 强制重新扫描磁盘（外部改动过后用） */
  function refresh() {
    invalidate();
    return rescan();
  }

  function status() {
    return {
      connected: !!rootHandle,
      permission: permission,
      name: rootHandle ? rootHandle.name : null
    };
  }

  /** 供设置页判断该不该显示「连接文件夹」之类的按钮 */
  function supported() {
    return apiSupported();
  }

  /* ---------------- 文档 ---------------- */

  function list() {
    return rescan().then(function (res) {
      return res.docs;
    });
  }

  function read(id) {
    return resolveFile(id).then(function (handle) {
      return handle.getFile();
    }).then(function (file) {
      return file.text();
    });
  }

  function write(id, content) {
    return resolveFile(id, true)
      .then(function (handle) {
        return handle.createWritable();
      })
      .then(function (writable) {
        return writable.write(content).then(function () {
          return writable.close();
        });
      })
      .then(function () {
        return rescan().then(function () {
          return { usage: { ratio: 0 } };
        });
      });
  }

  /**
   * 找一个不冲突的文件名。
   * 同名时加数字后缀，避免直接覆盖用户已有的文件。
   */
  function pickFreePath(folderId, base) {
    function attempt(n) {
      var suffix = n === 1 ? '' : '-' + n;
      var candidate = joinPath(folderId, base + suffix + '.md');
      return resolveFile(candidate).then(
        function () {
          return attempt(n + 1);
        },
        function () {
          return candidate;
        }
      );
    }
    return attempt(1);
  }

  function create(opts) {
    opts = opts || {};
    var folderId = opts.folderId || '';
    var base = safeFileName(opts.title || 'untitled');
    var finalPath = null;

    return pickFreePath(folderId, base)
      .then(function (path) {
        finalPath = path;
        return makeWritable(path);
      })
      .then(function (writable) {
        return writable.write(opts.content || '').then(function () {
          return writable.close();
        });
      })
      .then(function () {
        return rescan();
      })
      .then(function (res) {
        // 路径是我们自己定的，按路径取回就一定是对的那一篇
        return (
          res.docs.filter(function (d) {
            return d.path === finalPath;
          })[0] || null
        );
      });
  }

  function makeWritable(path) {
    // 所有写入都经过这里，在这里统一让扫描缓存失效最不容易漏
    invalidate();
    return resolveFile(path, true).then(function (handle) {
      return handle.createWritable();
    });
  }

  /**
   * 重命名。FSA 没有 rename 原语，只能「读 → 写新 → 删旧」。
   * 对 .md 这种小文件来说这个代价完全可以接受。
   */
  function rename(id, title) {
    var folderId = parentOf(id);
    var nextPath = joinPath(folderId, safeFileName(title) + '.md');

    if (nextPath === id) return Promise.resolve();

    return read(id)
      .then(function (content) {
        return makeWritable(nextPath).then(function (writable) {
          return writable.write(content).then(function () {
            return writable.close();
          });
        });
      })
      .then(function () {
        return removeEntry(id);
      })
      .then(function () {
        return rescan();
      });
  }

  function removeEntry(path) {
    invalidate();
    var name = baseName(path);
    return resolveDir(parentOf(path)).then(function (dir) {
      return dir.removeEntry(name);
    });
  }

  function remove(id) {
    return removeEntry(id).then(function () {
      return rescan();
    });
  }

  /** 只更新元数据：真实文件没有自定义标题，改名就走 rename */
  function touch(id, patch) {
    if (patch && patch.title) return rename(id, patch.title);
    return Promise.resolve();
  }

  function moveDoc(id, folderId) {
    var target = joinPath(folderId || '', baseName(id));
    if (target === id) return Promise.resolve();

    return read(id)
      .then(function (content) {
        return makeWritable(target).then(function (writable) {
          return writable.write(content).then(function () {
            return writable.close();
          });
        });
      })
      .then(function () {
        return removeEntry(id);
      })
      .then(function () {
        return rescan();
      });
  }

  /* ---------------- 文件夹 ---------------- */

  function listFolders() {
    return rescan().then(function (res) {
      return res.folders;
    });
  }

  function createFolder(opts) {
    opts = opts || {};
    var parent = opts.parentId || '';
    var name = safeFileName(opts.name || 'folder');

    invalidate();
    return resolveDir(joinPath(parent, name), true)
      .then(function () {
        return rescan();
      })
      .then(function (res) {
        return res.folders.filter(function (f) {
          return f.id === joinPath(parent, name);
        })[0];
      });
  }

  function renameFolder(id, name) {
    var parent = parentOf(id);
    var nextId = joinPath(parent, safeFileName(name));

    if (nextId === id) return Promise.resolve();

    return copyDir(id, nextId)
      .then(function () {
        return removeDir(id);
      })
      .then(function () {
        return rescan();
      });
  }

  /** 递归复制目录（FSA 没有 move/rename，只能复制再删） */
  function copyDir(fromPath, toPath) {
    return resolveDir(toPath, true).then(function (target) {
      return resolveDir(fromPath).then(function (source) {
        return listEntries(source).then(function (entries) {
          var chain = Promise.resolve();

          entries.forEach(function (entry) {
            var childFrom = joinPath(fromPath, entry.name);
            var childTo = joinPath(toPath, entry.name);

            if (entry.kind === 'directory') {
              chain = chain.then(function () {
                return copyDir(childFrom, childTo);
              });
            } else {
              chain = chain.then(function () {
                return entry.getFile().then(function (file) {
                  return file.text().then(function (text) {
                    return resolveFile(childTo, true).then(function (handle) {
                      return handle.createWritable().then(function (writable) {
                        return writable.write(text).then(function () {
                          return writable.close();
                        });
                      });
                    });
                  });
                });
              });
            }
          });

          return chain;
        });
      });
    });
  }

  function removeDir(path) {
    invalidate();
    var name = baseName(path);
    return resolveDir(parentOf(path)).then(function (dir) {
      return dir.removeEntry(name, { recursive: true });
    });
  }

  function folderStats(id) {
    return rescan().then(function (res) {
      var doomed = Object.create(null);
      doomed[id] = true;

      var grew = true;
      while (grew) {
        grew = false;
        res.folders.forEach(function (f) {
          if (!doomed[f.id] && f.parentId && doomed[f.parentId]) {
            doomed[f.id] = true;
            grew = true;
          }
        });
      }

      return {
        docs: res.docs.filter(function (d) {
          return d.folderId && doomed[d.folderId];
        }).length,
        folders: Object.keys(doomed).length - 1
      };
    });
  }

  function removeFolder(id) {
    // 先统计影响范围：删完之后目录已经不在了，算不出来
    return folderStats(id).then(function (stats) {
      return removeDir(id).then(function () {
        return rescan().then(function () {
          return stats;
        });
      });
    });
  }

  function moveFolder(id, parentId) {
    parentId = parentId || null;
    if (id === parentId) return Promise.reject(new Error('cycle'));

    var byId = Object.create(null);
    folders.forEach(function (f) {
      byId[f.id] = f;
    });

    var walk = parentId;
    var guard = 0;
    while (walk && guard++ < 500) {
      if (walk === id) return Promise.reject(new Error('cycle'));
      walk = byId[walk] ? byId[walk].parentId : null;
    }

    var target = joinPath(parentId || '', baseName(id));
    if (target === id) return Promise.resolve();

    return copyDir(id, target)
      .then(function () {
        return removeDir(id);
      })
      .then(function () {
        return rescan();
      });
  }

  /* ---------------- 其它 ---------------- */

  function usage() {
    return Promise.resolve({ ratio: 0, unknown: true });
  }

  function exportAll() {
    return rescan().then(function (res) {
      return Promise.all(
        res.docs.map(function (meta) {
          return read(meta.id).then(function (content) {
            return Object.assign({}, meta, { content: content });
          });
        })
      ).then(function (full) {
        return { docs: full, folders: res.folders };
      });
    });
  }

  MM.providers = MM.providers || {};
  MM.providers.fsa = {
    kind: 'fsa',
    labelKey: 'tierFsa',
    capabilities: { openFolder: true, watch: false, binary: false, rename: true, folders: true },
    prepare: prepare,
    isAvailable: isAvailable,
    supported: supported,
    init: init,

    pickRoot: pickRoot,
    requestAccess: requestAccess,
    disconnect: disconnect,
    refresh: refresh,
    status: status,

    list: list,
    read: read,
    write: write,
    create: create,
    rename: rename,
    touch: touch,
    remove: remove,

    listFolders: listFolders,
    createFolder: createFolder,
    renameFolder: renameFolder,
    removeFolder: removeFolder,
    folderStats: folderStats,
    moveFolder: moveFolder,
    moveDoc: moveDoc,

    usage: usage,
    quotaWarnRatio: 1,
    exportAll: exportAll
  };
})();
