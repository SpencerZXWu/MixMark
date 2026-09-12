/**
 * MixMark — M1 冒烟测试（关键风险验证）
 * ===============================================================
 * 目的：在写业务代码之前，先用最小代价验证「双击 index.html 就能用」
 *       这条产品红线在技术上是否成立。
 *
 * 直接双击本文件在浏览器打开即可。三个必须通过的实验：
 *
 *   [1] file:// 下能否加载 IIFE 经典脚本（CM6）
 *       —— 若失败，整个零构建架构不成立
 *   [2] file:// 下 @font-face 字体能否加载（KaTeX 数学字体）
 *       —— 若被 CORS 拦，需改为 base64 内联
 *   [3] 中文 IME 在 CodeMirror 中是否正常
 *       —— 需人工在下方编辑器里用微软拼音输入中文，观察有无丢字/错位
 *
 * 这个页面同时是回归测试用例，长期保留。
 */
'use strict';

const checks = [];

function record(level, name, detail) {
  checks.push({ level, name, detail });
}

/* ---------------------------------------------------------------- */
/* [1] IIFE 经典脚本加载                                              */
/* ---------------------------------------------------------------- */
function checkGlobals() {
  const libs = [
    ['CM (CodeMirror 6)', window.CM, ['EditorView', 'EditorState', 'markdown', 'basicSetup']],
    ['marked', window.marked, ['parse']],
    ['DOMPurify', window.DOMPurify, ['sanitize']],
    ['katex', window.katex, ['renderToString']],
    ['hljs', window.hljs, ['highlight', 'highlightElement']],
  ];

  for (const [label, obj, members] of libs) {
    if (!obj) {
      record('fail', `${label} 未加载`, 'window 上找不到该库，检查 <script> 路径');
      continue;
    }
    const missing = members.filter((m) => typeof obj[m] === 'undefined');
    if (missing.length) {
      record('warn', `${label} 已加载但缺成员`, `缺少：${missing.join(', ')}`);
    } else {
      record('ok', `${label} 加载正常`, members.join(', '));
    }
  }
}

/* ---------------------------------------------------------------- */
/* [2] 数学字体在 file:// 下是否真的可用                              */
/* ---------------------------------------------------------------- */
async function checkKatexFonts() {
  const el = document.getElementById('katex-target');
  if (!window.katex) {
    record('fail', 'KaTeX 字体检查跳过', 'katex 未加载');
    return;
  }

  try {
    // 两个公式：第一个用分式与根号；第二个用大号括号，
    // 后者会触发 KaTeX_Size* 系列字体，避免因懒加载造成误判。
    el.innerHTML =
      window.katex.renderToString('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', {
        throwOnError: true,
        displayMode: true,
      }) +
      window.katex.renderToString('\\left(\\frac{a}{b}\\right)^{n} \\quad \\sum_{i=1}^{n} i', {
        throwOnError: true,
        displayMode: true,
      });
  } catch (err) {
    record('fail', 'KaTeX 渲染抛错', String(err && err.message));
    return;
  }

  // 等字体请求尘埃落定
  try {
    await document.fonts.ready;
  } catch (_) {
    /* ignore */
  }

  /* --------------------------------------------------------------
   * 判定依据：直接读 FontFace.status，不要用下面两种都会被误导的方法。
   *
   *  ✘ document.fonts.check('16px "KaTeX_Size1"')
   *    浏览器对 @font-face 是按需懒加载的，当前公式没用到某个字号
   *    字体（如 Size1）它压根不会去请求，check() 返回 false —— 假阴性。
   *
   *  ✘ performance.getEntriesByType('resource')
   *    Chrome 在 file:// 协议下不为子资源记录 resource timing 条目，
   *    返回长度恒为 0 —— 也是假阴性。（实测确认）
   *
   *  ✔ 唯一可靠的做法：遍历 [...document.fonts] 看 status。
   *    任意公式都会用到 Main / Math，这两个是 loaded 即证明字体通路正常。
   * -------------------------------------------------------------- */
  const strip = (s) => s.replace(/["']/g, '');
  const faces = [...document.fonts].filter((f) => /^KaTeX_/.test(strip(f.family)));
  const loadedFaces = faces.filter((f) => f.status === 'loaded');
  const uniqueFamilies = [...new Set(faces.map((f) => strip(f.family)))];
  const loadedFamilies = [...new Set(loadedFaces.map((f) => strip(f.family)))];

  // 任意公式都必然用到这两个，缺任何一个就是真失败
  const REQUIRED = ['KaTeX_Main', 'KaTeX_Math'];
  const missing = REQUIRED.filter((f) => !loadedFamilies.includes(f));

  const summary = document.getElementById('katex-verdict');

  if (faces.length === 0) {
    record(
      'fail',
      '样本中不存在任何 KaTeX 字体面',
      '说明 katex.min.css 未生效 —— 检查 CSS 路径与 fonts/ 目录'
    );
    summary.textContent = '✖ 字体 CSS 未加载，公式必然错位';
    return;
  }

  if (missing.length) {
    record(
      'fail',
      `KaTeX 字体在 file:// 下加载失败：${missing.join(', ')}`,
      '需把 woff2 改为 base64 内联进 CSS（会有约 250KB 体积代价）'
    );
    summary.textContent = '✖ 关键数学字体缺失 —— 公式会退化成系统衬线字体';
    return;
  }

  record(
    'ok',
    'KaTeX 字体在 file:// 下加载成功',
    `已激活 ${loadedFamilies.length} 个字族（${loadedFamilies.join(', ')}）—— ` +
      `@font-face 未被 CORS 拦截`
  );
  record(
    'ok',
    '其余字体面按需懒加载属正常',
    `共 ${uniqueFamilies.length} 个字族，未激活的是当前公式用不到的字号/风格（AMS、Fraktur、Script 等），不代表失败`
  );

  summary.textContent =
    `✔ 字体正常 —— 已激活 ${loadedFamilies.join(' / ')}。` +
    `上方两个公式应为标准数学排版（根号、分数线、大括号比例正确）`;
}

/* ---------------------------------------------------------------- */
/* [3] 中文 IME：需人工输入                                           */
/* ---------------------------------------------------------------- */
function setupEditor() {
  const host = document.getElementById('editor-host');
  if (!window.CM) {
    host.textContent = 'CM6 未加载，无法测试输入法';
    record('fail', '中文 IME 测试跳过', 'CM6 未加载');
    return;
  }

  const { EditorView, EditorState, basicSetup, markdown, keymap, defaultKeymap, history, historyKeymap } = window.CM;

  const initial = [
    '# 中文输入测试',
    '',
    '请在这里用**微软拼音**输入一段中文，观察：',
    '',
    '1. 候选框是否跟随光标',
    '2. 上屏后有无丢字、重复字、光标错位',
    '3. 快速连打长句是否掉字符',
    '',
    '英文 mixed with 中文 and $E = mc^2$ 混排也应正常。',
    '',
    '```js',
    'const hello = "你好，世界";',
    '```',
    '',
  ].join('\n');

  const view = new EditorView({
    state: EditorState.create({
      doc: initial,
      extensions: [
        basicSetup,
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        history(),
        EditorView.theme({
          '&': { height: '260px', fontSize: '14px' },
          '.cm-scroller': {
            fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace',
          },
        }),
      ],
    }),
    parent: host,
  });

  // 把输入事件记录下来，便于客观判断有无疑似丢字
  let inputEvents = 0;
  view.dom.addEventListener('input', () => {
    inputEvents++;
    const len = view.state.doc.length;
    document.getElementById('ime-counter').textContent =
      `输入事件 ${inputEvents} 次 · 当前文档 ${len} 字符 · 行数 ${view.state.doc.lines}`;
  });

  record('ok', 'CodeMirror 6 实例创建成功', '可直接在上方编辑器中做输入法测试');
}

/* ---------------------------------------------------------------- */
/* 渲染报告                                                          */
/* ---------------------------------------------------------------- */
function render() {
  const order = { fail: 0, warn: 1, ok: 2 };
  const icon = { ok: '✔', warn: '!', fail: '✖' };
  const color = { ok: 'var(--ok)', warn: 'var(--warn)', fail: 'var(--bad)' };

  checks.sort((a, b) => order[a.level] - order[b.level]);

  document.getElementById('report').innerHTML = checks
    .map(
      (c) => `<li class="row">
        <span class="icon" style="color:${color[c.level]}">${icon[c.level]}</span>
        <span class="body">
          <b>${escapeHtml(c.name)}</b>
          <span class="detail">${escapeHtml(c.detail)}</span>
        </span>
      </li>`
    )
    .join('');

  const fails = checks.filter((c) => c.level === 'fail').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  const head = document.getElementById('verdict');

  if (fails) {
    head.className = 'verdict bad';
    head.textContent = `${fails} 项失败 · ${warns} 项警告 —— 架构需要调整`;
  } else if (warns) {
    head.className = 'verdict warn';
    head.textContent = `全部通过（${warns} 项警告，需留意）`;
  } else {
    head.className = 'verdict ok';
    head.textContent = '全部通过 —— 「双击可用」架构成立';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------------------------------------------------------- */
/* 启动                                                              */
/* ---------------------------------------------------------------- */
(async function main() {
  checkGlobals();
  await checkKatexFonts();
  setupEditor();
  render();
})();
