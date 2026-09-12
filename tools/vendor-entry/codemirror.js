/**
 * MixMark vendor 入口：CodeMirror 6
 * ---------------------------------------------------------------
 * CM6 只提供 ESM 源码，而 `file://` 协议下浏览器会因 CORS 拒绝加载
 * ES Module，因此必须预先打包成 IIFE 经典脚本。
 *
 * 这里显式装配 window.CM，而不是用 `export *`：
 *   1. 避免多包之间的重名导出歧义
 *   2. 挂到 window 上的成员一目了然，就是「MixMark 可用的 CM API 清单」
 *   3. 便于日后裁剪体积时快速定位用途
 */
import * as codemirror from 'codemirror'; // 元包，提供 basicSetup / minimalSetup
import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as commands from '@codemirror/commands';
import * as language from '@codemirror/language';
import * as search from '@codemirror/search';
import * as langMarkdown from '@codemirror/lang-markdown';
import * as lezerHighlight from '@lezer/highlight';

window.CM = Object.assign(
  {},
  codemirror,
  state,
  view,
  commands,
  language,
  search,
  langMarkdown,
  {
    // 语法高亮的标签集合，供 md-syntax.js 定义 HighlightStyle 使用
    tags: lezerHighlight.tags,
    Tag: lezerHighlight.Tag,
  }
);
