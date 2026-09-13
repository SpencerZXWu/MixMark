/**
 * MixMark · 桌面端文件夹库（纯 Node，不依赖 Electron）
 * ===============================================================
 * 「桌面版」到底多给了用户什么？就是这一层：文档不再躺在浏览器的
 * localStorage / IndexedDB 里，而是**真的以 .md 明文落在你自己选的文件夹**。
 *
 * 磁盘布局：
 *
 *   <你选的文件夹>/
 *   ├─ 笔记.md                    ← 正文，明文，随时能用别的编辑器打开
 *   ├─ 论文/
 *   │  └─ 提纲.md                 ← 虚拟文件夹会镜像成真实子目录
 *   └─ .mixmark/
 *      ├─ docs.json               ← 文档元数据（id / 标题 / 时间 / 所在文件夹）
 *      ├─ folders.json            ← 文件夹树
 *      └─ files.json              ← 文档 id → 相对路径
 *
 * 为什么元数据不直接靠目录扫描推导：
 *   目录扫不出「id」，也扫不出 mtime 之外的排序意图；而应用内部到处以 id 为准
 *   （打开的标签、当前文档、AI 的引用）。索引文件是权威，`.md` 是**镜像**。
 *   代价得说清楚：用户若在应用外改名/删文件，应用不会立刻知道 —— 重新同步时纠正。
 *
 * 为什么单独拆成一个纯 Node 模块：
 *   Electron 的主进程没法在自动化里直接跑断言（要起窗口），
 *   但这层才是真正容易出错的地方（路径拼接、重名、中文、保留名）。
 *   拆出来之后 tools/check-fs.js 能用普通 node 把它跑一遍。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** 索引所在的隐藏目录名 */
const META_DIR = '.mixmark';

/** Windows 保留设备名：叫这些名字的文件在建目录时会失败 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** 单个路径段的安全长度（给「文件夹层级」留出余量） */
const MAX_SEGMENT = 80;

/**
 * 收编已有文档时**不进**的目录。
 *
 * 这些里面就算躺着 .md，也不是用户写的笔记：一个 node_modules 里能有上千个
 * README/LICENSE。实测把仓库根当成库时会一口气收进 676 篇第三方 readme，
 * 文档树直接淹掉。
 */
const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.idea',
  '.vs'
]);

/** 收编数量上限：防止有人误把整个盘当库，一次塞进来几十万篇 */
const MAX_ADOPT = 3000;

/**
 * 把任意字符串变成能当文件名用的样子。
 * 中文原样保留 —— Node 与 NTFS 都没问题，不要为了「保险」把中文音译掉。
 */
function safeSegment(name) {
  let s = String(name == null ? '' : name)
    // Windows 不允许的字符；另外控制字符一并去掉
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // 结尾的点和空格在 Windows 上会被系统悄悄吃掉，导致「写进去的名字和读出来的不一样」
    .replace(/[. ]+$/, '');

  if (!s) s = '未命名';
  if (RESERVED.test(s)) s = '_' + s;
  if (s.length > MAX_SEGMENT) s = s.slice(0, MAX_SEGMENT).trim();

  return s || '未命名';
}

/**
 * 标题 → 文件名。常见写法 `笔记.md` 不该变成 `笔记.md.md`。
 * 后缀跟着文档格式走，否则收编进来的 .txt 一被对齐就会变成 .md。
 */
function fileNameFor(title, id, format) {
  const ext = String(format || '').toLowerCase() === 'txt' ? '.txt' : '.md';
  let base = safeSegment(String(title == null ? '' : title).trim() || id);
  base = base.replace(/\.(md|markdown|txt)$/i, '');
  if (!base) base = safeSegment(id);
  return base + ext;
}

function readJsonFile(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1), 'utf8');
}

/**
 * 打开一个文件夹作为文档库。
 * @param {string} root 绝对路径
 */
function open(root) {
  const metaDir = path.join(root, META_DIR);
  const docsFile = path.join(metaDir, 'docs.json');
  const foldersFile = path.join(metaDir, 'folders.json');
  const filesFile = path.join(metaDir, 'files.json');

  fs.mkdirSync(metaDir, { recursive: true });

  /** docId → 相对路径（用 / 分隔，存起来与平台无关） */
  let files = readJsonFile(filesFile, {});

  function saveFiles() {
    writeJsonFile(filesFile, files);
  }

  function docsIndex() {
    const v = readJsonFile(docsFile, []);
    return Array.isArray(v) ? v : [];
  }

  function foldersIndex() {
    const v = readJsonFile(foldersFile, []);
    return Array.isArray(v) ? v : [];
  }

  /** 虚拟文件夹 id → 相对目录（'' 表示根） */
  function dirForFolder(folderId, folders) {
    const parts = [];
    let walk = folderId;
    let guard = 0;
    while (walk && guard++ < 64) {
      const f = folders.find((x) => x.id === walk);
      if (!f) break;
      parts.unshift(safeSegment(f.name));
      walk = f.parentId;
    }
    return parts.join('/');
  }

  /** 某个相对路径是否已被别的文档占用 */
  function taken(rel, exceptId) {
    for (const id of Object.keys(files)) {
      if (id === exceptId) continue;
      if (files[id].toLowerCase() === rel.toLowerCase()) return true;
    }
    return false;
  }

  /** 目标相对路径：文档所在文件夹 + 标题，重名就加 (2)(3) */
  function desiredRel(doc, folders) {
    const dir = dirForFolder(doc.folderId || null, folders);
    const name = fileNameFor(doc.title, doc.id, doc.format);
    const stem = name.replace(/\.(md|txt)$/i, '');

    let candidate = dir ? dir + '/' + name : name;
    let n = 2;
    while (taken(candidate, doc.id)) {
      const alt = stem + ' (' + n + ').md';
      candidate = dir ? dir + '/' + alt : alt;
      n++;
      if (n > 500) break;
    }
    return candidate;
  }

  function absOf(rel) {
    return path.join(root, rel.split('/').join(path.sep));
  }

  /* ------------------------------------------------------------------
     KV 接口（library.js 认的那一套）
     ------------------------------------------------------------------ */

  const KV = { docs: docsFile, folders: foldersFile };

  function get(key) {
    if (key === 'docs' || key === 'folders') {
      const v = readJsonFile(KV[key], null);
      return v === null ? null : JSON.stringify(v);
    }
    if (key.indexOf('doc:') === 0) {
      const id = key.slice(4);
      const rel = files[id];
      if (!rel) return null;
      try {
        return fs.readFileSync(absOf(rel), 'utf8');
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  /**
   * meta 是可选第三参。索引是权威，但**新建文档走的是「先写正文、后写索引」**，
   * 轮到这一步时索引里还没有它 —— 光靠索引就只能拿 id 当文件名，
   * 用户会在磁盘上看到 `dmtz9d5xo3lx56.md`，而不是他自己起的标题。
   */
  function set(key, value, meta) {
    if (key === 'docs' || key === 'folders') {
      writeJsonFile(KV[key], JSON.parse(value));
      return { path: null };
    }
    if (key.indexOf('doc:') === 0) {
      const id = key.slice(4);
      let rel = files[id];

      // 还没有落盘位置：先查索引，再退回调用方给的 meta，最后才用 id
      if (!rel) {
        const doc = docsIndex().find((d) => d.id === id) || meta || { id: id, title: '' };
        rel = desiredRel(doc, foldersIndex());
        files[id] = rel;
        saveFiles();
      }

      const abs = absOf(rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(value == null ? '' : value), 'utf8');
      // 把落点回给页面：状态栏与 AI 要如实回答「存在哪」，不能靠猜
      return { path: abs };
    }
    // 其余键（设置之类）不归这一层管
    return { path: null };
  }

  function remove(key) {
    if (key === 'docs' || key === 'folders') {
      try {
        fs.unlinkSync(KV[key]);
      } catch (err) {
        /* 本来就没有 */
      }
      return;
    }
    if (key.indexOf('doc:') === 0) {
      const id = key.slice(4);
      const rel = files[id];
      if (rel) {
        try {
          fs.unlinkSync(absOf(rel));
        } catch (err) {
          /* 已经不在了 */
        }
        delete files[id];
        saveFiles();
      }
    }
  }

  function keys() {
    return ['docs', 'folders'].concat(Object.keys(files).map((id) => 'doc:' + id));
  }

  /* ------------------------------------------------------------------
     与真实文件对齐

     结构变化（重命名、移动、新建文件夹）之后调用一次：
     索引改了，磁盘上的 .md 位置/名字也得跟着走，否则两边会慢慢飘开。
     ------------------------------------------------------------------ */

  function sync() {
    const docs = docsIndex();
    const folders = foldersIndex();
    const moved = [];

    for (const doc of docs) {
      const want = desiredRel(doc, folders);
      const have = files[doc.id];

      if (have === want) {
        // 位置对，但文件可能被用户在应用外删了 —— 补回来（内容从索引读不到，置空）
        if (!fs.existsSync(absOf(want))) {
          const abs = absOf(want);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, '', 'utf8');
        }
        continue;
      }

      const absWant = absOf(want);
      fs.mkdirSync(path.dirname(absWant), { recursive: true });

      if (have && fs.existsSync(absOf(have))) {
        try {
          fs.renameSync(absOf(have), absWant);
          moved.push({ id: doc.id, from: have, to: want });
        } catch (err) {
          // 跨盘或占用导致改名失败：退化成「写一份新的、删掉旧的」
          fs.writeFileSync(absWant, fs.readFileSync(absOf(have), 'utf8'), 'utf8');
          try {
            fs.unlinkSync(absOf(have));
          } catch (e2) {
            /* 删不掉就留着，下次再清 */
          }
          moved.push({ id: doc.id, from: have, to: want });
        }
      } else if (!fs.existsSync(absWant)) {
        fs.writeFileSync(absWant, '', 'utf8');
      }

      files[doc.id] = want;
    }

    // 索引里已经没有的文档：把文件与记录一起清掉
    const alive = new Set(docs.map((d) => d.id));
    let dropped = 0;
    for (const id of Object.keys(files)) {
      if (alive.has(id)) continue;
      try {
        fs.unlinkSync(absOf(files[id]));
      } catch (err) {
        /* 已经不在 */
      }
      delete files[id];
      dropped++;
    }

    // 顺手清掉空目录（用户删掉文件夹后，磁盘上不该剩下空壳）
    pruneEmptyDirs(root, metaDir);

    saveFiles();
    return { moved, dropped };
  }

  /** 递归删掉空的子目录，但绝不动根目录与元数据目录 */
  function pruneEmptyDirs(dir, keep) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (full === keep) continue;
      pruneEmptyDirs(full, keep);
      try {
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } catch (err) {
        /* 非空或没权限，留着 */
      }
    }
  }

  /* ------------------------------------------------------------------
     首次连接：把文件夹里已有的 .md 收进来
     ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------
     扫文件夹：把磁盘上的 .md 收进索引
     ------------------------------------------------------------------
     同一套遍历与建文件夹逻辑，两个用法：
       adoptExisting()  首次连接，索引还空着的时候全量收编
       scanFolder()     每次都能用，只补磁盘上新出现的那些
     ------------------------------------------------------------------ */

  /**
   * 遍历文件夹，收集所有 .md / .markdown / .txt。
   *
   * ok=false 表示**根目录没读成**（被删了、U 盘拔了、没权限）。
   * 这个区分很要紧：调用方据此决定是「什么都别做」还是「里面本来就空」——
   * 把「读不到」当成「里面没东西」，一次意外就能让整个库看起来空了。
   */
  function collectDocs() {
    const found = [];
    let ok = false;

    (function walk(dir, prefix) {
      if (found.length >= MAX_ADOPT) return;

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        return;
      }
      ok = true;

      for (const e of entries) {
        if (e.isDirectory()) {
          if (e.name === META_DIR || SKIP_DIRS.has(e.name.toLowerCase())) continue;
          walk(path.join(dir, e.name), prefix ? prefix + '/' + e.name : e.name);
          continue;
        }
        if (!/\.(md|markdown|txt)$/i.test(e.name)) continue;
        found.push({
          rel: prefix ? prefix + '/' + e.name : e.name,
          name: e.name,
          // 后缀要跟着记下来，否则对齐磁盘时会把用户的 .txt 改名成 .md
          format: /\.txt$/i.test(e.name) ? 'txt' : 'md'
        });
      }
    })(root, '');

    return { found, ok };
  }

  function newId(prefix, stamp) {
    return prefix + stamp.toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /**
   * 「相对目录路径」→ 虚拟文件夹 id，缺的补建。
   *
   * 按 (parentId, name) 认已有的文件夹 —— 增量扫描时必须这样，
   * 否则用户每丢一次文件，磁盘上那棵目录树就会在侧栏里多长一遍。
   */
  function folderMaker(folders, stamp) {
    const idOf = { '': null };

    return function idFor(prefix) {
      if (prefix in idOf) return idOf[prefix];

      const parts = prefix.split('/');
      const parentId = idFor(parts.slice(0, -1).join('/'));
      const name = parts[parts.length - 1];

      let hit = folders.find((f) => f.parentId === parentId && f.name === name);
      if (!hit) {
        hit = {
          id: newId('f', stamp + folders.length),
          name,
          parentId,
          ctime: stamp,
          mtime: stamp
        };
        folders.push(hit);
      }

      idOf[prefix] = hit.id;
      return hit.id;
    };
  }

  /** 相对路径的目录部分 → 文件夹 id（根目录是 null） */
  function folderOf(rel, idFor) {
    const parts = rel.split('/');
    if (parts.length < 2) return null;
    return idFor(parts.slice(0, -1).join('/'));
  }

  /** 一个磁盘文件 → 一条索引记录 */
  function docFrom(f, stamp, folderId) {
    return {
      id: newId('d', stamp),
      // 标题不带后缀：文档树里其它文档都不带，混着显示很别扭。
      // 磁盘文件名不受影响 —— files 里记的是收编时的相对路径
      title: f.name.replace(/\.(md|markdown|txt)$/i, ''),
      ctime: stamp,
      mtime: stamp,
      size: 0,
      format: f.format,
      autoTitle: false,
      folderId: folderId
    };
  }

  /**
   * 首次连接：索引还空着，把文件夹里已有的文档全收进来。
   * 只在索引为空时做 —— 之后往文件夹里加东西走 scanFolder()。
   */
  function adoptExisting() {
    if (docsIndex().length) return { adopted: 0 };

    const { found } = collectDocs();
    if (!found.length) return { adopted: 0 };
    if (found.length >= MAX_ADOPT) {
      console.warn('[library-fs] 这个文件夹里的文档太多了，只收编了前 ' + MAX_ADOPT + ' 篇');
    }

    const stamp = Date.now();
    const folders = [];
    const idFor = folderMaker(folders, stamp);

    const docsOut = found.map((f, i) => {
      const doc = docFrom(f, stamp + i, folderOf(f.rel, idFor));
      // 越靠前的越「新」：列表按 mtime 倒序，这样顺序跟文件夹里看到的接近
      doc.mtime = stamp - i;
      files[doc.id] = f.rel;
      return doc;
    });

    writeJsonFile(foldersFile, folders);
    writeJsonFile(docsFile, docsOut);
    saveFiles();

    return { adopted: docsOut.length };
  }

  /**
   * 增量扫一遍：把**后来**丢进文件夹的文档收进来。
   *
   * 这就是「我往文件夹里放一篇，切回应用该能看见它」。与 adoptExisting 的区别是
   * 每次都干活，而且只认磁盘上没有记录的那些。
   *
   * 只加不删：磁盘上少了什么不在这里处理 —— 一次读不到目录就当整库清空，
   * 代价太大（见 collectDocs 的 ok）。
   */
  function scanFolder() {
    const { found, ok } = collectDocs();
    if (!ok) return { adopted: 0, files: [] };

    const docs = docsIndex();
    const folders = foldersIndex();

    // 已有记录：相对路径（小写）→ 文档 id
    const known = {};
    for (const id of Object.keys(files)) {
      if (files[id]) known[files[id].toLowerCase()] = id;
    }

    const idFor = folderMaker(folders, Date.now());
    const stamp = Date.now();
    const added = [];

    found.forEach((f, i) => {
      if (known[f.rel.toLowerCase()]) return; // 已经在库里了
      const doc = docFrom(f, stamp + i, folderOf(f.rel, idFor));
      doc.mtime = stamp - i;
      docs.push(doc);
      files[doc.id] = f.rel;
      added.push(f.rel);
    });

    if (!added.length) return { adopted: 0, files: [] };

    writeJsonFile(foldersFile, folders);
    writeJsonFile(docsFile, docs);
    saveFiles();

    return { adopted: added.length, files: added };
  }

  return {
    root,
    metaDir,
    get,
    set,
    remove,
    keys,
    sync,
    adoptExisting,
    scanFolder,
    docsIndex,
    foldersIndex,
    /** 全部文档 → 绝对路径的映射（给页面做「存在哪」的展示） */
    paths: () => {
      const out = {};
      for (const id of Object.keys(files)) out[id] = absOf(files[id]);
      return out;
    },
    /** 给「打开文件 / 另存为」用：直接读写库外的单个文件 */
    readTextFile: (p) => fs.readFileSync(p, 'utf8'),
    writeTextFile: (p, text) => fs.writeFileSync(p, String(text == null ? '' : text), 'utf8'),
    /** 每个文档在磁盘上的位置，供状态栏与调试展示 */
    pathOf: (id) => (files[id] ? absOf(files[id]) : null)
  };
}

module.exports = { open, safeSegment, fileNameFor, META_DIR };
