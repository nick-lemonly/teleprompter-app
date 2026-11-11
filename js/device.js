// This device's identity and local preferences (role, name).
// In the simulator each iframe passes ?device=… so frames act as separate devices.

const params = new URLSearchParams(location.search);
const urlDevice = params.get('device');
const PREFS_KEY = 'prompter.prefs' + (urlDevice ? '.' + urlDevice : '');

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

const prefs = readPrefs();

function save() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preferences last for this visit only */
  }
}

if (urlDevice) prefs.deviceId = urlDevice;
if (!prefs.deviceId) {
  prefs.deviceId =
    'dev-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 12);
}
if (params.get('role') === 'display' || params.get('role') === 'controller') prefs.role = params.get('role');
save();

export const deviceId = prefs.deviceId;

export function getRole() {
  return prefs.role || null;
}
export function setRole(role) {
  prefs.role = role;
  save();
}

export function getPref(key, fallback) {
  return key in prefs ? prefs[key] : fallback;
}
export function setPref(key, value) {
  prefs[key] = value;
  save();
}

/** Laptops/desktops: no touch screen. iPads and phones report touch points. */
export function isDesktop() {
  return (navigator.maxTouchPoints || 0) === 0;
}

export function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'phone' : 'tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'PC';
  return 'computer';
}

export function getDeviceName(role, userFirstName) {
  const saved = prefs[role === 'display' ? 'displayName' : 'controllerName'];
  if (saved) return saved;
  if (role === 'display') return 'Studio iPad';
  return `${userFirstName}'s ${deviceKind()}`;
}
export function setDeviceName(role, name) {
  prefs[role === 'display' ? 'displayName' : 'controllerName'] = name;
  save();
}
