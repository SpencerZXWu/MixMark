/**
 * MixMark · 打印 / 导出 PDF
 * ===============================================================
 * 刻意不引 jsPDF 之类的库：
 *   ① 中文排版在 jsPDF 里需要额外嵌入中文字体（动辄 10MB+），效果还差
 *   ② 浏览器自带的打印引擎排版质量最好，且原生支持分页、页边距、
 *      「另存为 PDF」
 *   ③ 用户按 Ctrl+P 也是同样的结果，不需要我们做任何事
 *
 * 我们唯一要做的是把 print 样式写对（见 preview.css 的 @media print）：
 * 隐藏应用外壳，只输出预览内容，并避免标题与代码块被分页切断。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  MM.commands.registerAll([
    {
      id: 'export.print',
      titleKey: 'cmdPrint',
      group: 'export',
      // 不绑 Ctrl+P：浏览器原生打印已经能打出正确结果，
      // 我们抢过来反而会丢掉浏览器提供的预览与页面设置界面
      run: function () {
        var content = MM.docs.content();

        // 预览区为空时数据是空的，打印出来会是一张白纸 —— 先补渲染
        var container = document.getElementById('preview');
        if (container && !container.querySelector('.mm-block') && content.trim()) {
          MM.preview.renderNow(content);
        }

        // 等一帧，确保样式与字体已就位再唤起打印
        requestAnimationFrame(function () {
          window.print();
        });
      }
    }
  ]);
})();
