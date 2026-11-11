import { toMs } from '../ui.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const byName = (a, b) => collator.compare(a.name || a.title || '', b.name || b.title || '');

/** mode: 'name' | 'edited' | 'opened' */
export function sortScripts(list, mode) {
  const arr = list.slice();
  if (mode === 'name') return arr.sort((a, b) => collator.compare(a.title || '', b.title || ''));
  const key = mode === 'edited' ? 'updatedAt' : 'lastOpenedAt';
  return arr.sort((a, b) => toMs(b[key]) - toMs(a[key]) || collator.compare(a.title || '', b.title || ''));
}
