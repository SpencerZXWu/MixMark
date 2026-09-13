/**
 * MixMark · 拖图入正文
 * ===============================================================
 * 把图片（或任意文件）从资源管理器拖进编辑器，正文里就多一句
 * ![文件名](文件名)，预览时靠句柄换 blob URL 显示出来。
 *
 * 为什么正文里写的是**文件名**而不是路径：浏览器拿不到文件的系统路径
 * （FileSystemFileHandle 只暴露 name，绝对路径是隐私设计）。
 * 所以「认领」这一步由 MM.disk.assets 记在 IndexedDB 里，
 * 正文只保留一个名字。细节见 provider/diskfile.js 末尾。
 *
 * 两件事都放在这里：
 *   1. 拖放 → 认领句柄 + 插入引用
 *   2. 预览渲染完之后，把裸文件名的 img[src] 换成 blob URL
 * 两者是一根链条的两端，分开放反而难找。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var bound = false;

  /* ------------------------------------------------------------------
     拖放
     ------------------------------------------------------------------ */

  /** 这次拖的是文件吗？拖选中的文字也走 drag 事件，不能一概 preventDefault */
  function hasFiles(e) {
    var dt = e.dataTransfer;
    if (!dt) return false;
    if (dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1) return true;
    return !!(dt.files && dt.files.length);
  }

  function insertImage(name) {
    var view = MM.editor.raw();
    if (!view) return;

    var sel = view.state.selection.main;
    var md = '![' + name + '](' + name + ')';

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: md },
      selection: { anchor: sel.from + md.length }
    });
    view.focus();
  }

  function onDrop(e) {
    if (!hasFiles(e)) return; // 拖文字进来交给编辑器自己处理

    e.preventDefault();
    e.stopPropagation();

    var items = e.dataTransfer.items;
    var pending = [];

    // getAsFileSystemHandle() 必须在 drop 处理器还没返回时调用 ——
    // 一旦让出事件循环，items 就失效了。所以这里先同步收齐 Promise，
    // 再去 await。文件选择器那边是同样的道理。
    if (items && items.length) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind !== 'file') continue;
        if (typeof items[i].getAsFileSystemHandle !== 'function') continue;
        pending.push(items[i].getAsFileSystemHandle());
      }
    }

    if (!pending.length) {
      MM.toast.danger(MM.i18n.t('dropNeedHandle'));
      return;
    }

    Promise.all(pending).then(function (handles) {
      var files = handles.filter(function (h) {
        return h && h.kind === 'file';
      });

      if (!files.length) {
        MM.toast.danger(MM.i18n.t('dropNeedHandle'));
        return;
      }

      // 一个一个来：adopt 是异步写库的，串行才能保证插入顺序与拖入顺序一致
      var chain = Promise.resolve();
      files.forEach(function (handle) {
        chain = chain
          .then(function () {
            return MM.disk.assets.adopt(handle);
          })
          .then(function (name) {
            if (name) insertImage(name);
          });
      });

      return chain.then(function () {
        MM.toast.ok(MM.i18n.t('toastDropAdded', { n: files.length }));
      });
    });
  }

  function bindDrop() {
    if (bound) return;
    bound = true;

    // 绑在工作区而不是编辑器上：拖到工具栏或预览区也能接住，
    // 用户不会精确瞄准编辑区
    var host = document.querySelector('.workspace') || document.querySelector('.pane--edit');
    if (!host) return;

    host.addEventListener('dragover', function (e) {
      // 只有拖文件才接管；否则页面里的文字拖选会被搅乱
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    host.addEventListener('drop', onDrop);
  }

  /* ------------------------------------------------------------------
     预览：把裸文件名的图片换成 blob URL
     ------------------------------------------------------------------ */

  /**
   * 只处理「裸文件名」：`照片.png` 这种既没有协议也没有路径分隔符的 src。
   * file:// 全路径、相对路径、data: 一律不碰 —— 那些本来就由浏览器直接解析。
   */
  function resolvePreviewImages() {
    var imgs = document.querySelectorAll('#preview img[src]');

    // 用 forEach 而不是 for：下面的 then 是异步的，
    // 用 var 声明循环变量的话，所有回调拿到的都是最后一个元素
    Array.prototype.forEach.call(imgs, function (img) {
      if (img.dataset.assetResolved) return;

      var src = img.getAttribute('src');
      if (!src) return;
      if (src.indexOf(':') !== -1 || src.indexOf('/') !== -1 || src.indexOf('\\') !== -1) return;

      if (!MM.disk.assets.has(src)) {
        // 没登记过：画个占位框，别让图片静默消失
        img.classList.add('is-missing');
        img.title = MM.i18n.t('imgMissing', { name: src });
        return;
      }

      img.dataset.assetResolved = '1';
      // 把原始写法记下来：反向修改回写时要用它。blob: URL 只在这一会话有效，
      // 写进文档就成了一个永远打不开的地址。
      if (!img.dataset.mdSrc) img.dataset.mdSrc = src;
      MM.disk.assets.resolve(src).then(function (url) {
        if (url) {
          // 解析成功要把占位框摘掉 —— 早先那轮渲染可能已经给它加上了
          // （先渲染、后拖入的顺序很常见）
          img.classList.remove('is-missing');
          img.removeAttribute('title');
          img.src = url;
        } else {
          img.classList.add('is-missing');
          img.title = MM.i18n.t('imgMissing', { name: src });
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------ */

  function init() {
    bindDrop();

    // 每次预览重画都要重跑一遍：预览 DOM 是整体换掉的，
    // 上一轮换好的 blob URL 这一轮又变回文件名了
    MM.bus.on('preview:rendered', resolvePreviewImages);

    // 新拖进来的图要立刻显示，不用等下一次渲染
    MM.bus.on('asset:changed', resolvePreviewImages);

    return true;
  }

  MM.dropAssets = {
    init: init,
    resolvePreviewImages: resolvePreviewImages
  };
})();
