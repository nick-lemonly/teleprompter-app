// The shared script library (Firestore): live snapshot of all folders and scripts,
// plus file actions, trash, and the 30-day purge.
import {
  fs, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp,
} from '../firebase.js';
import { userStamp } from '../auth.js';
import { deviceId } from '../device.js';
import { toMs } from '../ui.js';
import { TRASH_PURGE_DAYS } from '../config.js';
import * as cmd from '../rig/commands.js';

let folders = new Map();
let scripts = new Map();
let loaded = { folders: false, scripts: false };
let started = false;
const subs = new Set();
let readyResolve;
const ready = new Promise((r) => (readyResolve = r));

function emit() {
  if (loaded.folders && loaded.scripts) readyResolve();
  for (const fn of subs) fn();
}

export function startLibrary() {
  if (started) return;
  started = true;
  onSnapshot(collection(fs, 'folders'), (snap) => {
    folders = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    loaded.folders = true;
    emit();
  }, (err) => console.error('Folders failed', err));
  onSnapshot(collection(fs, 'scripts'), (snap) => {
    scripts = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    loaded.scripts = true;
    emit();
  }, (err) => console.error('Scripts failed', err));
}

export function onLibrary(fn) {
  startLibrary();
  subs.add(fn);
  if (loaded.folders && loaded.scripts) fn();
  return () => subs.delete(fn);
}
export const libraryReady = () => {
  startLibrary();
  return ready;
};

export const getFolder = (id) => folders.get(id) || null;
export const getScript = (id) => scripts.get(id) || null;
export const allFolders = () => [...folders.values()];
export const allScripts = () => [...scripts.values()];
const live = (x) => !x.deletedAt;

export function childFolders(parentId) {
  return allFolders().filter((f) => live(f) && (f.parentId || null) === (parentId || null));
}
export function childScripts(folderId) {
  return allScripts().filter((s) => live(s) && (s.folderId || null) === (folderId || null));
}

/** Folder path from the top, e.g. [{id,name}, …]. */
export function folderPath(id) {
  const path = [];
  const seen = new Set();
  let f = getFolder(id);
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    path.unshift(f);
    f = f.parentId ? getFolder(f.parentId) : null;
  }
  return path;
}

/** All live descendant folder ids (not including the folder itself). */
export function descendantFolderIds(id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const f of allFolders()) {
      if (f.parentId === cur && !out.includes(f.id)) {
        out.push(f.id);
        stack.push(f.id);
      }
    }
  }
  return out;
}

const stampCreate = () => ({
  createdAt: serverTimestamp(), createdBy: userStamp(deviceId),
  updatedAt: serverTimestamp(), updatedBy: userStamp(deviceId),
  deletedAt: null, deletedWithParent: null,
});
const stampUpdate = () => ({ updatedAt: serverTimestamp(), updatedBy: userStamp(deviceId) });

// ── Create / rename / move ──────────────────────────────────────────────────

export async function createFolder(name, parentId = null) {
  const ref = await addDoc(collection(fs, 'folders'), { name, parentId: parentId || null, ...stampCreate() });
  return ref.id;
}

export async function createScript(title, folderId = null, content = '<p><br></p>') {
  const ref = await addDoc(collection(fs, 'scripts'), {
    title, folderId: folderId || null, content, revision: 1, lastOpenedAt: serverTimestamp(), ...stampCreate(),
  });
  return ref.id;
}

export function renameFolder(id, name) {
  return updateDoc(doc(fs, 'folders', id), { name, ...stampUpdate() });
}
export function renameScript(id, title) {
  // Title isn't rendered on the prompter, so no revision bump.
  return updateDoc(doc(fs, 'scripts', id), { title, ...stampUpdate() });
}

export function canMoveFolder(id, targetId) {
  if (!targetId) return true;
  return targetId !== id && !descendantFolderIds(id).includes(targetId);
}
export function moveFolder(id, targetId) {
  if (!canMoveFolder(id, targetId)) throw new Error("A folder can't go inside itself.");
  return updateDoc(doc(fs, 'folders', id), { parentId: targetId || null, ...stampUpdate() });
}
export function moveScript(id, targetId) {
  return updateDoc(doc(fs, 'scripts', id), { folderId: targetId || null, ...stampUpdate() });
}

// ── Duplicate ───────────────────────────────────────────────────────────────

export async function duplicateScript(id, targetFolderId) {
  const s = getScript(id);
  if (!s) return null;
  return createScript(`Copy of ${s.title || 'Untitled'}`, targetFolderId === undefined ? s.folderId : targetFolderId, s.content);
}

/** Copies a folder and everything inside it, in batches. */
export async function duplicateFolder(id) {
  const src = getFolder(id);
  if (!src) return null;
  const ops = [];
  const newId = (col) => doc(collection(fs, col)).id;
  const copy = (folderId, newParentId, name) => {
    const nid = newId('folders');
    ops.push(['folders', nid, { name, parentId: newParentId || null, ...stampCreate() }]);
    for (const s of childScripts(folderId)) {
      ops.push(['scripts', newId('scripts'), {
        title: s.title, folderId: nid, content: s.content || '', revision: 1, lastOpenedAt: null, ...stampCreate(),
      }]);
    }
    for (const f of childFolders(folderId)) copy(f.id, nid, f.name);
    return nid;
  };
  const rootId = copy(id, src.parentId, `Copy of ${src.name}`);
  await commitInBatches(ops.map(([col, docId, data]) => (b) => b.set(doc(fs, col, docId), data)));
  return rootId;
}

async function commitInBatches(fns) {
  for (let i = 0; i < fns.length; i += 400) {
    const batch = writeBatch(fs);
    fns.slice(i, i + 400).forEach((fn) => fn(batch));
    await batch.commit();
  }
}

// ── Trash ───────────────────────────────────────────────────────────────────

// deletedAt uses the client time (not serverTimestamp) so the item leaves the list
// immediately: pending server timestamps read back as null in local snapshots.
export async function trashScript(id) {
  await updateDoc(doc(fs, 'scripts', id), { deletedAt: Timestamp.now(), deletedWithParent: null, ...stampUpdate() });
}

/** Deleting a folder takes everything inside it along (marked with deletedWithParent). */
export async function trashFolder(id) {
  const now = Timestamp.now();
  const inner = descendantFolderIds(id);
  const fns = [(b) => b.update(doc(fs, 'folders', id), { deletedAt: now, deletedWithParent: null, ...stampUpdate() })];
  for (const fid of inner) {
    const f = getFolder(fid);
    if (f && !f.deletedAt) fns.push((b) => b.update(doc(fs, 'folders', fid), { deletedAt: now, deletedWithParent: id }));
  }
  for (const s of allScripts()) {
    if (!s.deletedAt && (s.folderId === id || inner.includes(s.folderId))) {
      fns.push((b) => b.update(doc(fs, 'scripts', s.id), { deletedAt: now, deletedWithParent: id }));
    }
  }
  await commitInBatches(fns);
}

/** Top-level trash entries (items deleted directly, not along with a folder). */
export function trashItems() {
  const items = [];
  for (const f of allFolders()) if (f.deletedAt && !f.deletedWithParent) items.push({ kind: 'folder', ...f });
  for (const s of allScripts()) if (s.deletedAt && !s.deletedWithParent) items.push({ kind: 'script', ...s });
  return items.sort((a, b) => toMs(b.deletedAt) - toMs(a.deletedAt));
}

function parentIsGone(parentId) {
  if (!parentId) return false;
  const p = getFolder(parentId);
  return !p || !!p.deletedAt;
}

export async function restore(item) {
  const fns = [];
  if (item.kind === 'script') {
    const s = getScript(item.id);
    fns.push((b) => b.update(doc(fs, 'scripts', item.id), {
      deletedAt: null, deletedWithParent: null, folderId: parentIsGone(s?.folderId) ? null : s?.folderId || null,
    }));
  } else {
    const f = getFolder(item.id);
    fns.push((b) => b.update(doc(fs, 'folders', item.id), {
      deletedAt: null, deletedWithParent: null, parentId: parentIsGone(f?.parentId) ? null : f?.parentId || null,
    }));
    for (const x of allFolders()) {
      if (x.deletedWithParent === item.id) fns.push((b) => b.update(doc(fs, 'folders', x.id), { deletedAt: null, deletedWithParent: null }));
    }
    for (const x of allScripts()) {
      if (x.deletedWithParent === item.id) fns.push((b) => b.update(doc(fs, 'scripts', x.id), { deletedAt: null, deletedWithParent: null }));
    }
  }
  await commitInBatches(fns);
}

export async function deleteForever(item) {
  const fns = [(b) => b.delete(doc(fs, item.kind === 'folder' ? 'folders' : 'scripts', item.id))];
  if (item.kind === 'folder') {
    for (const x of allFolders()) if (x.deletedWithParent === item.id) fns.push((b) => b.delete(doc(fs, 'folders', x.id)));
    for (const x of allScripts()) if (x.deletedWithParent === item.id) fns.push((b) => b.delete(doc(fs, 'scripts', x.id)));
  }
  await commitInBatches(fns);
}

/** Runs whenever someone opens the library: permanently deletes trash older than 30 days. */
export async function purgeOldTrash() {
  await libraryReady();
  const cutoff = Date.now() - TRASH_PURGE_DAYS * 24 * 60 * 60 * 1000;
  const fns = [];
  for (const f of allFolders()) {
    const t = toMs(f.deletedAt);
    if (t && t < cutoff) fns.push((b) => b.delete(doc(fs, 'folders', f.id)));
  }
  for (const s of allScripts()) {
    const t = toMs(s.deletedAt);
    if (t && t < cutoff) fns.push((b) => b.delete(doc(fs, 'scripts', s.id)));
  }
  if (fns.length) {
    await commitInBatches(fns);
    console.info(`Purged ${fns.length} trashed item(s) older than ${TRASH_PURGE_DAYS} days`);
  }
}

// ── Prompter ────────────────────────────────────────────────────────────────

export function markOpened(id) {
  return updateDoc(doc(fs, 'scripts', id), { lastOpenedAt: serverTimestamp() }).catch(() => {});
}

export function loadOnPrompter(id) {
  const s = getScript(id);
  cmd.loadScript(id, s?.revision || 0);
  markOpened(id);
}

export function deleteScriptDoc(id) {
  return deleteDoc(doc(fs, 'scripts', id));
}
