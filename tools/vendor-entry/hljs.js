/**
 * MixMark vendor 入口：highlight.js
 * ---------------------------------------------------------------
 * 只注册 common 语言包（约 35 种常用语言），而不是全部 190+ 种，
 * 体积从 ~1.2MB 降到 ~120KB。
 *
 * 预览区代码块高亮走这里；编辑器内部的代码围栏高亮不引
 * @codemirror/language-data（体积过大），M1 阶段先不做。
 */
import hljs from 'highlight.js/lib/common';

window.hljs = hljs;
