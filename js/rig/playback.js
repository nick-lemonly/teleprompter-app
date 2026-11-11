// Position math. Every device computes the scroll position itself from the shared
// playback state and the shared clock, so no stream of positions is needed.
import { DEFAULT_SETTINGS, DEFAULT_SPEED_LPM } from '../config.js';

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function withDefaults(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

/** One line of text, in display px. */
export function linePx(settings) {
  return settings.fontSizePx * settings.lineHeight;
}

/** Speed is in lines per minute, so the reading pace holds when text size changes. */
export function pxPerSecond(settings, speedLpm) {
  return ((speedLpm || DEFAULT_SPEED_LPM) / 60) * linePx(settings);
}

export const EMPTY_PLAYBACK = Object.freeze({
  state: 'paused',
  anchorPos: 0,
  anchorTime: 0,
  speedLpm: DEFAULT_SPEED_LPM,
  seq: 0,
});

/** Position (display px) at server time `now`. */
export function computePos(playback, settings, now, maxPos = Infinity) {
  const pb = playback || EMPTY_PLAYBACK;
  let pos = Number(pb.anchorPos) || 0;
  if (pb.state === 'playing') {
    pos += (pxPerSecond(settings, pb.speedLpm) * (now - pb.anchorTime)) / 1000;
  }
  return clamp(pos, 0, Math.max(0, maxPos));
}

/** Unclamped position, used to detect reaching the end. */
export function rawPos(playback, settings, now) {
  return computePos(playback, settings, now, Infinity);
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
