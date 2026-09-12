/**
 * MixMark — vendor 构建脚本
 * ===============================================================
 * 作用：把 npm 依赖转换成 `web/vendor/` 下的 IIFE 经典脚本。
 * 产物全部入库，浏览器端因此**零构建**，双击 index.html 即可运行。
 *
 * 运行频率：仅当升级依赖时才需要执行 `npm run vendor`。
 *
 *   node tools/build-vendor.js
 *   node tools/build-vendor.js --force   # 忽略缓存，强制重建
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const VENDOR = path.join(ROOT, 'web', 'vendor');
const STAGE = path.join(ROOT, '.vendor-tmp'); // esbuild 中间产物，构建结束即删

const pkg = require(path.join(ROOT, 'package.json'));

let esbuild;
try {
  esbuild = require('esbuild');
} catch (_) {
  console.error('✖ 未找到 esbuild。请先执行：npm.cmd install');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */

const log = {
  step: (m) => console.log(`\n\x1b[36m▸ ${m}\x1b[0m`),
  ok: (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`),
  warn: (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`),
  fail: (m) => console.log(`  \x1b[31m✖\x1b[0m ${m}`),
};

/** 在若干候选路径中找到第一个真实存在的文件 */
function resolveFirst(candidates, label) {
  for (const rel of candidates) {
    const abs = path.join(NM, rel);
    if (fs.existsSync(abs)) return abs;
  }
  throw new Error(
    `找不到 ${label}。已尝试：\n    ${candidates.join('\n    ')}\n` +
      `  请确认 npm install 是否成功。`
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to, { label } = {}) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  log.ok(`${label || path.basename(to)}  ${fmtSize(fs.statSync(to).size)}`);
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* 各个 vendor 的构建步骤                                                */
/* ------------------------------------------------------------------ */

/** 1. CodeMirror 6 —— ESM 必须打包成 IIFE */
async function buildCodeMirror() {
  log.step('打包 CodeMirror 6（ESM → IIFE）');
  const outfile = path.join(VENDOR, 'codemirror.bundle.js');
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'vendor-entry', 'codemirror.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'firefox100', 'safari15'],
    minify: true,
    legalComments: 'none',
    outfile,
    metafile: true,
    logLevel: 'warning',
  });
  log.ok(`codemirror.bundle.js  ${fmtSize(fs.statSync(outfile).size)}`);
  return result;
}

/** 2. highlight.js —— 打包 common 语言集 */
async function buildHljs() {
  log.step('打包 highlight.js（common 语言集）');
  const outfile = path.join(VENDOR, 'hljs.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'vendor-entry', 'hljs.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'firefox100', 'safari15'],
    minify: true,
    legalComments: 'none',
    outfile,
    logLevel: 'warning',
  });
  log.ok(`hljs.bundle.js  ${fmtSize(fs.statSync(outfile).size)}`);
}

/** 3. marked —— 官方已提供 UMD 产物，直接复制 */
function copyMarked() {
  log.step('复制 marked（UMD）');
  const src = resolveFirst(
    ['marked/marked.min.js', 'marked/lib/marked.umd.js', 'marked/marked.umd.js'],
    'marked UMD 产物'
  );
  copyFile(src, path.join(VENDOR, 'marked.js'), { label: 'marked.js' });
}

/** 4. DOMPurify —— 官方 UMD */
function copyPurify() {
  log.step('复制 DOMPurify（UMD）');
  const src = resolveFirst(
    ['dompurify/dist/purify.min.js', 'dompurify/dist/purify.js'],
    'DOMPurify 产物'
  );
  copyFile(src, path.join(VENDOR, 'purify.js'), { label: 'purify.js' });
}

/** 5. KaTeX —— JS + CSS + 字体 */
function copyKatex() {
  log.step('复制 KaTeX（JS + CSS + 字体）');
  const dist = path.join(NM, 'katex', 'dist');
  if (!fs.existsSync(dist)) throw new Error('找不到 katex/dist，请确认 npm install 是否成功。');

  const katexDir = path.join(VENDOR, 'katex');
  copyFile(path.join(dist, 'katex.min.js'), path.join(katexDir, 'katex.min.js'), {
    label: 'katex/katex.min.js',
  });
  copyFile(path.join(dist, 'katex.min.css'), path.join(katexDir, 'katex.min.css'), {
    label: 'katex/katex.min.css',
  });

  // 化学式扩展：\ce{H2SO4} 这类写法靠它。必须在 katex.min.js 之后加载
  // （它把自己挂到已有的 katex 上，而不是重新定义一遍）。
  copyFile(path.join(dist, 'contrib', 'mhchem.min.js'), path.join(katexDir, 'mhchem.min.js'), {
    label: 'katex/mhchem.min.js',
  });

  // 只带 woff2：Chrome/Edge/Firefox/Safari 现代版本全部支持，
  // 可省掉 woff + ttf 约一半体积。
  const fontSrc = path.join(dist, 'fonts');
  const fontDst = path.join(katexDir, 'fonts');
  ensureDir(fontDst);
  const fonts = fs.readdirSync(fontSrc).filter((f) => f.endsWith('.woff2'));
  for (const f of fonts) {
    fs.copyFileSync(path.join(fontSrc, f), path.join(fontDst, f));
  }
  log.ok(`katex/fonts/*.woff2  ${fonts.length} 个文件  ${fmtSize(dirSize(fontDst))}`);
}

/**
 * 6. KaTeX 字体内联 —— 供「导出单文件 HTML」用
 *
 * 为什么必须构建期做：`file://` 下 fetch 被禁，运行时读不到 woff2 再转 base64。
 *
 * 产物是一个独立的经典脚本（挂 `window.MM_KATEX_CSS`），
 * **不写进 index.html** —— 它约 500KB，只有点「导出 HTML」时才值得加载。
 */
function buildKatexInlineCss() {
  log.step('内联 KaTeX 字体（产出导出用的 CSS 常量）');

  const dist = path.join(NM, 'katex', 'dist');
  const fontDst = path.join(VENDOR, 'katex', 'fonts');
  let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');

  // 先删掉 woff / ttf 的备选源：导出的单文件带不了这些文件，
  // 留着只会变成一堆无效请求。现代浏览器全部都吃 woff2。
  css = css.replace(/,\s*url\([^)]*\.(woff|ttf)\)\s*format\(["']?[a-z]+["']?\)/gi, '');

  let inlined = 0;
  let missing = 0;

  css = css.replace(/url\(([^)]+?)\)/g, (whole, rawUrl) => {
    const url = rawUrl.trim().replace(/^["']|["']$/g, '');
    if (!/\.woff2$/i.test(url)) return whole; // data: 等原样留着

    const file = path.join(fontDst, path.basename(url));
    if (!fs.existsSync(file)) {
      missing++;
      return whole;
    }

    inlined++;
    return `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})`;
  });

  const js =
    '/* 由 tools/build-vendor.js 生成，请勿手工修改。\n' +
    '   内容：KaTeX 样式 + 已转成 base64 的 woff2 字体，供导出单文件 HTML 使用。 */\n' +
    'window.MM_KATEX_CSS=' +
    JSON.stringify(css) +
    ';\n';

  const target = path.join(VENDOR, 'katex', 'katex-inline.js');
  fs.writeFileSync(target, js, 'utf8');

  log.ok(
    `katex/katex-inline.js  ${fmtSize(fs.statSync(target).size)}` +
      `  （内联 ${inlined} 个字体${missing ? `，缺 ${missing} 个` : ''}）`
  );
}

/* ------------------------------------------------------------------ */
/* 清单文件：记录版本，便于日后追溯「这个产物是怎么来的」                    */
/* ------------------------------------------------------------------ */
function writeManifest(meta) {
  const deps = ['codemirror', '@codemirror/lang-markdown', 'marked', 'dompurify', 'katex', 'highlight.js'];
  const rows = deps
    .map((d) => {
      let v = '?';
      try {
        v = require(path.join(NM, d, 'package.json')).version;
      } catch (_) {
        /* ignore */
      }
      return `| \`${d}\` | ${v} |`;
    })
    .join('\n');

  const content = `# web/vendor 依赖清单

> 本目录由 \`node tools/build-vendor.js\` 自动生成，**请勿手工修改**。
> 产物入库，浏览器端因此无需构建。

生成时间：${new Date().toISOString()}

| 依赖 | 版本 |
| --- | --- |
${rows}

## 产物说明

| 文件 / 目录 | 全局变量 | 用途 |
| --- | --- | --- |
| \`codemirror.bundle.js\` | \`window.CM\` | 编辑器内核（CM6 全套 + Markdown 语言支持） |
| \`hljs.bundle.js\` | \`window.hljs\` | 预览区代码块高亮（common 语言集） |
| \`marked.js\` | \`window.marked\` | Markdown → HTML |
| \`purify.js\` | \`window.DOMPurify\` | HTML 净化，防注入 |
| \`katex/\` | \`window.katex\` | 数学公式渲染（含 woff2 字体） |

## 为什么全是 IIFE 而不是 ESM

\`file://\` 协议下浏览器会以 CORS 为由拒绝加载 \`<script type="module">\`，
导致「双击 index.html 就能用」这个核心目标无法达成。因此全部依赖
必须预打包成经典脚本。

## 为什么 KaTeX 只带 woff2

现代浏览器全部支持 woff2，去掉 woff/ttf 可省约一半体积。
本项目不支持 IE 与 2017 年前的浏览器。
`;
  fs.writeFileSync(path.join(VENDOR, 'VENDOR.md'), content, 'utf8');
  log.ok('VENDOR.md  依赖清单');
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('\x1b[1mMixMark · vendor 构建\x1b[0m');
  console.log(`源: node_modules/   →   目标: web/vendor/`);

  ensureDir(VENDOR);
  ensureDir(STAGE);

  try {
    await buildCodeMirror();
    await buildHljs();
    copyMarked();
    copyPurify();
    copyKatex();
    buildKatexInlineCss();
    writeManifest();
  } finally {
    // 不留中间产物，保持目录整洁
    fs.rmSync(STAGE, { recursive: true, force: true });
  }

  const total = dirSize(VENDOR);
  console.log(
    `\n\x1b[32m✔ vendor 构建完成\x1b[0m  web/vendor/ 共 ${fmtSize(total)}` +
      `\n  下一步：直接在浏览器打开 web/index.html\n`
  );
}

main().catch((err) => {
  console.error(`\n\x1b[31m✖ vendor 构建失败\x1b[0m`);
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
