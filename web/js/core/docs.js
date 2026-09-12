/**
 * MixMark · 文档生命周期
 * ===============================================================
 * 职责：打开 / 新建 / 重命名 / 删除 / 自动保存 / 统计 / 大纲。
 *
 * 设计决定：正文内容**不放进 MM.store**。
 *   编辑器每次敲键都会改内容，若把字符串塞进 store 并广播，
 *   会造成无谓的全量通知。正文留在本模块闭包里，只有
 *   元数据（标题、脏标记、统计、大纲）进入 store。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 当前文档的工作副本 */
  var current = {
    id: null,
    title: '',
    autoTitle: true,
    content: '',
    dirty: false
  };

  var statsTimer = null;
  var saveTimer = null;
  var savePromise = null;

  /* ------------------------------------------------------------------
     派生数据
     ------------------------------------------------------------------ */

  /**
   * 字数统计：中文按字计，西文按词计。
   * 这是中文用户最符合直觉的「字数」口径。
   */
  var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
  var LATIN_RE = /[A-Za-z0-9_'\u2019-]+/g;

  function computeStats(text) {
    var cjk = (text.match(CJK_RE) || []).length;
    var latin = (text.replace(CJK_RE, ' ').match(LATIN_RE) || []).length;
    return {
      words: cjk + latin,
      chars: text.length,
      lines: text ? text.split('\n').length : 1
    };
  }

  /**
   * 提取标题大纲。跳过围栏代码块内的 # 行，避免把注释当成标题。
   */
  function parseOutline(text) {
    var lines = text.split('\n');
    var out = [];
    var fence = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // 用 [ \t] 而非 \s 表示缩进，与 pipeline.js 的扫描器保持同一约定。
      // （那边曾因 \s 会吃掉换行符而导致围栏误判，全文公式失效）
      var fenceOpen = /^[ \t]{0,3}(```|~~~)/.exec(line);
      if (fenceOpen) {
        if (!fence) {
          fence = fenceOpen[1];
        } else if (line.trim().indexOf(fence) === 0) {
          fence = null;
        }
        continue;
      }
      if (fence) continue;

      var m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        out.push({
          level: m[1].length,
          // 去掉行内标记，大纲里不该出现 ** 或 `
          text: m[2].replace(/[*_`~]/g, '').trim(),
          line: i + 1
        });
      }
    }
    return out;
  }

  /** 从正文推导标题：取第一个 H1，没有则取第一行非空文本 */
  function deriveTitle(text) {
    var m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(text);
    if (m) return m[1].replace(/[*_`~]/g, '').trim().slice(0, 80);

    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t && !/^(```|~~~|>|\||-{3,})/.test(t)) {
        return t.replace(/^[#>\-*\s]+/, '').replace(/[*_`~]/g, '').trim().slice(0, 80);
      }
    }
    return '';
  }

  function displayTitle() {
    return current.title || MM.i18n.t('untitled');
  }

  /* ------------------------------------------------------------------
     向 store 同步元数据
     ------------------------------------------------------------------ */

  function pushStats(text) {
    MM.store.set({
      stats: computeStats(text),
      outline: parseOutline(text)
    });
  }

  function scheduleStats(text) {
    if (statsTimer) clearTimeout(statsTimer);

    // 记下这份统计属于哪篇文档。防抖窗口内用户可能已经切走了，
    // 不校验就会把上一篇的字数与大纲贴到新文档上（已踩过）
    var forId = current.id;

    statsTimer = setTimeout(function () {
      statsTimer = null;
      if (forId !== current.id) return;
      pushStats(text);
    }, 180);
  }

  /* ------------------------------------------------------------------
     脏标记与自动保存
     ------------------------------------------------------------------ */

  function markDirty() {
    if (current.dirty) return;
    current.dirty = true;
    MM.store.set({ dirty: true });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    if (!MM.settings.get('autoSave')) return;
    if (!current.id) return;

    // 同样要校验文档身份：否则「编辑 A → 立刻切到 B」时，
    // 这次延时保存会作用在 B 身上，而 A 的修改永远不会落盘
    var forId = current.id;

    saveTimer = setTimeout(function () {
      saveTimer = null;
      if (forId !== current.id) return;
      save();
    }, MM.settings.get('autoSaveDelay'));
  }

  /**
   * 落盘所有挂起的工作，并取消尚未触发的防抖任务。
   * 切换文档、关闭窗口前必须调用。
   */
  function flushPending() {
    if (statsTimer) {
      clearTimeout(statsTimer);
      statsTimer = null;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (current.id && current.dirty) return save({ force: true });
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------
     保存
     ------------------------------------------------------------------ */

  /**
   * 写盘。并发调用会复用同一个 Promise，避免重复写入。
   * @param {object} [opts] { force: true 时即使不脏也写 }
   */
  function save(opts) {
    if (!current.id) return Promise.resolve();

    var force = opts && opts.force;
    if (!current.dirty && !force) return Promise.resolve();
    if (savePromise) return savePromise;

    var snapshot = current.content;

    MM.store.set({ saving: true });

    savePromise = MM.provider
      .get()
      .write(current.id, snapshot)
      .then(function (res) {
        current.dirty = false;
        MM.store.set({
          saving: false,
          dirty: false,
          lastSaved: Date.now()
        });

        // 自动标题跟随：用户没手动改过名，就跟着 H1 走
        if (current.autoTitle) {
          var derived = deriveTitle(snapshot);
          if (derived && derived !== current.title) {
            current.title = derived;
            MM.store.set({ title: derived });
            refreshIndexSoon();
          }
        }

        // 保存成功即清掉崩溃恢复快照
        if (MM.recovery) MM.recovery.clear();

        if (res && res.usage && res.usage.ratio >= (MM.provider.get().quotaWarnRatio || 0.8)) {
          MM.bus.emit('storage:near-full', res.usage);
        }

        savePromise = null;
        return true;
      })
      .catch(function (err) {
        savePromise = null;
        MM.store.set({ saving: false });

        if (err && err.quota) {
          MM.bus.emit('storage:full');
        } else {
          MM.bus.emit('toast', {
            level: 'danger',
            text: MM.i18n.t('toastSaveFailed', {
              msg: MM.i18n.t('errWriteFailed') + (err && err.message ? ' (' + err.message + ')' : '')
            })
          });
        }
        // 让调用方知道保存失败，但不要把异常抛给编辑器的事件回调
        return false;
      });

    return savePromise;
  }

  /** 标题变化后刷新侧栏列表（防抖，避免连打标题时频繁重排） */
  var indexTimer = null;
  function refreshIndexSoon() {
    if (indexTimer) clearTimeout(indexTimer);
    indexTimer = setTimeout(function () {
      indexTimer = null;
      refreshIndex();
    }, 600);
  }

  function refreshIndex() {
    var provider = MM.provider.get();

    // 兼容尚未实现文件夹能力的 provider（如后续的 FSA 实现）
    var foldersP = provider.listFolders ? provider.listFolders() : Promise.resolve([]);

    return Promise.all([provider.list(), foldersP])
      .then(function (res) {
        MM.store.set({ docs: res[0], folders: res[1] });

        // 文件夹删掉后，设置里的展开记录会变成孤儿，顺手清掉
        pruneExpanded(
          res[1].map(function (f) {
            return f.id;
          })
        );
      })
      .catch(function (err) {
        console.error('[docs] 刷新索引失败', err);
      });
  }

  /* ------------------------------------------------------------------
     打开 / 新建 / 重命名 / 删除
     ------------------------------------------------------------------ */

  /**
   * 已打开的文档 id，顺序即标签顺序。
   *
   * 纯粹是界面状态：「当前是哪一篇」仍然只看 current.id，
   * 标签栏只是把「曾经打开过」这件事记下来。两者分开的好处是
   * 标签栏坏掉也不会影响文档读写。
   */
  var openIds = [];

  function publishTabs() {
    MM.store.set({ openTabs: openIds.slice() });
  }

  /**
   * 按给定顺序重排标签（用户在标签栏里拖出来的顺序）。
   *
   * 传进来的清单只当"顺序建议"用：不认识的 id 一律丢掉，
   * 没提到但确实打开着的保留在末尾 —— 万一清单不全，
   * 也不该有标签凭空消失。
   */
  function reorderTabs(ids) {
    if (!ids || !ids.length) return;

    var known = {};
    openIds.forEach(function (id) {
      known[id] = true;
    });

    var next = ids.filter(function (id) {
      return known[id];
    });
    openIds.forEach(function (id) {
      if (next.indexOf(id) === -1) next.push(id);
    });

    if (next.join(',') === openIds.join(',')) return;

    openIds = next;
    publishTabs();
  }

  function open(id) {
    var provider = MM.provider.get();

    // 先把上一篇落盘再读新的：
    // 「编辑 A → 立刻切到 B」时 A 的修改还停在防抖窗口里，
    // 不冲一次就会被永久丢弃。
    return flushPending()
      .then(function () {
        return provider.read(id);
      })
      .then(function (content) {
        current.id = id;
        current.content = content;

        var meta = findMeta(id);
        current.title = (meta && meta.title) || '';
        current.autoTitle = meta ? meta.autoTitle !== false : true;
        current.dirty = false;

        MM.store.set({
          docId: id,
          title: displayTitle(),
          // 格式跟着文档走：新建时选一次，之后切换标签也能恢复
          format: (meta && meta.format) || 'md',
          dirty: false,
          lastSaved: (meta && meta.mtime) || Date.now()
        });

        pushStats(content);

        // 每打开一篇就占一个标签；已经在标签栏里的只是切过去
        if (openIds.indexOf(id) === -1) openIds.push(id);
        publishTabs();

        MM.bus.emit('doc:opened', { id: id, content: content });

        // 记下最后打开的文档，下次启动直接回到这里
        try {
          window.localStorage.setItem('mixmark:last-doc', id);
        } catch (err) {
          /* 忽略：非致命 */
        }

        return content;
      })
      .catch(function (err) {
        MM.bus.emit('toast', {
          level: 'danger',
          text: MM.i18n.t('errReadFailed') + ' ' + ((err && err.message) || '')
        });
        throw err;
      });
  }

  /**
   * 关闭一个标签。
   *
   * 只把它从标签栏拿掉，文档本身完好无损 —— 与「删除文档」是两件事。
   * 关掉的若是当前这一篇，切到剩下的最后一篇；一个不剩就新建一篇，
   * 保证标签栏不会空着（空着的话编辑区没有归属，反而更懵）。
   */
  function closeTab(id) {
    var at = openIds.indexOf(id);
    if (at === -1) return Promise.resolve(false);

    openIds.splice(at, 1);
    publishTabs();

    if (id !== current.id) return Promise.resolve(true);
    if (openIds.length) {
      return open(openIds[openIds.length - 1]).then(function () {
        return true;
      });
    }
    return create({ content: '' }).then(function () {
      return true;
    });
  }

  function findMeta(id) {
    var list = MM.store.get().docs;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function create(opts) {
    opts = opts || {};
    var provider = MM.provider.get();
    var content = opts.content || '';

    // 带内容创建时先推导一次标题：这样欢迎文档一打开就显示
    // 「欢迎使用 MixMark」，而不是光秃秃的「未命名文档」。
    // autoTitle 仍然保持开启，之后继续跟随正文里的 H1 变化。
    var title = opts.title || (content ? deriveTitle(content) : '');

    // 不传 folderId 时落到「当前选中的文件夹」—— 选中文件夹后新建，
    // 新文档自然出现在该文件夹里，不需要额外的移动操作
    var folderId = opts.folderId !== undefined ? opts.folderId : MM.store.get().activeFolderId;

    return provider
      .create({
        title: title,
        content: content,
        format: opts.format,
        autoTitle: opts.autoTitle !== false,
        folderId: folderId || null
      })
      .then(function (meta) {
        return refreshIndex().then(function () {
          return open(meta.id);
        });
      });
  }

  function rename(id, title) {
    return MM.provider
      .get()
      .rename(id, title)
      .then(function () {
        if (id === current.id) {
          current.title = title;
          current.autoTitle = false;
          MM.store.set({ title: displayTitle() });
        }
        return refreshIndex();
      });
  }

  function duplicate(id) {
    var provider = MM.provider.get();
    var meta = findMeta(id);
    var title = ((meta && meta.title) || MM.i18n.t('untitled')) + ' copy';

    return provider.read(id).then(function (content) {
      return provider
        .create({
          title: title,
          content: content,
          autoTitle: false,
          // 副本放在原文档同一个文件夹里
          folderId: (meta && meta.folderId) || null
        })
        .then(function (created) {
          return refreshIndex().then(function () {
            return open(created.id);
          });
        });
    });
  }

  /* ------------------------------------------------------------------
     文件夹
     ------------------------------------------------------------------ */

  function folderById(id) {
    var list = MM.store.get().folders;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /**
   * 新建文件夹。默认建在「当前选中的文件夹」里，
   * 因此往深处建结构就是「选一层 → 建一层」，不需要拖拽。
   */
  function createFolder(name, parentId) {
    var provider = MM.provider.get();
    if (!provider.createFolder) return Promise.reject(new Error('unsupported'));

    var parent = parentId === undefined ? MM.store.get().activeFolderId : parentId;

    return provider.createFolder({ name: name || '', parentId: parent || null }).then(function (meta) {
      return refreshIndex().then(function () {
        // 保证父级是展开的，新文件夹立刻可见。
        //
        // 但**不**把新文件夹设为当前选中：否则连点两次「+」会一路往深处钻
        // （第二个文件夹变成第一个的子文件夹）。多数人按第二次时想要的是
        // 同级追加；要往下建一层，先点一下那个文件夹即可 —— 一步操作，语义清楚。
        if (parent) setFolderExpanded(parent, true);
        return meta;
      });
    });
  }

  function renameFolder(id, name) {
    var provider = MM.provider.get();
    if (!provider.renameFolder) return Promise.reject(new Error('unsupported'));

    return provider.renameFolder(id, name).then(function () {
      return refreshIndex();
    });
  }

  /** 删除前先统计影响范围，供确认框把话说清楚 */
  function folderStats(id) {
    var provider = MM.provider.get();
    if (!provider.folderStats) return Promise.resolve({ docs: 0, folders: 0 });
    return provider.folderStats(id);
  }

  function removeFolder(id) {
    var provider = MM.provider.get();
    if (!provider.removeFolder) return Promise.reject(new Error('unsupported'));

    return provider
      .removeFolder(id)
      .then(function () {
        return refreshIndex();
      })
      .then(function () {
        var state = MM.store.get();

        // 当前打开的文档可能就在被删的子树里，得重新挑一篇
        var docAlive = state.docs.some(function (d) {
          return d.id === state.docId;
        });

        var next = null;
        if (!docAlive) {
          next = state.docs.length ? open(state.docs[0].id) : create({ content: '' });
        }

        return Promise.resolve(next).then(function () {
          // 选中的文件夹若也被删了，退回根目录，
          // 否则后续新建会落在一个不存在的文件夹里
          var active = MM.store.get().activeFolderId;
          if (active && !folderById(active)) MM.store.set({ activeFolderId: null });
        });
      });
  }

  /* ------------------------------------------------------------------
     移动
     ------------------------------------------------------------------ */

  function moveDoc(id, folderId) {
    var provider = MM.provider.get();
    if (!provider.moveDoc) return Promise.reject(new Error('unsupported'));

    return provider.moveDoc(id, folderId || null).then(function () {
      return refreshIndex();
    });
  }

  function moveFolder(id, parentId) {
    var provider = MM.provider.get();
    if (!provider.moveFolder) return Promise.reject(new Error('unsupported'));

    return provider
      .moveFolder(id, parentId || null)
      .then(function () {
        return refreshIndex();
      })
      .catch(function (err) {
        // 拖到自己身上/自己的子文件夹里属于常见误操作，
        // 给一句明确提示，不要静默失败
        if (err && err.message === 'cycle') {
          MM.bus.emit('toast', { level: 'danger', text: MM.i18n.t('toastCannotMoveIntoSelf') });
          return null;
        }
        throw err;
      });
  }

  /* ------------------------------------------------------------------
     展开状态（视图偏好，存设置而不是文档数据）
     ------------------------------------------------------------------ */

  function expandedList() {
    var list = MM.settings.get('expandedFolders');
    return Array.isArray(list) ? list : [];
  }

  function isFolderExpanded(id) {
    return expandedList().indexOf(id) !== -1;
  }

  function setFolderExpanded(id, expanded) {
    var list = expandedList().slice();
    var i = list.indexOf(id);

    if (expanded && i === -1) list.push(id);
    else if (!expanded && i !== -1) list.splice(i, 1);
    else return;

    MM.settings.set({ expandedFolders: list });
  }

  function toggleFolder(id) {
    setFolderExpanded(id, !isFolderExpanded(id));
  }

  /** 删除文件夹时清掉它的展开记录，避免设置里越积越多 */
  function pruneExpanded(validIds) {
    var list = expandedList();
    var kept = list.filter(function (id) {
      return validIds.indexOf(id) !== -1;
    });
    if (kept.length !== list.length) MM.settings.set({ expandedFolders: kept });
  }

  function remove(id) {
    return MM.provider
      .get()
      .remove(id)
      .then(function () {
        // 文档没了，标签也不能留着（否则标签栏会出现点不开的空标签）
        var at = openIds.indexOf(id);
        if (at !== -1) openIds.splice(at, 1);
        publishTabs();

        var remaining = MM.store.get().docs.filter(function (d) {
          return d.id !== id;
        });

        // 删掉的正是当前文档：切到列表里的下一个，没有就新建
        if (id === current.id) {
          if (remaining.length) {
            return refreshIndex().then(function () {
              return open(remaining[0].id);
            });
          }
          return refreshIndex().then(function () {
            return create({ content: '' });
          });
        }
        return refreshIndex();
      });
  }

  /* ------------------------------------------------------------------
     供编辑器调用
     ------------------------------------------------------------------ */

  /**
   * 内容变化。这是最高频的入口，必须轻量：
   * 只做脏标记 + 防抖统计 + 防抖保存，不做任何 DOM 操作。
   */
  function setContent(text) {
    current.content = text;
    markDirty();
    scheduleStats(text);
    scheduleSave();
    if (MM.recovery) MM.recovery.note(current.id, text);
  }

  /* ------------------------------------------------------------------
     启动
     ------------------------------------------------------------------ */

  /**
   * 首启示例文档的标题。
   *
   * 单独提出来是因为顶栏要用它做一件事：这份示例叫「欢迎使用 MixMark」，
   * 而顶栏最左边本来就写着 MixMark —— 摆在一起就是同一句话说了两遍。
   * 所以这份文档的标题位留空，等用户改名或新建文档后自然就出现了。
   */
  var WELCOME_TITLE = '欢迎使用 MixMark';

  /** 首次启动时的示例文档，让用户打开就有东西可看 */
  function welcomeContent() {
    return [
      '# ' + WELCOME_TITLE,
      '',
      '一个极简的 Markdown 编辑器。所有内容都保存在**你自己的设备**上。',
      '',
      '## 快速上手',
      '',
      '- 左侧输入，右侧实时预览',
      '- `Ctrl + S` 立即保存（平时会自动保存）',
      '- `Ctrl + Shift + P` 打开命令面板，可以搜索所有功能',
      '- 左侧侧栏可以切换「文档」和「大纲」两个面板',
      '',
      '## 支持的语法',
      '',
      '行内代码 `const a = 1`，**加粗**，*斜体*，~~删除线~~，还有[链接](https://example.com)。',
      '',
      '> 引用块：适合放摘录或提示。',
      '',
      '```js',
      '// 代码块会按语言高亮',
      'function greet(name) {',
      '  return `你好，${name}`;',
      '}',
      '```',
      '',
      '### 数学公式',
      '',
      '行内公式 $E = mc^2$，块级公式：',
      '',
      '$$',
      '\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}',
      '$$',
      '',
      '### 表格',
      '',
      '| 功能 | 快捷键 |',
      '| --- | --- |',
      '| 加粗 | Ctrl + B |',
      '| 斜体 | Ctrl + I |',
      '| 保存 | Ctrl + S |',
      '| 命令面板 | Ctrl + Shift + P |',
      '',
      '### 任务列表',
      '',
      '- [x] 打开 MixMark',
      '- [x] 读到这里',
      '- [ ] 写下你的第一篇笔记',
      '',
      '---',
      '',
      '把这段内容全选删掉，就可以开始你自己的写作了。'
    ].join('\n');
  }

  /**
   * 切换存储位置之后调用：重新拉一遍索引，并打开一篇合适的文档。
   * 新位置是空的话不自动造文件 —— 往用户硬盘上凭空写一个 untitled.md
   * 是不礼貌的，把编辑器清空、等他按「+」更合适。
   */
  function reload() {
    return flushPending()
      .then(function () {
        return refreshIndex();
      })
      .then(function () {
        var state = MM.store.get();

        var alive =
          state.docId &&
          state.docs.some(function (d) {
            return d.id === state.docId;
          });

        if (alive) return open(state.docId);
        if (state.docs.length) return open(state.docs[0].id);

        clearCurrent();
        return null;
      });
  }

  /** 把「当前文档」置空（编辑器变空白，但不写盘、不建文件） */
  function clearCurrent() {
    current.id = null;
    current.content = '';
    current.title = '';
    current.dirty = false;

    MM.store.set({
      docId: null,
      title: '',
      dirty: false,
      stats: { words: 0, chars: 0, lines: 1 },
      outline: []
    });

    MM.bus.emit('doc:opened', { id: null, content: '' });
  }

  /**
   * 启动流程：初始化存储 → 读索引 → 打开上次的文档 / 首个文档 / 新建示例。
   */
  function boot() {
    return MM.provider
      .init()
      .then(function (provider) {
        MM.store.set({ tier: provider.kind });
        // 一次性把文档与文件夹都拉进来，避免启动后列表闪一下才补齐
        return refreshIndex().then(function () {
          return MM.store.get();
        });
      })
      .then(function (state) {
        var list = state.docs;

        // 首次启动：一篇文档都没有时建一篇示例，让用户打开就有东西可看
        if (!list.length) {
          return create({ content: welcomeContent() });
        }

        var lastId = null;
        try {
          lastId = window.localStorage.getItem('mixmark:last-doc');
        } catch (err) {
          /* 忽略：非致命 */
        }

        var exists =
          lastId &&
          list.some(function (d) {
            return d.id === lastId;
          });

        return open(exists ? lastId : list[0].id);
      });
  }

  MM.docs = {
    boot: boot,
    open: open,
    reload: reload,
    clearCurrent: clearCurrent,
    create: create,
    rename: rename,
    duplicate: duplicate,
    remove: remove,

    /* 文件夹 */
    folderById: folderById,
    createFolder: createFolder,
    renameFolder: renameFolder,
    removeFolder: removeFolder,
    folderStats: folderStats,
    moveDoc: moveDoc,
    moveFolder: moveFolder,
    isFolderExpanded: isFolderExpanded,
    setFolderExpanded: setFolderExpanded,
    toggleFolder: toggleFolder,

    save: save,
    flushPending: flushPending,
    closeTab: closeTab,
    reorderTabs: reorderTabs,
    setContent: setContent,
    content: function () {
      return current.content;
    },
    currentId: function () {
      return current.id;
    },
    displayTitle: displayTitle,
    deriveTitle: deriveTitle,
    computeStats: computeStats,
    parseOutline: parseOutline,
    refreshIndex: refreshIndex,
    findMeta: findMeta,
    welcomeContent: welcomeContent,

    /** 顶栏用它判断“标题位该不该留空”，见 WELCOME_TITLE 的注释 */
    isWelcomeTitle: function (title) {
      return title === WELCOME_TITLE;
    }
  };
})();
