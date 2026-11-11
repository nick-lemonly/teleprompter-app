// Icons from Lucide (https://lucide.dev), ISC License, lucide-static v1.66.0.
// Vendored so the app has no runtime icon dependency. Add more by copying their inner SVG.
const PATHS = {
  'a-arrow-down': "<path d=\"m14 12 4 4 4-4\"/> <path d=\"M18 16V7\"/> <path d=\"m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16\"/> <path d=\"M3.304 13h6.392\"/>",
  'a-arrow-up': "<path d=\"m14 11 4-4 4 4\"/> <path d=\"M18 16V7\"/> <path d=\"m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16\"/> <path d=\"M3.304 13h6.392\"/>",
  'arrow-left': "<path d=\"m12 19-7-7 7-7\"/> <path d=\"M19 12H5\"/>",
  'chevron-left': "<path d=\"m15 18-6-6 6-6\"/>",
  'chevron-right': "<path d=\"m9 18 6-6-6-6\"/>",
  'ellipsis': "<circle cx=\"12\" cy=\"12\" r=\"1\"/> <circle cx=\"19\" cy=\"12\" r=\"1\"/> <circle cx=\"5\" cy=\"12\" r=\"1\"/>",
  'file-text': "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/> <path d=\"M10 9H8\"/> <path d=\"M16 13H8\"/> <path d=\"M16 17H8\"/>",
  'folder': "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
  'lock-open': "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/> <path d=\"M7 11V7a5 5 0 0 1 9.9-1\"/>",
  'lock': "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>",
  'pause': "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/> <rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/>",
  'play': "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"/>",
  'rabbit': "<path d=\"M13 16a3 3 0 0 1 2.24 5\"/> <path d=\"M18 12h.01\"/> <path d=\"M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3\"/> <path d=\"M20 8.54V4a2 2 0 1 0-4 0v3\"/> <path d=\"M7.612 12.524a3 3 0 1 0-1.6 4.3\"/>",
  'redo-2': "<path d=\"m15 14 5-5-5-5\"/> <path d=\"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13\"/>",
  'search': "<path d=\"m21 21-4.34-4.34\"/> <circle cx=\"11\" cy=\"11\" r=\"8\"/>",
  'skip-back': "<path d=\"M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z\"/> <path d=\"M3 20V4\"/>",
  'trash-2': "<path d=\"M10 11v6\"/> <path d=\"M14 11v6\"/> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/> <path d=\"M3 6h18\"/> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>",
  'turtle': "<path d=\"m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z\"/> <path d=\"M4.82 7.9 8 10\"/> <path d=\"M15.18 7.9 12 10\"/> <path d=\"M16.93 10H20a2 2 0 0 1 0 4H2\"/>",
  'undo-2': "<path d=\"M9 14 4 9l5-5\"/> <path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\"/>",
};

/** Inline SVG string for an icon. Inherits text color via currentColor. */
export function icon(name, size = 22) {
  return `<svg class="icon icon-${name}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

/** Same, as a DOM node. */
export function iconEl(name, size) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size);
  return t.content.firstChild;
}
