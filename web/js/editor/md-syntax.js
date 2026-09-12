/**
 * MixMark · Markdown 语法高亮
 * ===============================================================
 * 用 HighlightStyle 把 Lezer 的语法标签映射到 CSS 类，
 * 具体颜色交给 editor.css 里的 CSS 变量 —— 这样明暗主题切换
 * 不需要重建编辑器，只换变量即可。
 *
 * 不使用 CM 内联主题的原因：主题切换时重建 HighlightStyle 会产生
 * 新的样式表，反复切换会累积；交给 CSS 变量最干净。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  function build() {
    if (!window.CM) {
      console.error('[md-syntax] window.CM 不存在，检查 vendor/codemirror.bundle.js 是否加载');
      return null;
    }

    var CM = window.CM;
    var t = CM.tags;

    var style = CM.HighlightStyle.define([
      { tag: t.heading1, class: 'mm-syn-heading' },
      { tag: t.heading2, class: 'mm-syn-heading' },
      { tag: t.heading3, class: 'mm-syn-heading' },
      { tag: t.heading4, class: 'mm-syn-heading' },
      { tag: t.heading5, class: 'mm-syn-heading' },
      { tag: t.heading6, class: 'mm-syn-heading' },

      { tag: t.strong, class: 'mm-syn-strong' },
      { tag: t.emphasis, class: 'mm-syn-em' },
      { tag: t.strikethrough, class: 'mm-syn-strike' },

      { tag: t.link, class: 'mm-syn-link' },
      { tag: t.url, class: 'mm-syn-url' },
      { tag: t.labelName, class: 'mm-syn-link' },

      { tag: t.monospace, class: 'mm-syn-code' },
      { tag: t.quote, class: 'mm-syn-quote' },

      /* 这里**刻意不给 t.list 上色**。
         Lezer 的 t.list 落在整个 ListItem 上（连正文一起），
         而 mm-syn-marker 是给「-, #, ** 这类记号」用的浅灰（约 2:1）——
         拿它涂整条列表项，结果是列表正文一片灰白，看不清。
         记号本身由下面的 processingInstruction 负责，那才是它该管的东西。
         （用户报的「- 后面的文字颜色太浅看不清」就是这一条。） */
      { tag: t.processingInstruction, class: 'mm-syn-marker' },
      { tag: t.contentSeparator, class: 'mm-syn-hr' },
      { tag: t.escape, class: 'mm-syn-math' }
    ]);

    return style;
  }

  MM.mdSyntax = {
    build: build,
    /** 由 cm-setup 在创建编辑器前调用一次 */
    style: null
  };
})();
