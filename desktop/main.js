/**
 * MixMark · 桌面端主进程
 * ===============================================================
 * 这一层只做三件事，别的都交给页面：
 *   1. 开窗口（记住大小位置），把 app/index.html 装进去
 *   2. 提供「文件夹库」的 IPC —— 真正的文件读写全在 lib/library-fs.js
 *   3. 原生菜单（中文），点菜单 → 发命令 id 给页面执行
 *
 * 刻意不做的事：
 *   - 不给渲染进程开 nodeIntegration。页面是网上也能跑的同一份代码，
 *     没有理由因为装了个壳就多拿到 Node 权限
 *   - 不自己实现一套「保存」逻辑。文档怎么存由页面里的存储层决定，
 *     这里只是它众多后端里的一个
 */
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const libraryFs = require('./lib/library-fs.js');

/** 记住「上次连的是哪个文件夹」，以及窗口大小位置 */
const CONFIG_FILE = path.join(app.getPath('userData'), 'desktop.json');

/** 当前打开的文件夹库；未连接时为 null */
let lib = null;
let win = null;

/* ------------------------------------------------------------------
   配置
   ------------------------------------------------------------------ */

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch (err) {
    return {};
  }
}

function writeConfig(patch) {
  const next = Object.assign(readConfig(), patch);
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 1), 'utf8');
  } catch (err) {
    console.warn('[desktop] 配置写入失败', err);
  }
  return next;
}

/**
 * 命令行里的 --library <文件夹>。
 *
 * 用途是「快捷方式带上文件夹，双击就直接开那个库」，同时它也是自动化
 * 验证端到端链路的唯一入口 —— 选文件夹的对话框没法脚本化。
 * 两种写法都认：--library D:\笔记 与 --library=D:\笔记
 * 这一条只是**优先**于记忆值，用户之后在界面上换库照样覆盖它。
 */
function rootFromArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (a === '--library') {
      const next = args[i + 1] ? String(args[i + 1]) : '';
      if (next && next.slice(0, 2) !== '--') return next;
      return null;
    }
    if (a.indexOf('--library=') === 0) {
      const v = a.slice('--library='.length);
      return v || null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   文件夹库
   ------------------------------------------------------------------ */

function status() {
  return {
    connected: !!lib,
    path: lib ? lib.root : null,
    name: lib ? path.basename(lib.root) : null,
    // 把「每篇文档在磁盘上的位置」一并带给页面：
    // 状态栏与 AI 的 get_status 要如实回答「存在哪」，而不是写个占位文案
    files: lib ? lib.paths() : {},
    version: app.getVersion()
  };
}

/**
 * 连接一个文件夹。
 *
 * 失败必须抛出来，不能吞掉：页面那边会据此判断「切过去能不能用」，
 * 悄悄失败会让用户以为数据已经在新文件夹里了。
 */
function connect(root) {
  if (!root) throw new Error('未指定文件夹');
  if (!fs.existsSync(root)) throw new Error('文件夹不存在：' + root);

  lib = libraryFs.open(root);
  const adopted = lib.adoptExisting();

  writeConfig({ libraryRoot: root, lastOpenedAt: Date.now() });
  return Object.assign(status(), { adopted: adopted.adopted });
}

function requireLib() {
  if (!lib) throw new Error('还没有连接文件夹');
  return lib;
}

/* ------------------------------------------------------------------
   窗口
   ------------------------------------------------------------------ */

function createWindow() {
  const cfg = readConfig();

  win = new BrowserWindow({
    width: (cfg.bounds && cfg.bounds.width) || 1180,
    height: (cfg.bounds && cfg.bounds.height) || 780,
    x: cfg.bounds ? cfg.bounds.x : undefined,
    y: cfg.bounds ? cfg.bounds.y : undefined,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#ffffff',
    title: 'MixMark',
    // 先不显示，等页面画好了再露面，避免看到一片空白闪一下
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 页面里没有需要 sandbox 隔离之外的额外能力；保持默认的沙箱会更安全，
      // 但 preload 里要用 require('electron') 的 contextBridge，
      // 在 sandbox:true 下仍然可以，所以这里不关沙箱
      sandbox: true
    }
  });

  win.once('ready-to-show', () => win.show());

  win.on('close', () => {
    if (!win) return;
    const b = win.getBounds();
    writeConfig({ bounds: { width: b.width, height: b.height, x: b.x, y: b.y } });
  });

  win.on('closed', () => {
    win = null;
  });

  // 页面里的外链一律交给系统浏览器，不在应用窗口里打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

/** 菜单项 → 页面命令。菜单与工具栏共用一套命令实现 */
function send(id) {
  if (win && !win.isDestroyed()) win.webContents.send('mm:command', id);
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建文档', accelerator: 'CmdOrCtrl+Alt+N', click: () => send('file.new') },
        { label: '重命名当前文档', click: () => send('file.rename') },
        { type: 'separator' },
        { label: '连接文件夹…', click: () => pickFolder('menu') },
        { label: '在文件管理器里打开', click: () => openRoot() },
        { type: 'separator' },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => send('file.importFiles') },
        { label: '导出当前文档到文件…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('file.exportToFile') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('file.save') },
        { label: '导出为 Markdown', click: () => send('export.md') },
        { label: '导出为 HTML', click: () => send('export.html') },
        { label: '导出全部为 .zip', click: () => send('export.all') },
        { label: '导入文件夹…', click: () => send('file.importFolder') },
        { type: 'separator' },
        { label: '打印 / 导出 PDF', accelerator: 'CmdOrCtrl+P', click: () => send('export.print') },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => send('edit.undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('edit.redo') },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        { label: '查找与替换', accelerator: 'CmdOrCtrl+F', click: () => send('edit.find') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '仅编辑', click: () => send('view.edit') },
        { label: '分栏', click: () => send('view.split') },
        { label: '仅预览', click: () => send('view.preview') },
        { label: '循环切换视图', accelerator: 'CmdOrCtrl+Alt+V', click: () => send('view.cycle') },
        { type: 'separator' },
        { label: '折叠 / 展开侧栏', accelerator: 'CmdOrCtrl+\\', click: () => send('view.sidebar') },
        { label: '切换明暗主题', accelerator: 'CmdOrCtrl+Alt+T', click: () => send('app.theme') },
        { label: '设置', accelerator: 'CmdOrCtrl+Alt+,', click: () => send('app.settings') },
        { type: 'separator' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '实际大小', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 MixMark',
          click: () => {
            const s = status();
            dialog.showMessageBox(win, {
              type: 'info',
              title: '关于 MixMark',
              message: 'MixMark ' + s.version,
              detail:
                '极简 Markdown 文档编辑器\n\n' +
                '文档库：' + (s.connected ? s.path : '尚未连接文件夹（当前存在应用内部）')
            });
          }
        },
        {
          label: '欢迎页',
          click: () => send('home.show')
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------
   文件夹选择
   ------------------------------------------------------------------ */

async function pickFolder() {
  const res = await dialog.showOpenDialog(win, {
    title: '选择一个文件夹当作文档库',
    buttonLabel: '用这个文件夹',
    properties: ['openDirectory', 'createDirectory'],
    // 从上次的位置开始找，省得每次都从「此电脑」点进去
    defaultPath: readConfig().libraryRoot || app.getPath('documents')
  });

  if (res.canceled || !res.filePaths.length) return { canceled: true };

  const next = connect(res.filePaths[0]);

  // 页面需要重新加载文档树：换库等于换了一整个世界
  if (win && !win.isDestroyed()) win.webContents.send('mm:library-changed');
  return next;
}

function openRoot() {
  if (!lib) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: '还没连接文件夹',
      message: '先连接一个文件夹，文档才会以 .md 存进去。',
      buttons: ['好']
    });
    return false;
  }
  shell.openPath(lib.root);
  return true;
}

/* ------------------------------------------------------------------
   单个文件的打开 / 另存为

   刻意**不用**页面里那套 MM.disk（File System Access）：那是给浏览器用的，
   句柄存在 IndexedDB 里，而 Electron 加载页面走 file:// ——
   那里根本没有 IndexedDB。桌面端的原生对话框更直接，路径就是个字符串。
   ------------------------------------------------------------------ */

async function openFiles() {
  const res = await dialog.showOpenDialog(win, {
    title: '打开 Markdown 文件',
    properties: ['openFile', 'multiSelections'],
    defaultPath: readConfig().libraryRoot || app.getPath('documents'),
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };

  const files = [];
  for (const p of res.filePaths) {
    try {
      files.push({ path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8') });
    } catch (err) {
      console.warn('[desktop] 读取失败：' + p, err);
    }
  }
  return { files: files };
}

async function saveAs(suggestedName, text) {
  const res = await dialog.showSaveDialog(win, {
    title: '导出到文件',
    defaultPath: path.join(
      readConfig().libraryRoot || app.getPath('documents'),
      suggestedName || '未命名.md'
    ),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };

  fs.writeFileSync(res.filePath, String(text == null ? '' : text), 'utf8');
  return { path: res.filePath, name: path.basename(res.filePath) };
}

/* ------------------------------------------------------------------
   IPC
   ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('mm:library:status', () => status());

  ipcMain.handle('mm:library:pick', () => pickFolder());

  ipcMain.handle('mm:library:forget', () => {
    lib = null;
    writeConfig({ libraryRoot: null });
    return status();
  });

  ipcMain.handle('mm:library:get', (_e, key) => requireLib().get(String(key)));
  ipcMain.handle('mm:library:set', (_e, key, value) => {
    requireLib().set(String(key), value);
    return true;
  });
  ipcMain.handle('mm:library:remove', (_e, key) => {
    requireLib().remove(String(key));
    return true;
  });
  ipcMain.handle('mm:library:keys', () => requireLib().keys());
  ipcMain.handle('mm:library:sync', () => requireLib().sync());

  /**
   * 在系统文件管理器里定位某篇文档。
   * 菜单里没有直接入口，但页面可以调（状态栏点击「存储位置」时就该走它）。
   */
  ipcMain.handle('mm:library:reveal', (_e, docId) => {
    const l = requireLib();
    const p = l.pathOf(String(docId));
    if (!p) return false;
    shell.showItemInFolder(p);
    return true;
  });

  /** 目录里别的东西变了（用户在应用外加了文件），重新扫一遍并收进来 */
  ipcMain.handle('mm:library:rescan', () => {
    const l = requireLib();
    const adopted = l.adoptExisting();
    const synced = l.sync();
    return { adopted: adopted.adopted, moved: synced.moved.length, dropped: synced.dropped };
  });

  ipcMain.handle('mm:library:openRoot', () => openRoot());

  ipcMain.handle('mm:files:open', () => openFiles());
  ipcMain.handle('mm:files:saveAs', (_e, name, text) => saveAs(name, text));
}

/* ------------------------------------------------------------------
   启动
   ------------------------------------------------------------------ */

// 第二个实例直接退出并把窗口带到前面 —— 文档库同时被两个进程写会互相踩
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // 显式指定的文件夹优先于「上次那个」
    const forced = rootFromArgv(process.argv);
    if (forced) {
      try {
        connect(forced);
      } catch (err) {
        console.warn('[desktop] --library 指定的文件夹用不了：' + err.message);
      }
    }

    // 上次连过的文件夹：启动时直接接回来（这就是「记住我的库」）
    const cfg = readConfig();
    if (!lib && cfg.libraryRoot && fs.existsSync(cfg.libraryRoot)) {
      try {
        connect(cfg.libraryRoot);
      } catch (err) {
        console.warn('[desktop] 恢复上次的文档库失败', err);
      }
    }

    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Windows 上关掉窗口就是退出；macOS 那边习惯不同，但它不是本版目标
    if (process.platform !== 'darwin') app.quit();
  });
}
