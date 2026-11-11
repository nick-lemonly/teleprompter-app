// Modal pickers: choose a script (controller "switch script") or a destination folder (move).
import { h, openModal } from '../ui.js';
import {
  onLibrary, childFolders, childScripts, folderPath, allScripts, allFolders, getFolder, canMoveFolder,
} from './store.js';
import { sortScripts, byName } from './sort.js';
import { icon } from '../icons.js';

/** Resolves to a script id, or null if cancelled. */
export function pickScript({ title = 'Choose a script' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let folderId = null;
    let queryText = '';
    const search = h('input.input.search', { type: 'search', placeholder: 'Search scripts and folders', 'aria-label': 'Search' });
    const crumbs = h('div.crumbs');
    const list = h('div.pick-list');
    const content = h('div.picker', {},
      h('div.picker-head', {}, h('h2', {}, title), h('button.btn.icon', { 'aria-label': 'Close', onclick: () => modal.close() }, '✕')),
      search, crumbs, list);
    const modal = openModal(content, {
      className: 'modal-tall',
      onClose: () => {
        unsub();
        resolve(result);
      },
    });

    const choose = (id) => {
      result = id;
      modal.close();
    };

    function render() {
      const q = queryText.trim().toLowerCase();
      crumbs.replaceChildren(...(q ? [h('span.muted', {}, 'Search results')] : breadcrumbEls(folderId, (id) => { folderId = id; render(); })));
      const rows = [];
      if (q) {
        for (const f of allFolders().filter((f) => !f.deletedAt && f.name?.toLowerCase().includes(q)).sort(byName)) {
          rows.push(folderRow(f, () => { folderId = f.id; queryText = ''; search.value = ''; render(); }));
        }
        for (const s of sortScripts(allScripts().filter((s) => !s.deletedAt && (s.title || '').toLowerCase().includes(q)), 'opened')) {
          rows.push(scriptRow(s, () => choose(s.id), true));
        }
      } else {
        if (folderId) {
          const parent = getFolder(folderId)?.parentId || null;
          rows.push(h('button.pick-row.up', { onclick: () => { folderId = parent; render(); } }, h('span.ico', { html: icon('arrow-left', 18) }), h('span', {}, 'Up a level')));
        }
        for (const f of childFolders(folderId).sort(byName)) rows.push(folderRow(f, () => { folderId = f.id; render(); }));
        for (const s of sortScripts(childScripts(folderId), 'opened')) rows.push(scriptRow(s, () => choose(s.id)));
      }
      if (!rows.length) rows.push(h('p.muted.empty', {}, q ? 'No matches' : 'This folder is empty'));
      list.replaceChildren(...rows);
    }

    search.addEventListener('input', () => {
      queryText = search.value;
      render();
    });
    const unsub = onLibrary(render);
    setTimeout(() => search.focus({ preventScroll: true }), 50);
  });
}

/** Resolves to { folderId } (null = top level), or null if cancelled. */
export function pickFolder({ title = 'Move to…', movingFolderId = null, startIn = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let folderId = startIn;
    const crumbs = h('div.crumbs');
    const list = h('div.pick-list');
    const moveBtn = h('button.btn.primary', { onclick: () => { result = { folderId }; modal.close(); } }, 'Move here');
    const content = h('div.picker', {},
      h('div.picker-head', {}, h('h2', {}, title), h('button.btn.icon', { 'aria-label': 'Close', onclick: () => modal.close() }, '✕')),
      crumbs, list,
      h('div.dialog-actions', {}, h('button.btn', { onclick: () => modal.close() }, 'Cancel'), moveBtn));
    const modal = openModal(content, { className: 'modal-tall', onClose: () => { unsub(); resolve(result); } });

    function render() {
      crumbs.replaceChildren(...breadcrumbEls(folderId, (id) => { folderId = id; render(); }));
      const rows = [];
      if (folderId) {
        const parent = getFolder(folderId)?.parentId || null;
        rows.push(h('button.pick-row.up', { onclick: () => { folderId = parent; render(); } }, h('span.ico', { html: icon('arrow-left', 18) }), h('span', {}, 'Up a level')));
      }
      for (const f of childFolders(folderId).sort(byName)) {
        const blocked = movingFolderId && !canMoveFolder(movingFolderId, f.id);
        const row = folderRow(f, () => { folderId = f.id; render(); });
        if (blocked) {
          row.disabled = true;
          row.title = "A folder can't go inside itself";
        }
        rows.push(row);
      }
      if (!childFolders(folderId).length) rows.push(h('p.muted.empty', {}, 'No folders inside'));
      list.replaceChildren(...rows);
      moveBtn.disabled = !!(movingFolderId && !canMoveFolder(movingFolderId, folderId));
    }
    const unsub = onLibrary(render);
  });
}

export function breadcrumbEls(folderId, go) {
  const path = folderId ? folderPath(folderId) : [];
  const els = [h('button.crumb', { onclick: () => go(null) }, 'All scripts')];
  for (const f of path) {
    els.push(h('span.crumb-sep', {}, '/'));
    els.push(h('button.crumb', { onclick: () => go(f.id) }, f.name || 'Untitled folder'));
  }
  return els;
}

function folderRow(f, onclick) {
  return h('button.pick-row', { onclick }, h('span.ico', { html: icon('folder', 20) }), h('span.name', {}, f.name || 'Untitled folder'));
}

function scriptRow(s, onclick, showPath = false) {
  const path = showPath && s.folderId ? folderPath(s.folderId).map((f) => f.name).join(' / ') : '';
  return h('button.pick-row', { onclick },
    h('span.ico', { html: icon('file-text', 20) }),
    h('span.name', {}, s.title || 'Untitled', path ? h('span.path', {}, path) : null));
}
