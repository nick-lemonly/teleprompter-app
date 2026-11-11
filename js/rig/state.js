// Reads and writes the shared live state (/rig) and device presence (/presence) in RTDB.
// Also hosts the simulator hooks, which are inert unless DEMO_ENABLED (localhost + ?demo=1).
import {
  db,
  fs,
  ref,
  onValue,
  update,
  set,
  remove,
  onDisconnect,
  rtdbServerTimestamp,
  goOffline,
  goOnline,
  disableNetwork,
  enableNetwork,
} from '../firebase.js';
import { DEMO_ENABLED } from '../config.js';
import { deviceId } from '../device.js';
import { clockOffset, _setDemoSkew } from '../clock.js';

let rig = {};
let presence = {};
let connected = false;
let rigLoaded = false;
let started = false;
let presenceInfo = null;
let resolveLoaded;
const loadedPromise = new Promise((r) => (resolveLoaded = r));
const subscribers = new Set();

// Live numbers for the simulator readout.
export const debugStats = {};

// Simulator knobs. All zero/false in production, so every code path below is a no-op there.
const demo = { latencyIn: 0, latencyOut: 0, fps: 0 };

function emit() {
  for (const fn of subscribers) {
    try {
      fn(rig, presence);
    } catch (err) {
      console.error(err);
    }
  }
}

function delayIn(fn) {
  if (DEMO_ENABLED && demo.latencyIn > 0) setTimeout(fn, demo.latencyIn);
  else fn();
}
function delayOut(fn) {
  if (DEMO_ENABLED && demo.latencyOut > 0) setTimeout(fn, demo.latencyOut);
  else fn();
}

export function startRig() {
  if (started) return;
  started = true;
  // "Loaded" means both /rig and /presence have arrived: deciding whether the current
  // display is online needs presence.
  let gotRig = false;
  let gotPresence = false;
  const markLoaded = () => {
    if (gotRig && gotPresence && !rigLoaded) {
      rigLoaded = true;
      resolveLoaded();
    }
  };
  onValue(ref(db, 'rig'), (snap) => {
    const val = snap.val() || {};
    delayIn(() => {
      rig = val;
      gotRig = true;
      markLoaded();
      emit();
    });
  });
  onValue(ref(db, 'presence'), (snap) => {
    const val = snap.val() || {};
    delayIn(() => {
      presence = val;
      gotPresence = true;
      markLoaded();
      emit();
    });
  });
  onValue(ref(db, '.info/connected'), (snap) => {
    connected = !!snap.val();
    if (connected && presenceInfo) registerPresence();
    emit();
  });
}

export function subscribe(fn) {
  subscribers.add(fn);
  if (rigLoaded) fn(rig, presence);
  return () => subscribers.delete(fn);
}

export const getRig = () => rig;
export const getPresence = () => presence;
export const isConnected = () => connected;
export const whenRigLoaded = () => loadedPromise;

export function isOnline(id) {
  return !!(id && presence[id]);
}

/** Multi-path update relative to /rig, e.g. { playback: {...}, 'settings/flipV': true }. */
export function writeRig(updates) {
  delayOut(() => {
    update(ref(db, 'rig'), updates).catch((err) => console.error('Rig write failed', err));
  });
}

// ── Presence ────────────────────────────────────────────────────────────────

export function setPresence(info) {
  presenceInfo = info;
  if (connected) registerPresence();
}

async function registerPresence() {
  if (!presenceInfo) return;
  const r = ref(db, 'presence/' + deviceId);
  try {
    await onDisconnect(r).remove();
    await set(r, { ...presenceInfo, online: true, lastSeen: rtdbServerTimestamp() });
  } catch (err) {
    console.error('Presence failed', err);
  }
}

export function clearPresence() {
  presenceInfo = null;
  remove(ref(db, 'presence/' + deviceId)).catch(() => {});
}

// ── Simulator hooks ─────────────────────────────────────────────────────────

/** Frame-rate throttle for loops. Always true outside the simulator. */
let lastFrameAt = 0;
export function shouldRenderFrame(now) {
  if (!DEMO_ENABLED || !demo.fps) return true;
  if (now - lastFrameAt < 1000 / demo.fps) return false;
  lastFrameAt = now;
  return true;
}

if (DEMO_ENABLED) {
  let offlineTimer = null;
  window.__prompterDemo = {
    deviceId,
    stats: debugStats,
    get settings() {
      return { ...demo };
    },
    setLatency(inMs, outMs) {
      demo.latencyIn = Number(inMs) || 0;
      demo.latencyOut = Number(outMs) || 0;
    },
    setFps(fps) {
      demo.fps = Number(fps) || 0;
    },
    setClockSkew(ms) {
      _setDemoSkew(Number(ms) || 0);
    },
    clockOffset,
    goOfflineFor(seconds) {
      clearTimeout(offlineTimer);
      goOffline(db);
      disableNetwork(fs).catch(() => {});
      offlineTimer = setTimeout(() => {
        goOnline(db);
        enableNetwork(fs).catch(() => {});
      }, seconds * 1000);
    },
  };
}
