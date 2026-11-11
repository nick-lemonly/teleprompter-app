// High-level actions. Every playback change computes the current position from the OLD
// state, then writes a new anchor (position + server time) so motion stays continuous.
import { getRig, writeRig } from './state.js';
import { serverNow } from '../clock.js';
import { computePos, linePx, withDefaults, clamp, EMPTY_PLAYBACK } from './playback.js';
import { blockIndexAt } from './layout.js';
import { deviceId } from '../device.js';
import { DEFAULT_SETTINGS, DEFAULT_SPEED_LPM, RANGES } from '../config.js';

let localLayoutProvider = null;

/** Controllers provide their own measured layout as a fallback when no display has published one. */
export function setLocalLayoutProvider(fn) {
  localLayoutProvider = fn;
}

export function currentSettings() {
  return withDefaults(getRig().settings);
}

export function currentPlayback() {
  return getRig().playback || EMPTY_PLAYBACK;
}

export function currentLayout() {
  const rig = getRig();
  if (rig.layout?.blockTops && rig.layout.totalHeight > 0 && rig.layout.scriptId === rig.script?.id) return rig.layout;
  return localLayoutProvider?.() || rig.layout || null;
}

function maxPos() {
  const m = currentLayout()?.maxPos;
  return typeof m === 'number' ? m : Infinity;
}

function minPos() {
  const m = currentLayout()?.minPos;
  return typeof m === 'number' ? m : 0;
}

export function nowPos() {
  return computePos(currentPlayback(), currentSettings(), serverNow(), maxPos(), minPos());
}

export function isPlaying() {
  return currentPlayback().state === 'playing';
}

function writePlayback(changes, kind, extra = {}) {
  const old = currentPlayback();
  const now = serverNow();
  const pb = {
    state: old.state || 'paused',
    speedLpm: old.speedLpm || DEFAULT_SPEED_LPM,
    anchorPos: computePos(old, currentSettings(), now, maxPos(), minPos()),
    ...changes,
    anchorTime: now,
    seq: (old.seq || 0) + 1,
    by: deviceId,
    kind,
  };
  writeRig({ playback: pb, ...extra });
  return pb;
}

// ── Transport ───────────────────────────────────────────────────────────────

export function play() {
  const old = currentPlayback();
  if (old.state === 'playing') return;
  const changes = { state: 'playing' };
  if (old.state === 'ended') changes.anchorPos = 0; // play from the end restarts at the top
  writePlayback(changes, 'play');
}

export function pause() {
  if (currentPlayback().state !== 'playing') return;
  writePlayback({ state: 'paused' }, 'pause');
}

export function togglePlay() {
  if (isPlaying()) pause();
  else play();
}

export function setSpeed(lpm) {
  const v = clamp(Math.round(lpm), RANGES.speed.min, RANGES.speed.max);
  if (v === currentPlayback().speedLpm) return;
  writePlayback({ speedLpm: v }, 'speed');
}

export function bumpSpeed(delta) {
  setSpeed((currentPlayback().speedLpm || DEFAULT_SPEED_LPM) + delta);
}

/** Jump to a position (display px). 'scrub' eases on the display; others snap. */
export function seekTo(pos, kind = 'seek') {
  const old = currentPlayback();
  const state = old.state === 'ended' ? 'paused' : old.state;
  writePlayback({ state, anchorPos: clamp(pos, minPos(), maxPos()) }, kind);
}

// Navigation acts only between takes: never while playing.
export function toTop() {
  if (isPlaying()) return;
  seekTo(0, 'top');
}

/** Paragraph starts to navigate between (skips blank spacer lines). */
function navStops(layout) {
  return layout?.navTops?.length ? layout.navTops : layout?.blockTops || [];
}

export function back() {
  if (isPlaying()) return;
  const layout = currentLayout();
  const pos = nowPos();
  const lp = linePx(currentSettings());
  const tops = navStops(layout);
  if (tops.length < 2) return seekTo(pos - 3 * lp, 'nudge');
  const i = blockIndexAt(pos + 1, tops);
  // Like "previous track": more than about a line into this block → its start.
  if (pos - tops[i] > lp * 0.75) seekTo(tops[i], 'nudge');
  else seekTo(i > 0 ? tops[i - 1] : 0, 'nudge');
}

export function forward() {
  if (isPlaying()) return;
  const layout = currentLayout();
  const pos = nowPos();
  const lp = linePx(currentSettings());
  const tops = navStops(layout);
  if (tops.length < 2) return seekTo(pos + 3 * lp, 'nudge');
  if (pos < tops[0] - 1) return seekTo(tops[0], 'nudge'); // from the lead-in: to the first line
  const i = blockIndexAt(pos + 1, tops);
  seekTo(i + 1 < tops.length ? tops[i + 1] : layout.maxPos, 'nudge');
}

// ── Session settings ────────────────────────────────────────────────────────

export function changeFontSize(direction) {
  const s = currentSettings();
  const r = RANGES.fontSize;
  const v = clamp(s.fontSizePx + direction * r.step, r.min, r.max);
  if (v !== s.fontSizePx) writeRig({ 'settings/fontSizePx': v });
}

export function changeLineHeight(direction) {
  const s = currentSettings();
  const r = RANGES.lineHeight;
  const v = Math.round(clamp(s.lineHeight + direction * r.step, r.min, r.max) * 10) / 10;
  if (v !== s.lineHeight) writeRig({ 'settings/lineHeight': v });
}

export function toggleFlipV() {
  writeRig({ 'settings/flipV': !currentSettings().flipV });
}

export function toggleFlipH() {
  writeRig({ 'settings/flipH': !currentSettings().flipH });
}

/** Load a script on the display: top, paused. Session settings carry over. */
export function loadScript(id, revision = 0) {
  const old = currentPlayback();
  writePlayback(
    { state: 'paused', anchorPos: 0, speedLpm: old.speedLpm || DEFAULT_SPEED_LPM },
    'load',
    { script: { id, revision }, layout: null, report: null },
  );
}

export function unloadScript() {
  writePlayback({ state: 'paused', anchorPos: 0 }, 'load', { script: null, layout: null, report: null });
}

/** Reset session settings to defaults (keeps the script and place, pauses). */
export function newSession() {
  writePlayback(
    { state: 'paused', speedLpm: DEFAULT_SPEED_LPM },
    'session',
    { sessionId: newId(), settings: { ...DEFAULT_SETTINGS } },
  );
}

export function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 13);
}
