/**
 * MixMark · 桌面端 preload
 * ===============================================================
 * 渲染进程与主进程之间唯一的通道。
 *
 * 只用 contextBridge 暴露一层薄薄的、说得清用途的 API ——
 * 不把整个 ipcRenderer 或 require 丢进页面（那等于把 Node 权限交出去）。
 *
 * 页面侧看到的是 window.mixmark；存储层据此注册 'electron' 后端
 * （见 web/js/provider/electron.js）。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('mixmark', {
  /** provider 选路靠这个标记认出「这是桌面端」 */
  native: true,
  platform: process.platform,

  library: {
    status: () => invoke('mm:library:status'),
    pick: () => invoke('mm:library:pick'),
    forget: () => invoke('mm:library:forget'),
    get: (key) => invoke('mm:library:get', key),
    set: (key, value) => invoke('mm:library:set', key, value),
    remove: (key) => invoke('mm:library:remove', key),
    keys: () => invoke('mm:library:keys'),
    /** 结构改动之后让磁盘上的 .md 与索引对齐 */
    sync: () => invoke('mm:library:sync'),
    /** 重新扫一遍文件夹：把用户丢进去的 .md 收进来，把删掉的清出去 */
    rescan: () => invoke('mm:library:rescan'),
    /** 在系统文件管理器里定位某篇文档 */
    reveal: (docId) => invoke('mm:library:reveal', docId),
    openRoot: () => invoke('mm:library:openRoot')
  },

  /** 单个文件的打开 / 另存为（走系统原生弹窗） */
  files: {
    open: () => invoke('mm:files:open'),
    saveAs: (suggestedName, text) => invoke('mm:files:saveAs', suggestedName, text)
  },

  /**
   * 主进程菜单里的「新建文档 / 保存 / 导出…」等，统一转发成命令 id，
   * 由渲染进程的 MM.commands.run 执行 —— 菜单与工具栏走同一条路径，
   * 不会出现「菜单里能做、工具栏里做不了」这种两套逻辑。
   */
  onCommand: (cb) => {
    ipcRenderer.on('mm:command', (_e, id) => cb(id));
  },

  /** 库换地方了（重新选了文件夹），界面需要重新加载文档树 */
  onLibraryChanged: (cb) => {
    ipcRenderer.on('mm:library-changed', () => cb());
  }
});
