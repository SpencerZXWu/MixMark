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

  /**
   * 右边显示**当前仓库**，而不是抽象的「存储层级」——
   * 用户认得出的是「我在 D:\笔记 里」，不是「我用的是桌面端后端」。
   * 地址放 title 里，点一下弹仓库列表，顺手就能换。
   */
  function renderRepo() {
    if (!els.repo) return;

    var repo = MM.repos ? MM.repos.current() : null;
    if (!repo) {
      // 仓库层还没就绪（启动早期）：退回显示存储层级，总比空着强
      els.repo.textContent = MM.provider.tierLabel();
      return;
    }

    els.repo.textContent = MM.repos.labelOf(repo);
    els.repo.title = MM.repos.pathOf(repo);
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
    els.repo = document.getElementById('status-repo');

    // 点击保存状态 = 立即保存，符合「哪里显示状态，哪里就能操作」的直觉
    els.save.addEventListener('click', function () {
      MM.commands.run('file.save');
    });
    els.save.title = MM.i18n.t('cmdSaveNow');

    if (els.repo) {
      els.repo.addEventListener('click', function () {
        MM.repoMenu.toggle(els.repo);
      });
    }

    MM.store.watch(['saving', 'dirty'], renderSave);
    MM.store.watch('stats', renderStats);
    MM.store.watch('cursorLine', renderCursor);
    MM.store.watch('tier', renderRepo);
    MM.store.watch('repo', renderRepo);

    // 切仓库 / 改名 / 移除都要重画（这时 store 里的值可能还没变）
    MM.bus.on('repo:changed', renderRepo);
    MM.bus.on('repo:list', renderRepo);

    renderSave();
    renderStats();
    renderCursor();
    renderRepo();

    // 语言切换后整条状态栏都要重刷
    MM.settings.onChange(function (s, changed) {
      if (changed.indexOf('locale') === -1) return;
      renderSave();
      renderStats();
      renderCursor();
      renderRepo();
    });
  }

  MM.statusbar = {
    init: init
  };
})();
