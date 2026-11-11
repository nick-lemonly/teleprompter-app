// Shared clock: converts this device's clock to Firebase server time.
import { db, ref, onValue } from './firebase.js';

let offset = 0;
let started = false;
let skewForDemo = 0;

export function startClock() {
  if (started) return;
  started = true;
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    offset = Number(snap.val()) || 0;
  });
}

/** Current Firebase server time in ms. */
export function serverNow() {
  return Date.now() + offset + skewForDemo;
}

export function clockOffset() {
  return offset + skewForDemo;
}

// Demo-only: simulate a device whose offset estimate is wrong.
export function _setDemoSkew(ms) {
  skewForDemo = ms;
}
