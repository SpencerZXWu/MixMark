/**
 * MixMark · 桌面端胶水层
 * ===============================================================
 * 只有跑在 Electron 壳里时才生效（靠 window.mixmark 判断）。
 * 浏览器里这个文件整个是空转的 —— 所以它可以无条件被 index.html 引入，
 * 不需要构建期做条件装配（本项目运行期零构建，没有「打包时剔除」这种手段）。
 *
 * 它负责把「桌面端多出来的能力」接到应用既有的命令体系上：
 *   - 原生菜单点一下 → MM.commands.run(同一个 id)（菜单与工具栏不会有两套逻辑）
 *   - 连接文件夹 → 真的把文档库搬到磁盘上
 *   - 打开 .md / 导出到文件 → 走系统对话框
 *   - 换库之后重新加载文档树
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var bridge = null;

  function ready() {
    if (!bridge && window.mixmark && window.mixmark.native) bridge = window.mixmark;
    return bridge;
  }

  /** 把原生对话框返回的文件内容收进文档库 */
  function importFiles() {
    var b = ready();
    if (!b) return Promise.resolve();

    return b.files
      .open()
      .then(function (res) {
        if (!res || res.canceled || !res.files || !res.files.length) return null;

        // 串行建：并发 create 会同时改索引，后写的会盖掉前一条
        return res.files.reduce(function (chain, f) {
          return chain.then(function () {
            return MM.docs.create({
              content: f.text,
              title: f.name,
              autoTitle: false,
              folderId: null
            });
          });
        }, Promise.resolve()).then(function () {
          MM.toast.ok(MM.i18n.t('toastImportedFiles', { n: res.files.length }));
        });
      })
      .catch(function (err) {
        if (err && (/canceled/i.test(err.message || '') || err.name === 'AbortError')) return;
        MM.toast.danger(MM.i18n.t('desktopFailed', { msg: (err && err.message) || err }));
      });
  }

  /** 把当前文档导出到用户挑的路径（不改变文档在库里的位置） */
  function exportToFile() {
    var b = ready();
    if (!b) return Promise.resolve();

    var title = String(MM.docs.displayTitle() || '未命名').replace(/\.(md|markdown|txt)$/i, '');
    var name = (title || '未命名') + '.md';

    return b.files
      .saveAs(name, MM.docs.content())
      .then(function (res) {
        if (!res || res.canceled) return;
        MM.toast.ok(MM.i18n.t('toastExportedTo', { path: res.path }));
      })
      .catch(function (err) {
        MM.toast.danger(MM.i18n.t('desktopFailed', { msg: (err && err.message) || err }));
      });
  }

  /** 在文件管理器里定位当前文档 */
  function revealCurrent() {
    var b = ready();
    if (!b) return Promise.resolve();

    var id = MM.store.get().docId;
    if (!id) return Promise.resolve();

    return Promise.resolve(b.library.reveal(id)).then(function (done) {
      // 没落盘就说明白，不要静默无反应
      if (!done) MM.toast.show(MM.i18n.t('desktopNotOnDisk'));
    });
  }

  /** 重新扫描文件夹：把用户丢进去的文件收进来，把删掉的清出去 */
  function rescanFolder() {
    var b = ready();
    if (!b) return Promise.resolve();

    return Promise.resolve(b.library.rescan ? b.library.rescan() : null)
      .then(function (r) {
        if (!r) return null;
        return MM.docs.reload().then(function () {
          MM.toast.ok(MM.i18n.t('toastRescanned', { n: r.adopted }));
        });
      })
      .catch(function (err) {
        MM.toast.danger(MM.i18n.t('desktopFailed', { msg: (err && err.message) || err }));
      });
  }

  function registerCommands() {
    MM.commands.registerAll([
      { id: 'file.importFiles', titleKey: 'cmdImportFiles', group: 'file', run: importFiles },
      { id: 'file.exportToFile', titleKey: 'cmdExportToFile', group: 'file', run: exportToFile },
      { id: 'storage.revealDoc', titleKey: 'cmdRevealDoc', group: 'app', run: revealCurrent },
      { id: 'storage.rescanFolder', titleKey: 'cmdRescanFolder', group: 'app', run: rescanFolder },
      {
        id: 'home.show',
        titleKey: 'cmdShowHome',
        group: 'app',
        run: function () {
          if (MM.home && MM.home.show) MM.home.show();
        }
      },
      {
        id: 'desktop.openLibraryFolder',
        titleKey: 'cmdOpenLibraryFolder',
        group: 'app',
        run: function () {
          var b = ready();
          if (!b) return;
          Promise.resolve(b.library.openRoot()).then(function (done) {
            if (!done) MM.toast.show(MM.i18n.t('desktopNotConnected'));
          });
        }
      }
    ]);
  }

  /**
   * 菜单点击 → 命令。
   * 只转发，不自己实现：菜单里的「保存」和工具栏里的 Ctrl+S 必须是同一件事，
   * 否则迟早出现「菜单能用、快捷键失效」这种对不上的 bug。
   */
  function bindMenu() {
    var b = ready();
    if (!b) return;

    b.onCommand(function (id) {
      if (!id) return;
      try {
        MM.commands.run(id);
      } catch (err) {
        console.warn('[desktop] 菜单命令执行失败：' + id, err);
      }
    });
  }

  /** 换库了（重新选了文件夹）→ 整个文档树都得重来 */
  function bindLibraryChanged() {
    var b = ready();
    if (!b) return;

    b.onLibraryChanged(function () {
      MM.provider
        .use('electron')
        .then(function () {
          MM.store.set({ tier: 'electron' });
          return MM.docs.reload();
        })
        .then(function () {
          var st = MM.desktopBridge.status();
          MM.toast.ok(MM.i18n.t('toastFolderConnected', { name: st.name || '' }));
        })
        .catch(function (err) {
          console.error('[desktop] 换库后重新加载失败', err);
          MM.toast.danger(MM.i18n.t('desktopFailed', { msg: (err && err.message) || err }));
        });
    });
  }

  function init() {
    if (!ready()) return false;

    registerCommands();
    bindMenu();
    bindLibraryChanged();

    // 让设置页与状态栏知道「这台机器能做到什么」
    MM.store.set({ desktop: true });

    console.info('[desktop] 桌面端已启用；文档库=' + (MM.desktopBridge.status().path || '（未连接）'));
    return true;
  }

  MM.desktop = {
    init: init,
    available: function () {
      return !!ready();
    }
  };
})();
