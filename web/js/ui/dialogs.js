/**
 * MixMark · 对话框
 * ===============================================================
 * 自己实现而不是用原生 prompt/confirm：
 *   - 原生 confirm 在部分浏览器里会阻塞渲染，且样式无法控制
 *   - 原生 prompt 无法做「空值校验后再提交」的体验
 *
 * 两个都返回 Promise，调用处可以写得很平：
 *   var name = await MM.dialogs.prompt({...});
 *   if (!name) return;
 */
(function () {
  'use strict';

  var MM = (window.MM = window.MM || {});

  /** 当前打开的对话框栈（一般只有一层，保留以支持设置页里再弹确认框） */
  var stack = [];

  /* ------------------------------------------------------------------
     通用浮层
     ------------------------------------------------------------------ */

  function openOverlay(inner, opts) {
    opts = opts || {};

    var overlay = document.createElement('div');
    overlay.className = 'overlay ' + (opts.position === 'top' ? 'overlay--top' : 'overlay--center');
    overlay.appendChild(inner);

    document.body.appendChild(overlay);
    stack.push(overlay);

    function close(result) {
      var i = stack.indexOf(overlay);
      if (i !== -1) stack.splice(i, 1);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey, true);
      if (opts.onClose) opts.onClose(result);
    }

    function onKey(e) {
      if (stack[stack.length - 1] !== overlay) return; // 只响应最上层
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
    }

    document.addEventListener('keydown', onKey, true);

    // 点击遮罩关闭（设置页等不需要，用 dismissable: false 关掉）
    if (opts.dismissable !== false) {
      overlay.addEventListener('mousedown', function (e) {
        if (e.target === overlay) close(null);
      });
    }

    return { overlay: overlay, close: close };
  }

  /** 把焦点限制在浮层内，Tab 到边界时绕回 */
  function trapFocus(container) {
    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;

      var focusables = container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;

      var first = focusables[0];
      var last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ------------------------------------------------------------------
     输入框对话框
     ------------------------------------------------------------------ */

  /**
   * @param {object} opts
   *   title / label / placeholder / value / okText / cancelText
   *   select 可选：{ label, value, options: [{ value, text }] }
   * @returns {Promise<string|{value:string, option:string}|null>}
   *   传了 opts.select 时返回对象（两个字段一起给，调用方不用再查一次），
   *   否则仍然返回纯文本 —— 老调用点一行不用改
   */
  function prompt(opts) {
    opts = opts || {};

    return new Promise(function (resolve) {
      var dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      var title = document.createElement('h2');
      title.className = 'dialog__title';
      title.textContent = opts.title || '';

      var label = document.createElement('label');
      label.className = 'dialog__message';
      label.setAttribute('for', 'mm-dialog-input');
      label.textContent = opts.label || '';

      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'mm-dialog-input';
      input.className = 'dialog__field';
      input.value = opts.value || '';
      input.placeholder = opts.placeholder || '';
      input.autocomplete = 'off';
      input.spellcheck = false;

      // 可选的下拉字段（如「文档格式」）。不传就不生成，
      // 保持原来的单输入框行为与返回类型
      var select = null;
      if (opts.select && opts.select.options && opts.select.options.length) {
        select = document.createElement('select');
        select.className = 'dialog__field dialog__select';
        select.setAttribute('aria-label', opts.select.label || '');
        opts.select.options.forEach(function (opt, i) {
          var node = document.createElement('option');
          node.value = opt.value;
          node.textContent = opt.text;
          select.appendChild(node);
          if (i === 0 && !opts.select.value) select.value = opt.value;
        });
        if (opts.select.value) select.value = opts.select.value;
      }

      var actions = document.createElement('div');
      actions.className = 'dialog__actions';

      var cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.type = 'button';
      cancel.textContent = opts.cancelText || MM.i18n.t('btnCancel');

      var submitBtn = document.createElement('button');
      submitBtn.className = 'btn btn--primary';
      submitBtn.type = 'button';
      submitBtn.textContent = opts.okText || MM.i18n.t('btnOk');

      actions.appendChild(cancel);
      actions.appendChild(submitBtn);

      dialog.appendChild(title);
      if (opts.label) dialog.appendChild(label);
      dialog.appendChild(input);
      if (select) dialog.appendChild(select);
      dialog.appendChild(actions);

      // 结果统一由 onClose 透出：Esc / 点遮罩 / 按钮三条路径都会走到它，
      // 若改成在外面包装 handle.close，Esc 走的是内部原始函数，Promise 会挂死。
      var handle = openOverlay(dialog, {
        position: 'center',
        onClose: function (result) {
          resolve(result);
        }
      });
      trapFocus(dialog);

      function submit() {
        var value = input.value.trim();
        if (!value) {
          // 空值不接受：抖一下输入框并重新聚焦，比弹错误框轻
          input.focus();
          input.select();
          MM.toast.show(MM.i18n.t('toastNameRequired'));
          return;
        }
        handle.close(select ? { value: value, option: select.value } : value);
      }

      cancel.addEventListener('click', function () {
        handle.close(null);
      });
      submitBtn.addEventListener('click', submit);

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });

      // 等一帧再聚焦，确保元素已完成布局（否则部分浏览器聚焦不到）
      requestAnimationFrame(function () {
        input.focus();
        input.select();
      });
    });
  }

  /* ------------------------------------------------------------------
     确认对话框
     ------------------------------------------------------------------ */

  /**
   * @returns {Promise<boolean>}
   */
  function confirm(opts) {
    opts = opts || {};

    return new Promise(function (resolve) {
      var dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      var title = document.createElement('h2');
      title.className = 'dialog__title';
      title.textContent = opts.title || '';

      var message = document.createElement('p');
      message.className = 'dialog__message';
      message.textContent = opts.message || '';

      var actions = document.createElement('div');
      actions.className = 'dialog__actions';

      var cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.type = 'button';
      cancel.textContent = opts.cancelText || MM.i18n.t('btnCancel');

      var okBtn = document.createElement('button');
      okBtn.className = 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary');
      okBtn.type = 'button';
      okBtn.textContent = opts.okText || MM.i18n.t('btnOk');

      actions.appendChild(cancel);
      actions.appendChild(okBtn);

      dialog.appendChild(title);
      if (opts.message) dialog.appendChild(message);
      dialog.appendChild(actions);

      var handle = openOverlay(dialog, {
        position: 'center',
        onClose: function (result) {
          resolve(result === true);
        }
      });
      trapFocus(dialog);

      cancel.addEventListener('click', function () {
        handle.close(false);
      });
      okBtn.addEventListener('click', function () {
        handle.close(true);
      });

      requestAnimationFrame(function () {
        (opts.danger ? cancel : okBtn).focus();
      });
    });
  }

  /* ------------------------------------------------------------------
     自定义内容浮层（设置页用）
     ------------------------------------------------------------------ */

  function custom(build, opts) {
    var handle = openOverlay(build, Object.assign({ dismissable: true }, opts || {}));
    return handle;
  }

  MM.dialogs = {
    prompt: prompt,
    confirm: confirm,
    custom: custom
  };
})();
