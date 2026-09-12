/**
 * MixMark — 全量语法检查
 * ===============================================================
 * 项目铁律之一：改完 JS 先跑一遍语法检查。
 *
 *   node tools/check-syntax.js
 *
 * 检查范围：
 *   ✔ web/js/**\/*.js     业务源码（经典脚本，IIFE 风格）
 *   ✔ tools/*.js          构建脚本
 *   ✘ web/vendor/         第三方产物，压缩过，跳过
 *   ✘ tools/vendor-entry/ ESM 入口，需按 module 解析，单独处理
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const RULES = [
  { dir: path.join(ROOT, 'web', 'js'), module: false, label: 'web/js' },
  { dir: path.join(ROOT, 'tools'), module: false, label: 'tools', skip: ['vendor-entry'] },
  { dir: path.join(ROOT, 'tools', 'vendor-entry'), module: true, label: 'tools/vendor-entry' },
];

function walk(dir, skip = []) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, skip));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

let pass = 0;
const failures = [];

/* ------------------------------------------------------------------
   CSS 健全性检查

   JS 有 node --check 兜底，CSS 没有。而「注释结束符被吞掉」是真实
   发生过的事故：少写一个结束符，会把后面几十行规则整段变成注释，
   浏览器却不会报任何错，只能靠肉眼发现样式「莫名其妙没生效」。
   这里做最小但有效的检查：注释配对 + 花括号配平。

   注意：本段注释里不能出现那两个符号本身，否则会把注释提前结束
   —— 这个脚本第一次写出来就是这么挂的。
   ------------------------------------------------------------------ */

const CSS_DIR = path.join(ROOT, 'web', 'css');

const CSS_FILES = fs.existsSync(CSS_DIR)
  ? fs
      .readdirSync(CSS_DIR)
      .filter((f) => f.endsWith('.css'))
      .map((f) => path.join(CSS_DIR, f))
  : [];

/**
 * 检查单个 CSS 文件。
 * 返回问题描述数组，空数组表示通过。
 */
function checkCss(file) {
  const src = fs.readFileSync(file, 'utf8');
  const problems = [];

  // 注释必须成对
  const opens = (src.match(/\/\*/g) || []).length;
  const closes = (src.match(/\*\//g) || []).length;

  if (opens !== closes) {
    problems.push(`注释不配对：/* 出现 ${opens} 次，*/ 出现 ${closes} 次`);

    // 多出来的 /* 会把后面整段规则吞成注释，直接报出行号便于定位
    if (opens > closes) {
      let idx = -1;
      for (let i = 0; i < opens - closes; i++) {
        idx = src.indexOf('/*', idx + 1);
        const line = src.slice(0, idx).split('\n').length;
        problems.push(`  第 ${line} 行附近的 /* 缺少对应的 */`);
      }
    }
  }

  // 花括号配平（先剥掉注释再数，避免注释里的括号干扰）
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const braceOpen = (stripped.match(/\{/g) || []).length;
  const braceClose = (stripped.match(/\}/g) || []).length;

  if (braceOpen !== braceClose) {
    problems.push(`花括号不配平：{ ${braceOpen} 个，} ${braceClose} 个`);
  }

  return problems;
}

for (const file of CSS_FILES) {
  const problems = checkCss(file);
  if (problems.length === 0) {
    pass++;
  } else {
    failures.push({
      file: path.relative(ROOT, file),
      msg: problems.join('\n'),
    });
  }
}

for (const rule of RULES) {
  const files = walk(rule.dir, rule.skip || []);
  if (files.length === 0) continue;

  for (const file of files) {
    const args = ['--check'];
    if (rule.module) args.push('--input-type=module');
    // node --check 读文件时，--input-type 无效，改用 stdin 以支持 ESM
    const res = rule.module
      ? spawnSync(process.execPath, ['--input-type=module', '--check'], {
          input: fs.readFileSync(file, 'utf8'),
          encoding: 'utf8',
        })
      : spawnSync(process.execPath, [...args, file], { encoding: 'utf8' });

    if (res.status === 0) {
      pass++;
    } else {
      failures.push({
        file: path.relative(ROOT, file),
        msg: (res.stderr || '').trim(),
      });
    }
  }
}

if (failures.length === 0) {
  console.log(`\x1b[32m✔ 语法检查通过\x1b[0m  ${pass} 个文件`);
  process.exit(0);
}

console.log(`\x1b[31m✖ 语法检查失败\x1b[0m  ${failures.length} / ${pass + failures.length} 个文件有问题\n`);
for (const f of failures) {
  console.log(`\x1b[31m▸ ${f.file}\x1b[0m`);
  console.log(
    f.msg
      .split('\n')
      .filter((l) => !/^\s*at /.test(l))
      .slice(0, 8)
      .map((l) => `    ${l}`)
      .join('\n')
  );
  console.log('');
}
process.exit(1);
