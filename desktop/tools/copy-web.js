/**
 * MixMark · 把 web/ 拷进 desktop/app/
 * ===============================================================
 *   node tools/copy-web.js
 *
 * 为什么要拷一份而不是直接引用 ../web：
 *   electron-builder 只会把列进 `files` 的东西打进安装包，
 *   而它默认不允许把「包目录之外」的文件收进去（那会让打包结果依赖
 *   开发机上的目录结构）。拷进来之后，打的包是自洽的。
 *
 * 为什么不做增量（只拷改过的）：
 *   这一步只花几百毫秒，而且 web/ 是唯一真源 ——
 *   增量同步一旦出错，打出来的包里可能混着两份不同版本的 JS，
 *   那种问题排查起来极贵。每次都全量覆盖，永远不会错位。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'web');
const DEST = path.join(__dirname, '..', 'app');

function copyDir(from, to, stats) {
  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);

    if (entry.isDirectory()) {
      copyDir(src, dst, stats);
      continue;
    }
    if (!entry.isFile()) continue;

    fs.copyFileSync(src, dst);
    stats.files++;
    stats.bytes += fs.statSync(src).size;
  }
}

function main() {
  if (!fs.existsSync(path.join(SRC, 'index.html'))) {
    console.error('找不到 ' + path.join(SRC, 'index.html') + ' —— web/ 目录不完整？');
    process.exit(1);
  }

  // 全量重建：先删干净，避免上一次的残留文件被打进包里
  fs.rmSync(DEST, { recursive: true, force: true });

  const stats = { files: 0, bytes: 0 };
  copyDir(SRC, DEST, stats);

  console.log(
    '[copy-web] ' + stats.files + ' 个文件 / ' + (stats.bytes / 1024 / 1024).toFixed(2) + ' MB → desktop/app'
  );

  // 自检：入口与两个 vendor 产物必须在，缺了打出来的包是废的
  ['index.html', 'js/main.js', 'vendor/codemirror.bundle.js', 'vendor/katex/katex.min.js'].forEach((f) => {
    if (!fs.existsSync(path.join(DEST, f))) {
      console.error('[copy-web] 缺少关键文件：' + f);
      process.exit(1);
    }
  });

  console.log('[copy-web] 关键文件齐全');
}

main();
