/**
 * MixMark · 存储后端：IndexedDB
 * ===============================================================
 * 在 http(s) 环境下比 localStorage 强得多：
 *   - 容量从约 5MB 提到几百 MB（按源配额，通常 >1GB）
 *   - 不会把整个库塞进主线程的同步 API
 *
 * 注意：`file://` 下 Chrome 直接拒绝 IndexedDB（SecurityError），
 * 所以 isAvailable() 必须真的试着打开一次数据库，不能只看 API 是否存在。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var DB_NAME = 'mixmark';
  var STORE = 'kv';
  var PREFIX = 'mixmark:';

  /** 逻辑键 → 存储键。与 localStorage 版本保持同一套命名，便于导出/迁移。 */
  function storageKey(key) {
    if (key === 'docs') return PREFIX + 'docs:index';
    if (key === 'folders') return PREFIX + 'folders:index';
    return PREFIX + key; // doc:<id>
  }

  /** 存储键 → 逻辑键（usage() 统计时要还原回逻辑键） */
  function logicalKey(skey) {
    if (skey === PREFIX + 'docs:index') return 'docs';
    if (skey === PREFIX + 'folders:index') return 'folders';
    if (skey.indexOf(PREFIX + 'doc:') === 0) return skey.slice(PREFIX.length);
    return null;
  }

  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB 不可用'));
        return;
      }

      var req;
      try {
        req = window.indexedDB.open(DB_NAME, 1);
      } catch (err) {
        // file:// 下 Chrome 会在这里抛 SecurityError
        reject(err);
        return;
      }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('IndexedDB 打开失败'));
      };
      req.onblocked = function () {
        reject(new Error('IndexedDB 被其它标签页阻塞'));
      };
    });

    // 打开失败时不要缓存失败的 Promise，否则重试永远失败
    dbPromise.catch(function () {
      dbPromise = null;
    });

    return dbPromise;
  }

  /**
   * 在事务里跑一个请求，返回它自己的 result。
   *
   * 关键：等**请求自己的 onsuccess**，不要等事务的 oncomplete。
   * 用 oncomplete + `req.result !== undefined ? req.result : req` 这种写法，
   * 会在「键不存在」时把 IDBRequest 对象本身当成值返回，
   * 上层 JSON.parse 就会报 "[object IDBRequest] is not valid JSON"。（已踩过）
   */
  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var req;

        try {
          req = fn(t.objectStore(STORE));
        } catch (err) {
          reject(err);
          return;
        }

        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error || new Error('IndexedDB 请求失败'));
        };
        t.onabort = function () {
          reject(t.error || new Error('IndexedDB 事务被中止'));
        };
      });
    });
  }

  var backend = {
    init: function () {
      return openDb().then(function () {
        return undefined;
      });
    },

    get: function (key) {
      return tx('readonly', function (store) {
        return store.get(storageKey(key));
      }).then(function (value) {
        return value === undefined ? null : value;
      });
    },

    set: function (key, value) {
      return tx('readwrite', function (store) {
        return store.put(value, storageKey(key));
      }).then(function () {
        return undefined;
      });
    },

    remove: function (key) {
      return tx('readwrite', function (store) {
        return store.delete(storageKey(key));
      }).then(function () {
        return undefined;
      });
    },

    keys: function () {
      return tx('readonly', function (store) {
        return store.getAllKeys();
      }).then(function (all) {
        return (all || [])
          .map(function (k) {
            return logicalKey(k);
          })
          .filter(Boolean);
      });
    }
  };

  /** 真的开一次库再下结论 —— 只看 typeof indexedDB 会在 file:// 下骗人 */
  function isAvailable() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      // file:// 下 IndexedDB 会被拒绝，直接判定不可用，省得抛异常
      return false;
    }
    return !!window.indexedDB;
  }

  MM.providers = MM.providers || {};
  MM.providers.idb = MM.providers.createLibrary({
    backend: backend,
    kind: 'idb',
    labelKey: 'tierIdb',
    // 配额是动态的，用 navigator.storage.estimate() 更准，但它是异步的；
    // 这里给一个保守值，仅用于「快满了」的提示
    quotaBytes: 200 * 1024 * 1024,
    isAvailable: isAvailable
  });
})();
