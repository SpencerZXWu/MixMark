/**
 * MixMark · 虚拟文档库（通用实现）
 * ===============================================================
 * 「文档 + 文件夹」这套虚拟库的增删改查只写一遍，内容存到哪儿
 * 由可插拔的 backend 决定：
 *
 *   localBackend → localStorage（file:// 下的唯一选择，容量约 5MB）
 *   idbBackend   → IndexedDB（http(s) 下可用，容量几百 MB 起步）
 *
 * backend 接口（一律返回 Promise，同步实现包一层 Promise.resolve）：
 *   init()               初始化
 *   get(key)             → Promise<string|null>
 *   set(key, value)      → Promise<void>，失败时 reject（配额满带 quota:true）
 *   remove(key)
 *   keys()               → Promise<string[]>，用于估算用量
 *
 * 逻辑键只有三种：'docs' | 'folders' | 'doc:<id>'
 * 各 backend 自己负责把它们映射到实际存储位置。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  function newId() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * 收集某文件夹自身 + 全部后代。
   * 用迭代而不是递归：层级深度不可控时不会爆栈。
   */
  function collectSubtree(folders, rootId) {
    var doomed = Object.create(null);
    doomed[rootId] = true;

    var grew = true;
    while (grew) {
      grew = false;
      for (var i = 0; i < folders.length; i++) {
        var f = folders[i];
        if (!doomed[f.id] && f.parentId && doomed[f.parentId]) {
          doomed[f.id] = true;
          grew = true;
        }
      }
    }
    return doomed;
  }

  /* ------------------------------------------------------------------
     工厂
     ------------------------------------------------------------------ */

  /**
   * @param {object} config
   *   backend     后端实现（见文件头说明）
   *   kind        provider 标识，如 'local' / 'idb'
   *   labelKey    i18n key，用于状态栏显示存储位置
   *   quotaWarnRatio 用量预警线，默认 0.8
   */
  function createLibrary(config) {
    var backend = config.backend;
    var warnRatio = config.quotaWarnRatio || 0.8;

    /* ---------------- 索引读写 ---------------- */

    function readJson(key) {
      return backend.get(key).then(function (raw) {
        if (!raw) return [];
        try {
          var parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
          console.error('[library] 索引损坏，已重置：' + key, err);
          return [];
        }
      });
    }

    function writeJson(key, list) {
      return backend.set(key, JSON.stringify(list));
    }

    /* ---------------- 文档 ---------------- */

    function list() {
      return readJson('docs').then(function (docs) {
        // 最近修改的排前面
        docs.sort(function (a, b) {
          return (b.mtime || 0) - (a.mtime || 0);
        });
        return docs;
      });
    }

    function read(id) {
      return backend.get('doc:' + id).then(function (content) {
        if (content === null || content === undefined) {
          return Promise.reject(new Error('not-found'));
        }
        return content;
      });
    }

    function write(id, content) {
      // 先读索引再写正文：正文这一段会先落盘，后端得靠标题才能定文件名，
      // 所以把 meta 一并交过去（原生后端用不上，桌面端后端需要）
      return readJson('docs').then(function (docs) {
        var meta = null;
        for (var i = 0; i < docs.length; i++) {
          if (docs[i].id === id) {
            meta = docs[i];
            docs[i].mtime = Date.now();
            docs[i].size = content.length;
            break;
          }
        }
        return backend.set('doc:' + id, content, meta).then(function () {
          return writeJson('docs', docs);
        });
      });
    }

    /**
     * 结构变化（新建 / 改名 / 移动）之后调一次，让后端把镜像文件搬到该在的位置。
     *
     * 只有桌面端后端提供 sync —— 浏览器那几个后端的「文件在哪」用户看不见，
     * 压根没有对齐这回事。所以这是可选能力，后端没实现就当无事发生。
     */
    function alignDisk() {
      if (typeof backend.sync !== 'function') return Promise.resolve();
      return Promise.resolve()
        .then(function () {
          return backend.sync();
        })
        .catch(function (err) {
          console.warn('[library] 磁盘对齐失败', err);
        });
    }

    function create(opts) {
      opts = opts || {};
      var id = newId();
      var now = Date.now();
      var content = opts.content || '';

      var meta = {
        id: id,
        title: opts.title || '',
        ctime: now,
        mtime: now,
        size: content.length,
        // 文档格式：md 走 Markdown 渲染，txt 当纯文本；存盘时也按它定后缀
        format: opts.format === 'txt' ? 'txt' : 'md',
        autoTitle: opts.autoTitle !== false,
        folderId: opts.folderId || null
      };

      return backend
        // meta 作为第三参：此刻索引里还没有它，后端靠它才能把文件命名成标题
        .set('doc:' + id, content, meta)
        .then(function () {
          return readJson('docs');
        })
        .then(function (docs) {
          docs.push(meta);
          return writeJson('docs', docs);
        })
        .then(function () {
          return alignDisk();
        })
        .then(function () {
          return meta;
        })
        .catch(function (err) {
          // 回滚，避免留下没有索引的孤儿文档
          return backend.remove('doc:' + id).then(function () {
            return Promise.reject(err);
          });
        });
    }

    function rename(id, title) {
      return readJson('docs')
        .then(function (docs) {
          for (var i = 0; i < docs.length; i++) {
            if (docs[i].id === id) {
              docs[i].title = title;
              // 手动改名后不再自动跟随 H1
              docs[i].autoTitle = false;
              docs[i].mtime = Date.now();
              break;
            }
          }
          return writeJson('docs', docs);
        })
        // 磁盘上的 .md 也得跟着改名，否则用户看到的是「界面改了、文件没改」
        .then(function () {
          return alignDisk();
        });
    }

    /** 只更新元数据（自动标题跟随、拖拽移动都用它，不标记为手动改名） */
    function touch(id, patch) {
      return readJson('docs').then(function (docs) {
        for (var i = 0; i < docs.length; i++) {
          if (docs[i].id === id) {
            Object.assign(docs[i], patch || {});
            break;
          }
        }
        return writeJson('docs', docs);
      });
    }

    function remove(id) {
      return backend
        .remove('doc:' + id)
        .then(function () {
          return readJson('docs');
        })
        .then(function (docs) {
          return writeJson(
            'docs',
            docs.filter(function (d) {
              return d.id !== id;
            })
          );
        })
        // 删掉后可能腾空了某个目录，顺手扫一遍（后端的 sync 会清空壳）
        .then(function () {
          return alignDisk();
        });
    }

    /* ---------------- 文件夹 ---------------- */

    function listFolders() {
      return readJson('folders');
    }

    function createFolder(opts) {
      opts = opts || {};
      var now = Date.now();

      var meta = {
        id: newId(),
        name: (opts.name || '').trim() || 'folder',
        parentId: opts.parentId || null,
        ctime: now,
        mtime: now
      };

      return readJson('folders')
        .then(function (folders) {
          folders.push(meta);
          return writeJson('folders', folders);
        })
        .then(function () {
          return meta;
        });
    }

    function renameFolder(id, name) {
      return readJson('folders')
        .then(function (folders) {
          var hit = false;
          for (var i = 0; i < folders.length; i++) {
            if (folders[i].id === id) {
              folders[i].name = name;
              folders[i].mtime = Date.now();
              hit = true;
              break;
            }
          }
          if (!hit) return Promise.reject(new Error('not-found'));
          return writeJson('folders', folders);
        })
        // 目录名也得改，否则磁盘上还是旧文件夹名
        .then(function () {
          return alignDisk();
        });
    }

    function folderStats(id) {
      return Promise.all([readJson('folders'), readJson('docs')]).then(function (res) {
        var doomed = collectSubtree(res[0], id);
        return {
          docs: res[1].filter(function (d) {
            return d.folderId && doomed[d.folderId];
          }).length,
          folders: Object.keys(doomed).length - 1 // 不含自身
        };
      });
    }

    /**
     * 删除文件夹：连同全部后代文件夹与其中的文档一起删。
     * 不提供「只删文件夹、内容移出去」的变体 —— 那种语义含糊，
     * 确认框里把影响范围说清楚，比事后让人找文档更让人放心。
     */
    function removeFolder(id) {
      return Promise.all([readJson('folders'), readJson('docs')]).then(function (res) {
        var folders = res[0];
        var docs = res[1];
        var doomed = collectSubtree(folders, id);

        var kept = [];
        var chain = Promise.resolve();

        docs.forEach(function (d) {
          if (d.folderId && doomed[d.folderId]) {
            chain = chain.then(function () {
              return backend.remove('doc:' + d.id);
            });
          } else {
            kept.push(d);
          }
        });

        return chain
          .then(function () {
            return writeJson('docs', kept);
          })
          .then(function () {
            return writeJson(
              'folders',
              folders.filter(function (f) {
                return !doomed[f.id];
              })
            );
          })
          .then(function () {
            return { docs: docs.length - kept.length, folders: Object.keys(doomed).length };
          })
          // 子树全删完后，磁盘上的空目录也该跟着消失
          .then(function (res) {
            return alignDisk().then(function () {
              return res;
            });
          });
      });
    }

    /**
     * 移动文件夹。
     * 必须阻断「把父文件夹移进自己的子文件夹」这种循环引用，
     * 否则整棵子树会从树上脱落、界面上再也看不到。
     */
    function moveFolder(id, parentId) {
      parentId = parentId || null;
      if (id === parentId) return Promise.reject(new Error('cycle'));

      return readJson('folders').then(function (folders) {
        var byId = Object.create(null);
        folders.forEach(function (f) {
          byId[f.id] = f;
        });

        // 从目标位置往上走到根，途中碰到自己就说明成环
        var walk = parentId;
        var guard = 0;
        while (walk && guard++ < 500) {
          if (walk === id) return Promise.reject(new Error('cycle'));
          walk = byId[walk] ? byId[walk].parentId : null;
        }

        for (var i = 0; i < folders.length; i++) {
          if (folders[i].id === id) {
            folders[i].parentId = parentId;
            folders[i].mtime = Date.now();
            break;
          }
        }
        return writeJson('folders', folders).then(function () {
          return alignDisk();
        });
      });
    }

    /**
     * 移动文档。
     * 刻意用独立方法而不是 touch()：touch 会把 mtime 改成当前时间，
     * 导致「只是换个位置」的文档跳到列表最顶部。
     */
    function moveDoc(id, folderId) {
      return readJson('docs').then(function (docs) {
        var hit = false;
        for (var i = 0; i < docs.length; i++) {
          if (docs[i].id === id) {
            docs[i].folderId = folderId || null;
            hit = true;
            break;
          }
        }
        if (!hit) return Promise.reject(new Error('not-found'));
        return writeJson('docs', docs).then(function () {
          return alignDisk();
        });
      });
    }

    /* ---------------- 用量 ---------------- */

    var ASSUMED_QUOTA = 5 * 1024 * 1024;

    function usage() {
      return backend
        .keys()
        .then(function (keys) {
          var chain = Promise.resolve(0);
          keys.forEach(function (k) {
            chain = chain.then(function (total) {
              return backend.get(k).then(function (v) {
                return total + (k.length + (v ? v.length : 0)) * 2;
              });
            });
          });
          return chain;
        })
        .then(function (bytes) {
          return {
            bytes: bytes,
            quota: config.quotaBytes || ASSUMED_QUOTA,
            ratio: Math.min(1, bytes / (config.quotaBytes || ASSUMED_QUOTA))
          };
        })
        .catch(function () {
          return { bytes: 0, ratio: 0, unknown: true };
        });
    }

    /* ---------------- 导出全部（迁移用） ---------------- */

    function exportAll() {
      return Promise.all([list(), listFolders()]).then(function (res) {
        var docs = res[0];
        return Promise.all(
          docs.map(function (meta) {
            return read(meta.id).then(function (content) {
              return Object.assign({}, meta, { content: content });
            });
          })
        ).then(function (full) {
          return { docs: full, folders: res[1] };
        });
      });
    }

    /* ---------------- 组装 ---------------- */

    return {
      kind: config.kind,
      labelKey: config.labelKey,
      capabilities: { openFolder: false, watch: false, binary: false, rename: true, folders: true },

      isAvailable: config.isAvailable || function () {
        return true;
      },

      init: backend.init,

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
      quotaWarnRatio: warnRatio,
      exportAll: exportAll
    };
  }

  MM.providers = MM.providers || {};
  MM.providers.createLibrary = createLibrary;
})();
