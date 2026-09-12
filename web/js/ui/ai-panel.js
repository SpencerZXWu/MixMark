/**
 * MixMark · AI 助手
 * ===============================================================
 * 侧栏下半部分的一个对话面板，能读写文档库里的一切。
 *
 * 三件事：
 *   1. 调 DeepSeek 的 chat/completions（OpenAI 兼容协议）
 *   2. 带一组「工具」让模型自己动手：列文档、读文档、改文档、建文档、搜索
 *   3. 把工具执行结果回填给模型，让它接着推理（有轮数上限，防死循环）
 *
 * 系统提示词刻意写成「少说话、多工作」：能动手就别问，
 * 改完一句话交差。这是产品定位（写作与学习助手），不是随便写的。
 *
 * 【关于跨域】曾经以为 file:// 下必然调不通 API，于是写了一段「被浏览器拦了」
 * 的提示。**实测推翻了这个推断**：DeepSeek 的接口允许跨域，双击打开也能直连。
 * 错误处理里还留着那段提示，是因为换接口或换网络环境时它仍可能派上用场，
 * 但措辞不能再说成「必然如此」。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var API_URL = 'https://api.deepseek.com/chat/completions';

  /** 工具调用的最大轮数：模型偶尔会绕圈，必须有硬上限 */
  var MAX_ROUNDS = 6;
  /** 单篇文档回给模型的字符上限，避免一句话把上下文撑爆 */
  var MAX_DOC_CHARS = 12000;

  var SYSTEM_PROMPT = [
    '你是 MixMark 里的写作与学习助手。工作原则：',
    '1. 少说话，多做事。能直接动手的，不要先问「要不要我做」。',
    '2. 需要资料就先调工具去读，不要凭记忆猜文档里的内容。',
    '3. 改完只用一句话说明改了什么，不复述改动内容，不写「希望对你有帮助」这类客套话。',
    '4. 用中文回答（用户用别的语言时跟随用户）。',
    '5. 不确定的地方直说不确定，绝不编造文档里没有的内容。',
    '6. 涉及删改时尽量保留原意与格式；能小改就不要重写整篇。',
    '7. **绝不声称你没做过的事**。只有工具返回里明确写了成功，才能说改好了。',
    '   写类工具（write_doc / create_doc）返回的是「已提出方案、等用户确认」，',
    '   那就是还没生效 —— 照实说「已提出改写方案，等你确认」，',
    '   不要写成「已改完 / 已更新」。拿不准有没有生效，就先去读一遍再回答。',
    '8. **做不到就直说做不到**，并说清楚为什么 / 你能做什么，不要勉强去试。',
    '   你的能力就在下面这组工具里，清单之外的事（联网搜索、访问这台电脑上',
    '   文档库以外的文件、发邮件、装插件、替用户按快捷键等）一律做不到，',
    '   直接告知用户，不要假装完成，也不要给一段「你可以自己怎么做」的教程充数。',
    '9. 用户可能用「引用」把内容直接递给你（选中的行、某篇文档、某个文件夹）。',
    '   那些内容已经在你的上下文里了，**不要**再去调一遍 read_doc。',
    '10. 文档库的结构改动（重命名 / 移动 / 新建文件夹）会立即生效，',
    '    用户在界面上能一键撤销 —— 所以可以放手调整，但一次别改太多，',
    '    改完把「动了哪几项」列清楚。'
  ].join('\n');

  var TOOLS = [
    {
      type: 'function',
      function: {
        name: 'list_library',
        description: '列出文档库里的全部文件夹与文档（含 id、标题、所在文件夹、当前打开的是哪篇）。任何需要知道「有哪些文档」的操作都先调它。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_doc',
        description: '读取一篇文档的完整内容。可用 id 或标题指定，标题可以只写一部分。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '文档 id' },
            title: { type: 'string', description: '文档标题，可以是标题的一部分' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_doc',
        description: '用新内容整体替换一篇已有文档。只传新内容，不要传旧内容。改动可被用户 Ctrl+Z 撤销。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string', description: '替换后的完整正文' }
          },
          required: ['content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_doc',
        description: '新建一篇 Markdown 文档。标题请带 .md 后缀。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            folderId: { type: 'string', description: '放进哪个文件夹，留空即根目录' }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_docs',
        description: '在全部文档正文里查找关键词，返回命中的文档与所在行。',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_status',
        description:
          '读当前工作状态：当前是哪篇文档、在哪个文件夹、是否已保存、上次保存时间、字数/字符数/行数、光标位置、当前选区、编辑/预览模式、存储位置与保存路径。用户问「保存了吗」「多少字」「存在哪」这类问题时用。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rename_doc',
        description: '重命名一篇文档（只改标题，不动正文）。立即生效，用户可一键撤销。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string', description: '文档当前标题（可用一部分）' },
            newTitle: { type: 'string', description: '新标题' }
          },
          required: ['newTitle']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'move_doc',
        description: '把文档移进另一个文件夹。立即生效，用户可一键撤销。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            folderId: { type: 'string', description: '目标文件夹 id；留空或传 root 即移到根目录' },
            folderName: { type: 'string', description: '目标文件夹名（可用一部分），比手写 id 稳' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_folder',
        description: '新建一个文件夹。立即生效，用户可一键撤销。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            parentId: { type: 'string', description: '建在哪个文件夹下，留空即根目录' },
            parentName: { type: 'string', description: '父文件夹名（可用一部分）' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rename_folder',
        description: '重命名文件夹。立即生效，用户可一键撤销。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', description: '当前文件夹名（可用一部分）' },
            newName: { type: 'string' }
          },
          required: ['newName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'move_folder',
        description: '把文件夹（连同里面的东西）移到另一个文件夹下。立即生效，用户可一键撤销。不能移进自己的子文件夹。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            parentId: { type: 'string', description: '目标父文件夹 id；留空或传 root 即移到根目录' },
            parentName: { type: 'string', description: '目标父文件夹名（可用一部分）' }
          },
          required: []
        }
      }
    }
  ];

  var els = {};

  /**
   * 本轮实际执行过的工具。
   *
   * 用途只有一个：让「模型说的话」可以被核对。
   * 幻觉的典型长相就是「我改好了」—— 而这一轮根本没调过写类工具。
   */
  var roundTools = [];

  /** 哪些工具会动文档（在提案模式下都是「提出方案」而不是直接落地） */
  var WRITE_TOOLS = { write_doc: 1, create_doc: 1 };

  /**
   * 哪些工具会动文档库的结构。
   * 与 WRITE_TOOLS 分开：那些走「提案 → 确认」，这些立即生效（改完可撤销），
   * 两者的完成信号完全不一样，混着用会让幻觉检查算错。
   */
  var STRUCT_TOOLS = {
    rename_doc: 1,
    move_doc: 1,
    rename_folder: 1,
    move_folder: 1,
    create_folder: 1
  };

  /** runTool 的失败分支都以这些词开头，用它区分「做了但没成」与「做成了」 */
  var FAIL_PREFIX = ['找不到', '这个名字已被占用', '未知工具', '工具执行出错', '缺少'];

  var TOOL_LABEL = {
    list_library: 'aiToolList',
    read_doc: 'aiToolRead',
    write_doc: 'aiToolWrite',
    create_doc: 'aiToolCreate',
    search_docs: 'aiToolSearch',
    get_status: 'aiToolStatus',
    rename_doc: 'aiToolRename',
    move_doc: 'aiToolMove',
    rename_folder: 'aiToolRenameFolder',
    move_folder: 'aiToolMoveFolder',
    create_folder: 'aiToolMkdir'
  };

  /**
   * 「声称自己做了一件事」的常见说法。
   *
   * 宁漏勿滥：只用来触发一句提醒，不需要百分之百准确。
   * 但「已…了」中间隔几个字是很常见的写法（「已经帮你把结论补进笔记了」），
   * 咬着「已」和动词必须挨着会漏掉最典型的那一类，所以中间允许隔几个字，
   * 但不能跨句号/逗号 —— 跨过去就变成两个不相干的分句了。
   */
  var CLAIM_RE = new RegExp(
    '(' +
      '已(经)?[^。，,\\n]{0,6}(改|修改|更新|写入|创建|新建|删除|保存|加进|补进|重命名|移动|改成|整理|放(进|到|入))' +
      '|改好|写好|建好|写完了|搞定了' +
      '|\\b(updated|modified|created|deleted|saved|rewritten|renamed|moved|added)\\b' +
      ')',
    'i'
  );

  /** 对话记录：真正与模型往返的那些轮次（role 是 'user' / 'bot'） */
  var turns = [];
  var busy = false;

  /* ------------------------------------------------------------------
     引用：这次提问要 AI 看的东西

     三个来路，最后都落成同一张芯片：
       ① 编辑器行号左边的复选框 → 选中的行
       ② 侧栏把文档 / 文件夹拖进来
       ③ 输入框里写到「现在的文档」→ 自动挂上当前这篇

     为什么不直接拼进输入框的文本里：
       用户看到的输入框应该只是他打的那句话；「AI 能看到什么」是另一件事，
       分成两块才都能看清楚，也才都能单独撤掉。
     ------------------------------------------------------------------ */

  /** 手工挂上的引用（拖入的文档 / 文件夹） */
  var refs = [];
  /** 自动挂上的当前文档（由输入框里的关键词触发） */
  var autoRef = null;
  /** 用户手动叉掉过自动引用：在他重新打开一句话之前不要再自动挂 */
  var autoDismissed = false;

  /**
   * 哪几种说法算「我要的是现在打开的那篇」。
   * 宁多勿少：多挂一条用户能叉掉，漏挂了他只能自己再拖一次。
   */
  var REF_KEYWORDS = [
    '打开的文档',
    '当前文档',
    '现在的文档',
    '这篇文档',
    '这篇文章',
    '本篇',
    '本文',
    '正在写的',
    'current document',
    'this document',
    'the open document',
    'open document',
    'this file',
    'current file'
  ];

  function refKey(r) {
    if (r.kind === 'lines') return 'lines:' + r.docId + ':' + r.from + '-' + r.to;
    if (r.kind === 'folder') return 'folder:' + r.folderId;
    return 'doc:' + r.docId;
  }

  function currentDocMeta() {
    var id = MM.store.get().docId;
    if (!id) return null;
    return MM.docs.findMeta(id) || { id: id, title: MM.store.get().title || '' };
  }

  /**
   * 对话存哪儿？
   * 不放 MM.settings —— 那里是「设置」，一堆字符串键值对，不适合塞长数组。
   * 也不犯不着走文档存储（provider）—— 那是给用户文档的。
   * 单独一个 localStorage 键最直白。贵在活得比页面长，又不污染任何别的东西。
   */
  var STORE_KEY = 'mixmark:ai:v1';
  /** 只留最近这么多条，免得越聊越大 */
  var MAX_TURNS = 60;
  var saveTimer = null;

  /* ------------------------------------------------------------------
     编辑器内的差异高亮

     提案一旦提出，编辑区就直接变成「修改后」的样子：
     新增行标绿，被删掉的行以红色幽灵行留在原处。
     预览因此自然显示修改后的内容 —— 它本来就是按文档渲染的。

     代价得说清楚：文档已经是 after 了，所以自动保存会把它落盘。
     卡片因此明写「已预览改动，点保留确认 / 撤销回退」；
     而回退所需的当前版就在卡片里（也存了档），刷新后依然撤得回来。
     ------------------------------------------------------------------ */

  var CM = window.CM;

  /** 换一套装饰用这个 effect */
  var setDiff = CM.StateEffect.define();

  var diffField = CM.StateField.define({
    create: function () {
      return CM.Decoration.none;
    },
    update: function (value, tr) {
      value = value.map(tr.changes);
      for (var i = 0; i < tr.effects.length; i++) {
        if (tr.effects[i].is(setDiff)) value = tr.effects[i].value;
      }
      return value;
    },
    provide: function (f) {
      return CM.EditorView.decorations.from(f);
    }
  });

  /** 被删掉的那些行：文档里已经没有它们了，只能靠块状 widget 摆回去 */
  class DeleteBlock extends CM.WidgetType {
    constructor(lines) {
      super();
      this.lines = lines;
    }

    eq(other) {
      return other instanceof DeleteBlock && other.lines.join('\n') === this.lines.join('\n');
    }

    toDOM() {
      var wrap = document.createElement('div');
      wrap.className = 'ai-diff-del';
      for (var i = 0; i < this.lines.length; i++) {
        var row = document.createElement('div');
        row.className = 'ai-diff-del__line';
        // 空行也得占位，否则「删了三行、其中两行是空的」就看不出来
        row.textContent = this.lines[i] || ' ';
        wrap.appendChild(row);
      }
      return wrap;
    }

    ignoreEvent() {
      return false;
    }
  }

  /** 把「before → after」变成一串装饰。文档此刻已经是 after */
  function buildDecorations(doc, before, after) {
    var ranges = [];
    var diff = diffLines(before, after);
    var pending = [];
    var lineNo = 1;

    function flush() {
      if (!pending.length) return;
      var pos = lineNo <= doc.lines ? doc.line(lineNo).from : doc.length;
      ranges.push(
        CM.Decoration.widget({ widget: new DeleteBlock(pending.slice()), side: -1, block: true }).range(pos)
      );
      pending = [];
    }

    for (var i = 0; i < diff.length; i++) {
      var l = diff[i];
      if (l.type === 'same') {
        flush();
        lineNo++;
      } else if (l.type === 'add') {
        flush();
        if (lineNo <= doc.lines) {
          ranges.push(CM.Decoration.line({ class: 'ai-diff-add' }).range(doc.line(lineNo).from));
        }
        lineNo++;
      } else if (l.type === 'del') {
        pending.push(l.text);
      }
    }
    flush();

    return CM.Decoration.set(ranges, true);
  }

  /* ------------------------------------------------------------------
     变更提案
     ------------------------------------------------------------------ */

  /**
   * 行级差异（经典 LCS）。
   *
   * 文档通常几百行，O(n·m) 的表格完全吃得下；而它给出的结果和 Git 最接近，
   * 增删行能对得上。超过阀值就退化成一行的说明，免得把界面卡住。
   */
  function diffLines(a, b) {
    var A = String(a).split('\n');
    var B = String(b).split('\n');

    if (A.length * B.length > 400000) {
      return [{ type: 'meta', text: MM.i18n.t('aiDiffTooLarge', { a: A.length, b: B.length }) }];
    }

    var n = A.length;
    var m = B.length;
    var dp = [];
    var i;
    var j;

    for (i = 0; i <= n; i++) {
      dp.push(new Array(m + 1).fill(0));
    }
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    var out = [];
    i = 0;
    j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        out.push({ type: 'same', text: A[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ type: 'del', text: A[i] });
        i++;
      } else {
        out.push({ type: 'add', text: B[j] });
        j++;
      }
    }
    while (i < n) out.push({ type: 'del', text: A[i++] });
    while (j < m) out.push({ type: 'add', text: B[j++] });

    return out;
  }

  /**
   * 提一份变更，等用户在界面上定夺。
   *
   * 写入类工具一律走这里，**不直接动文档** —— 这是与 VS Code Copilot
   * 一致的做法：先摆出改了什么，人点头才真的落地。
   */
  function proposeChange(spec) {
    var lines = diffLines(spec.before, spec.after);
    var added = 0;
    var removed = 0;

    lines.forEach(function (l) {
      if (l.type === 'add') added++;
      else if (l.type === 'del') removed++;
    });

    var turn = {
      role: 'change',
      kind: spec.kind, // 'write' | 'create'
      docId: spec.docId || null,
      folderId: spec.folderId || null,
      title: spec.title,
      before: spec.before,
      after: spec.after,
      added: added,
      removed: removed,
      status: 'pending'
    };

    turns.push(turn);
    if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
    scheduleSave();

    if (els.log) {
      turn.node = changeCard(turn);
      els.log.appendChild(turn.node);
      els.log.scrollTop = els.log.scrollHeight;
    }

    // 一次只让一张卡片占着编辑区：旧的那张当场作废。
    // 否则两套高亮叠在一起，谁也说不清哪一行是谁改的
    if (activeTurn && activeTurn !== turn && activeTurn.status === 'pending') {
      activeTurn.status = 'reverted';
      scheduleSave();
      redrawCard(activeTurn);
    }

    // 一律摆到眼前：看不到改动的提案，用户没法判断留不留
    applyDiff(turn);

    return turn;
  }

  /* ------------------------------------------------------------------
     把提案摆进编辑区
     ------------------------------------------------------------------ */

  /** 此刻编辑区里正显示着哪张卡片的差异 */
  var activeTurn = null;
  /** 我们自己发起的 dispatch 标记：否则会被当成「用户手动改了文档」 */
  var applying = false;

  /**
   * 把提案摆到眼前。
   *
   * 三件事，一件也不能少 —— 看不到改动的提案根本没法确认：
   *   改当前这篇  → 直接把内容换掉
   *   改别的文档  → 先切过去
   *   新建文档    → 先把文件建出来（撤销时再删掉）
   */
  function applyDiff(turn) {
    return Promise.resolve()
      .then(function () {
        if (turn.kind === 'create' && !turn.docId) {
          MM.docs.create({
            content: turn.after,
            title: turn.title,
            autoTitle: false,
            folderId: turn.folderId
          });
          return new Promise(function (r) {
            setTimeout(r, 500);
          });
        }
      })
      .then(function () {
        if (turn.kind === 'write' && turn.docId !== MM.store.get().docId) {
          return Promise.resolve(MM.docs.open(turn.docId)).then(function () {
            return new Promise(function (r) {
              setTimeout(r, 500);
            });
          });
        }
      })
      .then(function () {
        // 刚建出来的那份：此刻它才是当前文档，把 id 补上，
        // 撤销时才有东西可删
        if (turn.kind === 'create' && !turn.docId) turn.docId = MM.store.get().docId;

        var view = MM.editor.raw();
        if (!view) return;

        // 新建的文档里已经是 after 了，再写一遍会把撤销栈弄脏，跳过
        if (turn.kind === 'write') {
          applying = true;
          try {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: turn.after },
              selection: { anchor: 0 },
              effects: setDiff.of(CM.Decoration.none)
            });
          } finally {
            applying = false;
          }
        }

        applying = true;
        try {
          // 内容到位了再算装饰位置，否则行号对不上
          view.dispatch({ effects: setDiff.of(buildDecorations(view.state.doc, turn.before, turn.after)) });
        } finally {
          applying = false;
        }

        activeTurn = turn;
        turn.applied = true;
        scheduleSave();
      });
  }

  /** 只撤高亮，不动内容（「保留」就走这里：内容早就已经是 after 了） */
  function clearDiff() {
    var view = MM.editor.raw();
    if (view) {
      applying = true;
      try {
        view.dispatch({ effects: setDiff.of(CM.Decoration.none) });
      } finally {
        applying = false;
      }
    }
    activeTurn = null;
  }

  /** 撤销：把文档整篇写回 before，同时撤掉高亮 */
  function revertEditor(turn) {
    var view = MM.editor.raw();
    if (!view) return;

    applying = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: turn.before },
        selection: { anchor: 0 },
        effects: setDiff.of(CM.Decoration.none)
      });
    } finally {
      applying = false;
    }
    activeTurn = null;
  }

  function redrawCard(turn) {
    if (!turn.node || !turn.node.parentNode) return;
    var fresh = changeCard(turn);
    turn.node.parentNode.replaceChild(fresh, turn.node);
    turn.node = fresh;
  }

  /** 保留就把内容真正写进去；撤销就只是把卡片刻成「已撤销」 */
  function resolveChange(turn, keep) {
    if (turn.status !== 'pending') return;

    turn.status = keep ? 'kept' : 'reverted';
    scheduleSave();

    if (turn.applied) {
      // 已经摆在编辑区里了：
      // 保留 = 只撤掉高亮（内容早就是 after）、撤销 = 回退内容
      if (keep) {
        clearDiff();
        if (MM.docs.flushPending) MM.docs.flushPending();
      } else if (turn.kind === 'create' && turn.docId) {
        // 撤销新建：把刚才为了预览而建出来的那份删掉，
        // 否则文档库里会多一个「AI 提议过、但你没要」的垃圾文件
        clearDiff();
        MM.docs.remove(turn.docId);
        turn.docId = null;
      } else {
        revertEditor(turn);
      }
    } else if (keep) {
      // 兜底：万一没能摆进编辑区（编辑器不可用等），保留时补写
      if (turn.kind === 'create') {
        MM.docs.create({
          content: turn.after,
          title: turn.title,
          autoTitle: false,
          folderId: turn.folderId
        });
      } else {
        var doc = findDoc(turn.docId) || findDoc(turn.title);
        if (doc) writeDocText(doc, turn.after);
      }
    }

    redrawCard(turn);
  }

  /* ------------------------------------------------------------------
     文档库查询与改动
     ------------------------------------------------------------------ */

  function allDocs() {
    return MM.store.get().docs || [];
  }

  function allFolders() {
    return MM.store.get().folders || [];
  }

  /** 按 id 或标题（允许部分匹配）找文档 */
  function findDoc(key) {
    if (!key) return null;
    var docs = allDocs();
    var id = String(key);

    for (var i = 0; i < docs.length; i++) {
      if (docs[i].id === id) return docs[i];
    }

    var needle = id.toLowerCase();
    for (var j = 0; j < docs.length; j++) {
      if (String(docs[j].title || '').toLowerCase().indexOf(needle) !== -1) return docs[j];
    }
    return null;
  }

  function clip(text) {
    text = String(text == null ? '' : text);
    if (text.length <= MAX_DOC_CHARS) return text;
    return text.slice(0, MAX_DOC_CHARS) + '\n…（已截断，原文 ' + text.length + ' 字）';
  }

  function readDocText(doc) {
    if (doc.id === MM.store.get().docId) return Promise.resolve(MM.docs.content());

    // 只传 id：storage 层内部自己会拼 'doc:' 前缀，多传一层就成了 doc:doc:xxx
    return Promise.resolve(MM.provider.get().read(doc.id)).then(function (v) {
      return typeof v === 'string' ? v : '';
    });
  }

  /** 把新内容写进一篇文档。当前文档走正常编辑路径，撤销栈才有效 */
  function writeDocText(doc, content) {
    var view = MM.editor.raw();
    var text = String(content == null ? '' : content);

    if (doc.id === MM.store.get().docId) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 }
      });
      return Promise.resolve(true);
    }

    // 不是当前文档：先切过去、写完、再切回来。
    // 切换会触发 flushPending，所以改动不会丢
    var backTo = MM.store.get().docId;
    return Promise.resolve(MM.docs.open(doc.id))
      .then(function () {
        var v = MM.editor.raw();
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: text },
          selection: { anchor: 0 }
        });
        return new Promise(function (r) {
          setTimeout(r, 400);
        });
      })
      .then(function () {
        if (MM.docs.flushPending) MM.docs.flushPending();
        return new Promise(function (r) {
          setTimeout(r, 400);
        });
      })
      .then(function () {
        if (backTo) return MM.docs.open(backTo);
      })
      .then(function () {
        return true;
      });
  }

  /* ------------------------------------------------------------------
     行引用：编辑器行号左边那一列复选框

     用 CodeMirror 的 gutter 实现，而不是往正文里插装饰 ——
     要求就是「行号前」，插在正文里会跑到行号右边。

     为什么每行都要放一个 marker（哪怕没勾）：gutters 只给「有 marker 的行」
     生成 DOM，没 marker 的行根本没有可点的元素，悬浮也就无从谈起。
     代价是一条 O(行数) 的 RangeSet，所以设了行数上限，超长文档就别铺了。
     ------------------------------------------------------------------ */

  /** 勾选的行号：{ 行号: true }。与编辑器里的 marker 保持同一份真相 */
  var selLines = {};

  var setLineSel = CM.StateEffect.define();

  class LineSelMarker extends CM.GutterMarker {
    constructor(checked) {
      super();
      this.checked = checked;
    }

    eq(other) {
      return other.checked === this.checked;
    }

    toDOM() {
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'mm-linesel' + (this.checked ? ' is-checked' : '');
      box.checked = this.checked;
      // 不进 Tab 序列：这是个鼠标交互的辅助入口，
      // 抢走 Tab 会让「Tab 缩进」这件正事变得别扭
      box.tabIndex = -1;
      return box;
    }
  }

  var MARK_OFF = new LineSelMarker(false);
  var MARK_ON = new LineSelMarker(true);

  /** 超过这个行数就不铺复选框：重建一次是 O(行数) */
  var MAX_LINESEL_LINES = 8000;

  function buildLineMarks(doc, numbers) {
    if (!doc || doc.lines > MAX_LINESEL_LINES) return CM.RangeSet.empty;

    var builder = new CM.RangeSetBuilder();
    for (var n = 1; n <= doc.lines; n++) {
      var at = doc.line(n).from;
      builder.add(at, at, numbers[n] ? MARK_ON : MARK_OFF);
    }
    return builder.finish();
  }

  var lineSelField = CM.StateField.define({
    create: function (state) {
      // 换文档会重建整个 state，勾选跟着清空。
      // 行号是「这一篇的第几行」，换一篇还留着同一个数字只会指向不相干的内容。
      // 注意 create 拿得到 state —— 这里必须把初始那一份 marker 铺出来，
      // 返回空表的话整列复选框在首次编辑之前都不会出现
      selLines = {};
      return buildLineMarks(state.doc, selLines);
    },
    update: function (value, tr) {
      var i;
      for (i = 0; i < tr.effects.length; i++) {
        if (tr.effects[i].is(setLineSel)) {
          selLines = tr.effects[i].value;
          return buildLineMarks(tr.state.doc, selLines);
        }
      }
      if (!tr.docChanged) return value;

      // 文档改了：先让 marker 跟着内容走（map），再按新位置回读行号。
      // 这样「勾住的是那段内容」而不是「勾住的是第 5 行」——
      // 在上面插两行，复选框会跟着内容一起下移，而不是留在原地指错东西。
      //
      // 注意只认 checked 的那些：RangeSet 里**每一行**都有 marker
      // （没勾的是占位方块），把它们全当成「被选中」会把整篇都勾上
      var mapped = value.map(tr.changes);
      var numbers = {};
      var iter = mapped.iter();
      while (iter.value) {
        if (iter.value.checked) numbers[tr.state.doc.lineAt(iter.from).number] = true;
        iter.next();
      }
      selLines = numbers;
      return buildLineMarks(tr.state.doc, numbers);
    }
  });

  /**
   * 行引用槽要作为一个整体装进编辑器：**字段本身也得在这一组里**。
   *
   * 这是个很容易踩的坑：StateField 只在被列进 extensions 时才存在于 state。
   * 光在 gutter 的 markers 回调里引用它，字段并不会因此注册 ——
   * 表现是槽画出来了、一个复选框都没有，`state.field(...)` 也取不到。
   */
  var lineSelExtension = [
    lineSelField,

    CM.gutter({
      class: 'mm-linesel-gutter',
      markers: function (view) {
        return view.state.field(lineSelField, false) || CM.RangeSet.empty;
      },
      initialSpacer: function () {
        return MARK_OFF;
      },
      domEventHandlers: {
        mousedown: function (view, line, event) {
          // 阻止原生勾选：状态由我们这边说了算，让浏览器也翻一次会打架
          event.preventDefault();

          /* ⚠️ 这里的第二个参数是**视口里的块信息**（只有 from/to/top/bottom），
             不是 @codemirror/state 那个带 number 的 Line。
             直接读 line.number 会得到 undefined，一路变成 NaN：
             selLines 里多出一个 "undefined" 键 → 引用芯片显示「第 NaN–NaN 行」→
             而每个复选框按数字匹配，一个也对不上，看上去就是「勾选标志消失了」。
             行号得自己从 from 换算。 */
          var at = typeof line.from === 'number' ? line.from : null;
          if (at === null) {
            var r = event.target.getBoundingClientRect();
            at = view.posAtCoords({ x: r.left, y: (r.top + r.bottom) / 2 });
          }
          if (at === null || at === undefined) return false;

          toggleLineRef(view.state.doc.lineAt(at).number);
          return true;
        }
      }
    })
  ];

  function toggleLineRef(n) {
    // 行号必须是有限数。放一个 NaN 进来，只会得到一个永远匹配不上任何行的
    // 幽灵键：芯片写着 NaN、复选框一个不亮，排查起来极难
    if (!Number.isFinite(n)) return;

    var next = {};
    Object.keys(selLines).forEach(function (k) {
      next[k] = true;
    });
    if (next[n]) delete next[n];
    else next[n] = true;

    selLines = next;
    pushLineSel();
    renderRefs();
  }

  function pushLineSel() {
    var view = MM.editor.raw();
    if (view) view.dispatch({ effects: setLineSel.of(selLines) });
  }

  function clearLineRefs() {
    selLines = {};
    pushLineSel();
    renderRefs();
  }

  /** 行号集合 → 连续区间。中间断开的地方要分成两条引用，否则会多捎上无关的行 */
  function lineRuns() {
    var nums = Object.keys(selLines)
      .map(Number)
      .filter(function (n) {
        return Number.isFinite(n) && n >= 1;
      })
      .sort(function (a, b) {
        return a - b;
      });
    var runs = [];
    for (var i = 0; i < nums.length; i++) {
      var last = runs[runs.length - 1];
      if (last && nums[i] === last.to + 1) last.to = nums[i];
      else runs.push({ from: nums[i], to: nums[i] });
    }
    return runs;
  }

  /* ------------------------------------------------------------------
     引用的增删与呈现
     ------------------------------------------------------------------ */

  function addRef(ref) {
    var key = refKey(ref);
    for (var i = 0; i < refs.length; i++) {
      if (refKey(refs[i]) === key) return false;
    }
    refs.push(ref);
    renderRefs();
    return true;
  }

  function removeRefKey(key) {
    refs = refs.filter(function (r) {
      return refKey(r) !== key;
    });
    renderRefs();
  }

  /** 当前生效的全部引用：自动的 + 行选区的 + 手工拖入的 */
  function allRefs() {
    var out = [];
    if (autoRef) out.push(autoRef);

    var doc = currentDocMeta();
    if (doc) {
      lineRuns().forEach(function (r) {
        out.push({ kind: 'lines', docId: doc.id, title: doc.title, from: r.from, to: r.to });
      });
    }

    return out.concat(refs);
  }

  function refLabel(r) {
    if (r.kind === 'lines') {
      return r.from === r.to
        ? MM.i18n.t('aiRefLine', { n: r.from })
        : MM.i18n.t('aiRefLines', { a: r.from, b: r.to });
    }
    if (r.kind === 'folder') return MM.i18n.t('aiRefFolder', { name: r.name });
    return MM.i18n.t('aiRefDoc', { title: r.title });
  }

  function renderRefs() {
    if (!els.refs) return;

    var list = allRefs();
    els.refs.innerHTML = '';
    els.refs.hidden = !list.length;
    if (!list.length) return;

    list.forEach(function (r) {
      var chip = el('span', 'ai-ref ai-ref--' + r.kind);
      var text = refLabel(r);
      // 行引用只写「第 N–M 行」：它必然属于当前打开的那一篇，
      // 把文档名也塞进芯片，在这么窄的侧栏里会把一行撑成两行
      var label = el('span', 'ai-ref__label', text);
      label.title = r.kind === 'lines' ? r.title + ' · ' + text : text;
      chip.appendChild(label);

      var x = el('button', 'ai-ref__drop', '\u00d7');
      x.type = 'button';
      x.title = MM.i18n.t('aiRefRemove');
      x.setAttribute('aria-label', MM.i18n.t('aiRefRemove') + '：' + text);
      x.addEventListener('click', function () {
        dropRef(r);
      });
      chip.appendChild(x);
      els.refs.appendChild(chip);
    });
  }

  function dropRef(r) {
    if (r.kind === 'lines') {
      var next = {};
      Object.keys(selLines).forEach(function (k) {
        var n = Number(k);
        if (n < r.from || n > r.to) next[n] = true;
      });
      selLines = next;
      pushLineSel();
      renderRefs();
      return;
    }

    if (r.auto) {
      // 叉掉的是「自动挂上来的那一条」：在他把输入框清空之前别再自动挂，
      // 否则下一句话没提到它也会自己冒出来
      autoDismissed = true;
      autoRef = null;
      renderRefs();
      return;
    }

    removeRefKey(refKey(r));
  }

  /** 输入框里的「现在的文档」这类说法 → 自动挂上当前打开的文档 */
  function syncAutoRef() {
    if (!els.input) return;

    var text = els.input.value;
    if (!text.trim()) {
      autoDismissed = false;
      if (autoRef) {
        autoRef = null;
        renderRefs();
      }
      return;
    }

    var lower = text.toLowerCase();
    var hit = REF_KEYWORDS.some(function (k) {
      return lower.indexOf(k.toLowerCase()) !== -1;
    });

    if (!hit) {
      if (autoRef) {
        autoRef = null;
        renderRefs();
      }
      return;
    }

    if (autoDismissed) return;

    var doc = currentDocMeta();
    if (!doc) return;
    if (autoRef && autoRef.docId === doc.id) return;

    autoRef = { kind: 'doc', docId: doc.id, title: doc.title, auto: true };
    renderRefs();
  }

  /**
   * 整块引用内容的大小上限。
   * 引用是要**存进对话记录**的（否则下一轮就「忘了」用户给它看过什么），
   * 不设上限的话拖进来三篇长文档就能把 localStorage 写爆。
   */
  var MAX_REF_CHARS = 8000;

  /** 把引用拼成给模型看的一大段文字 */
  function buildRefBlock(list) {
    if (!list.length) return Promise.resolve('');

    var parts = [];

    var chain = list.reduce(function (prev, r) {
      return prev.then(function () {
        if (r.kind === 'lines') {
          var view = MM.editor.raw();
          if (!view) return null;
          var doc = view.state.doc;
          var from = doc.line(Math.min(r.from, doc.lines)).from;
          var to = doc.line(Math.min(r.to, doc.lines)).to;
          parts.push(
            '── 选中的行（' + r.title + ' 第 ' + r.from + (r.to > r.from ? '-' + r.to : '') + ' 行）──\n' +
              view.state.sliceDoc(from, to)
          );
          return null;
        }

        if (r.kind === 'folder') {
          var kids = allDocs().filter(function (d) {
            return (d.folderId || null) === r.folderId;
          });
          parts.push(
            '── 文件夹「' + r.name + '」里的文档 ──\n' +
              (kids.length
                ? kids
                    .map(function (d) {
                      return '- 《' + d.title + '》(id: ' + d.id + ')';
                    })
                    .join('\n')
                : '（这个文件夹是空的）')
          );
          return null;
        }

        var meta = MM.docs.findMeta(r.docId);
        if (!meta) return null;
        return readDocText(meta).then(function (text) {
          parts.push('── 文档《' + meta.title + '》(id: ' + meta.id + ') ──\n' + clip(text));
        });
      });
    }, Promise.resolve());

    return chain.then(function () {
      if (!parts.length) return '';

      var head =
        '【引用】用户在输入框里引用了下面这些内容，它们就是这次要重点处理的对象。' +
        '内容已经附在下面了，不要再调 read_doc 去读同一篇。';
      var body = parts.join('\n\n');

      if (body.length > MAX_REF_CHARS) {
        body = body.slice(0, MAX_REF_CHARS) + '\n\n…（引用内容过长已截断，需要全文可以再调 read_doc）';
      }

      return head + '\n\n' + body;
    });
  }

  function clearRefs() {
    refs = [];
    autoRef = null;
    autoDismissed = false;
    clearLineRefs();
  }

  /* ------------------------------------------------------------------
     文档库的读法与结构改动
     ------------------------------------------------------------------ */

  /** 文件夹 id → 可读路径（「笔记 / 期中」）。给模型看的东西一律用路径，别用 id */
  function folderPath(id) {
    var names = [];
    var walk = id;
    var guard = 0;
    while (walk && guard++ < 50) {
      var f = MM.docs.folderById(walk);
      if (!f) break;
      names.unshift(f.name);
      walk = f.parentId;
    }
    return names.length ? names.join(' / ') : MM.i18n.t('aiRootFolder');
  }

  /** 按 id 或名字（允许只写一部分）找文件夹；'' / 'root' / '根目录' 表示根目录 */
  function resolveFolder(key) {
    if (key === undefined || key === null) return null;

    var raw = String(key).trim();
    if (!raw || raw === 'root' || raw === 'null' || raw === '根目录') {
      return { id: null, name: MM.i18n.t('aiRootFolder'), root: true };
    }

    var byId = MM.docs.folderById(raw);
    if (byId) return { id: byId.id, name: byId.name };

    var needle = raw.toLowerCase();
    var list = allFolders();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].name || '').toLowerCase().indexOf(needle) !== -1) {
        return { id: list[i].id, name: list[i].name };
      }
    }
    return null;
  }

  /** 防环：不能把文件夹移进自己或自己的后代里 */
  function isSelfOrDescendant(folderId, ancestorId) {
    var walk = folderId;
    var guard = 0;
    while (walk && guard++ < 50) {
      if (walk === ancestorId) return true;
      var f = MM.docs.folderById(walk);
      walk = f ? f.parentId : null;
    }
    return false;
  }

  /**
   * 结构改动收尾：记一张卡片进对话。
   *
   * 与内容改动不同，这里**先做了再记** —— 重命名、移动这类操作一眼能看懂、
   * 也能随手改回去，再插一道「确认」只会让「帮我理一下文档」变成十次点击。
   * 代价必须补上：卡片带一个「撤销」，让 `已生效` 不等于 `不可挽回`。
   */
  function structTurn(spec) {
    var turn = {
      role: 'change',
      kind: 'struct',
      title: spec.title,
      lines: spec.lines,
      undo: spec.undo || null,
      status: 'kept'
    };

    turns.push(turn);
    if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
    scheduleSave();

    if (els.log) {
      turn.node = changeCard(turn);
      els.log.appendChild(turn.node);
      els.log.scrollTop = els.log.scrollHeight;
    }

    return turn;
  }

  /** 把一次结构改动反向做回去。返回 true 表示确实撤回来了 */
  function runUndo(op) {
    if (!op || !op.type) return Promise.resolve(false);

    function ok() {
      return true;
    }

    if (op.type === 'rename_doc') return Promise.resolve(MM.docs.rename(op.id, op.from)).then(ok);
    if (op.type === 'move_doc') return Promise.resolve(MM.docs.moveDoc(op.id, op.from)).then(ok);
    if (op.type === 'rename_folder') return Promise.resolve(MM.docs.renameFolder(op.id, op.from)).then(ok);
    if (op.type === 'move_folder') return Promise.resolve(MM.docs.moveFolder(op.id, op.from)).then(ok);

    if (op.type === 'create_folder') {
      // 撤销「新建文件夹」= 把它删掉，但这只在它还空着的时候成立 ——
      // 里面已经有东西了就不能替用户连内容一起抹掉
      return Promise.resolve(MM.docs.folderStats(op.id)).then(function (st) {
        if (st && (st.docs || st.folders)) return false;
        return Promise.resolve(MM.docs.removeFolder(op.id)).then(ok);
      });
    }

    return Promise.resolve(false);
  }

  function undoStruct(turn) {
    if (turn.status !== 'kept' || !turn.undo) return;

    /**
     * 撤销可能失败，而且不只一种失败法：
     *   文件夹里已经有东西了 → 返回 false（用户没让我连内容一起删）
     *   对象已经不存在了     → 抛错。前面那张卡片被撤销后，
     *                        后面这张指向的东西可能就没了，这是链式撤销的正常现象
     * 两种都得接住，否则卡片永远停在「可撤销」，点下去只会报一个没人看见的错
     */
    runUndo(turn.undo)
      .then(function (done) {
        turn.status = done ? 'reverted' : 'failed';
        scheduleSave();
        redrawCard(turn);
        if (!done) pushNote(MM.i18n.t('aiUndoFailed'), true);
      })
      .catch(function (err) {
        turn.status = 'failed';
        scheduleSave();
        redrawCard(turn);
        pushNote(MM.i18n.t('aiUndoFailedGone', { msg: (err && err.message) || err }), true);
      });
  }

  /* ------------------------------------------------------------------
     工具执行
     ------------------------------------------------------------------ */

  function toolLibrary() {
    var s = MM.store.get();
    return JSON.stringify(
      {
        currentDocId: s.docId,
        // 带上路径：模型要「把 A 移到 B 下面」时，看到的是人话而不是 uuid。
        // 只读的树也顺带解释了「哪个文件夹套在哪个里」
        folders: allFolders().map(function (f) {
          return {
            id: f.id,
            name: f.name,
            path: folderPath(f.id),
            parentId: f.parentId === undefined ? null : f.parentId
          };
        }),
        docs: allDocs().map(function (d) {
          return {
            id: d.id,
            title: d.title,
            folderId: d.folderId === undefined ? null : d.folderId,
            path: folderPath(d.folderId)
          };
        })
      },
      null,
      1
    );
  }

  /** 当前工作状态：用户问「保存了吗 / 多少字 / 存哪」时用它，别让它瞎猜 */
  function toolStatus() {
    var s = MM.store.get();
    var id = s.docId;
    var meta = id ? MM.docs.findMeta(id) : null;
    var view = MM.editor.raw();
    var sel = view ? view.state.selection.main : null;
    var selection = sel && sel.from !== sel.to ? MM.editor.getSelectionText() : '';

    var bound = MM.disk && MM.disk.isBound(id);
    var fsa = MM.providers && MM.providers.fsa;
    var fsaStatus = fsa && fsa.status ? fsa.status() : null;

    var where;
    if (bound) where = MM.disk.labelOf(id);
    else if (fsaStatus && fsaStatus.connected && fsaStatus.permission === 'granted') {
      where = fsaStatus.name + '/ …（本地文件夹）';
    } else {
      where = MM.i18n.t('aiWhereLibrary');
    }

    return JSON.stringify(
      {
        当前文档: {
          id: id,
          标题: meta ? meta.title : s.title,
          所在文件夹: meta ? folderPath(meta.folderId) : null
        },
        保存状态: s.saving ? '正在保存' : s.dirty ? '有未保存的修改（自动保存会处理）' : '已保存',
        上次保存时间: s.lastSaved ? new Date(s.lastSaved).toLocaleString() : '（本次会话还没保存过）',
        统计: { 字数: s.stats.words, 字符数: s.stats.chars, 行数: s.stats.lines },
        光标在第几行: s.cursorLine,
        当前选区: selection ? selection.slice(0, 300) + (selection.length > 300 ? '…' : '') : '没有选中任何文字',
        视图模式: { edit: '仅编辑', split: '分栏', preview: '仅预览' }[s.mode] || s.mode,
        存储: {
          类型: MM.provider.tierLabel(),
          后端: MM.provider.getKind(),
          保存位置: where
        },
        文档库: { 文档数: allDocs().length, 文件夹数: allFolders().length },
        界面: {
          主题: MM.settings.get('theme'),
          强调色: MM.settings.get('accent'),
          正文字体: MM.settings.get('textFont'),
          编辑器字号: MM.settings.get('fontSize') + 'px'
        }
      },
      null,
      1
    );
  }

  function toolRenameDoc(args) {
    var doc = findDoc(args.id || args.title);
    if (!doc) return Promise.resolve('找不到文档：' + (args.id || args.title || '(未指定)') + '。先用 list_library 看看有哪些。');

    var next = String(args.newTitle || '').trim();
    if (!next) return Promise.resolve('缺少 newTitle。');
    if (next === doc.title) return Promise.resolve('《' + doc.title + '》的标题本来就是「' + next + '」，不用改。');

    var clash = allDocs().some(function (d) {
      return d.id !== doc.id && String(d.title || '').toLowerCase() === next.toLowerCase();
    });
    if (clash) return Promise.resolve('这个名字已被占用：' + next + '，换一个。');

    var before = doc.title;
    return Promise.resolve(MM.docs.rename(doc.id, next)).then(function () {
      structTurn({
        title: MM.i18n.t('aiStructRename'),
        lines: [MM.i18n.t('aiStructRenameLine', { from: before, to: next })],
        undo: { type: 'rename_doc', id: doc.id, from: before }
      });
      return '已把《' + before + '》重命名为《' + next + '》，已生效。';
    });
  }

  function toolMoveDoc(args) {
    var doc = findDoc(args.id || args.title);
    if (!doc) return Promise.resolve('找不到文档：' + (args.id || args.title || '(未指定)') + '。');

    var target;
    if (args.folderId || args.folderName) {
      target = resolveFolder(args.folderId || args.folderName);
      if (!target) {
        return Promise.resolve(
          '找不到文件夹：' + (args.folderId || args.folderName) + '。先用 list_library 看看有哪些（也可以用 create_folder 先建一个）。'
        );
      }
    } else {
      target = { id: null, name: MM.i18n.t('aiRootFolder') };
    }

    var from = doc.folderId || null;
    if (from === target.id) {
      return Promise.resolve('《' + doc.title + '》本来就在「' + target.name + '」里，不用动。');
    }

    return Promise.resolve(MM.docs.moveDoc(doc.id, target.id)).then(function () {
      structTurn({
        title: MM.i18n.t('aiStructMove'),
        lines: [MM.i18n.t('aiStructMoveLine', { title: doc.title, from: folderPath(from), to: target.name })],
        undo: { type: 'move_doc', id: doc.id, from: from }
      });
      return '已把《' + doc.title + '》移到「' + target.name + '」，已生效。';
    });
  }

  function toolCreateFolder(args) {
    var name = String(args.name || '').trim();
    if (!name) return Promise.resolve('缺少 name。');

    var parent = null;
    if (args.parentId || args.parentName) {
      parent = resolveFolder(args.parentId || args.parentName);
      if (!parent) return Promise.resolve('找不到父文件夹：' + (args.parentId || args.parentName) + '。');
    }
    var parentId = parent ? parent.id : null;

    var dup = allFolders().some(function (f) {
      return (f.parentId || null) === parentId && String(f.name || '').toLowerCase() === name.toLowerCase();
    });
    if (dup) return Promise.resolve('同一层已经有叫「' + name + '」的文件夹了，换个名字。');

    return Promise.resolve(MM.docs.createFolder(name, parentId)).then(function (meta) {
      structTurn({
        title: MM.i18n.t('aiStructMkdir'),
        lines: [
          MM.i18n.t('aiStructMkdirLine', {
            name: name,
            parent: parent ? parent.name : MM.i18n.t('aiRootFolder')
          })
        ],
        undo: meta && meta.id ? { type: 'create_folder', id: meta.id } : null
      });
      return '已新建文件夹「' + name + '」，已生效。';
    });
  }

  function toolRenameFolder(args) {
    var folder = resolveFolder(args.id || args.name);
    if (!folder || folder.root) {
      return Promise.resolve('找不到文件夹：' + (args.id || args.name || '(未指定)') + '。');
    }

    var next = String(args.newName || '').trim();
    if (!next) return Promise.resolve('缺少 newName。');
    if (next === folder.name) return Promise.resolve('这个文件夹本来就叫「' + next + '」。');

    var meta0 = MM.docs.folderById(folder.id);
    var parentId = meta0 ? meta0.parentId || null : null;
    var clash = allFolders().some(function (f) {
      return (f.parentId || null) === parentId && String(f.name || '').toLowerCase() === next.toLowerCase();
    });
    if (clash) return Promise.resolve('同一层已经有叫「' + next + '」的文件夹了，换个名字。');

    var before = folder.name;
    return Promise.resolve(MM.docs.renameFolder(folder.id, next)).then(function () {
      structTurn({
        title: MM.i18n.t('aiStructRenameFolder'),
        lines: [MM.i18n.t('aiStructRenameFolderLine', { from: before, to: next })],
        undo: { type: 'rename_folder', id: folder.id, from: before }
      });
      return '已把文件夹「' + before + '」重命名为「' + next + '」，已生效。';
    });
  }

  function toolMoveFolder(args) {
    var folder = resolveFolder(args.id || args.name);
    if (!folder || folder.root) {
      return Promise.resolve('找不到文件夹：' + (args.id || args.name || '(未指定)') + '。');
    }

    var target;
    if (args.parentId || args.parentName) {
      target = resolveFolder(args.parentId || args.parentName);
      if (!target) return Promise.resolve('找不到目标父文件夹：' + (args.parentId || args.parentName) + '。');
    } else {
      target = { id: null, name: MM.i18n.t('aiRootFolder'), root: true };
    }

    // 防环必须自己先查：docs.moveFolder 遇到成环是「提示一下就返回 null」，
    // 从返回值分不出「成了」还是「绕回去了」，等它就等于事后才知道白干
    if (target.id && isSelfOrDescendant(target.id, folder.id)) {
      return Promise.resolve('不能把「' + folder.name + '」移进它自己或它的子文件夹里，会整棵子树脱树。');
    }

    var meta = MM.docs.folderById(folder.id);
    var from = meta ? meta.parentId || null : null;
    if (from === target.id) return Promise.resolve('「' + folder.name + '」本来就在那里，不用动。');

    return Promise.resolve(MM.docs.moveFolder(folder.id, target.id)).then(function () {
      structTurn({
        title: MM.i18n.t('aiStructMoveFolder'),
        lines: [
          MM.i18n.t('aiStructMoveFolderLine', { title: folder.name, from: folderPath(from), to: target.name })
        ],
        undo: { type: 'move_folder', id: folder.id, from: from }
      });
      return '已把文件夹「' + folder.name + '」移到「' + target.name + '」，已生效。';
    });
  }

  function toolSearch(args) {
    var q = String((args && args.query) || '');
    if (!q) return Promise.resolve('缺少 query');

    var needle = q.toLowerCase();
    var hits = [];

    return allDocs()
      .reduce(function (chain, doc) {
        return chain.then(function () {
          if (hits.length >= 24) return null;
          return readDocText(doc).then(function (text) {
            var lines = String(text).split('\n');
            for (var i = 0; i < lines.length && hits.length < 24; i++) {
              if (lines[i].toLowerCase().indexOf(needle) !== -1) {
                hits.push({ docId: doc.id, title: doc.title, line: i + 1, text: lines[i].slice(0, 160) });
              }
            }
          });
        });
      }, Promise.resolve())
      .then(function () {
        if (!hits.length) return '没有找到「' + q + '」';
        return JSON.stringify({ query: q, count: hits.length, hits: hits }, null, 1);
      });
  }

  /**
   * 执行一次工具调用。
   * 一律返回字符串（模型只吃得下字符串结果），出错也返回说明而不是抛出 ——
   * 让模型能看见「为什么失败」，它自己会换个法子再来。
   */
  function runTool(name, args) {
    args = args || {};

    try {
      if (name === 'list_library') return Promise.resolve(toolLibrary());

      if (name === 'read_doc') {
        var doc = findDoc(args.id || args.title);
        if (!doc) return Promise.resolve('找不到文档：' + (args.id || args.title || '(未指定)') + '。先用 list_library 看看有哪些。');
        return readDocText(doc).then(function (text) {
          return '《' + doc.title + '》\n\n' + clip(text);
        });
      }

      if (name === 'write_doc') {
        var target = findDoc(args.id || args.title);
        if (!target) return Promise.resolve('找不到文档：' + (args.id || args.title || '(未指定)'));

        return readDocText(target).then(function (before) {
          var after = String(args.content == null ? '' : args.content);
          var turn = proposeChange({
            kind: 'write',
            docId: target.id,
            title: target.title,
            before: before,
            after: after
          });

          // 告诉模型「还没生效」—— 否则它会以为已经改完，
          // 接下来基于一个不存在的状态继续推理
          return '已提出对《' + target.title + '》的改写方案（+ ' + turn.added + ' 行 / - ' + turn.removed +
            ' 行），等用户在界面上点「保留」才会生效。现在还不算改完。';
        });
      }

      if (name === 'create_doc') {
        var title = String(args.title || '').trim() || '未命名.md';
        var taken = allDocs().some(function (d) {
          return String(d.title).toLowerCase() === title.toLowerCase();
        });
        if (taken) return Promise.resolve('这个名字已被占用：' + title + '，换个标题再建。');

        // 新建也要先提案：一份没经过确认的新文件，和偷偷改一篇旧的一样讨厌
        var turn = proposeChange({
          kind: 'create',
          title: title,
          folderId: args.folderId || null,
          before: '',
          after: String(args.content || '')
        });

        return Promise.resolve(
          '已提出新建《' + title + '》（+ ' + turn.added + ' 行），等用户点「保留」才会真正创建。'
        );
      }

      if (name === 'search_docs') return toolSearch(args);

      if (name === 'get_status') return Promise.resolve(toolStatus());

      if (name === 'rename_doc') return toolRenameDoc(args);
      if (name === 'move_doc') return toolMoveDoc(args);
      if (name === 'create_folder') return toolCreateFolder(args);
      if (name === 'rename_folder') return toolRenameFolder(args);
      if (name === 'move_folder') return toolMoveFolder(args);

      return Promise.resolve('未知工具：' + name);
    } catch (err) {
      return Promise.resolve('工具执行出错：' + ((err && err.message) || err));
    }
  }

  /* ------------------------------------------------------------------
     调模型
     ------------------------------------------------------------------ */

  function request(messages) {
    var key = MM.settings.get('aiKey');
    if (!key) return Promise.reject(new Error('no-key'));

    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        model: MM.settings.get('aiModel') || 'deepseek-chat',
        messages: messages,
        tools: TOOLS,
        temperature: 0.3
      })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            var msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
            throw new Error(msg);
          }
          return data;
        });
      })
      .catch(function (err) {
        // fetch 本身失败（跨域被拦、断网）时抛的是 TypeError，
        // 信息量几乎为零，这里换成能看懂的说法
        if (err instanceof TypeError) throw new Error('cors-or-network');
        throw err;
      });
  }

  /** 一轮：把工具调用跑到没有为止，再取最终答复 */
  function converse(messages) {
    var rounds = 0;
    var usedTools = [];

    function step() {
      rounds++;
      if (rounds > MAX_ROUNDS) {
        return Promise.resolve({ text: MM.i18n.t('aiTooManySteps'), usedTools: usedTools });
      }

      return request(messages).then(function (data) {
        var choice = (data.choices && data.choices[0]) || {};
        var msg = choice.message || {};
        messages.push(msg);

        var calls = msg.tool_calls || [];
        if (!calls.length) {
          return { text: msg.content || '', usedTools: usedTools };
        }

        // 串行执行：这些工具都会动文档库，并发容易互相踩
        return calls
          .reduce(function (chain, call) {
            return chain.then(function () {
              var fn = call.function || {};
              var args = {};
              try {
                args = JSON.parse(fn.arguments || '{}');
              } catch (err) {
                args = {};
              }

              usedTools.push(fn.name);
              setStatus(MM.i18n.t('aiWorkingOn', { tool: fn.name }));

              return runTool(fn.name, args).then(function (result) {
                recordTool(fn.name, result);
                messages.push({
                  role: 'tool',
                  tool_call_id: call.id,
                  content: String(result)
                });
              });
            });
          }, Promise.resolve())
          .then(step);
      });
    }

    return step();
  }

  /* ------------------------------------------------------------------
     对话记录的存取
     ------------------------------------------------------------------ */

  function saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(turns));
    } catch (err) {
      // 配额满了就放弃保存：对话记录不值得为它弹一个错误提示
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function loadTurns() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-MAX_TURNS) : [];
    } catch (err) {
      return [];
    }
  }

  function dropTurns() {
    turns = [];
    saveNow();
  }

  /* ------------------------------------------------------------------
     界面
     ------------------------------------------------------------------ */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function bubble(role, text) {
    var row = el('div', 'ai-msg ai-msg--' + role);
    var body = el('div', 'ai-msg__body');
    // 纯文本即可：模型输出里的 Markdown 在这么窄的栏里反而难读
    body.textContent = text;
    row.appendChild(body);
    return row;
  }

  /**
   * 往对话区加一条。
   * keep = true 的才进对话记录（与模型真正往返的那些），
   * 「还没配 API Key」这类临时提示只上屏、不存档 —— 下次打开重算就是。
   */
  /**
   * 变更卡片：只列变化行，不铺整篇。
   * 与 Copilot 的对话侧一样 —— 要看上下文去编辑器里看，
   * 这里只回答「改了什么」，看完就能决定留不留。
   */
  function changeCard(turn) {
    // 结构改动（重命名 / 移动 / 新建文件夹）走另一张脸：
    // 它没有行级差异可言，而且状态是「已生效、可撤销」，
    // 与内容提案的「等你定夺」正好相反
    if (turn.kind === 'struct') return structCard(turn);

    var box = el('div', 'ai-change ai-change--' + turn.status);
    var i;

    // 标题、统计、按钮排在一行：卡片比对话区还高的话，
    // 「保留 / 撤销」得滚下去才看得见 —— 那就白摆这两个按钮了
    var head = el('div', 'ai-change__head');
    var titleText =
      turn.kind === 'create'
        ? MM.i18n.t('aiChangeNew', { title: turn.title })
        : MM.i18n.t('aiChangeTitle', { title: turn.title });
    var titleEl = el('span', 'ai-change__title', titleText);
    // 侧栏就这么宽，标题总会被截；至少让它悬停时能把全名说清楚
    titleEl.title = titleText;
    head.appendChild(titleEl);
    head.appendChild(el('span', 'ai-change__stat', '+' + turn.added + '/\u2212' + turn.removed));

    if (turn.status === 'pending') {
      var drop = el('button', 'ai-change__btn', MM.i18n.t('aiRevert'));
      var keep = el('button', 'ai-change__btn ai-change__btn--keep', MM.i18n.t('aiKeep'));
      drop.type = 'button';
      keep.type = 'button';
      drop.addEventListener('click', function () {
        resolveChange(turn, false);
      });
      keep.addEventListener('click', function () {
        resolveChange(turn, true);
      });
      head.appendChild(drop);
      head.appendChild(keep);
    } else {
      head.appendChild(
        el('span', 'ai-change__done', turn.status === 'kept' ? MM.i18n.t('aiKept') : MM.i18n.t('aiReverted'))
      );
    }

    box.appendChild(head);

    var body = el('div', 'ai-change__diff');
    var lines = diffLines(turn.before, turn.after);
    var shown = 0;
    var MAX_SHOWN = 40;

    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.type === 'same') continue;
      if (shown >= MAX_SHOWN) break;
      shown++;
      body.appendChild(
        el('div', 'ai-change__line ai-change__line--' + line.type,
          (line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '') + line.text)
      );
    }

    var rest = 0;
    for (; i < lines.length; i++) {
      if (lines[i].type !== 'same') rest++;
    }
    if (rest) {
      body.appendChild(el('div', 'ai-change__line ai-change__line--more', MM.i18n.t('aiChangeMore', { n: rest })));
    }
    if (!shown) {
      body.appendChild(el('div', 'ai-change__line', MM.i18n.t('aiChangeSame')));
    }

    box.appendChild(body);
    return box;
  }

  /**
   * 结构变更的卡片。
   * 它记的是「已经发生的事」，所以没有待定状态 —— 只有「已生效（可撤销）」
   * 与「已撤销」两种。撤销不了的时候（比如文件夹里已经有东西了）就直说。
   */
  function structCard(turn) {
    var box = el('div', 'ai-change ai-change--struct ai-change--' + turn.status);

    var head = el('div', 'ai-change__head');
    var titleEl = el('span', 'ai-change__title', turn.title);
    titleEl.title = turn.title;
    head.appendChild(titleEl);

    if (turn.status === 'kept' && turn.undo) {
      var undo = el('button', 'ai-change__btn', MM.i18n.t('aiUndo'));
      undo.type = 'button';
      undo.addEventListener('click', function () {
        undoStruct(turn);
      });
      head.appendChild(undo);
    } else {
      var done =
        turn.status === 'kept'
          ? MM.i18n.t('aiApplied')
          : turn.status === 'reverted'
            ? MM.i18n.t('aiReverted')
            : MM.i18n.t('aiCannotUndo');
      head.appendChild(el('span', 'ai-change__done', done));
    }

    box.appendChild(head);

    var body = el('div', 'ai-change__diff');
    (turn.lines || []).forEach(function (line) {
      body.appendChild(el('div', 'ai-struct__line', line));
    });
    box.appendChild(body);

    return box;
  }

  /**
   * 一行小字，不当成对话内容（不进上下文、不进存档）。
   * 专门用来摊事实：本轮跑了什么工具、以及哪里对不上。
   */
  function pushNote(text, warn) {
    if (!els.log) return;
    var row = el('div', 'ai-note' + (warn ? ' ai-note--warn' : ''), text);
    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function recordTool(name, result) {
    var text = String(result == null ? '' : result);
    var failed = FAIL_PREFIX.some(function (p) {
      return text.indexOf(p) === 0;
    });
    // 结构改动也算「真动了东西」：它不像 write_doc 那样需要用户确认，
    // 而是当场生效的 —— 模型说「已重命名」时这句话确实为真
    roundTools.push({
      name: name,
      write: !!(WRITE_TOOLS[name] || STRUCT_TOOLS[name]),
      failed: failed
    });
  }

  function toolSummary() {
    return roundTools
      .map(function (t) {
        return MM.i18n.t(TOOL_LABEL[t.name] || 'aiToolOther') + (t.failed ? MM.i18n.t('aiToolFailed') : '');
      })
      .join(' · ');
  }

  function push(role, text, keep) {
    if (!els.log) return;
    els.log.appendChild(bubble(role, text));
    els.log.scrollTop = els.log.scrollHeight;

    if (!keep) return;

    turns.push({ role: role, text: text });
    if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
    scheduleSave();
  }

  function setStatus(text) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.hidden = !text;
  }

  function setBusy(v) {
    busy = !!v;
    if (els.send) els.send.disabled = busy;
    if (els.input) els.input.disabled = busy;
    if (!busy) setStatus('');
  }

  /**
   * 没配 Key 时把表单露出来。
   *
   * 只动表单，**不动对话区与输入框** —— 让它们一直看得见：
   * 用户能读到「为什么现在不能用」，填完 key 也不是「忽然多出一块东西」。
   */
  function showKeyForm(show) {
    if (els.key) els.key.hidden = !show;
  }

  /* ------------------------------------------------------------------
     发送
     ------------------------------------------------------------------ */

  /**
   * 对话记录直接当上下文用：不必再单独维护一份 API 消息数组，
   * 两者一旦分开存，就总会有一个忘了更新的那一天。
   * 变更卡片不进上下文：它是给界面的提案，不是对话内容。
   */
  function buildMessages() {
    return [{ role: 'system', content: SYSTEM_PROMPT }].concat(
      turns
        .filter(function (t) {
          return t.role !== 'change';
        })
        .map(function (t) {
          var content = t.text;
          // 引用过的内容一直带着走：不重复附带的话，
          // 模型下一轮就只记得自己说过什么，忘了用户给过它什么
          if (t.role === 'user' && t.refNote) content = t.refNote + '\n\n【用户的话】\n' + content;
          return { role: t.role === 'user' ? 'user' : 'assistant', content: content };
        })
    );
  }

  function send(text) {
    if (busy) return Promise.resolve();
    text = String(text || '').trim();
    if (!text) return Promise.resolve();

    if (!MM.settings.get('aiKey')) {
      push('bot', MM.i18n.t('aiNoKey'));
      showKeyForm(true);
      return Promise.resolve();
    }

    showKeyForm(false);

    // 引用要在 send 之前取：clearRefs 会把它们清掉
    var usedRefs = allRefs();

    push('user', text, true);
    setBusy(true);
    roundTools = [];

    var userTurn = turns[turns.length - 1];

    return buildRefBlock(usedRefs)
      .then(function (block) {
        // 引用内容挂在**这一条**用户消息上，而不是只拼进本次请求：
        // 下一轮要把「用户给它看过什么」一并带上，否则它转头就不记得了
        if (block && userTurn) {
          userTurn.refNote = block;
          scheduleSave();
        }
        // 引用是一次性的：它属于刚发出去的这一句
        if (usedRefs.length) clearRefs();
        return converse(buildMessages());
      })
      .then(function (out) {
        var reply = (out.text || '').trim();

        // 「少说话」也体现在这里：工具干过活、模型却什么都没说时，
        // 不要留一片空白，用一句「完成」交代过去
        if (!reply) reply = out.usedTools.length ? MM.i18n.t('aiDone') : MM.i18n.t('aiEmptyReply');

        // 先把事实摊出来，再说结论：模型说的话要和它实际干的事对得上，
        // 用户得能自己核对，而不是只能信它
        if (roundTools.length) {
          pushNote(MM.i18n.t('aiToolsRun', { list: toolSummary() }));
        }

        // 兜底：一口咬定改了，但这一轮压根没调过写类工具
        if (
          CLAIM_RE.test(reply) &&
          !roundTools.some(function (t) {
            return t.write;
          })
        ) {
          pushNote(MM.i18n.t('aiNoChangeWarning'), true);
        }

        push('bot', reply, true);
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err);
        if (msg === 'no-key') msg = MM.i18n.t('aiNoKey');
        else if (msg === 'cors-or-network') msg = MM.i18n.t('aiCors');
        else if (msg === 'Failed to fetch') msg = MM.i18n.t('aiCors');

        // 失败这轮留在记录里不删：问题已经上屏了，下一次提问带上它
        // 反而能让模型知道「刚才那条没成」
        push('bot', MM.i18n.t('aiFailed', { msg: msg }));
      })
      .then(function () {
        setBusy(false);
      });
  }

  /* ------------------------------------------------------------------
     装配
     ------------------------------------------------------------------ */

  function setCollapsed(collapsed) {
    if (!els.root) return;
    els.root.classList.toggle('is-collapsed', collapsed);
    if (els.toggle) els.toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    MM.settings.set({ aiOpen: !collapsed });
  }

  /* ------------------------------------------------------------------
     高度拖动
     ------------------------------------------------------------------ */

  var MIN_AI_H = 120;
  /** 上面至少给文档列表留出这么多，不能拖到把别人挤没 */
  var RESERVED_TOP = 140;

  function clampHeight(px) {
    var host = els.root ? els.root.parentNode : null;
    var avail = host && host.clientHeight ? host.clientHeight : 640;
    var max = Math.max(MIN_AI_H, avail - RESERVED_TOP);
    return Math.round(Math.min(max, Math.max(MIN_AI_H, px)));
  }

  function applyHeight(px) {
    if (!els.root) return;
    var h = clampHeight(px);
    els.root.style.setProperty('--mm-ai-h', h + 'px');
    return h;
  }

  function initResizer() {
    var rz = els.resizer;
    if (!rz) return;

    var startY = 0;
    var startH = 0;

    function onMove(e) {
      // 往上拖（clientY 变小）应该变高，所以是「起点减当前」
      applyHeight(startH + (startY - e.clientY));
    }

    function onUp() {
      rz.classList.remove('is-active');
      document.body.classList.remove('is-resizing-ai');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (els.root) {
        // 存的直接是量出来的真实高度，不存「拖了多少像素」——
        // 后者换个窗口尺寸就还原不回去了
        MM.settings.set({ aiHeight: Math.round(els.root.getBoundingClientRect().height) });
      }
    }

    rz.addEventListener('mousedown', function (e) {
      if (els.root.classList.contains('is-collapsed')) return;
      startY = e.clientY;
      startH = els.root.getBoundingClientRect().height;
      rz.classList.add('is-active');
      document.body.classList.add('is-resizing-ai');
      // 不 preventDefault 的话拖动会顺带选中侧栏里的文字
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 双击回到默认比例：拖歪了想还原时，比一点点拖回去省事
    rz.addEventListener('dblclick', function () {
      if (els.root) els.root.style.removeProperty('--mm-ai-h');
      MM.settings.set({ aiHeight: 0 });
    });

    // 窗口变小后，之前拖出来的高度可能已经超过可用空间
    window.addEventListener('resize', function () {
      if (MM.settings.get('aiHeight')) applyHeight(els.root.getBoundingClientRect().height);
    });

    if (MM.settings.get('aiHeight')) applyHeight(MM.settings.get('aiHeight'));
  }

  /* ------------------------------------------------------------------
     从侧栏拖进来当引用
     ------------------------------------------------------------------ */

  function parseDrop(e) {
    var raw = '';
    try {
      raw = e.dataTransfer.getData('text/plain') || '';
    } catch (err) {
      return null;
    }
    // 侧栏拖拽写的就是 "doc:<id>" / "folder:<id>"（见 ui/sidebar.js）
    var m = /^(doc|folder):(.+)$/.exec(raw);
    if (!m) return null;
    return { type: m[1], id: m[2] };
  }

  function addDropped(payload) {
    var meta = MM.docs.findMeta(payload.id);

    if (payload.type === 'doc') {
      if (!meta) return;
      addRef({ kind: 'doc', docId: meta.id, title: meta.title });
      return;
    }

    var folder = MM.docs.folderById(payload.id);
    if (!folder) return;
    addRef({ kind: 'folder', folderId: folder.id, name: folder.name });
  }

  function initDrop() {
    var root = els.root;
    if (!root) return;

    root.addEventListener('dragover', function (e) {
      if (!/text\/plain/.test(String(e.dataTransfer.types || ''))) return;
      e.preventDefault();
      // 侧栏那边 dragstart 写的是 move；指向这里其实是「复制一份给它看」，
      // 所以 sidebar 把 effectAllowed 放宽成了 copyMove
      e.dataTransfer.dropEffect = 'copy';
      root.classList.add('is-drop');
    });

    root.addEventListener('dragleave', function (e) {
      if (root.contains(e.relatedTarget)) return;
      root.classList.remove('is-drop');
    });

    root.addEventListener('drop', function (e) {
      root.classList.remove('is-drop');
      var payload = parseDrop(e);
      if (!payload) return;
      // 必须拦住：不拦的话事件会继续冒泡到侧栏的树，
      // 变成「拖到 AI 里顺手把文档也移动了」
      e.preventDefault();
      e.stopPropagation();
      addDropped(payload);
    });
  }

  function init() {
    els.root = document.getElementById('panel-ai');
    if (!els.root) return;

    els.log = document.getElementById('ai-log');
    els.input = document.getElementById('ai-input');
    els.send = document.getElementById('ai-send');
    els.status = document.getElementById('ai-status');
    els.toggle = document.getElementById('ai-toggle');
    els.clear = document.getElementById('ai-clear');
    els.key = document.getElementById('ai-keyform');
    els.keyInput = document.getElementById('ai-key');
    els.keySave = document.getElementById('ai-key-save');
    els.compose = document.getElementById('ai-compose');
    els.refs = document.getElementById('ai-refs');
    els.resizer = document.getElementById('ai-resizer');

    /* 发送是「按钮 click + 回车键」两件事，不走表单提交 ——
       表单提交会导航、刷新页面，把正在输入的对话全冲掉 */
    if (els.send) {
      els.send.addEventListener('click', function () {
        var text = els.input ? els.input.value : '';
        if (els.input) {
          els.input.value = '';
          els.input.style.height = '';
        }
        send(text);
      });
    }

    if (els.toggle) {
      els.toggle.addEventListener('click', function () {
        setCollapsed(!els.root.classList.contains('is-collapsed'));
      });
    }

    if (els.compose) {
      // 以前这里绑的是 submit；换成 div 之后没这回事了，
      // 但这个监听留着兜住「万一」：提交被拦住总比整页刷新强
      els.compose.addEventListener('submit', function (e) {
        e.preventDefault();
      });
    }

    // 回车发送、Shift+回车换行；输入框随内容长高（上限交给 CSS）
    if (els.input) {
      els.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (els.send) els.send.click();
        }
      });

      els.input.addEventListener('input', function () {
        els.input.style.height = 'auto';
        els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
        // 输入里出现「现在的文档」这类说法就自动挂上引用；
        // 说法被删掉时又把引用收回去
        syncAutoRef();
      });
    }

    if (els.clear) {
      els.clear.addEventListener('click', function () {
        dropTurns();
        if (els.log) els.log.innerHTML = '';
        setStatus('');
        push('bot', MM.i18n.t('aiHello'));
      });
    }

    if (els.keySave) {
      els.keySave.addEventListener('click', function () {
        var v = (els.keyInput && els.keyInput.value || '').trim();
        if (!v) return;
        MM.settings.set({ aiKey: v });
        if (els.keyInput) els.keyInput.value = '';
        showKeyForm(false);
        push('bot', MM.i18n.t('aiKeySaved'));
      });
    }

    // 折叠状态跟着设置走，重启后还是上次的样子
    setCollapsed(!MM.settings.get('aiOpen'));

    initResizer();
    initDrop();

    // 换文档：行引用的行号只对「那一篇的第几行」有意义，
    // 换了文档就作废（编辑器重建 state 时也会把手里的勾选清空，两边一致）
    MM.store.watch('docId', function () {
      selLines = {};
      renderRefs();
    });

    renderRefs();

    // 把上次的对话接回来；一条都没存过才拿欢迎语打头
    turns = loadTurns();
    if (turns.length) {
      turns.forEach(function (t) {
        if (!els.log) return;
        // 上次没定夺的变更，刷完页还等着你决定
        if (t.role === 'change') {
          t.node = changeCard(t);
          els.log.appendChild(t.node);
        } else {
          els.log.appendChild(bubble(t.role, t.text));
        }
      });
      if (els.log) els.log.scrollTop = els.log.scrollHeight;
    } else {
      push('bot', MM.i18n.t('aiHello'));
    }

    if (!MM.settings.get('aiKey')) showKeyForm(true);

    // 上次没定夺的改写：把差异重新摆回编辑区，接着上次的样子等你决定
    var pend = turns.filter(function (t) {
      return t.role === 'change' && t.status === 'pending';
    });
    if (pend.length) applyDiff(pend[pend.length - 1]);

    // 用户自己动手改了文档 → 说明他不打算按卡片来：
    // 撤掉高亮、把卡片作废。否则点「保留」会把他刚敲的几行整篇盖掉
    MM.editor.onChange(function () {
      if (applying || !activeTurn) return;
      var stale = activeTurn;
      clearDiff();
      if (stale.status === 'pending') {
        stale.status = 'reverted';
        scheduleSave();
        redrawCard(stale);
      }
    });

    // 关页面/刷新前把还在防抖里的那次写入落掉
    window.addEventListener('beforeunload', saveNow);
  }

  MM.aiPanel = {
    init: init,
    send: send,
    setCollapsed: setCollapsed,
    runTool: runTool,
    /** 编辑器内的差异高亮扩展（由 cm-setup 装进 EditorView） */
    diffExtension: diffField,
    /** 行号左边那列引用复选框（由 cm-setup 装进 EditorView，必须排在行号之前） */
    lineSelectExtension: lineSelExtension,
    /** 行引用的 StateField，给测试直接查状态用 */
    lineField: lineSelField,
    /** 当前勾选的行号（只读） */
    selectedLines: function () {
      return Object.keys(selLines).map(Number);
    },
    /** 当前挂着的引用（只读），给调试与测试用 */
    refs: function () {
      return allRefs();
    },
    toggleLineRef: toggleLineRef,
    clearRefs: clearRefs,
    /** 对话记录（只读），主要给调试与后续功能用 */
    history: function () {
      return turns.slice();
    }
  };
})();
