// Block maps: measuring a rendered script and mapping positions between layouts.
// Positions are "content y at the reference line": 0 means the top of the first block
// sits on the reference line.
import { linePx } from './playback.js';
import { REF_LINE_FRACTION } from '../config.js';

/** Blocks = top-level paragraphs plus each top-level list item. */
export function getBlocks(contentEl) {
  const blocks = [];
  for (const el of contentEl.children) {
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of el.children) if (li.tagName === 'LI') blocks.push(li);
    } else {
      blocks.push(el);
    }
  }
  return blocks;
}

// Layout offsets ignore CSS transforms (scale, flips), which is what we want.
function offsetTopWithin(el, container) {
  let y = 0;
  let node = el;
  while (node && node !== container) {
    y += node.offsetTop;
    node = node.offsetParent;
  }
  return y;
}

/**
 * Lead-in: how far above the first line you can scroll (negative px). At minPos the
 * first line sits one line above the bottom of the display, giving the talent lead time.
 */
export function leadInMinPos(viewportH, settings) {
  return -Math.max(0, viewportH * (1 - REF_LINE_FRACTION) - 1.5 * linePx(settings));
}

/** Measure a rendered script. contentEl must be position: relative. */
export function measureLayout(contentEl, settings, viewportH) {
  const blocks = getBlocks(contentEl);
  const blockTops = blocks.map((b) => offsetTopWithin(b, contentEl));
  const totalHeight = contentEl.offsetHeight;
  const maxPos = Math.max(0, totalHeight - linePx(settings));
  const texts = blocks.map((b) => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
  const minPos = Math.round(leadInMinPos(viewportH || 0, settings));
  return { blockTops, totalHeight, maxPos, minPos, texts };
}

export function layoutHash({ scriptId, revision, fontSizePx, lineHeight, viewportW, viewportH }) {
  const s = [scriptId || '', revision ?? '', fontSizePx, lineHeight, viewportW, viewportH].join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Index of the block containing pos (last block whose top <= pos). */
export function blockIndexAt(pos, tops) {
  if (!tops || !tops.length) return 0;
  let lo = 0;
  let hi = tops.length - 1;
  if (pos < tops[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function blockSpan(layout, i) {
  const start = layout.blockTops[i];
  const end = i + 1 < layout.blockTops.length ? layout.blockTops[i + 1] : layout.totalHeight;
  return [start, Math.max(end, start + 1)];
}

/**
 * Map a position between two layouts of the SAME content (e.g. the display's and a
 * controller's): find the block, take the fraction through it, apply it to the same
 * block in the other layout. Falls back to the raw value if the block maps don't match.
 */
export function mapPos(pos, from, to) {
  if (!from || !to || !from.blockTops?.length || from.blockTops.length !== to.blockTops?.length) {
    return pos;
  }
  const i = blockIndexAt(pos, from.blockTops);
  const [fs, fe] = blockSpan(from, i);
  const [ts, te] = blockSpan(to, i);
  if (pos < fs) return ts + (pos - fs);
  if (pos > fe) return te + (pos - fe);
  return ts + ((pos - fs) / (fe - fs)) * (te - ts);
}

/**
 * Keep the reader's place when the layout changes (text size, spacing, or an edit).
 * Same block count → same block index. Otherwise find the block by its text.
 */
export function remapAcrossLayouts(pos, oldL, newL) {
  if (!oldL?.blockTops?.length || !newL?.blockTops?.length) return pos;
  const i = blockIndexAt(pos, oldL.blockTops);
  const [os, oe] = blockSpan(oldL, i);
  const frac = Math.min(1, Math.max(0, (pos - os) / (oe - os)));
  let j = i;
  if (oldL.blockTops.length !== newL.blockTops.length) j = findMatchingBlock(i, oldL, newL);
  j = Math.min(newL.blockTops.length - 1, Math.max(0, j));
  const [ns, ne] = blockSpan(newL, j);
  // Before the first block (pos < 0 can't happen, but keep offsets sane).
  if (pos < os) return ns + (pos - os);
  return ns + frac * (ne - ns);
}

function nearestMatch(text, texts, around) {
  if (!text) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let j = 0; j < texts.length; j++) {
    if (texts[j] === text) {
      const d = Math.min(...around.map((a) => Math.abs(j - a)));
      if (d < bestDist) {
        bestDist = d;
        best = j;
      }
    }
  }
  return best;
}

function findMatchingBlock(i, oldL, newL) {
  const oldT = oldL.texts || [];
  const newT = newL.texts || [];
  const diff = newT.length - oldT.length;
  const around = [i, i + diff];
  const same = nearestMatch(oldT[i], newT, around);
  if (same >= 0) return same;
  // The current block itself was edited: anchor on its neighbours.
  for (let k = 1; k <= 3; k++) {
    const prev = nearestMatch(oldT[i - k], newT, around.map((a) => a - k));
    if (prev >= 0) return prev + k;
    const next = nearestMatch(oldT[i + k], newT, around.map((a) => a + k));
    if (next >= 0) return next - k;
  }
  return i;
}
