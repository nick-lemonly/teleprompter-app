// Script editor: Quill 2 with our own Google Docs paste cleanup, autosave, and a
// notice when someone else saves the same script.
import { fs, doc, onSnapshot, updateDoc, serverTimestamp, increment } from '../firebase.js';
import { h, toMs, timeAgo, toast } from '../ui.js';
import { htmlToBlocks, blocksToHtml, sanitizeHtml } from './sanitize.js';
import { userStamp } from '../auth.js';
import { deviceId } from '../device.js';
import { AUTOSAVE_MS, QUILL_VERSION } from '../config.js';
import { markOpened, loadOnPrompter } from '../library/store.js';
import { icon } from '../icons.js';

const QUILL_JS = `https://cdn.jsdelivr.net/npm/quill@${QUILL_VERSION}/dist/quill.js`;
const QUILL_CSS = `https://cdn.jsdelivr.net/npm/quill@${QUILL_VERSION}/dist/quill.snow.css`;
// Subresource integrity for the pinned files.
const QUILL_JS_SRI = 'sha384-utBUCeG4SYaCm4m7GQZYr8Hy8Fpy3V4KGjBZaf4WTKOcwhCYpt/0PfeEe3HNlwx8';
const QUILL_CSS_SRI = 'sha384-ecIckRi4QlKYya/FQUbBUjS4qp65jF/J87Guw5uzTbO1C1Jfa/6kYmd6dXUF6D7i';

let quillPromise = null;
export function loadQuill() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (!quillPromise) {
    quillPromise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = QUILL_CSS;
      link.integrity = QUILL_CSS_SRI;
      link.crossOrigin = 'anonymous';
      document.head.append(link);
      const script = document.createElement('script');
      script.src = QUILL_JS;
      script.integrity = QUILL_JS_SRI;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve(window.Quill);
      script.onerror = () => {
        quillPromise = null;
        reject(new Error('Could not load the editor'));
      };
      document.head.append(script);
    });
  }
  return quillPromise;
}

// ── Blocks ⇄ Quill Delta ────────────────────────────────────────────────────

export function blocksToOps(blocks) {
  const ops = [];
  for (const b of blocks) {
    const lineAttrs = b.type === 'li'
      ? { list: b.listType === 'ol' ? 'ordered' : 'bullet', ...(b.level > 1 ? { indent: b.level - 1 } : {}) }
      : null;
    const endLine = () => ops.push(lineAttrs ? { insert: '\n', attributes: { ...lineAttrs } } : { insert: '\n' });
    for (const r of b.runs) {
      if (r.br) {
        endLine();
        continue;
      }
      const a = {};
      if (r.b) a.bold = true;
      if (r.i) a.italic = true;
      if (r.u) a.underline = true;
      ops.push(Object.keys(a).length ? { insert: r.text, attributes: a } : { insert: r.text });
    }
    endLine();
  }
  return ops;
}

export function deltaToHtml(delta) {
  const blocks = [];
  delta.eachLine((line, attrs) => {
    const runs = [];
    for (const op of line.ops) {
      if (typeof op.insert !== 'string') continue;
      const a = op.attributes || {};
      runs.push({ text: op.insert, b: !!a.bold, i: !!a.italic, u: !!a.underline });
    }
    if (attrs.list === 'bullet' || attrs.list === 'ordered') {
      blocks.push({ type: 'li', listType: attrs.list === 'ordered' ? 'ol' : 'ul', level: (attrs.indent || 0) + 1, runs });
    } else {
      blocks.push({ type: 'p', runs });
    }
  });
  return sanitizeHtml(blocksToHtml(blocks));
}

// ── Editor view ─────────────────────────────────────────────────────────────

export function mountEditor(container, scriptId, { compact = false, onBack } = {}) {
  const titleInput = h('input.title-input', { type: 'text', placeholder: 'Untitled script', 'aria-label': 'Script title' });
  const status = h('span.save-status', { role: 'status' });
  const notice = h('div.conflict-notice.hidden');
  const toolbar = h('div.editor-toolbar', {
    html: `
      <span class="ql-formats">
        <button class="ql-bold" aria-label="Bold"></button>
        <button class="ql-italic" aria-label="Italic"></button>
        <button class="ql-underline" aria-label="Underline"></button>
      </span>
      <span class="ql-formats">
        <button class="ql-list" value="bullet" aria-label="Bulleted list"></button>
        <button class="ql-list" value="ordered" aria-label="Numbered list"></button>
        <button class="ql-indent" value="-1" aria-label="Outdent"></button>
        <button class="ql-indent" value="+1" aria-label="Indent"></button>
      </span>
      <span class="ql-formats">
        <button class="ql-undo" aria-label="Undo" title="Undo">${icon('undo-2', 18)}</button>
        <button class="ql-redo" aria-label="Redo" title="Redo">${icon('redo-2', 18)}</button>
      </span>`,
  });
  const body = h('div.editor-body');
  const loading = h('p.muted.editor-loading', {}, 'Loading…');
  const head = h('div.editor-head', {},
    !compact ? h('button.btn.ghost.back-btn', { onclick: () => onBack?.() }, '← Library') : null,
    titleInput,
    status,
    !compact ? h('button.btn.primary.load-btn', { onclick: () => { save(); loadOnPrompter(scriptId); toast('Loaded on the prompter'); } }, 'Load on prompter') : null,
  );
  const el = h('div.editor' + (compact ? '.compact' : ''), {}, head, notice, toolbar, h('div.editor-scroll', {}, loading, body));
  container.replaceChildren(el);

  let quill = null;
  let Delta = null;
  let stopped = false;
  let dirty = false;
  let saving = false;
  let timer = null;
  let lastSeenRevision = -1;
  let remote = null;
  let noticeTimer = null;
  let unsub = null;
  const ref = doc(fs, 'scripts', scriptId);

  const setStatus = (text, cls = '') => {
    status.textContent = text;
    status.className = 'save-status ' + cls;
  };

  function markDirty() {
    dirty = true;
    setStatus('Unsaved', 'unsaved');
    clearTimeout(timer);
    timer = setTimeout(save, AUTOSAVE_MS);
  }

  async function save() {
    clearTimeout(timer);
    if (!quill || !dirty) return;
    if (saving) {
      timer = setTimeout(save, 300);
      return;
    }
    saving = true;
    dirty = false;
    setStatus('Saving…', 'saving');
    const content = deltaToHtml(quill.getContents());
    const title = titleInput.value.trim() || 'Untitled script';
    try {
      await updateDoc(ref, {
        title, content, revision: increment(1), updatedAt: serverTimestamp(), updatedBy: userStamp(deviceId),
      });
      if (!stopped) setStatus(dirty ? 'Unsaved' : 'Saved', dirty ? 'unsaved' : 'saved');
    } catch (err) {
      console.error('Save failed', err);
      dirty = true;
      if (!stopped) {
        setStatus("Couldn't save — retrying", 'error');
        timer = setTimeout(save, 3000);
      }
    } finally {
      saving = false;
      if (dirty && !stopped && status.className.indexOf('error') < 0) {
        clearTimeout(timer);
        timer = setTimeout(save, AUTOSAVE_MS); // typed again while saving
      }
    }
  }

  function setContentFromHtml(html) {
    quill.setContents(new Delta(blocksToOps(htmlToBlocks(html))), 'silent');
    quill.history.clear();
  }

  function showNotice() {
    if (!remote) return notice.classList.add('hidden');
    const who = remote.updatedBy?.email === userStamp().email
      ? 'You (on another device)'
      : (remote.updatedBy?.name || 'Someone').split(' ')[0];
    notice.replaceChildren(
      h('span', {}, `${who} edited this ${timeAgo(toMs(remote.updatedAt) || Date.now())}.`),
      h('button.btn.small', {
        onclick: () => {
          setContentFromHtml(remote.content);
          titleInput.value = remote.title || '';
          dirty = false;
          setStatus('Saved', 'saved');
          remote = null;
          showNotice();
        },
      }, 'Load their version'),
      h('button.btn.small.ghost', { onclick: () => { remote = null; showNotice(); } }, 'Dismiss'),
    );
    notice.classList.remove('hidden');
  }

  (async () => {
    let Quill;
    try {
      Quill = await loadQuill();
    } catch (err) {
      loading.textContent = "The editor couldn't load. Check the connection and reload.";
      return;
    }
    if (stopped) return;
    Delta = Quill.import('delta');
    quill = new Quill(body, {
      theme: 'snow',
      formats: ['bold', 'italic', 'underline', 'list', 'indent'],
      placeholder: 'Paste or type the script…',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: {
            undo: () => quill.history.undo(),
            redo: () => quill.history.redo(),
          },
        },
        history: { delay: 800, maxStack: 300, userOnly: true },
      },
    });
    quill.enable(false);

    // Paste: clean Google Docs (and any other rich) HTML ourselves, before Quill sees it.
    body.addEventListener('paste', (e) => {
      const html = e.clipboardData?.getData('text/html');
      if (!html || !quill) return; // plain text: Quill handles it
      e.preventDefault();
      e.stopPropagation();
      const blocks = htmlToBlocks(html);
      let pasted = new Delta(blocksToOps(blocks));
      // A single paragraph pastes inline, without adding a line break.
      if (blocks.length === 1 && blocks[0].type === 'p') pasted = pasted.slice(0, Math.max(0, pasted.length() - 1));
      const range = quill.getSelection(true) || { index: quill.getLength() - 1, length: 0 };
      const change = new Delta().retain(range.index).delete(range.length).concat(pasted);
      quill.updateContents(change, 'user');
      quill.setSelection(range.index + pasted.length(), 0, 'silent');
    }, true);

    quill.on('text-change', (_d, _old, source) => {
      if (source === 'user') markDirty();
    });
    quill.root.addEventListener('blur', () => save());

    let first = true;
    unsub = onSnapshot(ref, (snap) => {
      if (stopped) return;
      if (!snap.exists()) {
        loading.textContent = 'This script no longer exists.';
        loading.classList.remove('hidden');
        quill.enable(false);
        return;
      }
      const data = snap.data();
      if (first) {
        first = false;
        titleInput.value = data.title || '';
        setContentFromHtml(data.content || '');
        lastSeenRevision = data.revision || 0;
        loading.classList.add('hidden');
        quill.enable(true);
        setStatus('Saved', 'saved');
        if (data.deletedAt) setStatus('In trash', 'error');
        markOpened(scriptId);
        if (!compact && !data.content?.replace(/<[^>]+>/g, '').trim()) quill.focus();
        return;
      }
      if (snap.metadata.hasPendingWrites) return;
      if (data.updatedBy?.deviceId === deviceId) {
        lastSeenRevision = Math.max(lastSeenRevision, data.revision || 0);
        return;
      }
      if ((data.revision || 0) > lastSeenRevision) {
        lastSeenRevision = data.revision || 0;
        remote = data;
        showNotice();
      } else if (document.activeElement !== titleInput && !dirty && data.title !== titleInput.value) {
        titleInput.value = data.title || ''; // renamed from the library
      }
    });
  })();

  titleInput.addEventListener('input', markDirty);
  titleInput.addEventListener('blur', () => save());
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      quill?.focus();
    }
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') save();
  };
  document.addEventListener('visibilitychange', onHide);
  noticeTimer = setInterval(() => remote && showNotice(), 5000);

  return () => {
    save();
    stopped = true;
    clearInterval(noticeTimer);
    document.removeEventListener('visibilitychange', onHide);
    unsub?.();
  };
}

