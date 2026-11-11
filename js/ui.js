// Small DOM helpers, dialogs, and formatting shared across views.

/** Tiny element builder: h('button.primary', { onclick }, 'Play') */
export function h(spec, attrs = {}, ...children) {
  // Attributes are optional: h('div', child, child) works too.
  if (attrs instanceof Node || typeof attrs === 'string' || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openModal(content, { onClose, className = '' } = {}) {
  const backdrop = h('div.modal-backdrop');
  const box = h('div.modal' + (className ? '.' + className : ''), { role: 'dialog', 'aria-modal': 'true' }, content);
  backdrop.append(box);
  document.body.append(backdrop);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  return { close, box };
}

export function confirmDialog({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => { result = true; modal.close(); } }, confirmLabel);
    const content = h('div.dialog',
      h('h2', {}, title),
      message ? h('p.muted', {}, message) : null,
      h('div.dialog-actions',
        h('button.btn', { onclick: () => modal.close() }, cancelLabel),
        ok,
      ),
    );
    const modal = openModal(content, { onClose: () => resolve(result) });
    ok.focus();
  });
}

export function promptDialog({ title, label = '', value = '', confirmLabel = 'Save', placeholder = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.input', { type: 'text', value, placeholder, 'aria-label': label || title });
    const submit = () => {
      const v = input.value.trim();
      if (!v) return input.focus();
      result = v;
      modal.close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const content = h('div.dialog',
      h('h2', {}, title),
      label ? h('label.field-label', {}, label) : null,
      input,
      h('div.dialog-actions',
        h('button.btn', { onclick: () => modal.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: submit }, confirmLabel),
      ),
    );
    const modal = openModal(content, { onClose: () => resolve(result) });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  });
}

let toastTimer;
export function toast(message, { error = false } = {}) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div.toast', { role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

export function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Firestore Timestamp | number | null → ms */
export function toMs(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  return 0;
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  const run = () => {
    last = Date.now();
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  };
  const t = (...args) => {
    pendingArgs = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      clearTimeout(timer);
      run();
    } else if (!timer) {
      timer = setTimeout(run, wait);
    }
  };
  t.flush = () => {
    if (pendingArgs) {
      clearTimeout(timer);
      run();
    }
  };
  t.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  return t;
}
