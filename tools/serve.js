/**
 * MixMark — 本地静态服务器（开发用）
 * ===============================================================
 * 为什么需要它：
 *   `file://` 协议下浏览器会禁用 IndexedDB / File System Access API，
 *   应用会自动降级为 localStorage 文档库（Tier A）。
 *   用这个服务器跑起来，就能验证 Tier B 的完整存储能力。
 *
 *   node tools/serve.js            # 默认 http://127.0.0.1:5178
 *   node tools/serve.js 8080       # 指定端口
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(path.resolve(__dirname, '..'), 'web');
const PORT = Number(process.argv[2]) || 5178;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  // 防目录穿越
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${urlPath}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store', // 开发期禁用缓存，省得手动清
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n\x1b[36mMixMark dev server\x1b[0m`);
  console.log(`  本地访问   http://127.0.0.1:${PORT}/`);
  console.log(`  根目录     ${ROOT}`);
  console.log(`\n  \x1b[2mCtrl+C 停止\x1b[0m\n`);
});
