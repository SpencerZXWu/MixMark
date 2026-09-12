/**
 * MixMark · 状态栏
 * ===============================================================
 * 只呈现三类信息：保存状态、文档统计、存储位置。
 * 刻意不放模式切换、语言切换等操作 —— 状态栏是「读数」不是「按钮堆」。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var els = {};
  var initialized = false;

  function renderSave() {
    var s = MM.store.get();

    var text;
    var cls = '';

    if (s.saving) {
      text = MM.i18n.t('statusSaving');
    } else if (s.dirty) {
      text = MM.i18n.t('statusUnsaved');
      cls = 'is-warn';
    } else {
      text = MM.i18n.t('statusSaved');
      cls = 'is-ok';
    }

    els.save.textContent = text;
    els.save.className = 'statusbar__item statusbar__item--clickable ' + cls;
  }

  function renderStats() {
    var s = MM.store.get();
    var parts = [
      MM.i18n.t('statusWords', { n: formatNumber(s.stats.words) }),
      MM.i18n.t('statusChars', { n: formatNumber(s.stats.chars) })
    ];
    els.stats.textContent = parts.join(' · ');
  }

  function renderCursor() {
    els.cursor.textContent = MM.i18n.t('statusLines', { n: MM.store.get().cursorLine });
  }

  function renderTier() {
    els.tier.textContent = MM.i18n.t('statusTier', { tier: MM.provider.tierLabel() });
  }

  /** 千分位：12345 → 12,345 */
  function formatNumber(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function init() {
    if (initialized) return;
    initialized = true;

    els.save = document.getElementById('status-save');
    els.stats = document.getElementById('status-stats');
    els.cursor = document.getElementById('status-cursor');
    els.tier = document.getElementById('status-tier');

    // 点击保存状态 = 立即保存，符合「哪里显示状态，哪里就能操作」的直觉
    els.save.addEventListener('click', function () {
      MM.commands.run('file.save');
    });
    els.save.title = MM.i18n.t('cmdSaveNow');

    MM.store.watch(['saving', 'dirty'], renderSave);
    MM.store.watch('stats', renderStats);
    MM.store.watch('cursorLine', renderCursor);
    MM.store.watch('tier', renderTier);

    renderSave();
    renderStats();
    renderCursor();
    renderTier();

    // 语言切换后整条状态栏都要重刷
    MM.settings.onChange(function (s, changed) {
      if (changed.indexOf('locale') === -1) return;
      renderSave();
      renderStats();
      renderCursor();
      renderTier();
    });
  }

  MM.statusbar = {
    init: init
  };
})();
