/**
 * MixMark · 崩溃恢复
 * ===============================================================
 * 解决的问题：浏览器崩溃 / 误关标签页 / 断电时，最近一次自动保存之后
 * 的内容会丢失。这里把正文快照周期性地写到 localStorage，
 * 下次启动时若发现「快照比已保存内容新」，就询问用户是否恢复。
 *
 * 为什么需要（而不是只靠自动保存）：
 *   自动保存有 1.5 秒防抖窗口，且保存失败（配额满）时不会留下任何痕迹。
 *   快照是比自动保存更粗但更耐用的兜底。
 *
 * 存储占用：只在内存里做比较，写盘时用覆盖式，最多留 1 份，避免吃配额。
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  var KEY = 'mixmark:recovery';
  var INTERVAL = 30000; // 至少间隔 30 秒才写一次盘

  var lastWrite = 0;
  var timer = null;
  var pending = null;

  /* ------------------------------------------------------------------
     写入
     ------------------------------------------------------------------ */

  function serialize(docId, content) {
    return JSON.stringify({
      docId: docId,
      content: content,
      at: Date.now()
    });
  }

  /**
   * 记一份快照。高频调用，内部做了节流：
   * 距离上次写盘不足 INTERVAL 时只暂存，等定时器到点再落盘。
   */
  function note(docId, content) {
    if (!docId) return;

    pending = { docId: docId, content: content };

    var now = Date.now();
    if (now - lastWrite >= INTERVAL) {
      flush();
      return;
    }

    if (!timer) {
      timer = setTimeout(function () {
        timer = null;
        flush();
      }, INTERVAL - (now - lastWrite));
    }
  }

  function flush() {
    if (!pending) return;

    // 内容已经落盘就不必留快照。
    // 这一句是快照机制有没有价值的分水岭：
    //   - 自动保存正常工作时，dirty 很快变回 false，快照不会长期占着配额
    //   - 自动保存被用户关掉、或因配额写盘失败时，dirty 一直为 true，
    //     快照就会稳定留存 —— 这正是真正需要它的两种场景
    if (!MM.store.get().dirty) {
      pending = null;
      return;
    }

    var payload = serialize(pending.docId, pending.content);
    pending = null;
    lastWrite = Date.now();

    try {
      window.localStorage.setItem(KEY, payload);
    } catch (err) {
      // 配额满时快照写不进去。这不是致命问题（自动保存仍在工作），
      // 但要停止重试，避免每次编辑都抛异常刷屏。
      console.warn('[recovery] 快照写入失败（可能是配额已满）', err);
    }
  }

  function clear() {
    pending = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) {
      /* 忽略 */
    }
  }

  /* ------------------------------------------------------------------
     启动时检查
     ------------------------------------------------------------------ */

  function peek() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;

    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.content !== 'string') return null;
      return parsed;
    } catch (err) {
      clear();
      return null;
    }
  }

  /**
   * 判断是否有「值得恢复」的内容。
   * 只有当快照和已保存内容确实不同、且快照不为空时才算数 ——
   * 否则正常关闭也会每次都弹窗，非常烦人。
   */
  function shouldOffer(currentContent, currentDocId) {
    var snap = peek();
    if (!snap) return false;
    if (!snap.content.trim()) return false;
    if (snap.content === currentContent) return false;
    // 只恢复同一篇文档的快照，避免把 A 的内容灌进 B
    if (currentDocId && snap.docId && snap.docId !== currentDocId) return false;
    return true;
  }

  MM.recovery = {
    note: note,
    flush: flush,
    clear: clear,
    peek: peek,
    shouldOffer: shouldOffer,
    KEY: KEY
  };
})();
