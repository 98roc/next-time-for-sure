/* V2.0 原型共用交互；由 build-v2.py 内联到各维护源及预览，不接入业务接口。 */
(() => {
  /** 在一个原生对话框内切换内容，保留上一步表单、滚动位置和焦点。 */
  function createDialog(root, { restore, exit } = {}) {
    root.classList.add('v2-scope');
    const host = document.createElement('dialog');
    host.className = 'v2-dialog';
    root.append(host);
    let current = null, stack = [], origin = null, pending = null;
    const signature = node => JSON.stringify([...node.querySelectorAll('input,select,textarea')].map(input => [input.name || input.dataset.edit, input.value, input.checked]));
    const dirty = entry => entry && signature(entry.node) !== entry.original;

    function mount(entry) {
      host.replaceChildren(entry.node);
      host.setAttribute('aria-label', entry.title);
      host.classList.toggle('v2-wide', entry.wide);
      entry.node.querySelector('[data-v2-back]').hidden = !stack.length;
      if (!host.open) host.showModal();
      entry.node.querySelector('.v2-content').scrollTop = entry.scroll || 0;
      const focus = entry.focus?.isConnected ? entry.focus : entry.node.querySelector('.v2-content input:not(:disabled),.v2-content select:not(:disabled),.v2-content textarea:not(:disabled)') || entry.node.querySelector('[data-v2-back]:not([hidden]),[data-v2-close]');
      focus?.focus({ preventScroll: true });
    }

    /** 未保存提示占用当前表面，不再增加遮罩；取消保留所有字段。 */
    function guard(action, all = false) {
      if (!dirty(current) && !(all && stack.some(dirty))) { action(); return; }
      pending = action;
      const warning = current.node.querySelector('.v2-unsaved');
      warning.hidden = false;
      warning.querySelector('button').focus();
    }

    function close(force = false) {
      const perform = () => {
        host.close(); host.replaceChildren(); current = null; stack = []; pending = null;
        exit?.();
        if (origin?.isConnected) origin.focus({ preventScroll: true });
        else root.querySelector('main button,button')?.focus({ preventScroll: true });
      };
      if (force) perform(); else guard(perform, true);
    }

    function back(force = false) {
      if (!stack.length) { close(force); return; }
      const perform = () => { current = stack.pop(); mount(current); restore?.(current.context); };
      if (force) perform(); else guard(perform);
    }

    /** 底部操作组居中，依次为关闭、其他操作、保存；右上角保留快捷关闭。 */
    function show({ title, body, actions = '', context = {}, form = false, wide = false, key = '' }) {
      const scroll = current && key && current.key === key ? current.node.querySelector('.v2-content').scrollTop : 0;
      if (!current) origin = document.activeElement;
      else if (!key || key !== current.key) {
        current.scroll = current.node.querySelector('.v2-content').scrollTop;
        current.focus = document.activeElement;
        stack.push(current);
      }
      const node = document.createElement('section');
      node.className = 'v2-dialog-layout';
      node.innerHTML = `<header class="v2-dialog-header"><button type="button" data-v2-back aria-label="返回上一步">← 返回</button><h2></h2><button type="button" data-v2-close aria-label="关闭弹窗" class="v2-close">×</button></header><div class="v2-unsaved" role="alert" hidden><span>有未保存的修改，是否放弃？</span><button type="button" data-v2-keep>继续编辑</button><button type="button" data-v2-discard class="v2-danger">放弃修改</button></div><div class="v2-content"></div><footer class="v2-dialog-footer"><div class="v2-actions v2-footer-actions"><button type="button" data-v2-close>关闭</button></div></footer>`;
      node.querySelector('h2').textContent = title;
      const content = node.querySelector('.v2-content');
      content.innerHTML = form ? `<form data-dialog-form>${body}</form>` : body;
      const source = document.createElement('div'); source.innerHTML = actions;
      // 操作区独立于内容滚动，表单外的保存按钮通过 form 属性继续提交。
      const localActions = content.querySelector('.mw-form-footer');
      if (localActions) { source.append(...localActions.childNodes); localActions.remove(); }
      const formNode = content.querySelector('form');
      if (formNode) formNode.id = root.id + '-v2-form';
      const controls = node.querySelector('.v2-footer-actions');
      const secondary = [], primary = [];
      for (const button of [...source.querySelectorAll('button')]) {
        if (/^(取消|关闭|返回详情|返回任务)$/.test(button.textContent.trim()) || ['cancelDelete','returnMilestone','back-task'].includes(button.dataset.action)) { button.remove(); continue; }
        if (button.type === 'submit' && formNode) button.setAttribute('form', formNode.id);
        if (/删除/.test(button.textContent)) button.classList.add('v2-danger');
        const commits = button.type === 'submit' || button.matches('.nt-primary,.mw-primary,.primary') || /^(保存|确认|加入安排)/.test(button.textContent.trim());
        (commits ? primary : secondary).push(button);
      }
      controls.append(...secondary, ...primary);
      const note = source.textContent.trim();
      if (note) { const info = document.createElement('p'); info.className = 'v2-context'; info.textContent = note; content.prepend(info); }
      current = { title, node, context, wide, key, scroll, original: signature(node) };
      mount(current);
    }

    host.addEventListener('click', event => {
      if (event.target.closest('[data-v2-close]')) close();
      if (event.target.closest('[data-v2-back]')) back();
      if (event.target.closest('[data-v2-keep]')) { current.node.querySelector('.v2-unsaved').hidden = true; pending = null; current.node.querySelector('.v2-content input,.v2-content select,.v2-content textarea')?.focus(); }
      if (event.target.closest('[data-v2-discard]')) { const action = pending; pending = null; action?.(); }
    });
    host.addEventListener('cancel', event => { event.preventDefault(); stack.length ? back() : close(); });
    // 原生 dialog 负责焦点围栏与背景 inert；屏蔽旧页面的 Escape 处理器。
    host.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
    return { show, close, back, host, get context() { return current?.context; } };
  }
  window.NtfsV2 = { createDialog };
})();
