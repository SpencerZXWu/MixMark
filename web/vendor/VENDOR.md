# web/vendor 依赖清单

> 本目录由 `node tools/build-vendor.js` 自动生成，**请勿手工修改**。
> 产物入库，浏览器端因此无需构建。

生成时间：2026-09-13T06:58:06.384Z

| 依赖 | 版本 |
| --- | --- |
| `codemirror` | 6.0.2 |
| `@codemirror/lang-markdown` | 6.5.2 |
| `marked` | 15.0.12 |
| `dompurify` | 3.4.15 |
| `katex` | 0.16.47 |
| `highlight.js` | 11.12.0 |
| `mermaid` | 12.0.0 |

## 产物说明

| 文件 / 目录 | 全局变量 | 用途 |
| --- | --- | --- |
| `codemirror.bundle.js` | `window.CM` | 编辑器内核（CM6 全套 + Markdown 语言支持） |
| `hljs.bundle.js` | `window.hljs` | 预览区代码块高亮（common 语言集） |
| `marked.js` | `window.marked` | Markdown → HTML |
| `purify.js` | `window.DOMPurify` | HTML 净化，防注入 |
| `katex/` | `window.katex` | 数学公式渲染（含 woff2 字体） |
| `mermaid.bundle.js` | `window.mermaid` | UML / 流程图等图表渲染（**按需加载**，不在 index.html 里） |

## 为什么全是 IIFE 而不是 ESM

`file://` 协议下浏览器会以 CORS 为由拒绝加载 `<script type="module">`，
导致「双击 index.html 就能用」这个核心目标无法达成。因此全部依赖
必须预打包成经典脚本。

## 为什么 KaTeX 只带 woff2

现代浏览器全部支持 woff2，去掉 woff/ttf 可省约一半体积。
本项目不支持 IE 与 2017 年前的浏览器。
