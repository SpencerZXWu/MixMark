/**
 * MixMark · 行号索引
 * ===============================================================
 * 维护「预览区块元素 ↔ 源码行号」的映射，供同步滚动使用。
 *
 * 为什么不用百分比同步：
 *   两个区域的行高完全不同 —— 源码里 10 行的代码块，预览里可能只占 3 行；
 *   反过来一个长公式在源码里 1 行，预览里能占 2 行。按比例滚动必然漂移，
 *   而且是越滚越偏。按块对齐 + 块内线性插值，才能做到长期不漂。
 *
 * 依赖：preview.css 里 .preview-scroll 必须 position: relative，
 *       否则 .mm-block 的 offsetTop 不是相对滚动容器的，坐标会全错。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /**
   * 扫描容器，建立块索引。
   * 渲染管线保证 .mm-block 在 DOM 中按 data-line 升序排列，因此数组天然有序。
   */
  function build(container) {
    if (!container) return [];

    var els = container.querySelectorAll('.mm-block[data-line]');
    var blocks = [];

    for (var i = 0; i < els.length; i++) {
      var line = parseInt(els[i].getAttribute('data-line'), 10);
      if (isNaN(line)) continue;
      blocks.push({
        line: line,
        el: els[i],
        top: 0,
        height: 0
      });
    }

    return blocks;
  }

  /**
   * 测量每个块的几何位置。
   * 全部读操作集中在一个循环里，不夹带写操作，避免布局抖动（layout thrashing）。
   */
  function measure(blocks) {
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].top = blocks[i].el.offsetTop;
      blocks[i].height = blocks[i].el.offsetHeight;
    }
    return blocks;
  }

  function buildAndMeasure(container) {
    return measure(build(container));
  }

  /**
   * 二分查找：返回最后一个 line <= target 的块下标。
   * 找不到（目标行在所有块之前）时返回 0。
   */
  function findByLine(blocks, target) {
    if (!blocks.length) return -1;

    var lo = 0;
    var hi = blocks.length - 1;
    var ans = 0;

    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (blocks[mid].line <= target) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return ans;
  }

  /**
   * 二分查找：返回最后一个 top <= targetTop 的块下标。
   * 用于「预览区滚到哪儿了 → 对应源码哪一行」。
   */
  function findByTop(blocks, targetTop) {
    if (!blocks.length) return -1;

    var lo = 0;
    var hi = blocks.length - 1;
    var ans = 0;

    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (blocks[mid].top <= targetTop) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return ans;
  }

  /**
   * 给定源码行号，算出它应落在预览区的哪个纵向位置。
   * 块内按行数线性插值，块间自然衔接。
   */
  function offsetForLine(blocks, line) {
    if (!blocks.length) return 0;

    var i = findByLine(blocks, line);
    var b = blocks[i];
    var next = blocks[i + 1];

    var spanStart = b.line;
    var spanEnd = next ? next.line : b.line + 1;
    var span = spanEnd - spanStart;

    var progress = span > 0 ? (line - spanStart) / span : 0;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;

    var startTop = b.top;
    var endTop = next ? next.top : b.top + b.height;

    return startTop + progress * (endTop - startTop);
  }

  MM.lineMap = {
    build: build,
    measure: measure,
    buildAndMeasure: buildAndMeasure,
    findByLine: findByLine,
    findByTop: findByTop,
    offsetForLine: offsetForLine
  };
})();
