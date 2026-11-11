// Central configuration. Tune defaults here after the on-rig calibration read.

export const APP_VERSION = '1.0.0';

// Firebase web config values are public identifiers, not secrets.
// Data is protected by Google sign-in plus the security rules in /firebase.
export const firebaseConfig = {
  apiKey: 'AIzaSyAPNSqELbxPB_6za4N0_Ziaz9Hm2XpLsq8',
  authDomain: 'lemonly-teleprompter-app.firebaseapp.com',
  projectId: 'lemonly-teleprompter-app',
  storageBucket: 'lemonly-teleprompter-app.firebasestorage.app',
  messagingSenderId: '1053479704517',
  appId: '1:1053479704517:web:53ffdd2c9d101f7a18ddac',
  databaseURL: 'https://lemonly-teleprompter-app-default-rtdb.firebaseio.com/',
};

// Who may use the app. Also enforced in the security rules.
export const ALLOWED_EMAIL = /@(lemonly|clickrain)\.com$/i;

// Session defaults (educated guesses: calibrate on the real rig).
export const DEFAULT_SETTINGS = {
  fontSizePx: 64,
  lineHeight: 1.4,
  flipV: true,
  flipH: false,
};
export const DEFAULT_SPEED_LPM = 20;

export const RANGES = {
  speed: { min: 5, max: 120, step: 1, bigStep: 5 },
  fontSize: { min: 32, max: 160, step: 4 },
  lineHeight: { min: 1.0, max: 2.2, step: 0.1 },
};

// Used for the controller mirror before any display has published its size.
export const FALLBACK_VIEWPORT = { w: 1180, h: 820 };

// Display layout.
export const REF_LINE_FRACTION = 1 / 3; // reference line, from the top of the display viewport
export const SIDE_PADDING_FRACTION = 0.05; // left/right padding, fraction of the display width

// Sync tuning.
export const SYNC = {
  reportIntervalMs: 1000, // display position reports
  easeMs: 300, // small corrections ease in over this long
  snapLines: 3, // jumps bigger than this many lines snap instead of easing
  speedWriteMs: 100, // max write rate while dragging the speed slider
  scrubWriteMs: 60, // max write rate while scrubbing the mirror
  greenMaxAgeMs: 2000,
  offlineAgeMs: 5000,
  inSyncLines: 0.5,
};

export const TRASH_PURGE_DAYS = 30;
export const AUTOSAVE_MS = 1500;

// Pinned CDN dependency (Firebase versions are pinned in js/firebase.js).
export const QUILL_VERSION = '2.0.3';

// Simulator hooks: only on localhost AND with ?demo=1. Inert everywhere else.
const params = new URLSearchParams(location.search);
export const DEMO_ENABLED =
  ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && params.has('demo');
