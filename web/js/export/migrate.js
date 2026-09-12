/**
 * MixMark · 迁移（导出全部 / 导入文件夹）
 * ===============================================================
 * Tier A（双击打开）与 B/C/D 之间搬家用的那座桥。
 *
 *   导出全部   → 把整个文档库打成一个 zip（保留文件夹结构）下载下来
 *   导入文件夹 → 选一个目录，把里面的 .md / .txt 收进文档库（含子目录）
 *
 * 为什么自己写 ZIP 而不是引 JSZip：项目的铁律是运行期零构建，
 * 加一个 vendor 就要动构建脚本、还要把体积背进去；而我们只需要
 * 「把一堆文本打进一个文件」，store 模式（不压缩）的 ZIP 结构简单到
 * 一百行以内写得下，而且 txt/md 本来就不值得压缩。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /* ------------------------------------------------------------------
     ZIP（仅 store 模式）
     ------------------------------------------------------------------ */

  /** CRC32 查表。ZIP 要求每个条目带校验和，跳不过去 */
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  /** entries: [{ name, text }] → Blob */
  function makeZip(entries) {
    var enc = new TextEncoder();
    var body = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (e) {
      var nameBytes = enc.encode(e.name);
      var data = enc.encode(e.text);
      var crc = crc32(data);

      var head = new Uint8Array(30 + nameBytes.length);
      var hv = new DataView(head.buffer);
      hv.setUint32(0, 0x04034b50, true); // 本地文件头
      hv.setUint16(4, 20, true); // 解压所需版本
      hv.setUint16(6, 0x0800, true); // 文件名按 UTF-8 解读 —— 中文名全靠这一位
      hv.setUint16(8, 0, true); // 压缩方式 0 = 不压缩
      hv.setUint16(10, 0, true); // 时间
      hv.setUint16(12, 0, true); // 日期
      hv.setUint32(14, crc, true);
      hv.setUint32(18, data.length, true);
      hv.setUint32(22, data.length, true);
      hv.setUint16(26, nameBytes.length, true);
      hv.setUint16(28, 0, true);
      head.set(nameBytes, 30);
      body.push(head, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); // 中央目录项
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true); // 对应本地头的偏移
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += head.length + data.length;
    });

    var cdSize = central.reduce(function (n, c) {
      return n + c.length;
    }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); // 目录结束标记
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(body.concat(central, [end]), { type: 'application/zip' });
  }

  /* ------------------------------------------------------------------
     小工具
     ------------------------------------------------------------------ */

  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /** 文件名里不能出现的字符（Windows 与 Unix 都不允许的那批） */
  function safeName(name) {
    return String(name || 'untitled')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'untitled';
  }

  var MD_EXT = /\.(md|markdown|mdown|txt)$/i;

  function withExt(title) {
    return MD_EXT.test(title) ? title : title + '.md';
  }

  function readDocText(doc) {
    if (doc.id === MM.store.get().docId) return Promise.resolve(MM.docs.content());
    // 只传 id：存储层内部自己会拼 'doc:' 前缀
    return Promise.resolve(MM.provider.get().read(doc.id)).then(function (v) {
      return typeof v === 'string' ? v : '';
    });
  }

  /* ------------------------------------------------------------------
     导出全部
     ------------------------------------------------------------------ */

  /** folderId → 'a/b' 这样的相对路径 */
  function folderPath(folderId, folders) {
    var parts = [];
    var guard = 0;
    var cur = folderId;

    while (cur && guard++ < 50) {
      var hit = null;
      for (var i = 0; i < folders.length; i++) {
        if (folders[i].id === cur) {
          hit = folders[i];
          break;
        }
      }
      if (!hit) break;
      parts.unshift(safeName(hit.name));
      cur = hit.parentId;
    }

    return parts.join('/');
  }

  function exportAll() {
    var docs = MM.store.get().docs || [];
    if (!docs.length) {
      MM.toast.show(MM.i18n.t('toastNothingToCopy'));
      return Promise.resolve();
    }

    var folders = MM.store.get().folders || [];
    var used = Object.create(null);

    return docs
      .reduce(function (chain, doc) {
        return chain.then(function (list) {
          return readDocText(doc).then(function (text) {
            var dir = folderPath(doc.folderId, folders);
            var base = safeName(withExt(doc.title));

            // 同名不同篇（库里允许）→ 加序号，zip 里不能有重名
            var path = dir ? dir + '/' + base : base;
            var n = 2;
            while (used[path.toLowerCase()]) {
              var stem = base.replace(MD_EXT, '');
              var ext = (base.match(MD_EXT) || ['.md'])[0];
              path = (dir ? dir + '/' : '') + stem + ' (' + n + ')' + ext;
              n++;
            }
            used[path.toLowerCase()] = 1;

            list.push({ name: path, text: text });
            return list;
          });
        });
      }, Promise.resolve([]))
      .then(function (entries) {
        var stamp = new Date().toISOString().slice(0, 10);
        downloadBlob('MixMark-' + stamp + '.zip', makeZip(entries));
        MM.toast.ok(MM.i18n.t('toastExportedCount', { n: entries.length }));
      });
  }

  /* ------------------------------------------------------------------
     导入文件夹
     ------------------------------------------------------------------ */

  function importFolder() {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // webkitdirectory 只影响「选什么」，不涉及跨域，file:// 下照样能用
    input.webkitdirectory = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', function () {
      var picked = Array.prototype.slice.call(input.files || []).filter(function (f) {
        return MD_EXT.test(f.name);
      });

      document.body.removeChild(input);

      if (!picked.length) {
        MM.toast.show(MM.i18n.t('toastImportNone'));
        return;
      }

      MM.toast.show(MM.i18n.t('toastImporting', { n: picked.length }));

      var dirMap = Object.create(null);

      /** 逐段把目录建出来，复用已经建过的；返回最内层 folderId */
      function ensureDir(parts) {
        var key = '';
        var parentId = null;

        return parts.reduce(function (chain, part) {
          key = key ? key + '/' + part : part;
          return chain.then(function () {
            if (dirMap[key]) {
              parentId = dirMap[key];
              return null;
            }
            return MM.docs.createFolder(part, parentId).then(function (meta) {
              dirMap[key] = meta.id;
              parentId = meta.id;
            });
          });
        }, Promise.resolve()).then(function () {
          return parentId;
        });
      }

      function uniqueTitle(title) {
        var taken = (MM.store.get().docs || []).some(function (d) {
          return String(d.title).toLowerCase() === title.toLowerCase();
        });
        if (!taken) return title;

        var stem = title.replace(MD_EXT, '');
        var ext = (title.match(MD_EXT) || ['.md'])[0];
        var n = 2;
        while (
          (MM.store.get().docs || []).some(function (d) {
            return String(d.title).toLowerCase() === (stem + ' (' + n + ')' + ext).toLowerCase();
          })
        ) {
          n++;
        }
        return stem + ' (' + n + ')' + ext;
      }

      var done = 0;

      // 串行：建文件夹与建文档都会改同一份索引，并发容易互相踩
      var chain = Promise.resolve();

      picked.forEach(function (file) {
        chain = chain.then(function () {
          var rel = file.webkitRelativePath || file.name;
          var parts = rel.split('/');
          // 去掉最外层的根目录名 —— 那是用户随手选的容器，不该变成库里的文件夹
          parts.shift();
          var dirs = parts.slice(0, -1);

          return ensureDir(dirs)
            .then(function (folderId) {
              return file.text().then(function (text) {
                MM.docs.create({
                  content: text,
                  title: uniqueTitle(safeName(file.name)),
                  autoTitle: false,
                  folderId: folderId
                });
                done++;
                return new Promise(function (r) {
                  setTimeout(r, 120);
                });
              });
            })
            .catch(function () {
              // 单个文件出问题不该拖垮整批
            });
        });
      });

      chain.then(function () {
        if (MM.docs.flushPending) MM.docs.flushPending();
        MM.toast.ok(MM.i18n.t('toastImported', { n: done }));
      });
    });

    input.click();
  }

  /* ------------------------------------------------------------------
     命令
     ------------------------------------------------------------------ */

  MM.commands.registerAll([
    {
      id: 'export.all',
      titleKey: 'cmdExportAll',
      group: 'export',
      run: exportAll
    },
    {
      id: 'file.importFolder',
      titleKey: 'cmdImportFolder',
      group: 'file',
      run: importFolder
    }
  ]);
})();
