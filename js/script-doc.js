import { fs, doc, onSnapshot } from './firebase.js';

/** Live-watch one script. Callback gets { id, title, content, revision, updatedBy, updatedAt, deletedAt } or null. */
export function watchScript(id, callback) {
  return onSnapshot(
    doc(fs, 'scripts', id),
    { includeMetadataChanges: false },
    (snap) => {
      if (!snap.exists()) return callback(null, snap);
      callback({ id: snap.id, ...snap.data() }, snap);
    },
    (err) => {
      console.error('Script watch failed', err);
      callback(null);
    },
  );
}
