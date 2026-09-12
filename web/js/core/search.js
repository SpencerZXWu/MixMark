/**
 * MixMark · 全文搜索
 * ===============================================================
 * 在「所有文档」里找内容，而不是只找标题。
 * 点击结果直接跳到对应文档的对应行。
 *
 * 实现策略：
 *   - 输入防抖 200ms，避免每敲一个字就把整个库读一遍
 *   - 逐篇读取后做大小写不敏感的子串匹配
 *   - 单篇最多返回若干条，总量封顶，防止一次渲染上千个 DOM 节点
 *
 * 对 localStorage 来说逐篇读取是同步的、很快；
 * 对 IDB / FSA 是异步的，但文档数量级下也够用。真到几万篇再考虑建索引。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var els = {};
  var timer = null;
  var lastQuery = '';
  var running = false;

  var PER_DOC_LIMIT = 5;
  var TOTAL_LIMIT = 120;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** 把一行里的命中片段高亮出来（先把整行转义，再插入标记，避免 XSS） */
  function highlight(line, needle) {
    var lower = line.toLowerCase();
    var target = needle.toLowerCase();

    var out = '';
    var from = 0;
    var idx;

    while ((idx = lower.indexOf(target, from)) !== -1 && out.length < 400) {
      out += escapeHtml(line.slice(from, idx));
      out += '<mark>' + escapeHtml(line.slice(idx, idx + needle.length)) + '</mark>';
      from = idx + needle.length;
    }
    out += escapeHtml(line.slice(from));

    return out;
  }

  /* ------------------------------------------------------------------
     执行搜索
     ------------------------------------------------------------------ */

  function scanDoc(meta, content, needle) {
    var lines = content.split('\n');
    var hits = [];

    for (var i = 0; i < lines.length && hits.length < PER_DOC_LIMIT; i++) {
      if (lines[i].toLowerCase().indexOf(needle) === -1) continue;

      // 去掉行首缩进，让结果看起来更像正文
      var text = lines[i].replace(/^\s+/, '');
      hits.push({
        docId: meta.id,
        title: meta.title || MM.i18n.t('untitled'),
        line: i + 1,
        text: text.length > 160 ? text.slice(0, 160) + '…' : text
      });
    }

    return hits;
  }

  function run(query) {
    if (!query) {
      render([]);
      return Promise.resolve([]);
    }

    var provider = MM.provider.get();
    var needle = query.toLowerCase();

    running = true;
    renderLoading();

    return provider
      .list()
      .then(function (docs) {
        var results = [];

        // 逐篇串行读取：并发读几十篇对 localStorage 没意义，
        // 对 IDB/FSA 反而会造成大量并发事务
        var chain = Promise.resolve();

        docs.forEach(function (meta) {
          chain = chain.then(function () {
            if (results.length >= TOTAL_LIMIT) return null;
            return provider
              .read(meta.id)
              .then(function (content) {
                var hits = scanDoc(meta, content, needle);
                for (var i = 0; i < hits.length && results.length < TOTAL_LIMIT; i++) {
                  results.push(hits[i]);
                }
              })
              .catch(function () {
                // 单篇读失败不影响其它文档的搜索
                return null;
              });
          });
        });

        return chain.then(function () {
          return results;
        });
      })
      .then(function (results) {
        running = false;
        render(results);
        return results;
      })
      .catch(function (err) {
        running = false;
        console.error('[search] 搜索失败', err);
        render([]);
        return [];
      });
  }

  function schedule(query) {
    lastQuery = query;
    if (timer) clearTimeout(timer);

    if (!query) {
      render([]);
      return;
    }

    timer = setTimeout(function () {
      timer = null;
      run(lastQuery);
    }, 200);
  }

  /* ------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------ */

  function renderLoading() {
    if (!els.results) return;
    els.results.innerHTML = '<li class="panel-empty">' + escapeHtml(MM.i18n.t('searchRunning')) + '</li>';
  }

  function render(results) {
    if (!els.results) return;

    els.results.innerHTML = '';

    if (!lastQuery) {
      var hint = document.createElement('li');
      hint.className = 'panel-empty';
      hint.textContent = MM.i18n.t('searchHint');
      els.results.appendChild(hint);
      return;
    }

    if (!results.length) {
      var empty = document.createElement('li');
      empty.className = 'panel-empty';
      empty.textContent = MM.i18n.t('searchNoResults', { q: lastQuery });
      els.results.appendChild(empty);
      return;
    }

    var summary = document.createElement('li');
    summary.className = 'search-summary';
    summary.textContent = MM.i18n.t('searchCount', { n: results.length });
    els.results.appendChild(summary);

    var frag = document.createDocumentFragment();
    var lastDocId = null;

    results.forEach(function (hit) {
      // 同一篇文档只出一次标题行，后面跟它的若干条命中
      if (hit.docId !== lastDocId) {
        lastDocId = hit.docId;
        var head = document.createElement('li');
        head.className = 'search-doc';
        head.textContent = hit.title;
        head.title = hit.title;
        frag.appendChild(head);
      }

      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-hit';
      btn.setAttribute('data-doc-id', hit.docId);
      btn.setAttribute('data-line', String(hit.line));

      var num = document.createElement('span');
      num.className = 'search-hit__line';
      num.textContent = String(hit.line);

      var body = document.createElement('span');
      body.className = 'search-hit__text';
      body.innerHTML = highlight(hit.text, lastQuery);

      btn.appendChild(num);
      btn.appendChild(body);
      li.appendChild(btn);
      frag.appendChild(li);
    });

    els.results.appendChild(frag);
  }

  /* ------------------------------------------------------------------
     跳转
     ------------------------------------------------------------------ */

  function openHit(btn) {
    var docId = btn.getAttribute('data-doc-id');
    var line = parseInt(btn.getAttribute('data-line'), 10);

    var go = docId === MM.store.get().docId
      ? Promise.resolve()
      : MM.docs.open(docId).then(function () {
          // 编辑器内容与滚动位置都换了，给它一帧再定位
          return new Promise(function (r) {
            setTimeout(r, 60);
          });
        });

    go.then(function () {
      if (!isNaN(line)) MM.editor.gotoLine(line);
      MM.editor.focus();
    });
  }

  /* ------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------ */

  function init() {
    els.input = document.getElementById('search-input');
    els.results = document.getElementById('search-results');
    if (!els.input || !els.results) return;

    els.input.addEventListener('input', function () {
      schedule(els.input.value.trim());
    });

    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        els.input.value = '';
        schedule('');
        MM.editor.focus();
      }
    });

    els.results.addEventListener('click', function (e) {
      var btn = e.target.closest('.search-hit');
      if (btn) openHit(btn);
    });

    render([]);
  }

  /** 切到搜索面板时把焦点给输入框 */
  function focus() {
    if (els.input) {
      els.input.focus();
      els.input.select();
    }
  }

  /** 当前是否正在等待输入 */
  function hasQuery() {
    return !!lastQuery;
  }

  MM.search = {
    init: init,
    focus: focus,
    schedule: schedule,
    run: run,
    hasQuery: hasQuery
  };
})();
