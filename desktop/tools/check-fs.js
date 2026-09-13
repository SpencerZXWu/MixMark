/**
 * MixMark · 桌面端文件夹库的自检
 * ===============================================================
 * 用普通 node 跑，不需要 Electron：
 *
 *   node desktop/tools/check-fs.js
 *
 * 覆盖的都是「一旦错了就会丢用户数据」的地方：中文文件名、重名、
 * 非法字符、Windows 保留名、重命名/移动之后磁盘上的文件跟着走。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib/library-fs.js');

let pass = 0;
let fail = 0;

function ok(label, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✔ ' + label);
  } else {
    fail++;
    console.log('  ✘ ' + label + (extra ? '   → ' + extra : ''));
  }
}

function section(name) {
  console.log('\n' + name);
}

function freshRoot(tag) {
  const dir = path.join(os.tmpdir(), 'mixmark-fs-check', tag + '-' + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(l, docs, folders) {
  l.set('folders', JSON.stringify(folders || []));
  l.set('docs', JSON.stringify(docs));
}

/* ------------------------------------------------------------------ */

section('① 基本落盘：真的写出 .md，中文名原样');

{
  const root = freshRoot('basic');
  const l = lib.open(root);

  const docs = [
    { id: 'd1', title: '读书笔记.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: null }
  ];
  write(l, docs);
  l.set('doc:d1', '# 读书笔记\n\n今天读了一本书。\n');

  ok('磁盘上存在 读书笔记.md', fs.existsSync(path.join(root, '读书笔记.md')));
  ok(
    '内容原样',
    fs.readFileSync(path.join(root, '读书笔记.md'), 'utf8') === '# 读书笔记\n\n今天读了一本书。\n'
  );
  ok('藏着 .mixmark 元数据目录', fs.existsSync(path.join(root, '.mixmark', 'docs.json')));
  ok('读回来一致', l.get('doc:d1') === '# 读书笔记\n\n今天读了一本书。\n');
  ok('pathOf 指到真实文件', l.pathOf('d1') === path.join(root, '读书笔记.md'));

  // 新建文档走的是「先写正文、后写索引」，轮到写文件时索引里还没有它 ——
  // 文件名只能靠调用方带过来的 meta，否则会写成一串内部 id
  const made = l.set('doc:d9', '正文', { id: 'd9', title: '刚建的笔记', format: 'md', folderId: null });
  ok('索引里还没有时也能用标题命名', fs.existsSync(path.join(root, '刚建的笔记.md')), JSON.stringify(made));
}

section('② 文件名安全：非法字符 / 保留名 / 结尾点号 / .md 后缀不重复');

{
  ok('斜杠换成空格', lib.fileNameFor('a/b:c*d?e"f<g>h|i', 'x') === 'a b c d e f g h i.md', lib.fileNameFor('a/b:c*d?e"f<g>h|i', 'x'));
  ok('CON 加下划线', lib.fileNameFor('CON', 'x') === '_CON.md', lib.fileNameFor('CON', 'x'));
  ok('结尾点号去掉', lib.fileNameFor('笔记...', 'x') === '笔记.md', lib.fileNameFor('笔记...', 'x'));
  ok('不叠加 .md', lib.fileNameFor('笔记.md', 'x') === '笔记.md', lib.fileNameFor('笔记.md', 'x'));
  ok('.markdown 也归一', lib.fileNameFor('笔记.markdown', 'x') === '笔记.md');
  ok('空标题回落到 id', lib.fileNameFor('   ', 'd9').indexOf('d9') === 0, lib.fileNameFor('   ', 'd9'));
  ok('txt 格式用 .txt 后缀', lib.fileNameFor('草稿', 'x', 'txt') === '草稿.txt', lib.fileNameFor('草稿', 'x', 'txt'));
}

section('③ 重名：自动加 (2)(3)，而且互不覆盖');

{
  const root = freshRoot('dup');
  const l = lib.open(root);
  const docs = [
    { id: 'a', title: '同名.md', ctime: 1, mtime: 3, size: 0, autoTitle: false, folderId: null },
    { id: 'b', title: '同名.md', ctime: 1, mtime: 2, size: 0, autoTitle: false, folderId: null },
    { id: 'c', title: '同名.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: null }
  ];
  write(l, docs);
  l.set('doc:a', 'AAA');
  l.set('doc:b', 'BBB');
  l.set('doc:c', 'CCC');

  ok('第一个用原名', fs.readFileSync(path.join(root, '同名.md'), 'utf8') === 'AAA');
  ok('第二个用 (2)', fs.existsSync(path.join(root, '同名 (2).md')));
  ok('第三个用 (3)', fs.existsSync(path.join(root, '同名 (3).md')));
  ok('三份内容没串', l.get('doc:b') === 'BBB' && l.get('doc:c') === 'CCC');
}

section('④ 文件夹：虚拟树镜像成真实子目录');

{
  const root = freshRoot('tree');
  const l = lib.open(root);
  const folders = [
    { id: 'f1', name: '笔记', parentId: null, ctime: 1, mtime: 1 },
    { id: 'f2', name: '期中', parentId: 'f1', ctime: 1, mtime: 1 }
  ];
  let docs = [{ id: 'd1', title: '代数.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: 'f2' }];
  write(l, docs, folders);
  l.set('doc:d1', '一元二次');

  ok('落进两级子目录', fs.existsSync(path.join(root, '笔记', '期中', '代数.md')), l.pathOf('d1'));

  // 移动到根：文件应该跟着出来，旧位置不该留空壳
  docs = [{ id: 'd1', title: '代数.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: null }];
  write(l, docs, folders);
  const r1 = l.sync();

  ok('文件被移到根', fs.existsSync(path.join(root, '代数.md')));
  ok('旧位置已清空', !fs.existsSync(path.join(root, '笔记', '期中', '代数.md')));
  ok('内容没丢', fs.readFileSync(path.join(root, '代数.md'), 'utf8') === '一元二次');
  ok('sync 报告了移动', r1.moved.length === 1, JSON.stringify(r1.moved));

  // 移回去，再确认空目录被清掉
  docs = [{ id: 'd1', title: '代数.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: 'f2' }];
  write(l, docs, folders);
  l.sync();
  ok('移回子目录', fs.existsSync(path.join(root, '笔记', '期中', '代数.md')));
}

section('⑤ 重命名：磁盘上的文件名跟着改');

{
  const root = freshRoot('rename');
  const l = lib.open(root);
  let docs = [{ id: 'd1', title: '旧名.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: null }];
  write(l, docs);
  l.set('doc:d1', '内容不变');

  docs = [{ id: 'd1', title: '新名.md', ctime: 1, mtime: 2, size: 0, autoTitle: false, folderId: null }];
  write(l, docs);
  l.sync();

  ok('新文件出现', fs.existsSync(path.join(root, '新名.md')));
  ok('旧文件消失', !fs.existsSync(path.join(root, '旧名.md')));
  ok('内容跟着走', fs.readFileSync(path.join(root, '新名.md'), 'utf8') === '内容不变');
}

section('⑥ 删除文档：文件与记录一起清掉');

{
  const root = freshRoot('del');
  const l = lib.open(root);
  write(l, [
    { id: 'd1', title: '甲.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: null },
    { id: 'd2', title: '乙.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: null }
  ]);
  l.set('doc:d1', '甲');
  l.set('doc:d2', '乙');
  ok('两份都在', fs.existsSync(path.join(root, '甲.md')) && fs.existsSync(path.join(root, '乙.md')));

  l.remove('doc:d1');
  ok('删了甲', !fs.existsSync(path.join(root, '甲.md')));
  ok('乙没受牵连', fs.existsSync(path.join(root, '乙.md')));

  // 索引里去掉乙之后 sync 也该清掉它
  write(l, []);
  const r = l.sync();
  ok('sync 清掉孤儿文件', !fs.existsSync(path.join(root, '乙.md')), JSON.stringify(r));
}

section('⑦ 首次连接：把文件夹里已有的 .md 收进来');

{
  const root = freshRoot('adopt');
  fs.mkdirSync(path.join(root, '旧笔记'), { recursive: true });
  fs.writeFileSync(path.join(root, '散落的.md'), '# 散落\n', 'utf8');
  fs.writeFileSync(path.join(root, '旧笔记', '很久以前.md'), '# 从前\n', 'utf8');
  fs.writeFileSync(path.join(root, '随笔.txt'), '随手写的', 'utf8');
  fs.writeFileSync(path.join(root, '忽略我.png'), 'not markdown', 'utf8');

  // 依赖与版本库里的 .md 不是用户的笔记。实测拿仓库根当库时，
  // 一个 node_modules 就能塞进来 676 篇第三方 README，文档树直接淹掉。
  fs.mkdirSync(path.join(root, 'node_modules', 'somepkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'somepkg', 'README.md'), '# pkg\n', 'utf8');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'README.md'), '# git internals\n', 'utf8');
  fs.mkdirSync(path.join(root, '笔记', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, '笔记', 'node_modules', 'README.md'), '# nested\n', 'utf8');

  const l = lib.open(root);
  const r = l.adoptExisting();

  const docs = l.docsIndex();
  const folders = l.foldersIndex();
  const placed = JSON.parse(fs.readFileSync(path.join(root, '.mixmark', 'files.json'), 'utf8'));

  ok('收进来 3 篇', r.adopted === 3, JSON.stringify(r));
  ok('标题不带后缀', docs.map((d) => d.title).sort().join(',') === '很久以前,散落的,随笔', docs.map((d) => d.title).join(','));
  ok('没去扫 node_modules / .git', !Object.keys(placed).some((id) => /node_modules|\.git/i.test(placed[id])), JSON.stringify(placed));
  ok('嵌套的 node_modules 也跳过', !folders.some((f) => f.name === 'node_modules'), JSON.stringify(folders));
  ok('真实目录建成了虚拟文件夹', folders.length === 1 && folders[0].name === '旧笔记', JSON.stringify(folders));
  ok('子目录那篇挂到了文件夹下', docs.find((d) => d.title === '很久以前').folderId === folders[0].id);
  ok('png 没被当成文档', !docs.some((d) => /png/.test(d.title)));
  ok('内容读得回来', l.get('doc:' + docs.find((d) => d.title === '散落的').id) === '# 散落\n');

  // 对齐磁盘时不能把用户的 .txt 改名成 .md
  l.sync();
  ok('.txt 对齐后还是 .txt', fs.existsSync(path.join(root, '随笔.txt')));
  ok('.txt 的格式被记下来了', docs.find((d) => d.title === '随笔').format === 'txt');
  ok('.md 没被改成 .md.md', fs.existsSync(path.join(root, '散落的.md')));

  // 再连一次不该重复导入
  const again = lib.open(root).adoptExisting();
  ok('第二次连接不重复导入', again.adopted === 0, JSON.stringify(again));
}

section('⑧ 元数据目录不会被当成文档，也不会被清掉');

{
  const root = freshRoot('meta');
  const l = lib.open(root);
  write(l, [{ id: 'd1', title: '甲.md', ctime: 1, mtime: 1, size: 0, autoTitle: false, folderId: null }]);
  l.set('doc:d1', '甲');
  l.sync();

  ok('.mixmark 还在', fs.existsSync(path.join(root, '.mixmark', 'files.json')));
  ok('files.json 记录了位置', JSON.parse(fs.readFileSync(path.join(root, '.mixmark', 'files.json'), 'utf8')).d1 === '甲.md');
}

section('⑨ 增量扫描：往文件夹里丢一篇，扫一次就该收进来');

{
  const root = freshRoot('scan');
  const l = lib.open(root);

  fs.writeFileSync(path.join(root, '甲.md'), '# 甲\n', 'utf8');
  ok('首次连接收编 1 篇', l.adoptExisting().adopted === 1);

  // 这就是用户干的事：在文件管理器里把文档丢进去
  fs.writeFileSync(path.join(root, '乙.md'), '# 乙\n', 'utf8');
  fs.mkdirSync(path.join(root, '课程'), { recursive: true });
  fs.writeFileSync(path.join(root, '课程', '丙.md'), '# 丙\n', 'utf8');
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'README.md'), '# 不是笔记\n', 'utf8');

  const r = l.scanFolder();
  ok('扫出新丢进来的 2 篇', r.adopted === 2, JSON.stringify(r.files));

  const docs = l.docsIndex();
  const folders = l.foldersIndex();
  ok('索引里有 3 篇', docs.length === 3, docs.map((d) => d.title).join(','));
  ok('子目录建出了文件夹', folders.length === 1 && folders[0].name === '课程', JSON.stringify(folders));
  ok('新收的挂到了文件夹下', docs.find((d) => d.title === '丙').folderId === folders[0].id);
  ok('node_modules 照旧跳过', !docs.some((d) => d.title === 'README'));
  ok('新收的内容读得回来', l.get('doc:' + docs.find((d) => d.title === '乙').id) === '# 乙\n');

  // 重复扫：不能重复收，也不能每次多长一棵文件夹树
  ok('再扫一次不重复', l.scanFolder().adopted === 0);
  ok('文件夹没有重复建', l.foldersIndex().length === 1);

  // 根目录整个读不到（被删了/U 盘拔了）：不能当成「里面本来就空」
  const gone = freshRoot('gone');
  const g = lib.open(gone);
  fs.writeFileSync(path.join(gone, '甲.md'), '# 甲\n', 'utf8');
  g.adoptExisting();
  fs.rmSync(gone, { recursive: true, force: true });
  const r2 = g.scanFolder();
  ok('根目录读不到时不误判为空', r2.adopted === 0 && r2.files.length === 0, JSON.stringify(r2));
}

/* ------------------------------------------------------------------ */

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
