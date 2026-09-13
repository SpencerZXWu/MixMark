/**
 * MixMark · 图表面板（反向修改的可视化部分）
 * ===============================================================
 * 点预览里的图表 → 从右侧滑出一块面板，把图表拆成可点选的**元素**与**连线**，
 * 用表单改，不写代码。
 *
 * 面板的定位刻意放在预览容器**外面**（挂在 .workspace 上）——
 * 预览区在反向修改模式下会被整体序列化回源码，面板要是住在里面，
 * 它自己就会被当成文档内容写进去。
 *
 * 改一处就立刻写回源码 + 重新渲染，所以「面板 ↔ 画布」始终一致。
 * 唯一不即时重建面板的场合是文本框输入（那会丢焦点）。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var el = null;
  var bodyEl = null;
  var titleEl = null;
  var typeEl = null;

  /** 当前编辑的对象 */
  var ctx = null; // { block, model, selected }

  /**
   * 文本输入的防抖句柄。
   *
   * 每敲一个字符就写源码 + 重渲染整片预览，视觉上就是一直闪；而且 mermaid
   * 是异步的，重渲染期间图表会短暂退回原始代码块。所以文本框一律攒一下再提。
   * 下拉框 / 增删这类「点一下就是一下」的操作不走防抖，立即生效。
   */
  var commitTimer = null;
  var COMMIT_DEBOUNCE = 420;

  /** 面板在分栏模式下挪到编辑区下半用，这几个是重新量位置的钩子 */
  var repositionObserver = null;
  /** 类型选择弹层 */
  var picker = null;

  var TYPE_LABEL = {
    classDiagram: 'diagramTypeClass',
    flowchart: 'diagramTypeFlow',
    graph: 'diagramTypeFlow',
    sequenceDiagram: 'diagramTypeSequence',
    'stateDiagram-v2': 'diagramTypeState',
    erDiagram: 'diagramTypeEr'
  };

  function t(k, v) {
    return MM.i18n.t(k, v);
  }

  /* ------------------------------------------------------------------
     小工具
     ------------------------------------------------------------------ */

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function textInput(value, onInput, placeholder) {
    var i = document.createElement('input');
    i.type = 'text';
    i.className = 'dg-input';
    i.value = value === undefined || value === null ? '' : value;
    if (placeholder) i.placeholder = placeholder;
    i.addEventListener('input', function () {
      onInput(i.value);
    });
    return i;
  }

  function textArea(value, onInput, rows) {
    var a = document.createElement('textarea');
    a.className = 'dg-input dg-input--area';
    a.rows = rows || 3;
    a.value = value || '';
    a.spellcheck = false;
    a.addEventListener('input', function () {
      onInput(a.value);
    });
    return a;
  }

  function select(options, value, onChange) {
    var s = document.createElement('select');
    s.className = 'dg-input';
    options.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      s.appendChild(op);
    });
    s.value = value;
    s.addEventListener('change', function () {
      onChange(s.value);
    });
    return s;
  }

  function iconButton(label, titleKey, onClick, extraClass) {
    var b = node('button', 'dg-btn' + (extraClass ? ' ' + extraClass : ''), label);
    b.type = 'button';
    b.title = t(titleKey);
    b.addEventListener('click', function (e) {
      e.preventDefault();
      onClick();
    });
    return b;
  }

  function field(labelKey, control) {
    var row = node('label', 'dg-field');
    row.appendChild(node('span', 'dg-field__label', t(labelKey)));
    row.appendChild(control);
    return row;
  }

  /* ------------------------------------------------------------------
     写回源码
     ------------------------------------------------------------------ */

  /** 预览里一次重渲染就够了：立刻看到改动的效果，面板自己不用重画 */
  function commit(opts) {
    // 排队中的文本提交先落地，否则紧接着的结构改动会被它覆盖回去
    if (commitTimer) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
    if (!ctx) return;

    var source = MM.diagram.serialize(ctx.model);
    var text = '```mermaid\n' + source + '\n```';

    var from = parseInt(ctx.block.getAttribute('data-line'), 10);
    var to = parseInt(ctx.block.getAttribute('data-line-end'), 10);
    if (!isFinite(from) || !isFinite(to)) return;
    if (to < from) to = from;

    // 末尾空行不属于这一块，留给块之间的间隔
    while (to > from && MM.editor.lineText(to).trim() === '') to--;

    MM.editor.replaceLines(from, to, text);

    var delta = text.split('\n').length - (to - from + 1);

    // 强制重渲染：图表必须跟着变，按住不重建是给打字用的
    MM.liveEdit.flush();
    MM.preview.renderNow(MM.docs.content(), true);

    // 重渲染之后 DOM 换了一批，重新认领我们正在编辑的那个块
    relink(delta);

    if (opts && opts.rebuild) renderPanel();
  }

  /** 文本框专用：攒一小段时间再提交，避免边敲边闪 */
  function commitTyping() {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(function () {
      commitTimer = null;
      commit();
    }, COMMIT_DEBOUNCE);
  }

  /**
   * 重渲染之后 .mm-block 是新的元素，面板里的引用就失效了。
   * 按图表序号重新认领（第几个图表就对应第几个块）。
   */
  function relink() {
    if (!ctx) return;

    var blocks = document.querySelectorAll('#preview .mm-block');
    var seen = -1;
    var want = ctx.index === undefined ? 0 : ctx.index;

    for (var i = 0; i < blocks.length; i++) {
      if (!isDiagramBlock(blocks[i])) continue;
      seen++;
      if (seen === want) {
        ctx.block = blocks[i];
        return;
      }
    }
  }

  /* ------------------------------------------------------------------
     面板渲染
     ------------------------------------------------------------------ */

  function renderPanel() {
    if (!ctx) return;

    var model = ctx.model;

    titleEl.textContent = t('diagramPanelTitle');
    var typeKey = TYPE_LABEL[model.type] || null;
    typeEl.textContent = typeKey ? t(typeKey) : model.type || t('diagramTypeUnknown');

    bodyEl.innerHTML = '';

    if (!model.structured) {
      var warn = node('p', 'dg-hint');
      warn.textContent = t('diagramUnsupported', { type: model.type || '?' });
      bodyEl.appendChild(warn);
    }

    bodyEl.appendChild(sectionLayout(model));
    bodyEl.appendChild(sectionElements(model));

    if (model.type !== 'sequenceDiagram') {
      bodyEl.appendChild(sectionEdges(model));
    }

    bodyEl.appendChild(sectionRaw(model));
  }

  /* ---- 布局 ---- */

  function sectionLayout(model) {
    var sec = node('section', 'dg-section');
    sec.appendChild(node('h4', 'dg-section__title', t('diagramLayout')));

    if (model.type === 'flowchart' || model.type === 'stateDiagram-v2') {
      var dirs = [
        { value: 'TD', label: t('diagramDirTD') },
        { value: 'LR', label: t('diagramDirLR') },
        { value: 'BT', label: t('diagramDirBT') },
        { value: 'RL', label: t('diagramDirRL') }
      ];
      var current = detectDirection(model);
      sec.appendChild(
        field(
          'diagramDirection',
          select(dirs, current, function (v) {
            model.direction = v;
            commit({ rebuild: false });
          })
        )
      );
      var hint = node('p', 'dg-hint');
      hint.textContent = t('diagramLayoutHint');
      sec.appendChild(hint);
    } else {
      var info = node('p', 'dg-hint');
      info.textContent = t('diagramLayoutAuto');
      sec.appendChild(info);
    }

    return sec;
  }

  function detectDirection(model) {
    if (model.direction) return model.direction;
    var m = /\s(TD|TB|LR|BT|RL)\s*$/i.exec(model.header || '');
    return m ? m[1].toUpperCase() : 'TD';
  }

  /* ---- 元素 ---- */

  function isElement(item) {
    return (
      item.kind === MM.diagram.KIND.CLASS ||
      item.kind === MM.diagram.KIND.PARTICIPANT ||
      item.kind === MM.diagram.KIND.ENTITY
    );
  }

  function sectionElements(model) {
    var sec = node('section', 'dg-section');

    var head = node('div', 'dg-section__head');
    head.appendChild(node('h4', 'dg-section__title', t('diagramElements')));
    head.appendChild(
      iconButton('+', 'diagramAddElement', function () {
        addElement(model);
      }, 'dg-btn--ghost')
    );
    sec.appendChild(head);

    var list = node('div', 'dg-list');
    var any = false;

    model.items.forEach(function (item, index) {
      if (!isElement(item)) return;
      any = true;
      list.appendChild(elementRow(model, item, index));
    });

    if (!any) {
      var empty = node('p', 'dg-hint');
      empty.textContent = t('diagramNoElements');
      list.appendChild(empty);
    }

    sec.appendChild(list);
    return sec;
  }

  function elementRow(model, item, index) {
    var box = node('div', 'dg-item');
    var selfName = item.name || item.id;

    var top = node('div', 'dg-item__top');
    top.appendChild(
      textInput(selfName, function (v) {
        renameElement(model, item, v);
      })
    );    top.appendChild(
      iconButton('×', 'diagramDelete', function () {
        removeElement(model, item);
      }, 'dg-btn--danger')
    );
    box.appendChild(top);

    // 流程图：形状 + 文字
    if (item.kind === MM.diagram.KIND.CLASS && item.shape !== undefined) {
      var shapes = MM.diagram.SHAPES.map(function (s) {
        return { value: s.id, label: t('diagramShape_' + s.id) };
      });
      box.appendChild(
        field(
          'diagramShape',
          select(shapes, item.shape || 'rect', function (v) {
            item.shape = v;
            commit();
          })
        )
      );
      box.appendChild(
        field(
          'diagramText',
          textInput(item.label, function (v) {
            item.label = v;
            commitTyping();
          })
        )
      );
    }

    // 类图：注解 + 成员
    if (model.type === 'classDiagram' && item.kind === MM.diagram.KIND.CLASS) {
      box.appendChild(
        field(
          'diagramAnnotation',
          textInput(item.annotation, function (v) {
            item.annotation = v;
            commitTyping();
          }, 'Interface')
        )
      );
      box.appendChild(
        field(
          'diagramMembers',
          textArea((item.members || []).join('\n'), function (v) {
            item.members = v.split('\n').filter(function (l) {
              return l.trim() !== '';
            });
            commitTyping();
          }, 4)
        )
      );
    }

    // 时序图参与者：别名 + 类型
    if (item.kind === MM.diagram.KIND.PARTICIPANT) {
      box.appendChild(
        field(
          'diagramAlias',
          textInput(item.label, function (v) {
            item.label = v;
            commitTyping();
          })
        )
      );
    }

    // ER 实体：属性
    if (item.kind === MM.diagram.KIND.ENTITY) {
      box.appendChild(
        field(
          'diagramAttrs',
          textArea((item.attrs || []).join('\n'), function (v) {
            item.attrs = v.split('\n').filter(function (l) {
              return l.trim() !== '';
            });
            commitTyping();
          }, 4)
        )
      );
    }

    box.setAttribute('data-index', String(index));
    return box;
  }

  function renameElement(model, item, next) {
    var old = item.name || item.id;
    if (!next || next === old) return;

    if (item.kind === MM.diagram.KIND.PARTICIPANT) item.id = next;
    else item.name = next;

    // 连线两端跟着改，否则图上会凭空多出一根指向空气的线
    model.items.forEach(function (it) {
      if (it.kind !== MM.diagram.KIND.EDGE && it.kind !== MM.diagram.KIND.MESSAGE) return;
      if (it.from === old) it.from = next;
      if (it.to === old) it.to = next;
      if (it.fromNode) it.fromNode.id = it.from === next ? next : it.fromNode.id;
      if (it.toNode) it.toNode.id = it.to === next ? next : it.toNode.id;
    });

    commitTyping();
  }

  function removeElement(model, item) {
    model.items = model.items.filter(function (it) {
      if (it === item) return false;
      // 连同这条元素身上的连线一起删，不然源码里会留下悬空的线
      if (it.kind === MM.diagram.KIND.EDGE || it.kind === MM.diagram.KIND.MESSAGE) {
        return it.from !== (item.name || item.id) && it.to !== (item.name || item.id);
      }
      return true;
    });
    commit({ rebuild: true });
  }

  function addElement(model) {
    var n = 1;
    var names = MM.diagram.elementNames(model);
    var name;
    do {
      name = 'New' + n++;
    } while (names.indexOf(name) !== -1);

    MM.diagram.addClass(model, name);
    commit({ rebuild: true });
  }

  /* ---- 连线 ---- */

  function sectionEdges(model) {
    var seq = model.type === 'sequenceDiagram';
    var sec = node('section', 'dg-section');

    var head = node('div', 'dg-section__head');
    head.appendChild(node('h4', 'dg-section__title', seq ? t('diagramMessages') : t('diagramEdges')));
    head.appendChild(
      iconButton('+', seq ? 'diagramAddMessage' : 'diagramAddEdge', function () {
        addEdge(model);
      }, 'dg-btn--ghost')
    );
    sec.appendChild(head);

    var list = node('div', 'dg-list');
    var any = false;

    model.items.forEach(function (item) {
      if (item.kind !== MM.diagram.KIND.EDGE && item.kind !== MM.diagram.KIND.MESSAGE) return;
      any = true;
      list.appendChild(seq ? messageRow(model, item) : edgeRow(model, item));
    });

    if (!any) {
      var empty = node('p', 'dg-hint');
      empty.textContent = seq ? t('diagramNoMessages') : t('diagramNoEdges');
      list.appendChild(empty);
    }

    sec.appendChild(list);
    return sec;
  }

  function endpointOptions(model, value) {
    var names = MM.diagram.elementNames(model);
    var opts = names.map(function (n) {
      return { value: n, label: n };
    });
    if (value && names.indexOf(value) === -1) opts.unshift({ value: value, label: value });
    if (!opts.length) opts.push({ value: value || '', label: value || t('diagramPickElement') });
    return opts;
  }

  function edgeRow(model, item) {
    var box = node('div', 'dg-item dg-item--edge');

    var line = node('div', 'dg-item__top');
    line.appendChild(
      select(endpointOptions(model, item.from), item.from, function (v) {
        item.from = v;
        if (item.fromNode) item.fromNode.id = v;
        commit();
      })
    );

    if (model.type === 'erDiagram') {
      line.appendChild(
        select(
          [
            { value: '||', label: '||' },
            { value: '}o', label: '}o' },
            { value: 'o{', label: 'o{' },
            { value: '|{', label: '|{' },
            { value: 'o|', label: 'o|' }
          ],
          item.fromCard || '||',
          function (v) {
            item.fromCard = v;
            commit();
          }
        )
      );
      line.appendChild(
        select(
          [
            { value: '||', label: '||' },
            { value: 'o{', label: 'o{' },
            { value: '|{', label: '|{' },
            { value: 'o|', label: 'o|' },
            { value: '}o', label: '}o' }
          ],
          item.toCard || '||',
          function (v) {
            item.toCard = v;
            commit();
          }
        )
      );
    } else {
      var arrows = MM.diagram.edgeArrows(model).map(function (a) {
        return { value: a, label: arrowLabel(a) };
      });
      line.appendChild(
        select(arrows, item.arrow || '-->', function (v) {
          item.arrow = v;
          commit();
        })
      );
    }

    line.appendChild(
      select(endpointOptions(model, item.to), item.to, function (v) {
        item.to = v;
        if (item.toNode) item.toNode.id = v;
        commit();
      })
    );

    line.appendChild(
      iconButton('×', 'diagramDelete', function () {
        removeEdge(model, item);
      }, 'dg-btn--danger')
    );

    box.appendChild(line);

    box.appendChild(
      field(
        'diagramLabel',
        textInput(item.label, function (v) {
          item.label = v;
          commitTyping();
        })
      )
    );

    // ER 的连线样式由两端的基数符号决定，没有单独的箭头 / 线型可选。
    // 其它图表**不另外给「线型」下拉框** —— 线型就写在箭头里
    // （`..>` 虚线、`-.->` 虚线、`==>` 粗线），两个控件表达同一件事
    // 必然打架，而按一套规则去改另一种图表的箭头就会生成不合法写法。
    if (model.type !== 'erDiagram') {
      // 端点带形状的（流程图），允许顺带改形状 —— 否则新加的连线
      // 会在源码里生出一个没有形状的裸节点
      if (item.fromNode) box.appendChild(shapeRow(item.fromNode));
      if (item.toNode) box.appendChild(shapeRow(item.toNode));
    }

    return box;
  }

  /** `-.->` 这种没人看得懂，标上它是虚线 */
  function arrowLabel(a) {
    var hint = MM.diagram.arrowHint(a);
    if (hint === 'dashed') return a + ' · ' + t('diagramStyleDashed');
    if (hint === 'thick') return a + ' · ' + t('diagramStyleThick');
    return a;
  }

  function shapeRow(target) {
    var shapes = MM.diagram.SHAPES.map(function (s) {
      return { value: s.id, label: t('diagramShape_' + s.id) };
    });
    return field(
      'diagramShapeFor',
      select(shapes, target.shape || 'rect', function (v) {
        target.shape = v;
        commit();
      })
    );
  }

  function messageRow(model, item) {
    var box = node('div', 'dg-item dg-item--edge');

    var line = node('div', 'dg-item__top');
    line.appendChild(
      select(endpointOptions(model, item.from), item.from, function (v) {
        item.from = v;
        commit();
      })
    );
    line.appendChild(
      select(
        MM.diagram.edgeArrows(model).map(function (a) {
          return { value: a, label: a };
        }),
        item.arrow || '->>',
        function (v) {
          item.arrow = v;
          commit();
        }
      )
    );
    line.appendChild(
      select(endpointOptions(model, item.to), item.to, function (v) {
        item.to = v;
        commit();
      })
    );
    line.appendChild(
      iconButton('×', 'diagramDelete', function () {
        removeEdge(model, item);
      }, 'dg-btn--danger')
    );
    box.appendChild(line);

    box.appendChild(
      field(
        'diagramText',
        textInput(item.text, function (v) {
          item.text = v;
          commitTyping();
        })
      )
    );

    return box;
  }

  function removeEdge(model, item) {
    model.items = model.items.filter(function (it) {
      return it !== item;
    });
    commit({ rebuild: true });
  }

  function addEdge(model) {
    var names = MM.diagram.elementNames(model);
    if (names.length < 2) {
      MM.toast.show(t('diagramNeedTwoElements'));
      return;
    }

    if (model.type === 'sequenceDiagram') {
      model.items.push({ kind: MM.diagram.KIND.MESSAGE, from: names[0], to: names[1], arrow: '->>', text: '' });
    } else if (model.type === 'erDiagram') {
      model.items.push({ kind: MM.diagram.KIND.EDGE, from: names[0], to: names[1], fromCard: '||', toCard: 'o{', label: '', style: 'solid' });
    } else {
      MM.diagram.addEdge(model, { from: names[0], to: names[1] });
    }
    commit({ rebuild: true });
  }

  /* ---- 注释与原始行 ---- */

  function sectionRaw(model) {
    var rest = model.items.filter(function (it) {
      return (
        it.kind === MM.diagram.KIND.NOTE ||
        it.kind === MM.diagram.KIND.DIRECTIVE ||
        it.kind === MM.diagram.KIND.SUBGRAPH_START ||
        it.kind === MM.diagram.KIND.SUBGRAPH_END ||
        it.kind === MM.diagram.KIND.RAW
      );
    });

    var sec = node('section', 'dg-section');
    sec.appendChild(node('h4', 'dg-section__title', t('diagramOther')));

    if (!rest.length) {
      var empty = node('p', 'dg-hint');
      empty.textContent = t('diagramNoOther');
      sec.appendChild(empty);
      return sec;
    }

    var list = node('div', 'dg-list');

    rest.forEach(function (item) {
      var box = node('div', 'dg-item');

      if (item.kind === MM.diagram.KIND.NOTE) {
        var head = node('div', 'dg-item__top');
        head.appendChild(
          textInput(item.target, function (v) {
            item.target = v;
            commitTyping();
          }, t('diagramNoteTarget'))
        );
        head.appendChild(
          iconButton('×', 'diagramDelete', function () {
            model.items = model.items.filter(function (it) {
              return it !== item;
            });
            commit({ rebuild: true });
          }, 'dg-btn--danger')
        );
        box.appendChild(head);
        box.appendChild(
          field(
            'diagramNoteText',
            textArea(item.text, function (v) {
              item.text = v;
              commitTyping();
            }, 2)
          )
        );
      } else {
        // 指令行（style / classDef / subgraph / loop …）和认不出的行：
        // 原样给一个输入框，别扭但绝不丢东西
        box.appendChild(
          textInput(MM.diagram.serialize({ header: '', items: [item] }).replace(/^\n+/, ''), function (v) {
            item.raw = v;
            item.kind = MM.diagram.KIND.RAW;
            commitTyping();
          })
        );
      }

      list.appendChild(box);
    });

    sec.appendChild(list);
    return sec;
  }

  /* ------------------------------------------------------------------
     开关
     ------------------------------------------------------------------ */

  function ensureBuilt() {
    if (el) return;

    el = node('aside', 'dg-panel');
    el.hidden = true;
    el.setAttribute('data-mm-ui', '1');

    var head = node('header', 'dg-panel__head');
    titleEl = node('span', 'dg-panel__title', t('diagramPanelTitle'));
    typeEl = node('span', 'dg-panel__type', '');
    head.appendChild(titleEl);
    head.appendChild(typeEl);

    var close = node('button', 'dg-panel__close', '×');
    close.type = 'button';
    close.title = t('diagramClose');
    close.addEventListener('click', function () {
      closePanel();
    });
    head.appendChild(close);

    el.appendChild(head);

    bodyEl = node('div', 'dg-panel__body');
    el.appendChild(bodyEl);

    document.body.appendChild(el);
  }

  function openPanel() {
    ensureBuilt();
    el.hidden = false;
    document.body.classList.add('dg-open');
    positionPanel();
    watchLayout();
  }

  function closePanel() {
    if (el) el.hidden = true;
    document.body.classList.remove('dg-open');
    if (commitTimer) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
    ctx = null;
  }

  /**
   * 面板放哪儿。
   *
   * 分栏模式下预览只占右半边，而面板默认固定贴在窗口右边 —— 正好压在
   * 图表上，一边改一边看不见改的是什么。所以那种情况把它挪到**编辑区
   * 下半部**：上半留源码、下半改图表，两者都在眼前。
   *
   * 纯预览模式整屏都是预览，没有「编辑区」可言，就维持原来的贴右。
   */
  function positionPanel() {
    if (!el || el.hidden) return;

    var s = el.style;
    var pane = document.querySelector('.pane--edit');
    var split = MM.store.get().mode === 'split' && pane;

    if (split) {
      var r = pane.getBoundingClientRect();
      if (r.width < 200) {
        // 编辑区被折得太窄（窗口很小），贴右反而更好用
        el.classList.remove('dg-panel--bottom');
        s.left = s.width = s.top = s.height = '';
        s.right = s.bottom = '0';
        return;
      }
      el.classList.add('dg-panel--bottom');
      s.left = r.left + 'px';
      s.width = r.width + 'px';
      s.top = r.top + r.height / 2 + 'px';
      s.height = r.height / 2 + 'px';
      s.right = 'auto';
      s.bottom = 'auto';
      return;
    }

    el.classList.remove('dg-panel--bottom');
    s.left = s.width = s.top = s.height = '';
    s.right = '0';
    s.bottom = '0';
  }

  /** 分栏分隔条被拖动 / 窗口改大小 / 切模式，都要重新量一遍 */
  function watchLayout() {
    var pane = document.querySelector('.pane--edit');
    if (pane && window.ResizeObserver && !repositionObserver) {
      repositionObserver = new ResizeObserver(positionPanel);
      repositionObserver.observe(pane);
    }
  }

  function isOpen() {
    return !!el && !el.hidden;
  }

  /* ------------------------------------------------------------------
     打开入口
     ------------------------------------------------------------------ */

  /**
   * 这个块里是不是图表。
   *
   * **两个判据都要认**：mermaid 是异步渲染的，刚重渲染完那会儿 DOM 里还只有
   * `pre > code.language-mermaid`，`.mm-mermaid` 得等一会儿才出现。
   * 只认后者的话，重渲染之后这个函数一律返回 false —— 面板就会继续抱着
   * 已经脱离文档的旧块，行号全是过期的，下一次编辑改到别的行上去。
   */
  function isDiagramBlock(el) {
    if (!el) return false;
    return !!el.querySelector('.mm-mermaid, pre > code.language-mermaid');
  }

  function diagramIn(block) {
    return block ? block.querySelector('.mm-mermaid') : null;
  }

  /** 记下这是第几个图表，重渲染后靠它找回自己的块 */
  function indexOfDiagram(block) {
    var blocks = document.querySelectorAll('#preview .mm-block');
    var seen = -1;
    for (var i = 0; i < blocks.length; i++) {
      if (!isDiagramBlock(blocks[i])) continue;
      seen++;
      if (blocks[i] === block) return seen;
    }
    return 0;
  }

  function open(source, block) {
    var model = MM.diagram.parse(source);
    ctx = {
      block: block,
      model: model,
      index: indexOfDiagram(block)
    };
    openPanel();
    renderPanel();
  }

  /** 从画布上的点击进入 */
  function openFor(diagramEl, target) {
    var block = diagramEl.closest ? diagramEl.closest('.mm-block') : null;
    if (!block) return;

    var from = parseInt(block.getAttribute('data-line'), 10);
    var to = parseInt(block.getAttribute('data-line-end'), 10);
    if (!isFinite(from) || !isFinite(to)) return;

    var lines = [];
    for (var n = from; n <= to; n++) lines.push(MM.editor.lineText(n));

    var source = lines.join('\n');
    var m = /```mermaid\s*\n([\s\S]*?)```/.exec(source);
    if (!m) return;

    open(m[1].replace(/\n$/, ''), block);

    // 点到图里的某个元素就顺手在面板里把它标出来
    if (target) markSelected(target);
  }

  /**
   * 工具条 / 预览功能栏上的「图表」按钮。
   *
   * 光标本来就落在某个图表上 → 直接开它的面板；
   * 否则 → 弹种类选择（那里同时给出「编辑现有图表」和五种新建）。
   *
   * 刻意不「找一个最近的图表就打开」：用户点的是「图表」，多半是想**新增**
   * 一个，自作主张把他领到一张已有图上会很迷惑。
   */
  function openNearest(block, anchor) {
    var here = block ? diagramIn(block) : null;
    if (here) {
      openFor(here, null);
      return;
    }

    var existing = document.querySelector('#preview .mm-mermaid');
    pickType(anchor, existing);
  }

  /**
   * 选图表种类。
   *
   * existing 不为空时，第一项是「编辑当前图表」—— 那时候用户也可能只是
   * 想接着改上一张。
   */
  function pickType(anchor, existing) {
    closePicker();

    var pop = node('div', 'dg-pick');
    pop.setAttribute('data-mm-ui', '1');

    if (existing) {
      pop.appendChild(
        pickItem('diagramEditCurrent', '✎', function () {
          closePicker();
          openFor(existing, null);
        })
      );
      pop.appendChild(node('div', 'dg-pick__sep'));
    }

    var titleKey = {
      classDiagram: 'diagramTypeClass',
      flowchart: 'diagramTypeFlow',
      sequenceDiagram: 'diagramTypeSequence',
      stateDiagram: 'diagramTypeState',
      erDiagram: 'diagramTypeEr'
    };

    MM.diagram.NEW_TYPES.forEach(function (kind) {
      pop.appendChild(
        pickItem(titleKey[kind], '◇', function () {
          closePicker();
          insertNew(kind);
        })
      );
    });

    document.body.appendChild(pop);
    picker = pop;

    // 贴在锚点下沿；没有锚点就摆在预览区中间偏上
    var r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    var left = r ? r.left : window.innerWidth / 2 - 90;
    var top = r ? r.bottom + 6 : 120;

    var w = pop.offsetWidth || 180;
    var h = pop.offsetHeight || 200;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r ? r.top - h - 6 : window.innerHeight - h - 8);

    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function pickItem(titleKey, glyph, run) {
    var b = node('button', 'dg-pick__item');
    b.type = 'button';
    b.appendChild(node('span', 'dg-pick__glyph', glyph));
    b.appendChild(node('span', 'dg-pick__label', t(titleKey)));
    b.addEventListener('click', run);
    return b;
  }

  function closePicker() {
    if (picker && picker.parentNode) picker.parentNode.removeChild(picker);
    picker = null;
  }

  /** 插一张指定类型的空图，并立刻把面板打开在它上面 */
  function insertNew(kind) {
    // 先把反向修改那边攒着的改动落地、并解除挂起 ——
    // 不然新插进来的图表会被「按住不重建」卡住，压根看不见
    MM.liveEdit.flush();
    MM.preview.setHold(false);

    var before = document.querySelectorAll('#preview .mm-mermaid').length;
    MM.editor.insertBlock('```mermaid\n' + MM.diagram.template(kind) + '\n```');

    // 图表是异步渲染的（mermaid 还得先按需加载），盯着图表数量变多就开面板。
    // 固定等一个时长要么白等、要么在大文档上等不够。
    var tries = 0;
    (function waitForIt() {
      tries++;
      var now = document.querySelectorAll('#preview .mm-mermaid');
      if (now.length > before) {
        openFor(now[now.length - 1], null);
        return;
      }
      if (tries < 40) setTimeout(waitForIt, 100);
    })();
  }

  /** 点画布上的节点 → 在面板里高亮对应的那一项 */
  function markSelected(node) {
    if (!ctx || !bodyEl) return;

    var text = (node.textContent || '').trim().split('\n')[0].trim();
    if (!text) return;

    var names = MM.diagram.elementNames(ctx.model);
    var hit = names.filter(function (n) {
      return n === text || text.indexOf(n) !== -1;
    })[0];
    if (!hit) return;

    var items = bodyEl.querySelectorAll('.dg-item');
    for (var i = 0; i < items.length; i++) {
      var input = items[i].querySelector('input');
      if (input && input.value === hit) {
        items[i].classList.add('dg-item--active');
        items[i].scrollIntoView({ block: 'nearest' });
        break;
      }
    }
  }

  MM.diagramPanel = {
    open: open,
    openFor: openFor,
    openNearest: openNearest,
    insertNew: insertNew,
    pickType: pickType,
    closePicker: closePicker,
    close: closePanel,
    isOpen: isOpen,
    /** 供测试用 */
    _ctx: function () {
      return ctx;
    },
    _position: positionPanel
  };

  // 切模式（分栏 ↔ 纯预览）之后面板的去处不一样，跟着重放一次。
  // 只监听一次：这个 IIFE 只跑一遍。
  if (MM.store && MM.store.watch) {
    MM.store.watch('mode', function () {
      positionPanel();
      closePicker();
    });
  }
  window.addEventListener('resize', function () {
    positionPanel();
    closePicker();
  });
  // 点别处收起选种弹层。capture 是为了先于面板自己的点击处理
  document.addEventListener('pointerdown', function (e) {
    if (!picker) return;
    if (picker.contains(e.target)) return;
    closePicker();
  }, true);
})();
