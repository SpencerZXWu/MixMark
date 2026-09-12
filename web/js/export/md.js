/**
 * MixMark · Markdown 导出
 * ===============================================================
 * 提供两个动作：复制全文到剪贴板、下载 .md 文件。
 *
 * 为什么 v0.1 没有「导出独立 HTML」：
 *   完整的 HTML 导出需要把 KaTeX 的 20 个 woff2 字体内联成 base64
 *   （约 340KB），而 file:// 下 fetch 被禁用，无法在运行时读取字体文件
 *   再转 base64。正确做法是在构建期生成字体内联常量，
 *   这属于 M3 的工作，先不做半成品。
 *
 * 想要 PDF：直接用浏览器的 Ctrl+P —— preview.css 里已经写好打印样式，
 * 只输出预览内容，效果等同于导出 PDF。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 把标题变成安全的文件名（去掉 Windows 与 Unix 都不允许的字符） */
  function safeFileName(title) {
    var name = (title || 'untitled').trim();
    // 文档名本身可能已带后缀（新建时就写在名字里了），先剥掉再拼，
    // 否则会导出成「我的笔记.md.md」
    name = name.replace(/\.(md|markdown|mdown|txt)$/i, '');
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    name = name.replace(/\s+/g, ' ');
    return name.slice(0, 80) || 'untitled';
  }

  /** 复制文本。file:// 下 navigator.clipboard 可能不可用，需要兜底。 */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      // 放在视口外但可被选中，避免页面跳动
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';
      ta.style.opacity = '0';

      document.body.appendChild(ta);
      ta.select();

      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }

      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy-failed'));
    });
  }

  /** 触发浏览器下载 */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/markdown') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // 立即 revoke 在部分浏览器上会打断下载，延后一点更稳
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /* ------------------------------------------------------------------
     命令
     ------------------------------------------------------------------ */

  MM.commands.registerAll([
    {
      id: 'export.copy',
      titleKey: 'cmdCopyMarkdown',
      group: 'export',
      run: function () {
        var text = MM.docs.content();
        if (!text) {
          MM.toast.show(MM.i18n.t('toastNothingToCopy'));
          return;
        }
        return copyText(text).then(
          function () {
            MM.toast.ok(MM.i18n.t('toastCopied'));
          },
          function () {
            MM.toast.danger(MM.i18n.t('toastCopyFailed'));
          }
        );
      }
    },

    {
      id: 'export.md',
      titleKey: 'cmdExportMd',
      group: 'export',
      run: function () {
        var name = safeFileName(MM.docs.displayTitle()) + '.md';
        download(name, MM.docs.content(), 'text/markdown');
        MM.toast.ok(MM.i18n.t('toastExported', { name: name }));
      }
    }
  ]);

  /* ------------------------------------------------------------------
     给同目录的 export/html.js 复用（文件名清洗与下载）
     ------------------------------------------------------------------ */

  MM.exportUtil = {
    safeFileName: safeFileName,
    download: download
  };
})();
