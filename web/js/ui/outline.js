/**
 * MixMark · 大纲面板
 * ===============================================================
 * 显示标题结构，点击跳转，并跟随光标高亮当前所在章节。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var listEl = null;
  var currentOutline = [];
  var activeLine = 1;

  function init(el) {
    listEl = el;

    // 事件委托：大纲节点会被整体重建，逐个绑定监听器不划算
    listEl.addEventListener('click', function (e) {
      var item = e.target.closest('.outline__item');
      if (!item) return;
      var line = parseInt(item.getAttribute('data-line'), 10);
      if (isNaN(line)) return;
      MM.editor.gotoLine(line);
    });
  }

  function render(outline) {
    if (!listEl) return;

    currentOutline = outline || [];
    listEl.innerHTML = '';

    if (!currentOutline.length) {
      var empty = document.createElement('li');
      empty.className = 'panel-empty';
      empty.textContent = MM.i18n.t('emptyOutline');
      listEl.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();

    currentOutline.forEach(function (h) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'outline__item';
      btn.setAttribute('data-level', h.level);
      btn.setAttribute('data-line', h.line);
      btn.textContent = h.text || '—';
      btn.title = h.text || '';
      li.appendChild(btn);
      frag.appendChild(li);
    });

    listEl.appendChild(frag);
    setActive(activeLine);
  }

  /** 高亮光标所在章节：最后一个起始行 <= 当前行的标题 */
  function setActive(line) {
    activeLine = line;

    if (!listEl || !currentOutline.length) return;

    var idx = -1;
    for (var i = 0; i < currentOutline.length; i++) {
      if (currentOutline[i].line <= line) idx = i;
      else break;
    }

    var nodes = listEl.querySelectorAll('.outline__item');
    for (var j = 0; j < nodes.length; j++) {
      var on = j === idx;
      nodes[j].classList.toggle('is-active', on);
      if (on) nodes[j].scrollIntoView({ block: 'nearest' });
    }
  }

  MM.outline = {
    init: init,
    render: render,
    setActive: setActive
  };
})();
