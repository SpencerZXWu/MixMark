/**
 * MixMark · 提示条
 * ===============================================================
 * 用法：
 *   MM.toast.show('已保存')
 *   MM.toast.ok('已保存')
 *   MM.toast.danger('保存失败')
 *   MM.bus.emit('toast', { level: 'ok', text: '...' })   // 跨模块解耦用法
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var host = null;
  var DEFAULT_DURATION = 2200;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    return host;
  }

  /**
   * @param {string} text
   * @param {object} [opts] { level: 'default'|'ok'|'danger', duration: ms }
   */
  function show(text, opts) {
    if (!text) return null;
    opts = opts || {};

    var el = document.createElement('div');
    el.className = 'toast' + (opts.level && opts.level !== 'default' ? ' toast--' + opts.level : '');
    el.setAttribute('role', 'status');
    el.textContent = text;

    var container = ensureHost();
    container.appendChild(el);

    var duration = opts.duration || DEFAULT_DURATION;

    // 最多同时显示 3 条，超出就挤掉最早的
    while (container.children.length > 3) {
      container.removeChild(container.firstChild);
    }

    var timer = setTimeout(dismiss, duration);

    function dismiss() {
      clearTimeout(timer);
      if (!el.parentNode) return;
      el.classList.add('is-leaving');
      // 等退场动画播完再摘除节点
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 200);
    }

    el.addEventListener('click', dismiss);
    return dismiss;
  }

  function ok(text) {
    return show(text, { level: 'ok' });
  }

  function danger(text) {
    return show(text, { level: 'danger', duration: 3600 });
  }

  /** 注册总线监听，让业务模块不必依赖 UI */
  function init() {
    MM.bus.on('toast', function (payload) {
      if (!payload) return;
      show(payload.text, { level: payload.level, duration: payload.duration });
    });
  }

  MM.toast = {
    init: init,
    show: show,
    ok: ok,
    danger: danger
  };
})();
