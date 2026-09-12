/**
 * MixMark · 存储后端：localStorage
 * ===============================================================
 * file:// 下 localStorage 是唯一可靠的持久化手段
 * （Chrome 在那里的 IndexedDB 会直接抛 SecurityError）。
 *
 * 虚拟库的增删改查逻辑在 library.js，这里只回答「怎么存」。
 * 键名与旧版完全一致，老数据不需要迁移。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var PREFIX = 'mixmark:';
  var KEY_MAP = {
    docs: PREFIX + 'docs:index',
    folders: PREFIX + 'folders:index'
  };

  function storageKey(key) {
    return KEY_MAP[key] || PREFIX + key; // doc:<id> → mixmark:doc:<id>
  }

  /** 存储键 → 逻辑键。只认库自己的键，别把设置之类的算进用量。 */
  function logicalKey(skey) {
    if (skey === KEY_MAP.docs) return 'docs';
    if (skey === KEY_MAP.folders) return 'folders';
    if (skey.indexOf(PREFIX + 'doc:') === 0) return skey.slice(PREFIX.length);
    return null;
  }

  var backend = {
    init: function () {
      return Promise.resolve();
    },

    get: function (key) {
      try {
        return Promise.resolve(window.localStorage.getItem(storageKey(key)));
      } catch (err) {
        console.warn('[backend:local] 读取失败', key, err);
        return Promise.resolve(null);
      }
    },

    set: function (key, value) {
      try {
        window.localStorage.setItem(storageKey(key), value);
        return Promise.resolve();
      } catch (err) {
        // 配额写满是唯一需要用户介入的错误，单独识别出来
        var isQuota =
          err &&
          (err.name === 'QuotaExceededError' ||
            err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            err.code === 22 ||
            err.code === 1014);

        return Promise.reject({
          quota: !!isQuota,
          message: isQuota ? 'storage-full' : String((err && err.message) || err)
        });
      }
    },

    remove: function (key) {
      try {
        window.localStorage.removeItem(storageKey(key));
      } catch (err) {
        console.warn('[backend:local] 删除失败', key, err);
      }
      return Promise.resolve();
    },

    keys: function () {
      var out = [];
      try {
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          var logical = k ? logicalKey(k) : null;
          if (logical) out.push(logical);
        }
      } catch (err) {
        /* 读不到就当空 */
      }
      return Promise.resolve(out);
    }
  };

  function isAvailable() {
    try {
      window.localStorage.setItem(PREFIX + 'probe', '1');
      window.localStorage.removeItem(PREFIX + 'probe');
      return true;
    } catch (err) {
      return false;
    }
  }

  MM.providers = MM.providers || {};
  MM.providers.local = MM.providers.createLibrary({
    backend: backend,
    kind: 'local',
    labelKey: 'tierLocal',
    quotaBytes: 5 * 1024 * 1024,
    isAvailable: isAvailable
  });
})();
