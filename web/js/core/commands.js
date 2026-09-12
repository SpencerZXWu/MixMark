/**
 * MixMark · 命令注册表
 * ===============================================================
 * 核心设计：一个功能只定义一次，自动出现在三个入口。
 *   ① 顶栏 / 工具栏按钮
 *   ② 键盘快捷键
 *   ③ 命令面板（Ctrl+Shift+P）
 * 避免「加个功能要改三处」的重复与不一致。
 *
 * 注册示例：
 *   MM.commands.register({
 *     id: 'format.bold',
 *     titleKey: 'fmtBold',
 *     group: 'format',
 *     key: 'Mod+B',
 *     run: function () { ... }
 *   });
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  var registry = [];
  var byId = Object.create(null);

  /* ------------------------------------------------------------------
     工具栏分组
     把同类命令（如三级标题）聚成一个下拉按钮。
     分组元数据单独注册，命令只负责声明自己属于哪一组 ——
     这样加一个「四级标题」仍然只需要在 actions.js 里改一行。
     ------------------------------------------------------------------ */

  var groups = Object.create(null);

  function registerGroup(id, meta) {
    groups[id] = Object.assign({ id: id }, meta || {});
    return groups[id];
  }

  function getGroup(id) {
    return groups[id] || null;
  }

  /* ------------------------------------------------------------------
     快捷键解析
     支持的写法：Mod+S / Mod+Shift+P / Ctrl+Alt+1 / F11 / Escape
     Mod = Mac 上的 Cmd，其它平台的 Ctrl
     ------------------------------------------------------------------ */

  var KEY_ALIAS = {
    ' ': 'Space',
    Esc: 'Escape',
    Return: 'Enter',
    Del: 'Delete',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Left: 'ArrowLeft',
    Right: 'ArrowRight'
  };

  function normalizeKey(k) {
    return KEY_ALIAS[k] || k;
  }

  function parseKey(spec) {
    var parts = String(spec).split('+');
    var result = { mod: false, ctrl: false, shift: false, alt: false, meta: false, key: '' };

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (i === parts.length - 1) {
        result.key = normalizeKey(p);
        continue;
      }
      switch (p.toLowerCase()) {
        case 'mod':
          result.mod = true;
          break;
        case 'ctrl':
        case 'control':
          result.ctrl = true;
          break;
        case 'shift':
          result.shift = true;
          break;
        case 'alt':
        case 'option':
          result.alt = true;
          break;
        case 'meta':
        case 'cmd':
        case 'command':
          result.meta = true;
          break;
      }
    }
    return result;
  }

  var parsedCache = Object.create(null);

  function parsed(spec) {
    return parsedCache[spec] || (parsedCache[spec] = parseKey(spec));
  }

  /** 事件是否命中某个快捷键定义 */
  function matches(spec, event) {
    var p = parsed(spec);

    // Mod 在 Mac 表示 Cmd(meta)，其它平台表示 Ctrl
    var wantCtrl = p.ctrl || (p.mod && !IS_MAC);
    var wantMeta = p.meta || (p.mod && IS_MAC);

    if (!!event.ctrlKey !== wantCtrl) return false;
    if (!!event.metaKey !== wantMeta) return false;
    if (!!event.shiftKey !== p.shift) return false;
    if (!!event.altKey !== p.alt) return false;

    var key = event.key;
    if (key === ' ') key = 'Space';
    // 字母键统一小写比较，避免 CapsLock / Shift 造成的差异
    if (key.length === 1) key = key.toLowerCase();
    var want = p.key.length === 1 ? p.key.toLowerCase() : p.key;

    return key === want;
  }

  /** 转成适合展示的文本，如 Mod+Shift+P → Ctrl+Shift+P */
  function formatKey(spec) {
    var p = parsed(spec);
    var out = [];
    if (p.ctrl || (p.mod && !IS_MAC)) out.push('Ctrl');
    if (p.meta || (p.mod && IS_MAC)) out.push(IS_MAC ? '⌘' : 'Win');
    if (p.alt) out.push(IS_MAC ? '⌥' : 'Alt');
    if (p.shift) out.push(IS_MAC ? '⇧' : 'Shift');

    var k = p.key;
    var DISPLAY = {
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
      Space: 'Space',
      Escape: 'Esc',
      Enter: 'Enter',
      Delete: 'Del',
      Backspace: 'Backspace'
    };
    out.push(DISPLAY[k] || (k.length === 1 ? k.toUpperCase() : k));

    return out.join(IS_MAC ? '' : '+');
  }

  /* ------------------------------------------------------------------
     注册
     ------------------------------------------------------------------ */

  /**
   * @param {object} def
   *   id       唯一标识，形如 'file.save'
   *   titleKey i18n key（也可以用 title 直接给字符串）
   *   group    用于命令面板分组：file|view|format|export|app
   *   key      可选，默认快捷键
   *   hidden   可选，不在命令面板中显示
   *   enabled  可选，返回布尔值；返回 false 时命令不可执行
   *   run      执行体
   */
  function register(def) {
    if (!def || !def.id) throw new Error('[commands] 注册命令必须提供 id');
    if (byId[def.id]) {
      console.warn('[commands] 命令 id 重复，已覆盖：' + def.id);
      var i = registry.indexOf(byId[def.id]);
      if (i !== -1) registry.splice(i, 1);
    }
    registry.push(def);
    byId[def.id] = def;
    return def;
  }

  /** 批量注册，便于各模块一次声明自己的命令 */
  function registerAll(list) {
    list.forEach(register);
    return list;
  }

  function get(id) {
    return byId[id] || null;
  }

  function all() {
    return registry.slice();
  }

  function isEnabled(def) {
    if (!def) return false;
    if (typeof def.enabled === 'function') {
      try {
        return !!def.enabled();
      } catch (err) {
        console.error('[commands] enabled() 出错：' + def.id, err);
        return false;
      }
    }
    return true;
  }

  function run(id, arg) {
    var def = byId[id];
    if (!def) {
      console.warn('[commands] 未找到命令：' + id);
      return false;
    }
    if (!isEnabled(def)) return false;

    try {
      var r = def.run(arg);
      if (r && typeof r.catch === 'function') {
        r.catch(function (err) {
          console.error('[commands] 命令执行失败：' + id, err);
        });
      }
    } catch (err) {
      console.error('[commands] 命令执行失败：' + id, err);
    }
    return true;
  }

  /** 命令标题（已按当前语言翻译） */
  function titleOf(def) {
    return def.title || MM.i18n.t(def.titleKey);
  }

  /* ------------------------------------------------------------------
     快捷键派发
     ------------------------------------------------------------------ */

  /** 命中第一条可用命令即执行，返回是否已被处理 */
  function handleKeydown(event) {
    for (var i = 0; i < registry.length; i++) {
      var def = registry[i];
      if (!def.key) continue;
      if (!matches(def.key, event)) continue;
      if (!isEnabled(def)) continue;

      event.preventDefault();
      event.stopPropagation();
      run(def.id);
      return true;
    }
    return false;
  }

  MM.commands = {
    register: register,
    registerAll: registerAll,
    registerGroup: registerGroup,
    getGroup: getGroup,
    get: get,
    all: all,
    run: run,
    isEnabled: isEnabled,
    titleOf: titleOf,
    matches: matches,
    formatKey: formatKey,
    handleKeydown: handleKeydown,
    IS_MAC: IS_MAC
  };
})();
