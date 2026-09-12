/**
 * MixMark · 存储层选路
 * ===============================================================
 * 业务代码只认 provider 接口，永远不感知自己跑在浏览器、桌面还是手机上。
 *
 * 选择顺序（第一个真正可用的胜出）：
 *   1. electron   桌面端 —— 主进程 fs，能力最完整        （M4）
 *   2. capacitor  安卓端 —— Capacitor Filesystem          （M4）
 *   3. fsa        浏览器 —— 真实文件夹（File System Access）  ← 用户主动连接过才有
 *   4. idb        浏览器 —— IndexedDB 文档库              ← http(s) 下的默认
 *   5. local      localStorage 文档库                    ← file:// 下的仅剩选择
 *
 * 关键点：可用 ≠ 能用。FSA 的 API 一直都在，但只有「用户选过目录且权限还在」
 * 才算真的可用；所以候选者可以先 prepare()（异步准备），再被问 isAvailable()。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var current = null;

  var ORDER = ['electron', 'capacitor', 'fsa', 'idb', 'local'];

  function candidates() {
    var registry = MM.providers || {};
    var list = [];
    ORDER.forEach(function (kind) {
      if (registry[kind]) list.push(registry[kind]);
    });
    return list;
  }

  /** 当前运行环境，用于诊断与设置页展示 */
  function detectEnvironment() {
    if (window.mixmark && window.mixmark.native) return 'electron';
    if (
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    ) {
      return 'capacitor';
    }
    if (location.protocol === 'file:') return 'file';
    if (/^https?:$/.test(location.protocol)) return 'http';
    return 'unknown';
  }

  /**
   * 依次「准备 → 探测」候选者，选出第一个可用的并初始化。
   * 全都不可用时抛错 —— 宁可明确失败，也不要让用户以为「保存成功」。
   */
  function init() {
    var env = detectEnvironment();
    var list = candidates();
    var tried = [];

    function next(i) {
      if (i >= list.length) {
        return Promise.reject(
          new Error(
            '没有任何可用的存储实现（环境：' + env + '，探测：' + (tried.join(' ') || '无') + '）'
          )
        );
      }

      var p = list[i];
      var prep = typeof p.prepare === 'function' ? p.prepare() : Promise.resolve();

      return prep
        .catch(function (err) {
          console.warn('[provider] prepare 失败：' + p.kind, err);
        })
        .then(function () {
          var ok = false;
          try {
            ok = !!p.isAvailable();
          } catch (err) {
            ok = false;
          }

          tried.push(p.kind + (ok ? '✔' : '✘'));
          if (!ok) return next(i + 1);

          current = p;
          console.info('[provider] 环境=' + env + '  选用=' + p.kind + '  探测=' + tried.join(' '));

          return p.init().then(function () {
            return p;
          });
        });
    }

    return next(0);
  }

  function get() {
    if (!current) throw new Error('[provider] 尚未初始化，请先调用 MM.provider.init()');
    return current;
  }

  function getKind() {
    return current ? current.kind : 'unknown';
  }

  /** 把 provider 的能力映射成给用户看的存储层级名称 */
  function tierLabel() {
    if (!current) return MM.i18n.t('tierLocal');
    return MM.i18n.t(current.labelKey || 'tierLocal');
  }

  /**
   * 列出用户可主动切换到的其它存储（设置页用）。
   * 正在使用的那个也会列出来，方便界面把「当前」标出来。
   */
  function availableKinds() {
    return candidates().map(function (p) {
      return {
        kind: p.kind,
        labelKey: p.labelKey,
        label: MM.i18n.t(p.labelKey || 'tierLocal'),
        supported: typeof p.supported === 'function' ? p.supported() : true,
        isCurrent: p === current
      };
    });
  }

  /**
   * 运行时切换存储。
   * 只负责换 current，**不搬运数据** —— 迁移由设置页显式触发，
   * 免得用户在不知情的情况下把文档留在旧存储里。
   */
  function use(kind) {
    var registry = MM.providers || {};
    var p = registry[kind];
    if (!p) return Promise.reject(new Error('unknown-provider:' + kind));

    var prep = typeof p.prepare === 'function' ? p.prepare() : Promise.resolve();

    return prep.then(function () {
      if (!p.isAvailable()) return Promise.reject(new Error('unavailable:' + kind));
      return p.init().then(function () {
        current = p;
        return p;
      });
    });
  }

  /** 供测试与调试：查看当前选中的 provider */
  function peek() {
    return current;
  }

  MM.provider = {
    init: init,
    get: get,
    getKind: getKind,
    tierLabel: tierLabel,
    detectEnvironment: detectEnvironment,
    availableKinds: availableKinds,
    use: use,
    peek: peek
  };
})();
