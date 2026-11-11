// Library view: browse folders, manage scripts, search, sort, trash.
import { h, toMs, timeAgo, toast, confirmDialog, promptDialog } from '../ui.js';
import * as store from './store.js';
import { pickFolder, breadcrumbEls } from './picker.js';
import { sortScripts, byName } from './sort.js';
import { htmlToText } from '../editor/sanitize.js';
import { getPref, setPref, setRole } from '../device.js';
import { icon } from '../icons.js';

export function mountLibrary(root, ctx, { folderId: initialFolder = null, trash = false } = {}) {
  let folderId = initialFolder;
  let queryText = '';
  let searchText = !!getPref('searchText', false);
  let sortMode = getPref('librarySort', 'opened');
  const textCache = new Map(); // scriptId+revision → plain text

  const search = h('input.input.search', { type: 'search', placeholder: 'Search', 'aria-label': 'Search scripts and folders' });
  const searchTextBox = h('input', { type: 'checkbox', checked: searchText });
  const sortSel = h('select.input.sort', { 'aria-label': 'Sort' },
    h('option', { value: 'opened' }, 'Last opened'),
    h('option', { value: 'edited' }, 'Last edited'),
    h('option', { value: 'name' }, 'Name (A–Z)'));
  sortSel.value = sortMode;
  const crumbs = h('nav.crumbs', { 'aria-label': 'Folder' });
  const list = h('div.lib-list');

  const head = h('div.lib-head', {},
    h('div.lib-title-row', {},
      h('h1', {}, trash ? 'Trash' : 'Scripts'),
      h('div.lib-actions', {},
        trash
          ? h('button.btn', { onclick: () => ctx.go('#/library') }, '← Back to scripts')
          : [
            h('button.btn', { onclick: newFolder }, '+ Folder'),
            h('button.btn.primary', { onclick: newScript }, '+ Script'),
          ],
        !trash ? h('button.btn.accent', { onclick: () => { setRole('controller'); ctx.go('#/controller'); } }, 'Control the prompter') : null,
      )),
    trash ? h('p.muted', {}, 'Items in the trash are deleted forever after 30 days.') : h('div.lib-tools', {},
      search,
      h('label.check', {}, searchTextBox, h('span', {}, 'Search script text too')),
      h('div.sort-trash', {},
        h('label.sort-wrap', {}, h('span.sort-label', {}, 'Sort'), sortSel),
        h('button.btn.ghost.trash-link', { onclick: () => ctx.go('#/trash'), html: `${icon('trash-2', 18)}<span>Trash</span>` }))),
    trash ? null : crumbs,
  );
  const el = h('div.library', {}, head, list);
  root.replaceChildren(el);

  search.addEventListener('input', () => {
    queryText = search.value;
    render();
  });
  searchTextBox.addEventListener('change', () => {
    searchText = searchTextBox.checked;
    setPref('searchText', searchText);
    render();
  });
  sortSel.addEventListener('change', () => {
    sortMode = sortSel.value;
    setPref('librarySort', sortMode);
    render();
  });

  const goFolder = (id) => {
    folderId = id;
    queryText = '';
    search.value = '';
    ctx.go(id ? `#/library/${id}` : '#/library', { replace: false });
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  async function newFolder() {
    const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', confirmLabel: 'Create' });
    if (name) await store.createFolder(name, folderId).catch(fail);
  }
  async function newScript() {
    const title = await promptDialog({ title: 'New script', placeholder: 'Script title', confirmLabel: 'Create' });
    if (!title) return;
    try {
      const id = await store.createScript(title, folderId);
      ctx.go(`#/edit/${id}`);
    } catch (err) {
      fail(err);
    }
  }
  function fail(err) {
    console.error(err);
    toast(err?.message?.includes('permission') ? "You don't have access to do that." : 'Something went wrong. Try again.', { error: true });
  }

  async function rename(item) {
    const isFolder = item.kind === 'folder';
    const v = await promptDialog({ title: isFolder ? 'Rename folder' : 'Rename script', value: isFolder ? item.name : item.title, confirmLabel: 'Rename' });
    if (!v) return;
    (isFolder ? store.renameFolder(item.id, v) : store.renameScript(item.id, v)).catch(fail);
  }
  async function move(item) {
    const isFolder = item.kind === 'folder';
    const res = await pickFolder({
      title: `Move “${isFolder ? item.name : item.title}” to…`,
      movingFolderId: isFolder ? item.id : null,
      startIn: isFolder ? item.parentId || null : item.folderId || null,
    });
    if (!res) return;
    try {
      if (isFolder) await store.moveFolder(item.id, res.folderId);
      else await store.moveScript(item.id, res.folderId);
      toast('Moved');
    } catch (err) {
      toast(err.message, { error: true });
    }
  }
  async function duplicate(item) {
    try {
      if (item.kind === 'folder') await store.duplicateFolder(item.id);
      else await store.duplicateScript(item.id);
      toast('Duplicated');
    } catch (err) {
      fail(err);
    }
  }
  async function trashIt(item) {
    const isFolder = item.kind === 'folder';
    const name = (isFolder ? item.name : item.title) || 'Untitled';
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      message: isFolder
        ? 'The folder and everything in it move to the Trash. You can restore them for 30 days.'
        : 'It moves to the Trash. You can restore it for 30 days.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      if (item.kind === 'folder') await store.trashFolder(item.id);
      else await store.trashScript(item.id);
      toast('Moved to trash');
    } catch (err) {
      fail(err);
    }
  }
  async function restoreIt(item) {
    await store.restore(item).catch(fail);
    toast('Restored');
  }
  async function deleteForever(item) {
    const name = item.kind === 'folder' ? item.name : item.title;
    const ok = await confirmDialog({
      title: `Delete “${name}” forever?`,
      message: item.kind === 'folder' ? 'The folder and everything in it will be gone. This can’t be undone.' : 'This can’t be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (ok) store.deleteForever(item).catch(fail);
  }

  // ── Rows ──────────────────────────────────────────────────────────────────
  function menuButton(items) {
    const btn = h('button.btn.icon.menu-btn', { 'aria-label': 'More actions', 'aria-haspopup': 'menu', html: icon('ellipsis') });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(btn, items);
    });
    return btn;
  }

  function folderRow(f, showPath) {
    const item = { kind: 'folder', ...f };
    const path = showPath && f.parentId ? store.folderPath(f.parentId).map((x) => x.name).join(' / ') : '';
    const row = h('div.lib-row.folder', { role: 'button', tabindex: 0 },
      h('span.ico', { html: icon('folder', 20) }),
      h('div.row-main', {}, h('div.row-title', {}, f.name || 'Untitled folder'), path ? h('div.row-meta', {}, path) : null),
      menuButton([
        ['Rename', () => rename(item)],
        ['Move…', () => move(item)],
        ['Duplicate', () => duplicate(item)],
        ['Delete', () => trashIt(item), 'danger'],
      ]));
    const open = () => goFolder(f.id);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => e.key === 'Enter' && open());
    return row;
  }

  function scriptRow(s, showPath) {
    const item = { kind: 'script', ...s };
    const path = showPath && s.folderId ? store.folderPath(s.folderId).map((x) => x.name).join(' / ') : '';
    const edited = toMs(s.updatedAt);
    const by = s.updatedBy?.name ? ` by ${s.updatedBy.name.split(' ')[0]}` : '';
    const row = h('div.lib-row.script', { role: 'button', tabindex: 0 },
      h('span.ico', { html: icon('file-text', 20) }),
      h('div.row-main', {},
        h('div.row-title', {}, s.title || 'Untitled script'),
        h('div.row-meta', {}, [path, edited ? `Edited ${timeAgo(edited)}${by}` : ''].filter(Boolean).join(' · '))),
      h('button.btn.small.load', {
        'aria-label': `Load “${s.title || 'Untitled'}” on the prompter`,
        title: 'Load on prompter',
        onclick: (e) => {
          e.stopPropagation();
          store.loadOnPrompter(s.id);
          setRole('controller');
          ctx.go('#/controller'); // straight to the controls
        },
        html: `${icon('play', 16, { fill: true })}<span class="load-text">Load on prompter</span>`,
      }),
      menuButton([
        ['Edit', () => ctx.go(`#/edit/${s.id}`)],
        ['Rename', () => rename(item)],
        ['Move…', () => move(item)],
        ['Duplicate', () => duplicate(item)],
        ['Delete', () => trashIt(item), 'danger'],
      ]));
    const open = () => ctx.go(`#/edit/${s.id}`);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => e.key === 'Enter' && e.target === row && open());
    return row;
  }

  function trashRow(item) {
    const name = item.kind === 'folder' ? item.name : item.title;
    return h('div.lib-row.trash', {},
      h('span.ico', { html: icon(item.kind === 'folder' ? 'folder' : 'file-text', 20) }),
      h('div.row-main', {},
        h('div.row-title', {}, name || 'Untitled'),
        h('div.row-meta', {}, `Deleted ${timeAgo(toMs(item.deletedAt))}`)),
      h('button.btn.small', { onclick: () => restoreIt(item) }, 'Restore'),
      h('button.btn.small.danger', { onclick: () => deleteForever(item) }, 'Delete forever'));
  }

  function plainText(s) {
    const key = `${s.id}:${s.revision}`;
    if (!textCache.has(key)) textCache.set(key, htmlToText(s.content || '').toLowerCase());
    return textCache.get(key);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    if (trash) {
      const items = store.trashItems();
      list.replaceChildren(...(items.length ? items.map(trashRow) : [h('p.muted.empty', {}, 'The trash is empty.')]));
      return;
    }
    if (folderId && (!store.getFolder(folderId) || store.getFolder(folderId).deletedAt)) folderId = null;
    const q = queryText.trim().toLowerCase();
    crumbs.replaceChildren(...(q ? [h('span.muted', {}, 'Search results')] : breadcrumbEls(folderId, goFolder)));
    const rows = [];
    if (q) {
      const folders = store.allFolders().filter((f) => !f.deletedAt && (f.name || '').toLowerCase().includes(q)).sort(byName);
      const scripts = store.allScripts().filter((s) =>
        !s.deletedAt && ((s.title || '').toLowerCase().includes(q) || (searchText && plainText(s).includes(q))));
      rows.push(...folders.map((f) => folderRow(f, true)), ...sortScripts(scripts, sortMode).map((s) => scriptRow(s, true)));
      if (!rows.length) rows.push(h('p.muted.empty', {}, 'No matches.'));
    } else {
      rows.push(...store.childFolders(folderId).sort(byName).map((f) => folderRow(f)));
      rows.push(...sortScripts(store.childScripts(folderId), sortMode).map((s) => scriptRow(s)));
      if (!rows.length) rows.push(h('p.muted.empty', {}, folderId ? 'This folder is empty.' : 'No scripts yet. Create one with “+ Script”.'));
    }
    list.replaceChildren(...rows);
  }

  const unsub = store.onLibrary(render);
  store.purgeOldTrash().catch((err) => console.warn('Trash purge failed', err));
  const tick = setInterval(render, 60000); // refresh "time ago"

  return () => {
    unsub();
    clearInterval(tick);
    closeMenu();
  };
}

// ── Popover menu ────────────────────────────────────────────────────────────
let openMenuEl = null;
let openAnchor = null;
function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
  openAnchor?.classList.remove('active');
  openAnchor = null;
  document.removeEventListener('pointerdown', onDocDown, true);
}
function onDocDown(e) {
  // Presses on the menu's own ••• button are handled by its click (which toggles).
  if (openMenuEl && !openMenuEl.contains(e.target) && !openAnchor?.contains(e.target)) closeMenu();
}
function openMenu(anchor, items) {
  if (openAnchor === anchor) return closeMenu(); // second press on the same ••• closes it
  closeMenu();
  openAnchor = anchor;
  anchor.classList.add('active');
  const menu = h('div.popover-menu', { role: 'menu' },
    items.map(([label, fn, cls]) => h('button.menu-item' + (cls ? '.' + cls : ''), {
      role: 'menuitem',
      onclick: (e) => {
        e.stopPropagation();
        closeMenu();
        fn();
      },
    }, label)));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
  openMenuEl = menu;
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
}
