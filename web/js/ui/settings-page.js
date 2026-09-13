/**
 * MixMark · 设置页
 * ===============================================================
 * 所有改动即时生效并立即持久化，没有「确定 / 取消」——
 * 设置项都是可逆的显示偏好，多一步确认只会增加摩擦。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var handle = null;

  /* 主题 / 强调色 / 字体三份清单都取自 settings.js ——
     那边是唯一来源，这边只管画，不再各存一份（曾经抄过一次，漏改过）。 */

  /* ------------------------------------------------------------------
     小构件
     ------------------------------------------------------------------ */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function group(titleKey) {
    var g = el('div', 'settings__group');
    g.appendChild(el('div', 'settings__group-title', MM.i18n.t(titleKey)));
    return g;
  }

  function row(labelKey, hintKey) {
    var r = el('div', 'settings__row');

    var left = el('div');
    left.appendChild(el('span', 'settings__row-label', MM.i18n.t(labelKey)));
    if (hintKey) left.appendChild(el('span', 'settings__row-hint', MM.i18n.t(hintKey)));

    var control = el('div', 'settings__control');

    r.appendChild(left);
    r.appendChild(control);
    return { row: r, control: control };
  }

  function select(options, value, onChange) {
    var s = el('select');
    options.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener('change', function () {
      onChange(s.value);
    });
    return s;
  }

  function checkbox(checked, onChange) {
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', function () {
      onChange(input.checked);
    });
    return input;
  }

  function range(min, max, step, value, onChange) {
    var wrap = el('span');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';

    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    var out = el('span', 'settings__row-hint', String(value));
    out.style.minWidth = '34px';
    out.style.textAlign = 'right';
    out.style.marginTop = '0';

    input.addEventListener('input', function () {
      out.textContent = input.value;
      onChange(Number(input.value));
    });

    wrap.appendChild(input);
    wrap.appendChild(out);
    return wrap;
  }

  function themeLabel(id) {
    return MM.i18n.t(
      {
        light: 'themeLight',
        sepia: 'themeSepia',
        mist: 'themeMist',
        dark: 'themeDark',
        night: 'themeNight',
        navy: 'themeNavy'
      }[id] || 'themeLight'
    );
  }

  /** 把 id 拼成 i18n 键：ink → accentInk、classic → fontClassic */
  function titleKey(prefix, id) {
    return prefix + id.charAt(0).toUpperCase() + id.slice(1);
  }

  /**
   * 主题缩略图。
   * 缩略图不存色值 —— 那块 .theme-card__pane 自带 data-theme / data-accent，
   * 它内部的 CSS 变量自然按那套配色解析（theme.css 的映射规则刻意没写
   * html 前缀，就是为了支持这种局部渲染）。所以这是真渲染，不是示意图。
   */
  function themeGrid(current, onPick) {
    var wrap = el('div', 'themes');

    MM.settings.THEMES.forEach(function (id) {
      var card = el('button', 'theme-card');
      card.type = 'button';
      card.title = themeLabel(id);
      card.setAttribute('aria-pressed', current === id ? 'true' : 'false');

      var pane = el('div', 'theme-card__pane');
      pane.setAttribute('data-theme', id);
      pane.setAttribute('data-accent', MM.settings.get('accent'));
      pane.appendChild(el('span', 'theme-card__line'));
      pane.appendChild(el('span', 'theme-card__line theme-card__line--sub'));
      pane.appendChild(el('span', 'theme-card__line theme-card__line--accent'));

      card.appendChild(pane);
      card.appendChild(el('span', 'theme-card__name', themeLabel(id)));
      card.addEventListener('click', function () {
        onPick(id, wrap);
      });
      wrap.appendChild(card);
    });

    return wrap;
  }

  /** 强调色变了，所有缩略图里的那一抹强调色也要跟着变 */
  function syncAccentPreview(id) {
    var panes = document.querySelectorAll('.theme-card__pane');
    for (var i = 0; i < panes.length; i++) panes[i].setAttribute('data-accent', id);
  }

  /** 一行「说明 + 一个按钮」的通用样子 */
  function actionRow(labelText, hintText, btnText, disabled, onClick) {
    var r = el('div', 'settings__row');

    var left = el('div');
    left.appendChild(el('span', 'settings__row-label', labelText));
    if (hintText) left.appendChild(el('span', 'settings__row-hint', hintText));

    var ctrl = el('div', 'settings__control');
    var btn = el('button', 'btn', btnText);
    btn.type = 'button';
    btn.disabled = !!disabled;
    btn.addEventListener('click', function () {
      onClick();
    });
    ctrl.appendChild(btn);

    r.appendChild(left);
    r.appendChild(ctrl);
    return r;
  }

  /**
   * 仓库一行：名字 + 地址，右边是操作。
   * 「当前」的那一行不给「切换」按钮 —— 点了也没意义，反而让人以为没生效。
   * 名字和地址都给出来：两个仓库都叫「笔记」时，只有地址能分开它们。
   */
  function repoRow(repo) {
    var r = el('div', 'settings__row');

    var left = el('div');
    left.appendChild(el('span', 'settings__row-label', repo.label));
    left.appendChild(
      el(
        'span',
        'settings__row-hint',
        repo.active ? repo.store + ' · ' + MM.i18n.t('repoCurrent') : repo.store
      )
    );

    var ctrl = el('div', 'settings__control');
    function act(text, fn) {
      var b = el('button', 'btn', text);
      b.type = 'button';
      b.addEventListener('click', fn);
      ctrl.appendChild(b);
    }

    if (!repo.active) {
      act(MM.i18n.t('setRepoOpen'), function () {
        if (handle) handle.close(null);
        setTimeout(function () {
          MM.reposOps.enter(repo);
        }, 0);
      });
    }

    // 本机文档库没有文件夹，也就没有「改名/移除」这回事
    if (repo.path) {
      act(MM.i18n.t('setRepoRename'), function () {
        MM.reposOps.rename(repo.id);
      });
      act(MM.i18n.t('setRepoRemove'), function () {
        MM.reposOps.remove(repo.id);
      });
    }

    r.appendChild(left);
    r.appendChild(ctrl);
    return r;
  }

  /** 执行一个存储相关命令，然后关掉设置页（底下的树会整棵换掉） */
  function runStorageCommand(id, arg) {
    if (handle) handle.close(null);
    setTimeout(function () {
      MM.commands.run(id, arg);
    }, 0);
  }

  /* ------------------------------------------------------------------
     构建
     ------------------------------------------------------------------ */

  function build() {
    var s = MM.settings.get();

    var box = el('div', 'settings');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    /* ---- 头部 ---- */
    var head = el('div', 'settings__head');
    head.appendChild(el('h2', null, MM.i18n.t('settingsTitle')));

    var closeBtn = el('button', 'icon-btn');
    closeBtn.type = 'button';
    closeBtn.title = MM.i18n.t('btnClose');
    closeBtn.setAttribute('aria-label', MM.i18n.t('btnClose'));
    closeBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
    closeBtn.addEventListener('click', function () {
      if (handle) handle.close(null);
    });
    head.appendChild(closeBtn);

    var body = el('div', 'settings__body');

    /* ---- 外观 ---- */
    var g1 = group('setAppearance');

    g1.appendChild(row('setTheme').row);
    g1.appendChild(
      themeGrid(s.theme, function (v, wrap) {
        MM.settings.set({ theme: v });
        var cards = wrap.querySelectorAll('.theme-card');
        for (var i = 0; i < cards.length; i++) {
          cards[i].setAttribute('aria-pressed', MM.settings.THEMES[i] === v ? 'true' : 'false');
        }
      })
    );

    g1.appendChild(row('setAccent').row);
    var swatches = el('div', 'swatches');
    MM.settings.ACCENTS.forEach(function (a) {
      var b = el('button', 'swatch');
      b.type = 'button';
      b.style.background = a.color;
      b.setAttribute('aria-pressed', s.accent === a.id ? 'true' : 'false');
      b.setAttribute('aria-label', MM.i18n.t(titleKey('accent', a.id)));
      b.title = MM.i18n.t(titleKey('accent', a.id));
      b.addEventListener('click', function () {
        MM.settings.set({ accent: a.id });
        swatches.querySelectorAll('.swatch').forEach(function (node, i) {
          node.setAttribute('aria-pressed', MM.settings.ACCENTS[i].id === a.id ? 'true' : 'false');
        });
        syncAccentPreview(a.id);
      });
      swatches.appendChild(b);
    });
    g1.appendChild(swatches);
    body.appendChild(g1);

    /* ---- 排版 ---- */
    var g2 = group('setTypography');

    var fontOptions = MM.settings.FONTS.map(function (id) {
      return { value: id, label: MM.i18n.t(titleKey('font', id)) };
    });

    var uiFontRow = row('setFontUi');
    uiFontRow.control.appendChild(
      select(fontOptions, s.uiFont, function (v) {
        MM.settings.set({ uiFont: v });
      })
    );
    g2.appendChild(uiFontRow.row);

    var textFontRow = row('setFontText');
    textFontRow.control.appendChild(
      select(fontOptions, s.textFont, function (v) {
        MM.settings.set({ textFont: v });
      })
    );
    g2.appendChild(textFontRow.row);

    var fontRow = row('setFontSize');
    fontRow.control.appendChild(
      range(12, 22, 1, s.fontSize, function (v) {
        MM.settings.set({ fontSize: v });
      })
    );
    g2.appendChild(fontRow.row);

    var measureRow = row('setLineWidth');
    measureRow.control.appendChild(
      range(50, 110, 2, s.measure, function (v) {
        MM.settings.set({ measure: v });
      })
    );
    g2.appendChild(measureRow.row);
    body.appendChild(g2);

    /* ---- 行为 ---- */
    var g3 = group('setBehavior');

    var autoRow = row('setAutoSave');
    autoRow.control.appendChild(
      checkbox(s.autoSave, function (v) {
        MM.settings.set({ autoSave: v });
      })
    );
    g3.appendChild(autoRow.row);

    var syncRow = row('setSyncScroll');
    syncRow.control.appendChild(
      checkbox(s.syncScroll, function (v) {
        MM.settings.set({ syncScroll: v });
        MM.scrollSync.setEnabled(v);
      })
    );
    g3.appendChild(syncRow.row);

    var lineRow = row('setLineNumbers');
    lineRow.control.appendChild(
      checkbox(s.lineNumbers, function (v) {
        MM.settings.set({ lineNumbers: v });
        MM.editor.reconfigure({ lineNumbers: v });
      })
    );
    g3.appendChild(lineRow.row);

    var breaksRow = row('setBreaks');
    breaksRow.control.appendChild(
      checkbox(s.breaks, function (v) {
        MM.settings.set({ breaks: v });
        MM.preview.renderNow(MM.docs.content());
      })
    );
    g3.appendChild(breaksRow.row);
    body.appendChild(g3);

    /* ---- 语言 ---- */
    var g4 = group('setLanguage');
    var langRow = row('setLanguage');
    langRow.control.appendChild(
      select(
        [
          { value: 'zh', label: MM.i18n.t('langZh') },
          { value: 'en', label: MM.i18n.t('langEn') }
        ],
        s.locale,
        function (v) {
          MM.settings.set({ locale: v });
          // 语言变了，整个设置页要按新语言重建
          if (handle) {
            var next = build();
            handle.overlay.replaceChild(next, handle.overlay.firstChild);
          }
        }
      )
    );
    g4.appendChild(langRow.row);
    body.appendChild(g4);

    /* ---- 仓库 ---- */
    var gRepo = group('setReposTitle');
    gRepo.appendChild(el('div', 'settings__row-hint', MM.i18n.t('setReposDesc')));

    MM.repos.list().forEach(function (repo) {
      gRepo.appendChild(repoRow(repo));
    });

    if (MM.desktopBridge && MM.desktopBridge.available()) {
      gRepo.appendChild(
        actionRow(MM.i18n.t('setRepoAdd'), null, MM.i18n.t('setRepoAdd'), false, function () {
          runStorageCommand('repo.create');
        })
      );
    }

    body.appendChild(gRepo);

    /* ---- 存储位置 ---- */
    var g5 = group('setStorage');

    var curRow = el('div', 'settings__row');
    var curLeft = el('div');
    curLeft.appendChild(el('span', 'settings__row-label', MM.provider.tierLabel()));
    curLeft.appendChild(el('span', 'settings__row-hint', MM.i18n.t('setStorageHint')));
    curRow.appendChild(curLeft);
    g5.appendChild(curRow);

    // 可切换到的其它存储
    MM.provider.availableKinds().forEach(function (k) {
      if (k.isCurrent) return;
      if (k.kind === 'fsa') return; // FSA 单独处理，它需要先选目录

      g5.appendChild(
        actionRow(k.label, null, MM.i18n.t('setSwitchTo', { name: k.label }), !k.supported, function () {
          runStorageCommand('storage.switch', k.kind);
        })
      );
    });

    // 本地文件夹（File System Access）
    var fsa = MM.providers && MM.providers.fsa;
    if (fsa && typeof fsa.supported === 'function' && fsa.supported()) {
      var st = fsa.status();

      if (!st.connected) {
        g5.appendChild(
          actionRow(MM.i18n.t('cmdPickFolder'), null, MM.i18n.t('cmdPickFolder'), false, function () {
            runStorageCommand('storage.pickFolder');
          })
        );
      } else if (st.permission !== 'granted') {
        g5.appendChild(
          actionRow(st.name, MM.i18n.t('folderNeedPermission'), MM.i18n.t('cmdReconnectFolder'), false, function () {
            runStorageCommand('storage.reconnectFolder');
          })
        );
      } else {
        g5.appendChild(
          actionRow(st.name, null, MM.i18n.t('cmdRefreshFolder'), false, function () {
            runStorageCommand('storage.refreshFolder');
          })
        );
        g5.appendChild(
          actionRow('', null, MM.i18n.t('cmdDisconnectFolder'), false, function () {
            runStorageCommand('storage.disconnectFolder');
          })
        );
      }
    } else {
      g5.appendChild(el('div', 'settings__row-hint', MM.i18n.t('fsaUnsupported')));
    }

    body.appendChild(g5);

    /* ---- 页脚：版本 ---- */
    var foot = el('div', 'settings__row');
    foot.style.paddingTop = '16px';
    foot.appendChild(
      el(
        'span',
        'settings__row-hint',
        MM.i18n.t('appName') +
          ' v' +
          (MM.VERSION || '0.1.0') +
          ' · ' +
          MM.i18n.t('statusTier', { tier: MM.provider.tierLabel() })
      )
    );
    body.appendChild(foot);

    box.appendChild(head);
    box.appendChild(body);
    return box;
  }

  /* ------------------------------------------------------------------
     对外
     ------------------------------------------------------------------ */

  function open() {
    if (handle) {
      handle.close(null);
      return;
    }

    handle = MM.dialogs.custom(build(), {
      position: 'center',
      onClose: function () {
        handle = null;
      }
    });
  }

  MM.settingsPage = {
    open: open,
    isOpen: function () {
      return !!handle;
    }
  };
})();
