// The prompter "stage": the same DOM and styles on the display and in the controller
// mirror, so text wraps identically. Sizes are in display px.
import { sanitizeHtml } from './editor/sanitize.js';
import { SIDE_PADDING_FRACTION, REF_LINE_FRACTION } from './config.js';

export function createStage(host) {
  const stage = document.createElement('div');
  stage.className = 'stage';
  const flip = document.createElement('div');
  flip.className = 'flip-layer';
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  const content = document.createElement('div');
  content.className = 'script-content';
  scroller.append(content);
  flip.append(scroller);
  stage.append(flip);
  host.append(stage);
  return { stage, flip, scroller, content };
}

/** Text settings and width. `h` is the stage height (the mirror may be taller than the display). */
export function applyStage(parts, { w, h, settings, flips = false }) {
  parts.stage.style.width = `${w}px`;
  parts.stage.style.height = `${h}px`;
  const c = parts.content.style;
  c.fontSize = `${settings.fontSizePx}px`;
  c.lineHeight = String(settings.lineHeight);
  const pad = Math.round(w * SIDE_PADDING_FRACTION);
  c.paddingLeft = `${pad}px`;
  c.paddingRight = `${pad}px`;
  c.width = `${w}px`;
  const t = [];
  if (flips && settings.flipV) t.push('rotate(180deg)');
  if (flips && settings.flipH) t.push('scaleX(-1)');
  parts.flip.style.transform = t.join(' ');
}

export function renderContent(parts, html) {
  parts.content.innerHTML = sanitizeHtml(html || '');
}

/** Put content position `pos` on the line at `refY` (stage px). */
export function setScroll(parts, pos, refY) {
  parts.scroller.style.transform = `translate3d(0, ${(refY - pos).toFixed(2)}px, 0)`;
}

export function refLineY(viewportH) {
  return viewportH * REF_LINE_FRACTION;
}

let fontsPromise = null;
/** Resolves once every Montserrat face the prompter uses is loaded. */
export function fontsReady() {
  if (!fontsPromise) {
    const faces = ['500 32px Montserrat', '700 32px Montserrat', 'italic 500 32px Montserrat', 'italic 700 32px Montserrat'];
    fontsPromise = Promise.all(faces.map((f) => document.fonts.load(f, 'AaÄ')))
      .catch(() => {})
      .then(() => document.fonts.ready);
  }
  return fontsPromise;
}
