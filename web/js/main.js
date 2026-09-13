/**
 * MixMark · 启动引导
 * ===============================================================
 * 唯一的入口。启动顺序是有讲究的，不能随意调换：
 *
 *   1. 设置     → 主题、语言、字号要在第一帧就正确，否则用户会看到闪烁
 *   2. 编辑器   → 依赖 CM6 与 settings（行号、自动换行）
 *   3. 预览挂载 → 需要一个容器元素
 *   4. 外壳     → 注册命令、生成工具栏与菜单栏、挂上 doc:opened 监听
 *   5. 侧栏/状态栏
 *   6. 文档启动 → 读取存储、打开文档，此时会派发 doc:opened
 *      （所以第 4 步必须已经完成，否则第一次打开文档没有任何反应）
 *   7. 磁盘直连 → 读回上次绑定的磁盘文件句柄
 *   8. 滚动同步 → 依赖编辑器与预览都已就绪
 *   9. 崩溃恢复检查
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  MM.VERSION = '0.6.2';

  /* ------------------------------------------------------------------
     致命错误：不能让用户对着一片空白猜发生了什么
     ------------------------------------------------------------------ */

  function fatal(message, err) {
    console.error('[main] 启动失败：' + message, err);

    var box = document.createElement('div');
    box.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:12px',
      'padding:32px',
      'text-align:center',
      'font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'background:#fff',
      'color:#1a1d21'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-size:16px;font-weight:700';
    title.textContent = 'MixMark 启动失败';

    var detail = document.createElement('div');
    detail.style.cssText = 'max-width:52ch;color:#565d69';
    detail.textContent = message;

    var hint = document.createElement('div');
    hint.style.cssText = 'max-width:52ch;color:#878e9a;font-size:12.5px';
    hint.textContent = '若反复出现，请打开浏览器开发者工具查看控制台错误详情。';

    box.appendChild(title);
    box.appendChild(detail);
    box.appendChild(hint);
    document.body.appendChild(box);
  }

  /* ------------------------------------------------------------------
     依赖自检
     ------------------------------------------------------------------ */

  function checkDependencies() {
    var missing = [];
    if (!window.CM) missing.push('CodeMirror (vendor/codemirror.bundle.js)');
    if (!window.marked) missing.push('marked (vendor/marked.js)');
    if (!window.DOMPurify) missing.push('DOMPurify (vendor/purify.js)');
    if (!window.katex) missing.push('KaTeX (vendor/katex/katex.min.js)');
    if (!window.hljs) missing.push('highlight.js (vendor/hljs.bundle.js)');
    return missing;
  }

  /* ------------------------------------------------------------------
     崩溃恢复
     ------------------------------------------------------------------ */

  function checkRecovery() {
    var content = MM.docs.content();
    var docId = MM.docs.currentId();

    if (!MM.recovery.shouldOffer(content, docId)) return;

    var snap = MM.recovery.peek();
    if (!snap) return;

    MM.dialogs
      .confirm({
        title: MM.i18n.t('recoveryTitle'),
        message: MM.i18n.t('recoveryMsg'),
        okText: MM.i18n.t('recoveryRestore'),
        cancelText: MM.i18n.t('recoveryDiscard')
      })
      .then(function (restore) {
        if (restore) {
          MM.editor.setContent(snap.content);
          MM.preview.renderNow(snap.content);
          MM.shell.updatePreviewEmpty(snap.content);
          // 走 setContent 而不是直接改内存：这样会被标记为未保存，
          // 自动保存随即接管，用户不必再手动 Ctrl+S
          MM.docs.setContent(snap.content);
          MM.toast.ok(MM.i18n.t('toastRestored'));
        } else {
          MM.recovery.clear();
          MM.toast.show(MM.i18n.t('toastDiscarded'));
        }
      });
  }

  /* ------------------------------------------------------------------
     离开页面时尽量保住内容
     ------------------------------------------------------------------ */

  function guardUnload() {
    window.addEventListener('beforeunload', function () {
      if (!MM.store.get().dirty) return;

      // localStorage 写入是同步的，在 beforeunload 里能真正跑完；
      // 自动保存的 Promise 则可能来不及兑现
      MM.docs.flushPending();
      MM.recovery.flush();
    });
  }

  /* ------------------------------------------------------------------
     启动
     ------------------------------------------------------------------ */

  function boot() {
    var missing = checkDependencies();
    if (missing.length) {
      fatal('以下依赖未能加载：\n' + missing.join('\n'), null);
      return;
    }

    // 1. 设置（必须在第一帧前生效）
    MM.settings.load();
    MM.settings.apply();

    // 2. 编辑器
    MM.editor.create(document.getElementById('editor-host'));

    // 3. 预览
    MM.preview.mount(document.getElementById('preview'));

    // 4. 外壳（注册命令 + 工具栏 + 菜单栏 + 查找条 + doc:opened 监听）
    MM.toast.init();
    MM.shell.init();
    MM.menubar.init();
    MM.findBar.init();
    MM.tabs.init();
    MM.dropAssets.init();
    MM.shell.applyInitialState();

    // 首页：只有第一次启动会停在这儿。刻意放在文档打开之前 ——
    // 否则工作区会先画出第一帧再被换掉，看着像闪了一下
    MM.home.init();

    // 5. 侧栏与状态栏
    MM.sidebar.init();
    MM.statusbar.init();
    MM.aiPanel.init();

    // 5.5 桌面端胶水层：注册「打开 .md / 导出到文件 / 扫描文件夹」这些
    //     只有装了壳才有的命令，并把原生菜单接到同一套命令上。
    //     浏览器里它自己会空转，不需要在这里判断环境
    MM.desktop.init();

    // 6. 仓库 → 文档
    //    先确认上次待的是哪个仓库，它决定用哪个存储后端：桌面端可以有多个
    //    文件夹仓库，光靠固定优先级选不出用户想要的那一个；文件夹仓库还得
    //    先让主进程连上它。startup() 返回建议的优先后端（没有就是 null）
    return MM.repos
      .init()
      .then(function () {
        return MM.reposOps.startup();
      })
      .then(function (preferred) {
        return MM.docs.boot(preferred);
      })
      .then(function () {
        // 6.5 磁盘直连：把上次绑定的文件句柄读回来。
        //     必须在文档打开之后 —— 界面要按当前 docId 判断该不该点亮磁盘标记
        return MM.disk.init();
      })
      .then(function () {
        // 7. 滚动同步（此时两侧都已有内容与尺寸）
        MM.shell.attachScrollSync();

        // 8. 崩溃恢复
        checkRecovery();

        MM.store.set({ ready: true });

        // 输入焦点直接给编辑器：打开就能打字，不需要先点一下
        MM.editor.focus();
      })
      .catch(function (err) {
        fatal('无法初始化存储或读取文档：' + ((err && err.message) || err), err);
      });
  }

  function start() {
    try {
      var result = boot();
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          fatal('启动过程中发生未预期的错误', err);
        });
      }
    } catch (err) {
      fatal('启动过程中发生未预期的错误：' + ((err && err.message) || err), err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  MM.guardUnload = guardUnload;
  guardUnload();
})();
