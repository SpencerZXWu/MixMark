/**
 * MixMark · 图表源码 ⇄ 结构模型
 * ===============================================================
 * 给「图表属性面板」用的中间层：把一段 mermaid 源码拆成可点选的元素和连线，
 * 面板改完再拼回源码。
 *
 * 核心取舍：**按行解析，认不出的行原样留着。**
 *
 * mermaid 的图表类型有十几种，语法还在长（每个大版本都会加）。想「完整支持
 * 全部语法」是追不上的。所以这里只把**结构**认出来 —— 类 / 节点 / 参与者 /
 * 状态 / 实体，以及它们之间的连线、注释、样式指令 —— 其余一律作为「原始行」
 * 保留在模型里，面板上也能直接编辑那一行。
 *
 * 这样做的结果：任何我们没解析的语法都不会被丢掉，用户也不会因为「面板不认」
 * 而被挡在外面。
 *
 * 支持的图表类型：classDiagram、flowchart / graph、sequenceDiagram、
 * stateDiagram-v2、erDiagram。其余类型走「只有原始行」的降级模型 ——
 * 至少能改，不会误报成空图。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /* ------------------------------------------------------------------
     通用
     ------------------------------------------------------------------ */

  var KIND = {
    CLASS: 'class',
    EDGE: 'edge',
    PARTICIPANT: 'participant',
    MESSAGE: 'message',
    NOTE: 'note',
    ENTITY: 'entity',
    DIRECTIVE: 'directive',
    SUBGRAPH_START: 'subgraphStart',
    SUBGRAPH_END: 'subgraphEnd',
    RAW: 'raw'
  };

  /**
   * 一律返回**小写**的类型名。
   *
   * 这里的返回值要拿去查 STRUCTURED 表，而表的键是小写的 —— 之前对状态图
   * 特例返回了 camelCase 的 'stateDiagram-v2'，查表必然落空，整个状态图
   * 就退化成「只有原始行」。类型名只在一个地方归一到 camelCase（见 parse 末尾）。
   */
  function detectType(header) {
    var h = String(header || '').trim().split(/\s+/)[0].toLowerCase();
    if (h === 'graph') return 'flowchart';
    return h;
  }

  /** 认得出结构的类型 */
  var STRUCTURED = {
    classdiagram: 'classDiagram',
    flowchart: 'flowchart',
    sequencediagram: 'sequenceDiagram',
    'statediagram-v2': 'stateDiagram-v2',
    erdiagram: 'erDiagram'
  };

  /* ------------------------------------------------------------------
     类图
     ------------------------------------------------------------------ */

  /** `+String title` / `+save()` 这类成员行 */
  function isMemberLine(text) {
    return /^\s*[+\-#~]/.test(text) || /^\s*[A-Za-z_][\w$]*\s*\(/.test(text);
  }

  function parseClassDiagram(header, rest) {
    var items = [];
    var current = null; // 正在读的 class 块
    var pendingNote = null;

    for (var i = 0; i < rest.length; i++) {
      var text = rest[i];
      var trimmed = text.trim();
      if (!trimmed) continue;

      if (current) {
        if (trimmed === '}') {
          items.push(current.item);
          current = null;
          continue;
        }
        // 类块里只有两种东西：注解和成员
        var ann = /^<<(.+)>>$/.exec(trimmed);
        if (ann) {
          current.item.annotation = ann[1].trim();
          continue;
        }
        if (trimmed !== '{') current.item.members.push(trimmed);
        continue;
      }

      // 关系：A <|-- B : label
      var edge = parseEdgeLine(text);
      if (edge) {
        items.push(edge);
        continue;
      }

      // `Note for X "..."` / `note "..."`（可能跨多行，最后以引号收尾）
      var noteOpen = /^\s*note\s+(?:for\s+([\w.]+)\s*)?["']?(.*)$/i.exec(trimmed);
      if (noteOpen) {
        pendingNote = {
          kind: KIND.NOTE,
          target: noteOpen[1] || '',
          text: noteOpen[2]
        };
        if (/["']$/.test(noteOpen[2]) || noteOpen[2] === '') {
          pendingNote.text = pendingNote.text.replace(/["']$/, '');
          items.push(pendingNote);
          pendingNote = null;
        }
        continue;
      }
      if (pendingNote) {
        pendingNote.text += '\n' + trimmed.replace(/["']$/, '');
        if (/["']$/.test(trimmed)) {
          items.push(pendingNote);
          pendingNote = null;
        }
        continue;
      }

      // `class Name {` / `class Name`
      var cls = /^\s*class\s+([\w.]+)\s*(\{)?\s*$/.exec(trimmed);
      if (cls) {
        var item = {
          kind: KIND.CLASS,
          name: cls[1],
          annotation: '',
          members: [],
          inline: ''
        };
        if (cls[2]) {
          current = { item: item };
        } else {
          items.push(item);
        }
        continue;
      }

      // `Name : +String title` —— 成员也可以写成类名后面跟冒号
      var colon = /^\s*([\w.]+)\s*:\s*(.+)$/.exec(trimmed);
      if (colon) {
        var host = findClass(items, colon[1]);
        if (host) {
          host.members.push(colon[2].trim());
          continue;
        }
      }

      // `<<Interface>> Name`
      var annOnly = /^\s*<<(.+)>>\s+([\w.]+)\s*$/.exec(trimmed);
      if (annOnly) {
        var target = findClass(items, annOnly[2]) || pushClass(items, annOnly[2]);
        target.annotation = annOnly[1].trim();
        continue;
      }

      // `direction LR`
      if (/^direction\s+/i.test(trimmed)) {
        items.push({ kind: KIND.DIRECTIVE, name: 'direction', value: trimmed.split(/\s+/)[1] });
        continue;
      }

      // 单起一行的类名（隐式声明）
      if (/^[\w.]+$/.test(trimmed)) {
        pushClass(items, trimmed);
        continue;
      }

      items.push({ kind: KIND.RAW, raw: text });
    }

    if (current) items.push(current.item);
    if (pendingNote) items.push(pendingNote);

    return { header: header, items: items };
  }

  function findClass(items, name) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === KIND.CLASS && items[i].name === name) return items[i];
    }
    return null;
  }

  function pushClass(items, name) {
    var item = { kind: KIND.CLASS, name: name, annotation: '', members: [], inline: '' };
    items.push(item);
    return item;
  }

  /* ------------------------------------------------------------------
     连线（类图 / 流程图 / 状态图共用一套写法）
     ------------------------------------------------------------------ */

  /**
   * 箭头操作符表，**长的排在前面**。
   *
   * 原先是拿一个正则去「找第一个类似箭头的东西」，碰到类图的 `<|--`（继承）
   * 就只认出了中间那个 `--`，把 `<|` 留在了左端点上 —— 左端点当场解析失败，
   * 整条继承关系就降到「原始行」里去了。
   *
   * 换成枚举已知写法：谁第一个出现在行里就用谁；位置相同时取更长的那个
   * （`-->` 不能被 `--` 抢先）。
   */
  var OPERATORS = [
    // ER 的基数写法（长，优先）
    '||--o{', '||--||', '||--|{', '}o--||', 'o|--||', '{o--||',
    // 时序图
    '<<-->>', '<<->>', '-->>', '->>', '--x', '-x', '<<-',
    // 类图
    '<|--', '<|..', '..|>', '*--', 'o--', '<-->', '<-.->',
    // 流程图 / 状态图
    '-.->', '==>', '-->', '--o', '<--', '---', '-.-', '===', '..>', '->', '--', '..', '-'
  ];

  function findArrow(body) {
    var best = null;

    for (var i = 0; i < OPERATORS.length; i++) {
      var op = OPERATORS[i];
      var at = body.indexOf(op);
      if (at <= 0) continue;

      var end = at + op.length;

      // 紧跟其后的 `|标签|` 是连线标签的一种写法，不能算进右端点
      var tail = /^\|([^|]*)\|/.exec(body.slice(end));
      var label = tail ? tail[1].trim() : '';
      var after = body.slice(end + (tail ? tail[0].length : 0));

      if (!after.trim()) continue;
      if (best && (at > best.start || (at === best.start && op.length <= best.op.length))) continue;

      best = { start: at, end: end + (tail ? tail[0].length : 0), op: op, label: label };
    }

    return best;
  }

  function styleOf(op) {
    if (/\./.test(op)) return 'dashed';
    if (/=/.test(op)) return 'thick';
    return 'solid';
  }

  /**
   * `A[文字]` → { id:'A', node:{...}, card:'' }
   * `A` → { id:'A', node:null }
   *
   * 元素名不能只用 \w：状态图里的状态名往往直接写中文（`待机 --> 运行`），
   * 而 \w 在 JS 里只管 ASCII，一个中文状态都解析不出来。
   * 改成「不是空白、也不是各种括号分隔符」就算名字。
   *
   * 类图的多重性写在两端的引号里（`Repository "1" --> "*" Document`），
   * 那对引号既不是节点定义也不是标签，得先摘下来。
   */
  function parseEndpoint(raw) {
    if (!raw) return null;

    var text = raw.trim();
    var card = '';

    var tail = /^(.*?)\s*"([^"]*)"\s*$/.exec(text);
    if (tail && tail[1].trim()) {
      text = tail[1].trim();
      card = tail[2];
    } else {
      var head = /^"([^"]*)"\s*(.+)$/.exec(text);
      if (head && head[2].trim()) {
        card = head[1];
        text = head[2].trim();
      }
    }

    if (/^\[\*\]$/.test(text)) return { id: '[*]', node: null, card: card };

    var m = /^([^\s[\]{}()<>|]+)\s*([\[\(\{>].*[\]\)\}]|>[^\]]*\])?$/.exec(text);
    if (!m) return null;

    var id = m[1];
    var def = m[2];
    if (!def) return { id: id, node: null, card: card };

    var shape = shapeOf(def);
    var labelText = def.replace(/^[[({>]+/, '').replace(/[\]})]+$/, '').trim();

    return {
      id: id,
      card: card,
      node: { id: id, label: labelText, shape: shape }
    };
  }

  /** 标签冒号：跳过 `A::member` 和 URL 里的冒号 */
  function findLabelColon(body) {
    for (var i = 0; i < body.length; i++) {
      if (body.charAt(i) !== ':') continue;
      if (body.charAt(i + 1) === ':') {
        i++;
        continue;
      }
      return i;
    }
    return -1;
  }

  /**
   * 拆一行连线：`A[文字] <|-- B{判断} : 标签`
   *
   * 难点在于两端都可能是「带形状的节点定义」或「裸 id」。所以先把端点
   * 连同它后面的形状括号一起切下来，再分别解析。
   */
  function parseEdgeLine(text) {
    var trimmed = text.trim();
    if (!trimmed) return null;
    // 明显不是连线的（指令、注释、子图）先挡掉，免得下面误判
    if (/^(style|classDef|class|click|linkStyle|direction|subgraph|end|title|section|note|participant|actor|loop|alt|else|opt|par|rect|critical|break)\b/i.test(trimmed)) {
      return null;
    }

    var body = trimmed;
    var label = '';

    // 末尾的 `: 标签`（类图、状态图）或 `: text`（时序图）
    var colonAt = findLabelColon(body);
    if (colonAt > -1) {
      label = body.slice(colonAt + 1).trim();
      body = body.slice(0, colonAt).trim();
    }

    var op = findArrow(body);
    if (!op) return null;

    var leftRaw = body.slice(0, op.start).trim();
    var rightRaw = body.slice(op.end).trim();

    var left = parseEndpoint(leftRaw);
    var right = parseEndpoint(rightRaw);

    if (!left || !right) return null;

    return {
      kind: KIND.EDGE,
      from: left.id,
      to: right.id,
      fromNode: left.node,
      toNode: right.node,
      arrow: op.op,
      // `A -->|是| B` 里的标签写在箭头上，`A --> B : 是` 写在冒号后，两种都要
      label: label || op.label || '',
      style: styleOf(op.op),
      // 引号基数（类图）与 ER 的基数写法完全不同，回写时要分开处理
      fromCard: left.card || '',
      toCard: right.card || '',
      cardMode: left.card || right.card ? 'quote' : ''
    };
  }

  /** 形状括号 → 语义名，供面板选择器用 */
  var SHAPES = [
    { id: 'rect', open: '[', close: ']' },
    { id: 'round', open: '(', close: ')' },
    { id: 'stadium', open: '([', close: '])' },
    { id: 'subroutine', open: '[[', close: ']]' },
    { id: 'cylinder', open: '[(', close: ')]' },
    { id: 'circle', open: '((', close: '))' },
    { id: 'diamond', open: '{', close: '}' },
    { id: 'hexagon', open: '{{', close: '}}' },
    { id: 'parallelogram', open: '[/', close: '/]' },
    { id: 'asymmetric', open: '>', close: ']' }
  ];

  /** 按「包裹符总长度」从长到短排。长写法必须先试，否则 `((圆形))` 会被 `(` 抢走判成圆角。 */
  var SHAPE_ORDER = SHAPES.slice().sort(function (a, b) {
    return b.open.length + b.close.length - (a.open.length + a.close.length);
  });

  function shapeOf(def) {
    for (var i = 0; i < SHAPE_ORDER.length; i++) {
      var s = SHAPE_ORDER[i];
      if (def.indexOf(s.open) === 0 && def.slice(def.length - s.close.length) === s.close) {
        return s.id;
      }
    }
    return 'rect';
  }

  function shapeWrapper(shape) {
    for (var i = 0; i < SHAPES.length; i++) {
      if (SHAPES[i].id === shape) return SHAPES[i];
    }
    return SHAPES[0];
  }

  /* ------------------------------------------------------------------
     流程图 / 状态图
     ------------------------------------------------------------------ */

  function parseFlowchart(header, rest) {
    var items = [];
    var depth = 0;

    for (var i = 0; i < rest.length; i++) {
      var text = rest[i];
      var trimmed = text.trim();
      if (!trimmed) continue;

      if (/^subgraph\b/i.test(trimmed)) {
        depth++;
        items.push({
          kind: KIND.SUBGRAPH_START,
          title: trimmed.replace(/^subgraph\s*/i, '').trim(),
          depth: depth
        });
        continue;
      }
      if (/^end$/i.test(trimmed)) {
        items.push({ kind: KIND.SUBGRAPH_END, depth: depth });
        depth = Math.max(0, depth - 1);
        continue;
      }

      var edge = parseEdgeLine(text);
      if (edge) {
        items.push(edge);
        continue;
      }

      // `A[文字]` 单独一行：节点定义
      var solo = parseEndpoint(trimmed);
      if (solo && solo.node) {
        items.push({ kind: KIND.CLASS, name: solo.node.id, label: solo.node.label, shape: solo.node.shape, members: [], annotation: '' });
        continue;
      }

      var dir = /^direction\s+(\w+)$/i.exec(trimmed);
      if (dir) {
        items.push({ kind: KIND.DIRECTIVE, name: 'direction', value: dir[1].toUpperCase() });
        continue;
      }

      var style = /^(style|classDef)\s+(.+)$/i.exec(trimmed);
      if (style) {
        items.push({ kind: KIND.DIRECTIVE, name: style[1].toLowerCase(), value: style[2] });
        continue;
      }

      items.push({ kind: KIND.RAW, raw: text });
    }

    return { header: header, items: items };
  }

  /* ------------------------------------------------------------------
     时序图
     ------------------------------------------------------------------ */

  var SEQ_ARROWS = ['<<-->>', '<<->>', '-->>', '->>', '--x', '-x', '-->>', '->', '-->', '<<-', '-'];

  function parseSequence(header, rest) {
    var items = [];

    for (var i = 0; i < rest.length; i++) {
      var trimmed = rest[i].trim();
      if (!trimmed) continue;

      var part = /^(participant|actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/i.exec(trimmed);
      if (part) {
        items.push({
          kind: KIND.PARTICIPANT,
          id: part[2],
          label: part[3] || part[2],
          actor: part[1].toLowerCase() === 'actor'
        });
        continue;
      }

      var note = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(trimmed);
      if (note) {
        items.push({
          kind: KIND.NOTE,
          target: note[2].trim(),
          text: note[3].trim(),
          position: note[1].toLowerCase()
        });
        continue;
      }

      // `A->>B: 文字`
      var msg = /^([^\s]+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|-->|->|--|<<-|-)\s*([^:]+):\s*(.*)$/.exec(trimmed);
      if (msg) {
        items.push({
          kind: KIND.MESSAGE,
          from: msg[1],
          to: msg[3].trim(),
          arrow: msg[2],
          text: msg[4].trim()
        });
        continue;
      }

      items.push({ kind: KIND.RAW, raw: rest[i] });
    }

    return { header: header, items: items };
  }

  /* ------------------------------------------------------------------
     ER 图
     ------------------------------------------------------------------ */

  function parseEr(header, rest) {
    var items = [];
    var current = null;

    for (var i = 0; i < rest.length; i++) {
      var trimmed = rest[i].trim();
      if (!trimmed) continue;

      if (current) {
        if (trimmed === '}') {
          items.push(current);
          current = null;
          continue;
        }
        if (trimmed !== '{') current.attrs.push(trimmed);
        continue;
      }

      var block = /^([\w"\-]+)\s*\{$/.exec(trimmed);
      if (block) {
        current = { kind: KIND.ENTITY, name: block[1].replace(/"/g, ''), attrs: [] };
        continue;
      }

      // `CUSTOMER ||--o{ ORDER : places`
      var rel = /^([\w"\-]+)\s+(\|\||}o|o\{|\|\{|o\||}o|\}[|o])\s*--\s*([|o{][|o{]?|\|\||o\{|\|\{)\s+([\w"\-]+)\s*:\s*(.*)$/.exec(trimmed);
      if (rel) {
        items.push({
          kind: KIND.EDGE,
          from: rel[1].replace(/"/g, ''),
          to: rel[4].replace(/"/g, ''),
          arrow: '--',
          label: rel[5].trim(),
          fromCard: rel[2],
          toCard: rel[3],
          cardMode: 'er',
          style: 'solid'
        });
        continue;
      }

      items.push({ kind: KIND.RAW, raw: rest[i] });
    }

    if (current) items.push(current);
    return { header: header, items: items };
  }

  /* ------------------------------------------------------------------
     解析入口
     ------------------------------------------------------------------ */

  function parse(source) {
    var text = String(source || '').replace(/\r\n?/g, '\n');
    var rawLines = text.split('\n');

    // 跳过前导空行，第一行非空才是类型声明
    var head = 0;
    while (head < rawLines.length && !rawLines[head].trim()) head++;

    var header = rawLines[head] || '';
    var type = detectType(header);
    var rest = rawLines.slice(head + 1);

    var model;
    switch (STRUCTURED[type]) {
      case 'classDiagram':
        model = parseClassDiagram(header, rest);
        break;
      case 'flowchart':
        model = parseFlowchart(header, rest);
        break;
      case 'sequenceDiagram':
        model = parseSequence(header, rest);
        break;
      case 'stateDiagram-v2':
        model = parseFlowchart(header, rest); // 状态图的转换写法和流程图一致
        break;
      case 'erDiagram':
        model = parseEr(header, rest);
        break;
      default:
        model = { header: header, items: [] };
        for (var i = 0; i < rest.length; i++) {
          if (rest[i].trim()) model.items.push({ kind: KIND.RAW, raw: rest[i] });
        }
    }

    model.type = STRUCTURED[type] || type;
    model.parserType = type;
    model.structured = !!STRUCTURED[type];
    model.lead = rawLines.slice(0, head).join('\n');
    return model;
  }

  /* ------------------------------------------------------------------
     序列化
     ------------------------------------------------------------------ */

  function edgeLine(item) {
    // ER 的基数写法完全不同，单独处理
    if (item.cardMode === 'er') {
      var card = (item.fromCard || '||') + '--' + (item.toCard || '||');
      return item.from + ' ' + card + ' ' + item.to + (item.label ? ' : ' + item.label : '');
    }

    var left = endpointText(item.from, item.fromNode);
    var right = endpointText(item.to, item.toNode);

    // 类图的多重性：`A "1" --> "*" B`（引号贴各自的元素）
    if (item.fromCard) left += ' "' + item.fromCard + '"';
    if (item.toCard) right = '"' + item.toCard + '" ' + right;

    /* 箭头就是线型的唯一出处。
     *
     * 曾经还额外存一个 style 字段，改「线型」时去替换箭头里的字符 ——
     * 一换就出错：类图的虚线是 `..>`，流程图的是 `-.->`，拿一套规则套两种
     * 图表，生出来的 `-.>` 类图根本不认。
     * mermaid 本来就把这些写进箭头里（`-->` / `..>` / `-.->` / `==>` /
     * `-->>` ），所以把箭头当好唯一真相，面板只需在选项上标清楚哪个是虚线。
     */
    var arrow = item.arrow || '-->';
    var main = left + ' ' + arrow + ' ' + right;
    return item.label ? main + ' : ' + item.label : main;
  }

  function endpointText(id, node) {
    if (!node) return id;
    var w = shapeWrapper(node.shape || 'rect');
    return node.id + w.open + (node.label || '') + w.close;
  }

  function itemLines(item) {
    switch (item.kind) {
      case KIND.CLASS: {
        if (item.shape) {
          // 流程图节点
          return [endpointText(item.name, { id: item.name, label: item.label, shape: item.shape })];
        }
        var out = [];
        var hasBody = item.members.length || item.annotation;
        if (!hasBody) return ['class ' + item.name];

        out.push('class ' + item.name + ' {');
        if (item.annotation) out.push('  <<' + item.annotation + '>>');
        for (var i = 0; i < item.members.length; i++) out.push('  ' + item.members[i]);
        out.push('}');
        return out.concat(item.inline ? [item.inline] : []);
      }

      case KIND.EDGE:
        return [edgeLine(item)];

      case KIND.NOTE: {
        // 时序图的注释写法是 `Note over A: 文字`，与类图的 `note for A "..."` 不同
        if (item.position) {
          return ['Note ' + item.position + ' ' + item.target + ': ' + (item.text || '')];
        }
        var body = String(item.text || '').split('\n');
        if (body.length === 1) {
          return ['note ' + (item.target ? 'for ' + item.target + ' ' : '') + '"' + body[0] + '"'];
        }
        var lines = ['note ' + (item.target ? 'for ' + item.target + ' ' : '') + '"' + body[0]];
        for (var k = 1; k < body.length; k++) lines.push(body[k]);
        lines[lines.length - 1] += '"';
        return lines;
      }

      case KIND.PARTICIPANT:
        return [
          (item.actor ? 'actor ' : 'participant ') +
            item.id +
            (item.label && item.label !== item.id ? ' as ' + item.label : '')
        ];

      case KIND.MESSAGE:
        return [item.from + item.arrow + item.to + ': ' + (item.text || '')];

      case KIND.ENTITY: {
        if (!item.attrs.length) return [item.name];
        var e = [item.name + ' {'];
        for (var a = 0; a < item.attrs.length; a++) e.push('  ' + item.attrs[a]);
        e.push('}');
        return e;
      }

      case KIND.DIRECTIVE:
        if (item.name === 'direction') return ['direction ' + item.value];
        return [item.name + ' ' + item.value];

      case KIND.SUBGRAPH_START:
        return ['subgraph ' + (item.title || '')];

      case KIND.SUBGRAPH_END:
        return ['end'];

      default:
        return [item.raw || ''];
    }
  }

  function serialize(model) {
    var out = [];

    // 首行：流程图/状态图会把方向挂在类型后面
    var header = model.header || '';
    if (model.structured && (model.type === 'flowchart' || model.type === 'stateDiagram-v2')) {
      var base = header.trim().split(/\s+/)[0] || 'flowchart';
      header = base + (model.direction ? ' ' + model.direction : '');
    }

    out.push(header);

    for (var i = 0; i < model.items.length; i++) {
      var lines = itemLines(model.items[i]);
      for (var k = 0; k < lines.length; k++) out.push(lines[k]);
    }

    return out.join('\n');
  }

  /* ------------------------------------------------------------------
     模型上的编辑操作（面板直接调）
     ------------------------------------------------------------------ */

  function addClass(model, name) {
    var item = { kind: KIND.CLASS, name: name, annotation: '', members: [], inline: '' };
    if (model.type === 'flowchart' || model.type === 'stateDiagram-v2') {
      item.label = name;
      item.shape = 'rect';
    }
    model.items.push(item);
    return item;
  }

  function addEdge(model, edge) {
    var item = {
      kind: KIND.EDGE,
      from: edge.from,
      to: edge.to,
      fromNode: edge.fromNode || null,
      toNode: edge.toNode || null,
      arrow: edge.arrow || '-->',
      label: edge.label || '',
      style: edge.style || 'solid'
    };
    model.items.push(item);
    return item;
  }

  /**
   * 面板上的候选元素（连线的两端要从中挑）。
   *
   * 还要把**只在连线里出现过**的名字收进来 —— 图示里 `A --> B` 这两个节点
   * 在 mermaid 眼里本来就是存在的，但我们的模型里它们没被单独声明过。
   * 不收的话，用户想给它们加一条新连线时，下拉框里根本找不到。
   */
  function elementNames(model) {
    var names = [];
    var seen = {};

    function add(n) {
      if (!n || n === '[*]' || seen[n]) return;
      seen[n] = 1;
      names.push(n);
    }

    for (var i = 0; i < model.items.length; i++) {
      var it = model.items[i];
      if (it.kind === KIND.CLASS) add(it.name);
      else if (it.kind === KIND.PARTICIPANT) add(it.id);
      else if (it.kind === KIND.ENTITY) add(it.name);
    }

    for (var k = 0; k < model.items.length; k++) {
      var e = model.items[k];
      if (e.kind === KIND.EDGE || e.kind === KIND.MESSAGE) {
        add(e.from);
        add(e.to);
      }
    }

    return names;
  }

  function edgeArrows(model) {
    if (model.type === 'sequenceDiagram') {
      return ['->>', '-->>', '->', '-->', '-x', '--x', '<<-->>'];
    }
    if (model.type === 'erDiagram') {
      return ['||--||', '||--o{', '}o--||', '||--|{', 'o|--||'];
    }
    if (model.type === 'classDiagram') {
      // 类图：实线靠 `--`，虚线靠 `..`，带三角的是继承 / 实现
      return ['-->', '--', '<|--', '..>', '..|>', '*--', 'o--'];
    }
    // 流程图 / 状态图：虚线是 `-.->`，粗线是 `==>`
    return ['-->', '---', '-.->', '==>', '--o', '--x', '<-->'];
  }

  /**
   * 箭头的中文注解，给面板的下拉项用。
   * 线型已经写在箭头里了，不标一下没人看得出来 `-.->` 就是虚线。
   */
  function arrowHint(arrow) {
    if (/\./.test(arrow)) return 'dashed';
    if (/=/.test(arrow)) return 'thick';
    return '';
  }

  /* ------------------------------------------------------------------
     新建图表用的初始骨架

     工具栏与预览功能栏共用这一份 —— 两处各写一份必然会跑偏。
     标识符用英文是图表圈的惯例（节点名、类名本来就习惯这么写），
     而它们不是界面文案，所以不进 i18n。
     ------------------------------------------------------------------ */

  var TEMPLATES = {
    classDiagram: [
      'classDiagram',
      '  class ClassA {',
      '    +String field',
      '    +method()',
      '  }',
      '  class ClassB',
      '  ClassA "1" --> "*" ClassB : has'
    ].join('\n'),

    flowchart: [
      'flowchart TD',
      '  A[Start] --> B{Check}',
      '  B -->|Yes| C[Done]',
      '  B -->|No| D[Retry]'
    ].join('\n'),

    sequenceDiagram: [
      'sequenceDiagram',
      '  participant A as Alice',
      '  participant B as Bob',
      '  A->>B: Request',
      '  B-->>A: Response'
    ].join('\n'),

    stateDiagram: [
      'stateDiagram-v2',
      '  [*] --> Idle',
      '  Idle --> Running : start',
      '  Running --> [*]'
    ].join('\n'),

    erDiagram: [
      'erDiagram',
      '  CUSTOMER ||--o{ ORDER : places',
      '  CUSTOMER {',
      '    string name',
      '  }',
      '  ORDER {',
      '    int id',
      '  }'
    ].join('\n')
  };

  /** 新建时可选的那几种（顺序就是面板/菜单里的顺序） */
  var NEW_TYPES = ['classDiagram', 'flowchart', 'sequenceDiagram', 'stateDiagram', 'erDiagram'];

  function template(kind) {
    return TEMPLATES[kind] || TEMPLATES.classDiagram;
  }

  MM.diagram = {
    KIND: KIND,
    SHAPES: SHAPES,
    NEW_TYPES: NEW_TYPES,
    template: template,
    parse: parse,
    serialize: serialize,
    detectType: detectType,
    addClass: addClass,
    addEdge: addEdge,
    elementNames: elementNames,
    edgeArrows: edgeArrows,
    arrowHint: arrowHint,
    isStructured: function (type) {
      return !!STRUCTURED[type];
    }
  };
})();
