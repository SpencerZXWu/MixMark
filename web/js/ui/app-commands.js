/**
 * MixMark · 文档与编辑命令
 * ===============================================================
 * 归在这里而不是 core/docs.js：重命名要弹输入框、删除要弹确认框，
 * 这些是 UI 关注点，不该混进文档生命周期模块。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 命令可以通过参数指定目标文档（侧栏点击），不传则作用于当前文档 */
  function targetId(arg) {
    return typeof arg === 'string' && arg ? arg : MM.store.get().docId;
  }

  /**
   * 文档名是否已被占用。
   * 不区分大小写、忽略前后空格 —— 「我的笔记.MD」和「我的笔记.md」
   * 在用户眼里就是同一个名字。
   * exceptId 用于重命名：自己不算和自己重名。
   */
  function nameTaken(name, exceptId) {
    var want = String(name || '').trim().toLowerCase();
    if (!want) return false;

    return MM.store.get().docs.some(function (d) {
      if (exceptId && d.id === exceptId) return false;
      return String(d.title || '').trim().toLowerCase() === want;
    });
  }

  /** 去掉已有后缀再拼上目标后缀：避免出现「a.md.md」 */
  function withExt(name, ext) {
    var base = String(name || '').replace(/\.(md|markdown|mdown|txt)$/i, '').trim();
    return (base || String(name || '').trim()) + ext;
  }

  /* ------------------------------------------------------------------
     文件
     ------------------------------------------------------------------ */

  MM.commands.registerAll([
    {
      id: 'file.new',
      titleKey: 'cmdNewDoc',
      group: 'file',
      // 不用 Mod+N：浏览器保留 Ctrl+N 打开新窗口，网页无法拦截
      key: 'Mod+Alt+N',
      run: function () {
        return MM.dialogs
          .prompt({
            title: MM.i18n.t('dlgNewDocTitle'),
            label: MM.i18n.t('dlgDocNameLabel'),
            placeholder: MM.i18n.t('dlgDocNamePlaceholder'),
            value: '',
            select: {
              label: MM.i18n.t('dlgDocFormatLabel'),
              // md 默认优先：多数时候建的是 Markdown
              value: 'md',
              options: [
                { value: 'md', text: MM.i18n.t('fmtMarkdown') },
                { value: 'txt', text: MM.i18n.t('fmtPlainText') }
              ]
            }
          })
          .then(function (res) {
            if (!res) return;

            // 名字里带上后缀，它就是这个文档的文件名
            var ext = res.option === 'txt' ? '.txt' : '.md';
            var title = withExt(res.value, ext);

            if (nameTaken(title)) {
              MM.toast.danger(MM.i18n.t('toastNameTaken', { name: title }));
              // 把对话框重新打开，让用户当场改名字
              return MM.commands.run('file.new');
            }

            // 名字是用户自己填的，就别让自动标题再把它改掉
            return MM.docs
              .create({
                content: '',
                title: title,
                autoTitle: false,
                format: res.option
              })
              .then(function () {
                MM.editor.focus();
                MM.toast.ok(MM.i18n.t('toastCreated'));
              });
          });
      }
    },

    {
      id: 'file.save',
      titleKey: 'cmdSaveNow',
      group: 'file',
      key: 'Mod+S',
      run: function () {
        return MM.docs.save({ force: true }).then(function (ok) {
          // 自动保存失败时已经弹过错误提示，这里只在用户主动保存时给正反馈
          if (ok) MM.toast.ok(MM.i18n.t('toastSaved'));
        });
      }
    },

    {
      id: 'file.rename',
      titleKey: 'cmdRenameDoc',
      group: 'file',
      run: function (arg) {
        var id = targetId(arg);
        if (!id) return;

        var meta = MM.docs.findMeta(id);
        var current = (meta && meta.title) || '';

        return MM.dialogs
          .prompt({
            title: MM.i18n.t('dlgRenameTitle'),
            label: MM.i18n.t('dlgDocNameLabel'),
            placeholder: MM.i18n.t('dlgDocNamePlaceholder'),
            value: current
          })
          .then(function (name) {
            if (!name || name === current) return;
            if (nameTaken(name, id)) {
              MM.toast.danger(MM.i18n.t('toastNameTaken', { name: name }));
              return;
            }
            return MM.docs.rename(id, name).then(function () {
              MM.toast.ok(MM.i18n.t('toastRenamed'));
            });
          });
      }
    },

    {
      id: 'file.delete',
      titleKey: 'cmdDeleteDoc',
      group: 'file',
      run: function (arg) {
        var id = targetId(arg);
        if (!id) return;

        var meta = MM.docs.findMeta(id);
        var name = (meta && meta.title) || MM.i18n.t('untitled');

        return MM.dialogs
          .confirm({
            title: MM.i18n.t('dlgDeleteTitle'),
            message: MM.i18n.t('dlgDeleteMsg', { name: name }),
            okText: MM.i18n.t('btnDelete'),
            danger: true
          })
          .then(function (yes) {
            if (!yes) return;
            return MM.docs.remove(id).then(function () {
              MM.toast.show(MM.i18n.t('toastDeleted'));
            });
          });
      }
    },

    {
      id: 'file.duplicate',
      titleKey: 'cmdDuplicateDoc',
      group: 'file',
      run: function (arg) {
        var id = targetId(arg);
        if (!id) return;
        return MM.docs.duplicate(id).then(function () {
          MM.toast.ok(MM.i18n.t('toastDuplicated'));
        });
      }
    },

    /* ---------------- 文件夹 ----------------
       新文件夹默认建在「当前选中的文件夹」里，
       所以往深处搭结构就是「选一层 → 建一层」，不需要拖拽。 */

    {
      id: 'file.newFolder',
      titleKey: 'cmdNewFolder',
      group: 'file',
      run: function () {
        var parent = MM.store.get().activeFolderId;

        return MM.dialogs
          .prompt({
            title: MM.i18n.t('cmdNewFolder'),
            label: MM.i18n.t('dlgFolderNameLabel'),
            placeholder: MM.i18n.t('dlgFolderNamePlaceholder'),
            value: ''
          })
          .then(function (name) {
            if (!name) return;
            return MM.docs.createFolder(name, parent).then(function () {
              MM.toast.ok(MM.i18n.t('toastFolderCreated'));
            });
          });
      }
    },

    {
      id: 'file.renameFolder',
      titleKey: 'cmdRenameFolder',
      group: 'file',
      run: function (arg) {
        var id = typeof arg === 'string' && arg ? arg : MM.store.get().activeFolderId;
        if (!id) return;

        var folder = MM.docs.folderById(id);
        if (!folder) return;

        var current = folder.name || '';

        return MM.dialogs
          .prompt({
            title: MM.i18n.t('dlgRenameTitle'),
            label: MM.i18n.t('dlgFolderNameLabel'),
            placeholder: MM.i18n.t('dlgFolderNamePlaceholder'),
            value: current
          })
          .then(function (name) {
            if (!name || name === current) return;
            return MM.docs.renameFolder(id, name).then(function () {
              MM.toast.ok(MM.i18n.t('toastFolderRenamed'));
            });
          });
      }
    },

    {
      id: 'file.deleteFolder',
      titleKey: 'cmdDeleteFolder',
      group: 'file',
      run: function (arg) {
        var id = typeof arg === 'string' && arg ? arg : MM.store.get().activeFolderId;
        if (!id) return;

        var folder = MM.docs.folderById(id);
        if (!folder) return;

        var name = folder.name || MM.i18n.t('untitledFolder');

        // 先算清楚要删掉多少东西再问 —— 「删文件夹」的影响范围
        // 不像「删文档」那么直观，必须把代价说清楚
        return MM.docs
          .folderStats(id)
          .then(function (stats) {
            return MM.dialogs.confirm({
              title: MM.i18n.t('dlgDeleteFolderTitle'),
              message: MM.i18n.t('dlgDeleteFolderMsg', {
                name: name,
                docs: stats.docs,
                folders: stats.folders
              }),
              okText: MM.i18n.t('btnDelete'),
              danger: true
            });
          })
          .then(function (yes) {
            if (!yes) return;
            return MM.docs.removeFolder(id).then(function () {
              MM.toast.show(MM.i18n.t('toastFolderDeleted'));
            });
          });
      }
    }
  ]);

  /* ------------------------------------------------------------------
     编辑
     ------------------------------------------------------------------ */

  /**
   * 撤销 / 恢复 / 剪切 / 复制 / 粘贴 —— **一律不注册快捷键**，
   * 只用 menuKey 提供菜单里的展示文案。
   *
   * 原因：这几个操作在 CodeMirror 内部已经有正确的 keymap，
   * 浏览器对 contenteditable 的原生粘贴也是通的。而 core/commands.js 的
   * handleKeydown 是挂在 document 上的捕获监听，命中就 preventDefault +
   * stopPropagation —— 一旦在这里注册 Mod+Z / Mod+C，对话框输入框里的
   * 原生撤销与粘贴会被一并抢走，而那些地方恰恰最需要它们。
   *
   * 不注册 ≠ 没有快捷键：在编辑器里 Ctrl+Z / Ctrl+C / Ctrl+V 照常工作。
   * 菜单的职责是把这些能力提供给鼠标用户，并如实画出当前可不可用。
   */

  function editorView() {
    return MM.editor.raw();
  }

  function hasEditor() {
    return !!(MM.store.get().docId && editorView());
  }

  function selectedText() {
    var v = editorView();
    if (!v) return '';
    var sel = v.state.selection.main;
    return v.state.sliceDoc(sel.from, sel.to);
  }

  function canUndo() {
    var v = editorView();
    return !!(v && window.CM.undoDepth && window.CM.undoDepth(v.state) > 0);
  }

  function canRedo() {
    var v = editorView();
    return !!(v && window.CM.redoDepth && window.CM.redoDepth(v.state) > 0);
  }

  /** 焦点在输入框里就别抢 Ctrl+F / Ctrl+H —— 那些地方各有各的用途 */
  function typingElsewhere() {
    var el = document.activeElement;
    if (!el) return false;

    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

    if (el.isContentEditable) {
      var cm = document.querySelector('.cm-editor');
      if (!cm || !cm.contains(el)) return true;
    }
    return false;
  }

  /** 写系统剪贴板；返回是否成功 —— 失败时绝不能删掉原文 */
  function copyToClipboard(text) {
    // execCommand 虽然已废弃，但它能直接用到 contenteditable 里的原生选区，
    // 而且不弹权限框；先用它，失败再退回 Clipboard API
    try {
      if (document.execCommand('copy')) return Promise.resolve(true);
    } catch (err) {
      /* 落到下面的分支 */
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return false;
        }
      );
    }
    return Promise.resolve(false);
  }

  function deleteSelection() {
    var v = editorView();
    if (!v) return;

    var sel = v.state.selection.main;
    if (sel.empty) return;
    v.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } });
  }

  function insertText(text) {
    var v = editorView();
    if (!v || !text) return;

    var sel = v.state.selection.main;
    v.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length }
    });
    v.focus();
  }

  MM.commands.registerAll([
    {
      id: 'edit.undo',
      titleKey: 'menuUndo',
      group: 'edit',
      menuKey: 'Mod+Z',
      enabled: function () {
        return hasEditor() && canUndo();
      },
      run: function () {
        var v = editorView();
        if (!v) return;
        window.CM.undo(v);
        v.focus();
      }
    },

    {
      id: 'edit.redo',
      titleKey: 'menuRedo',
      group: 'edit',
      menuKey: 'Mod+Shift+Z',
      enabled: function () {
        return hasEditor() && canRedo();
      },
      run: function () {
        var v = editorView();
        if (!v) return;
        window.CM.redo(v);
        v.focus();
      }
    },

    {
      id: 'edit.cut',
      titleKey: 'menuCut',
      group: 'edit',
      menuKey: 'Mod+X',
      enabled: function () {
        return hasEditor() && !!selectedText();
      },
      run: function () {
        var text = selectedText();
        if (!text) return;

        return copyToClipboard(text).then(function (ok) {
          // 没写进剪贴板就不删 —— 否则这段文字就凭空消失了
          if (!ok) {
            MM.toast.danger(MM.i18n.t('toastCopyFailed'));
            return;
          }
          deleteSelection();
        });
      }
    },

    {
      id: 'edit.copy',
      titleKey: 'menuCopy',
      group: 'edit',
      menuKey: 'Mod+C',
      enabled: function () {
        return hasEditor() && !!selectedText();
      },
      run: function () {
        var text = selectedText();
        if (!text) return;

        return copyToClipboard(text).then(function (ok) {
          if (!ok) MM.toast.danger(MM.i18n.t('toastCopyFailed'));
        });
      }
    },

    {
      id: 'edit.paste',
      titleKey: 'menuPaste',
      group: 'edit',
      menuKey: 'Mod+V',
      enabled: hasEditor,
      run: function () {
        // 读剪贴板要用户授权，file:// 下多半会被直接拒绝。
        // 这里失败不奇怪，关键是别让用户以为「点了没反应」。
        if (navigator.clipboard && navigator.clipboard.readText) {
          return navigator.clipboard.readText().then(
            function (text) {
              insertText(text);
            },
            function () {
              MM.toast.danger(MM.i18n.t('toastPasteFailed'));
            }
          );
        }
        MM.toast.danger(MM.i18n.t('toastPasteFailed'));
        return undefined;
      }
    },

    {
      id: 'edit.find',
      titleKey: 'menuFind',
      group: 'edit',
      key: 'Mod+F',
      enabled: function () {
        return !!MM.store.get().docId && !typingElsewhere();
      },
      run: function () {
        MM.findBar.open('find');
      }
    },

    {
      id: 'edit.replace',
      titleKey: 'menuReplace',
      group: 'edit',
      key: 'Mod+H',
      enabled: function () {
        return !!MM.store.get().docId && !typingElsewhere();
      },
      run: function () {
        MM.findBar.open('replace');
      }
    }
  ]);

  /* ------------------------------------------------------------------
     视图：分栏 / 预览
     ------------------------------------------------------------------ */

  MM.commands.register({
    id: 'view.togglePreview',
    titleKey: 'cmdTogglePreview',
    group: 'view',
    key: 'Mod+Shift+V',
    // 输入框里 Ctrl+Shift+V 是「粘贴为纯文本」，不能抢走
    enabled: function () {
      return !typingElsewhere();
    },
    run: function () {
      // 从「编辑」模式按下去也进预览：与其什么都不做，
      // 不如把它当成「切到看结果那边」
      MM.shell.setMode(MM.store.get().mode === 'preview' ? 'split' : 'preview');
    }
  });

  /* ------------------------------------------------------------------
     文件：直连磁盘原文件
     ------------------------------------------------------------------ */

  /** 文件名 → 文档标题：去掉扩展名，保留原名 */
  function suggestedFileName(title) {
    var name = String(title || '').trim() || MM.i18n.t('untitled');
    if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) {
      name = name.replace(/[\\/]+/g, ' ').trim();
    }
    if (/\.(md|markdown|mdown|txt)$/i.test(name)) return name;
    // 后缀跟着文档格式走：文本文档存出来就是 .txt
    return name + (MM.store.get().format === 'txt' ? '.txt' : '.md');
  }

  function diskUnavailable() {
    MM.toast.danger(MM.i18n.t('diskUnsupported'));
  }

  MM.commands.registerAll([
    {
      id: 'file.open',
      titleKey: 'menuOpenFile',
      group: 'file',
      key: 'Mod+O',
      // 不按环境置灰：灰按钮说不出「为什么不能点」。
      // 点下去给一句明确的提示，比沉默地变灰有用
      run: function () {
        if (!MM.disk.supported()) {
          diskUnavailable();
          return;
        }

        // showOpenFilePicker 必须在用户手势里直接调用 ——
        // 这里的点击处理器就是手势本体，中途没有被 await 断开
        return MM.disk
          .open()
          .then(function (res) {
            // autoTitle 关掉：磁盘文件的标题就该等于文件名（去掉扩展名），
            // 不该被正文里的 H1 改写 —— 否则界面上显示的名字和磁盘上的对不上
            return MM.docs
              .create({
                content: res.content,
                title: MM.disk.titleFromName(res.name),
                autoTitle: false
              })
              .then(function () {
                return MM.disk.bind(MM.docs.currentId(), res.handle, res.name);
              })
              .then(function () {
                MM.toast.ok(MM.i18n.t('toastFileOpened', { name: res.name }));
              });
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return; // 用户在系统弹窗里取消
            console.error('[file] 打开文件失败', err);
            diskUnavailable();
          });
      }
    },

    {
      id: 'file.saveAs',
      titleKey: 'menuSaveAs',
      group: 'file',
      key: 'Mod+Shift+S',
      enabled: function () {
        return !!MM.store.get().docId;
      },
      run: function () {
        if (!MM.disk.supported()) {
          diskUnavailable();
          return;
        }

        var id = MM.store.get().docId;
        var content = MM.docs.content();
        var name = suggestedFileName(MM.store.get().title);

        // 先弹保存框再写文档库：系统的文件选择器要求「瞬时用户激活」，
        // 中间多 await 一次就多一分过期的风险
        return MM.disk
          .saveAs(name, content)
          .then(function (res) {
            return MM.disk
              .bind(id, res.handle, res.name)
              .then(function () {
                return MM.docs.save({ force: true });
              })
              .then(function () {
                MM.toast.ok(MM.i18n.t('toastSaveAsDone', { name: res.name }));
              });
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return;
            console.error('[file] 另存为失败', err);
            MM.toast.danger(
              MM.i18n.t('toastDiskWriteFailed', {
                msg: (err && err.message) || String(err)
              })
            );
          });
      }
    },

    {
      id: 'file.saveAll',
      titleKey: 'menuSaveAll',
      group: 'file',
      key: 'Mod+Alt+S',
      enabled: function () {
        return MM.store.get().docs.length > 0;
      },
      run: function () {
        var total = MM.store.get().docs.length;
        var id = MM.store.get().docId;

        // 文档库里只有当前这篇在内存中被编辑，其余早已落盘；
        // 「全部保存」要做的是把在途的防抖写入催出来，再补上磁盘直连的那一份
        return MM.docs
          .flushPending()
          .then(function () {
            return MM.docs.save({ force: true });
          })
          .then(function () {
            if (!id || !MM.disk.isBound(id)) return false;
            return MM.disk.writeNow(id, MM.docs.content());
          })
          .then(function (wrote) {
            if (wrote) {
              MM.toast.ok(MM.i18n.t('toastDiskWritten', { name: MM.disk.labelOf(id) }));
            }
            MM.toast.ok(MM.i18n.t('toastSaveAllDone', { n: total }));
          });
      }
    },

    {
      id: 'file.close',
      titleKey: 'cmdCloseDoc',
      group: 'file',
      enabled: function (arg) {
        var id = targetId(arg);
        return !!id && MM.disk.isBound(id);
      },
      run: function (arg) {
        var id = targetId(arg);
        if (!id) return;

        var name = MM.disk.labelOf(id) || MM.i18n.t('untitled');
        var isCurrent = id === MM.store.get().docId;

        /** 解绑句柄 → 从文档库移除，磁盘上的文件不动 */
        function closeInApp() {
          return MM.disk
            .unbind(id)
            .then(function () {
              return MM.docs.remove(id);
            })
            .then(function () {
              MM.toast.show(MM.i18n.t('toastDocClosed', { name: name }));
            });
        }

        // 非当前文档在它离开编辑区那一刻就已经同步过磁盘了，不用再写一遍
        if (!isCurrent) return closeInApp();

        return MM.disk
          .writeNow(id, MM.docs.content())
          .then(function () {
            // 先刷成“不脏”再 remove：否则 remove 内部切文档时的
            // flushPending 会把刚删掉的这一篇又写回去
            return MM.docs.save({ force: true });
          })
          .then(closeInApp)
          .catch(function (err) {
            // 写盘失败就不关：关掉等于把改动丢掉，而磁盘上还是旧内容
            console.error('[file] 关闭前写回磁盘失败', err);
            MM.toast.danger(MM.i18n.t('toastCloseBlocked'));
          });
      }
    },

    {
      id: 'app.quit',
      titleKey: 'menuQuit',
      group: 'app',
      run: function () {
        var id = MM.store.get().docId;

        // 先把没落盘的东西写完 —— 否则「退出」就是一次静默的数据丢失
        return MM.docs
          .flushPending()
          .then(function () {
            return MM.docs.save({ force: true });
          })
          .catch(function () {
            return false;
          })
          .then(function () {
            if (!id || !MM.disk.isBound(id)) return false;
            return MM.disk.writeNow(id, MM.docs.content()).catch(function () {
              return false;
            });
          })
          .then(function () {
            // Electron / Capacitor 里 window.close() 是有效的；
            // 普通浏览器标签页不允许脚本关闭自己，只能如实告知
            window.close();
            setTimeout(function () {
              MM.toast.show(MM.i18n.t('toastQuitBlocked'));
            }, 150);
          });
      }
    }
  ]);

  /* ------------------------------------------------------------------
     仓库：本地文件夹 / 本机文档库
     ------------------------------------------------------------------
     一个仓库 = 一份文档数据 + 一套属于它自己的工作台状态（见 core/repos.js）。
     这里只负责「切过去」这一件事 —— 首页卡片、侧栏下拉、状态栏、设置页
     四个入口全都走这一个出口，免得四条路径各写一遍顺序。
     ------------------------------------------------------------------ */

  /**
   * 进入一个仓库。三步的顺序不能变：
   *   1. 先让主进程连上那个文件夹。连不上就到此为止 —— 继续往下走会切到一个
   *      空的 electron 库，看起来就像数据全丢了。
   *   2. 再改「当前仓库」：工作台状态是按它取存的，改晚了就会读到上一个库的。
   *   3. 最后才 reload，而且必须带 repoChanged —— 它会换成这个仓库自己的
   *      上次打开的文档与标签页。
   */
  function enterRepo(repo, opts) {
    opts = opts || {};
    if (!repo) return Promise.reject(new Error('unknown-repo'));

    var desk = MM.desktopBridge;
    var isFolder = !!repo.path;

    if (isFolder && (!desk || !desk.available())) {
      MM.toast.danger(MM.i18n.t('repoNeedsDesktop'));
      return Promise.resolve(null);
    }

    return Promise.resolve()
      .then(function () {
        // connected 表示主进程刚刚已经连上了（就是创建仓库时选的那个文件夹）
        if (isFolder && !opts.connected) return desk.openPath(repo.path);
        return null;
      })
      .then(function () {
        return MM.provider.use(isFolder ? 'electron' : repo.kind);
      })
      .then(function (p) {
        MM.repos.setCurrent(repo.id);
        MM.store.set({
          tier: p.kind,
          repo: MM.repos.labelOf(repo),
          repoPath: MM.repos.pathOf(repo)
        });
        return MM.docs.reload({ repoChanged: true });
      })
      .then(function () {
        MM.bus.emit('repo:changed', { id: repo.id });
        // 切成功了就离开首页进工作区。任何入口（首页卡片 / 侧栏 / 状态栏 / 设置页）
        // 都是这个结果 —— 否则用户点了创建、界面还停在原处，像是没生效
        if (MM.home && MM.home.hide) MM.home.hide();
        return repo;
      })
      .catch(function (err) {
        MM.toast.danger(
          MM.i18n.t('repoSwitchFailed', {
            name: MM.repos.labelOf(repo),
            msg: (err && err.message) || err
          })
        );
        return null;
      });
  }

  /**
   * 新建本地仓库：选文件夹 → 起名字 → 进去。
   * 名字默认给文件夹名，但可以改 —— 两个都叫「笔记」的文件夹只能靠名字分开。
   */
  function createRepo() {
    var desk = MM.desktopBridge;
    if (!desk || !desk.available()) {
      MM.toast.show(MM.i18n.t('homeRepoSoon'));
      return Promise.resolve(null);
    }

    return desk
      .pickRoot()
      .then(function (st) {
        if (!st || !st.connected) return null;

        // 同一个文件夹被选第二次：直接切过去，别让列表里出现两条一模一样的
        var exist = MM.repos.findByPath(st.path);
        if (exist) {
          MM.toast.show(MM.i18n.t('repoAlreadyAdded', { name: MM.repos.labelOf(exist) }));
          return enterRepo(exist, { connected: true });
        }

        return MM.dialogs
          .prompt({
            title: MM.i18n.t('repoNameTitle'),
            label: MM.i18n.t('repoNameLabel'),
            value: st.name || '',
            placeholder: MM.i18n.t('repoNamePlaceholder'),
            okText: MM.i18n.t('repoNameOk')
          })
          .then(function (name) {
            var repo = MM.repos.add({
              kind: 'electron',
              // 取消命名也算数：用文件夹名兜底，别让人白选一次文件夹
              label: String(name == null ? '' : name).trim() || null,
              path: st.path
            });
            return enterRepo(repo, { connected: true }).then(function (done) {
              if (done) MM.toast.ok(MM.i18n.t('repoCreated', { name: MM.repos.labelOf(repo) }));
              return done;
            });
          });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return null; // 用户取消，不是错误
        MM.toast.danger(MM.i18n.t('desktopFailed', { msg: (err && err.message) || err }));
        return null;
      });
  }

  function renameRepo(id) {
    var repo = MM.repos.raw(id);
    if (!repo) return Promise.resolve(null);

    return MM.dialogs
      .prompt({
        title: MM.i18n.t('repoRenameTitle'),
        label: MM.i18n.t('repoNameLabel'),
        value: MM.repos.labelOf(repo),
        placeholder: MM.i18n.t('repoNamePlaceholder'),
        okText: MM.i18n.t('btnOk')
      })
      .then(function (name) {
        if (name === null) return null;
        MM.repos.patch(repo.id, { label: String(name).trim() || null });
        MM.bus.emit('repo:list');
        MM.bus.emit('repo:changed', { id: repo.id });
        return repo;
      });
  }

  /**
   * 从列表里移除一个仓库。
   * **不动磁盘上的任何东西** —— 这是「不再显示它」，不是删数据；想要回来，
   * 重新选那个文件夹即可（.mixmark 还在，文档原样认回来）。
   */
  function removeRepo(id) {
    var repo = MM.repos.raw(id);
    if (!repo || repo.system) return Promise.resolve(false);

    return MM.dialogs
      .confirm({
        title: MM.i18n.t('repoRemoveTitle'),
        message: MM.i18n.t('repoRemoveMsg', {
          name: MM.repos.labelOf(repo),
          path: repo.path || ''
        }),
        okText: MM.i18n.t('repoRemoveOk'),
        danger: true
      })
      .then(function (yes) {
        if (!yes) return false;

        var wasActive = MM.repos.currentId() === id;
        MM.repos.remove(id);
        MM.bus.emit('repo:list');

        // 移掉的正好是当前仓库：退回本机文档库，别把界面留在一个不存在的库上
        if (wasActive) {
          return enterRepo(MM.repos.raw(MM.repos.LOCAL_ID)).then(function () {
            return true;
          });
        }
        return true;
      });
  }

  function openRepoFolder() {
    var desk = MM.desktopBridge;
    if (!desk || !desk.available()) return Promise.resolve();
    return Promise.resolve(desk.openRoot()).then(function (done) {
      if (!done) MM.toast.show(MM.i18n.t('desktopNotConnected'));
    });
  }

  /**
   * 启动时「采纳」上次待的那个仓库：只把后端定下来，不碰界面 ——
   * 这一刻界面还没画完，文档也由 docs.boot 负责加载，这里不需要 reload。
   *
   * 返回建议的优先后端（'electron' / 'local' / 'idb'），
   * 返回 null 表示「没偏好，按自动选路来」。
   */
  function startupRepo() {
    return resolveStartupRepo().then(function (kind) {
      // 侧栏与状态栏比仓库先初始化完，它们当时读不到仓库，只能显示占位文案。
      // 这里补一次通知，让它们把当前仓库正经画出来
      MM.bus.emit('repo:changed', { id: MM.repos.currentId() });
      return kind;
    });
  }

  function resolveStartupRepo() {
    var desk = MM.desktopBridge;
    var eProvider = MM.providers && MM.providers.electron;

    function localKind() {
      var local = MM.repos.raw(MM.repos.LOCAL_ID);
      return local ? local.kind : 'local';
    }

    // 桌面端：**主进程连着哪个文件夹才说了算**。
    // 它可能已经连上了（上次启动留下的、或命令行 --library 指定的），
    // 这时页面里的记录反而是过期的。
    if (desk && desk.available() && eProvider && typeof eProvider.prepare === 'function') {
      return eProvider
        .prepare()
        .then(function () {
          var st = desk.status();
          if (!st || !st.connected || !st.path) return localKind();

          // 主进程连着的文件夹还没登记过 —— 比如命令行直接指过去的，补上
          var repo = MM.repos.findByPath(st.path);
          if (!repo) repo = MM.repos.add({ kind: 'electron', path: st.path, label: null });
          MM.repos.setCurrent(repo.id);
          return 'electron';
        })
        .catch(function (err) {
          console.warn('[repo] 读回主进程的库失败', err);
          return localKind();
        });
    }

    return Promise.resolve(localKind());
  }

  /** 给 UI 层用的统一出口 */
  MM.reposOps = {
    enter: enterRepo,
    create: createRepo,
    rename: renameRepo,
    remove: removeRepo,
    openFolder: openRepoFolder,
    startup: startupRepo,
    of: function (id) {
      return MM.repos.raw(id);
    }
  };

  /* ------------------------------------------------------------------
     存储位置
     ------------------------------------------------------------------ */

  function fsaProvider() {
    return MM.providers && MM.providers.fsa;
  }

  /** 换 provider → 重拉索引 → 刷新状态栏 */
  function adopt(kind) {
    return MM.provider.use(kind).then(function (p) {
      MM.store.set({ tier: p.kind });
      return MM.docs.reload();
    });
  }

  MM.commands.registerAll([
    {
      id: 'repo.create',
      titleKey: 'cmdNewRepo',
      group: 'file',
      run: createRepo
    },

    {
      id: 'repo.rename',
      titleKey: 'cmdRenameRepo',
      group: 'file',
      run: function () {
        return renameRepo(MM.repos.currentId());
      }
    },

    {
      id: 'repo.openFolder',
      titleKey: 'cmdOpenRepoFolder',
      group: 'file',
      run: openRepoFolder,
      // 只有本地文件夹仓库才有「在文件管理器里打开」这回事
      enabled: function () {
        var r = MM.repos.current();
        return !!(MM.desktopBridge && MM.desktopBridge.available() && r && r.path);
      }
    },

    {
      id: 'storage.switch',
      titleKey: 'setStorage',
      group: 'app',
      run: function (kind) {
        if (!kind || kind === MM.provider.getKind()) return;
        return adopt(kind).catch(function (err) {
          // 「切过去也不能用」的情形必须发出声来。切换失败又静默，
          // 用户会以为已经在用新存储了
          var msg = String((err && err.message) || err);
          if (msg.indexOf('unavailable:') === 0) {
            MM.toast.danger(MM.i18n.t('storageUnavailable', { name: kind }));
            return;
          }
          MM.toast.danger(MM.i18n.t('desktopFailed', { msg: msg }));
        });
      }
    },

    {
      id: 'storage.pickFolder',
      titleKey: 'cmdPickFolder',
      group: 'app',
      run: function () {
        // 桌面端：选一个文件夹就是「新建一个本地仓库」，走统一的创建流程
        //（起名字 → 登记进仓库列表 → 进去），不要在命令里再写一遍
        if (MM.desktopBridge && MM.desktopBridge.available()) {
          return createRepo();
        }

        var fsa = fsaProvider();
        if (!fsa || !fsa.supported()) {
          MM.toast.danger(MM.i18n.t('fsaUnsupported'));
          return;
        }

        // showDirectoryPicker 必须在用户手势里直接调用。
        // 这里的点击处理器就是手势本体，中途没有被 await 断开，所以能正常弹出。
        return fsa
          .pickRoot()
          .then(function () {
            return adopt('fsa');
          })
          .then(function () {
            MM.toast.ok(MM.i18n.t('toastFolderConnected', { name: fsa.status().name || '' }));
          })
          .catch(function (err) {
            // 用户在系统弹窗里点了取消，不是错误，不用提示
            if (err && err.name === 'AbortError') return;
            console.error('[storage] 连接文件夹失败', err);
            MM.toast.danger(MM.i18n.t('fsaUnsupported'));
          });
      }
    },

    {
      id: 'storage.reconnectFolder',
      titleKey: 'cmdReconnectFolder',
      group: 'app',
      run: function () {
        var fsa = fsaProvider();
        if (!fsa || !fsa.status().connected) return;

        return fsa
          .requestAccess()
          .then(function () {
            return adopt('fsa');
          })
          .then(function () {
            MM.toast.ok(MM.i18n.t('toastFolderConnected', { name: fsa.status().name || '' }));
          })
          .catch(function (err) {
            if (err && err.message === 'denied') return; // 用户拒绝，静默
            console.error('[storage] 重新授权失败', err);
          });
      }
    },

    {
      id: 'storage.refreshFolder',
      titleKey: 'cmdRefreshFolder',
      group: 'app',
      run: function () {
        var fsa = fsaProvider();
        if (!fsa || !fsa.status().connected) return;

        return fsa
          .refresh()
          .then(function () {
            return MM.docs.reload();
          })
          .then(function () {
            MM.toast.show(MM.i18n.t('cmdRefreshFolder'));
          });
      }
    },

    {
      id: 'storage.disconnectFolder',
      titleKey: 'cmdDisconnectFolder',
      group: 'app',
      run: function () {
        var fsa = fsaProvider();
        if (!fsa || !fsa.status().connected) return;

        return MM.dialogs
          .confirm({
            title: MM.i18n.t('cmdDisconnectFolder'),
            message: MM.i18n.t('setStorageHint'),
            okText: MM.i18n.t('cmdDisconnectFolder'),
            danger: true
          })
          .then(function (yes) {
            if (!yes) return null;

            return fsa
              .disconnect()
              .then(function () {
                // 断开后回到浏览器自己的存储（能用 IndexedDB 就用它）
                var idb = MM.providers && MM.providers.idb;
                var fallback = idb && idb.isAvailable() ? 'idb' : 'local';
                return adopt(fallback);
              })
              .then(function () {
                MM.toast.show(MM.i18n.t('toastFolderDisconnected'));
              });
          });
      }
    }
  ]);
})();
