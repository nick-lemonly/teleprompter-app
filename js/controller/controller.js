// Controller: live mirror of the display plus transport and session controls.
import { h, toast, throttle } from '../ui.js';
import { createStage, applyStage, renderContent, setScroll, fontsReady } from '../render.js';
import {
  subscribe, getRig, getPresence, isOnline, isConnected, shouldRenderFrame, debugStats,
} from '../rig/state.js';
import { computePos, pxPerSecond, withDefaults, linePx, clamp, EMPTY_PLAYBACK } from '../rig/playback.js';
import { measureLayout, layoutHash, mapPos, remapAcrossLayouts, blockIndexAt } from '../rig/layout.js';
import { serverNow, clockOffset } from '../clock.js';
import { deviceId } from '../device.js';
import { watchScript } from '../script-doc.js';
import { attachShortcuts } from '../shortcuts.js';
import * as cmd from '../rig/commands.js';
import { FALLBACK_VIEWPORT, RANGES, REF_LINE_FRACTION, SYNC, DEFAULT_SPEED_LPM } from '../config.js';
import { pickScript } from '../library/picker.js';
import { loadOnPrompter } from '../library/store.js';
import { mountEditor } from '../editor/editor.js';

const pbKey = (pb) => (pb ? `${pb.seq}|${pb.by}|${pb.anchorTime}` : '');
const layoutKey = (s, vp) => `${s.fontSizePx}|${s.lineHeight}|${vp.w}|${vp.h}`;

export function mountController(root, ctx) {
  // ── DOM ───────────────────────────────────────────────────────────────────
  const titleBtn = h('button.script-title', { title: 'Switch script', onclick: () => chooseScript() },
    h('span.script-title-text', {}, 'No script loaded'), h('span.chev', {}, '▾'));
  const statusLight = h('span.status-light');
  const statusText = h('span.status-text', {}, 'Connecting…');
  const devicesEl = h('div.devices');
  const top = h('div.ctl-top', {},
    titleBtn,
    h('div.ctl-status', {}, h('div.status-pill', { role: 'status' }, statusLight, statusText), devicesEl),
  );

  const mirror = h('div.mirror', { 'aria-label': 'Live view of the display. Drag to scrub.' });
  const stageHost = h('div.mirror-stage-host');
  const parts = createStage(stageHost);
  const frameEl = h('div.mirror-frame');
  const caret = h('div.mirror-caret');
  const badge = h('div.mirror-badge.hidden');
  const emptyMsg = h('div.mirror-empty', {},
    h('p', {}, 'No script loaded'),
    h('button.btn.primary', { onclick: () => chooseScript() }, 'Choose a script'));
  mirror.append(stageHost, frameEl, caret, badge, emptyMsg);
  const editorHost = h('div.ctl-editor.hidden');
  const viewArea = h('div.ctl-view', {}, mirror, editorHost);

  const btn = (cls, label, title, onclick) =>
    h('button.tbtn' + cls, { 'aria-label': title, title, onclick }, label);
  const topBtn = btn('', '⏮ Top', 'To top (Home)', () => cmd.toTop());
  const backBtn = btn('', '◀ Back', 'Back a paragraph (←)', () => cmd.back());
  const playBtn = btn('.play', '▶', 'Play / pause (Space)', () => cmd.togglePlay());
  const fwdBtn = btn('', 'Fwd ▶', 'Forward a paragraph (→)', () => cmd.forward());
  const transport = h('div.transport', {}, topBtn, backBtn, playBtn, fwdBtn);

  const speed = h('input.speed-range', {
    type: 'range', min: RANGES.speed.min, max: RANGES.speed.max, step: RANGES.speed.step,
    value: DEFAULT_SPEED_LPM, 'aria-label': 'Speed (lines per minute)',
  });
  const speedVal = h('div.speed-val', {}, `${DEFAULT_SPEED_LPM} lines/min`);
  const speedRow = h('div.speed', {},
    h('div.speed-row', {}, h('span.speed-icon', { 'aria-hidden': 'true' }, '🐢'), speed, h('span.speed-icon', { 'aria-hidden': 'true' }, '🐇')),
    speedVal);

  const sizeVal = h('span.stepper-val');
  const lhVal = h('span.stepper-val');
  const stepper = (label, valEl, onMinus, onPlus, names) =>
    h('div.stepper', {},
      h('span.stepper-label', {}, label),
      h('div.stepper-ctl', {},
        h('button.sbtn', { 'aria-label': names[0], onclick: onMinus }, '−'),
        valEl,
        h('button.sbtn', { 'aria-label': names[1], onclick: onPlus }, '+')));
  const textControls = h('div.text-controls', {},
    stepper('Text size', sizeVal, () => cmd.changeFontSize(-1), () => cmd.changeFontSize(1), ['Smaller text', 'Larger text']),
    stepper('Line spacing', lhVal, () => cmd.changeLineHeight(-1), () => cmd.changeLineHeight(1), ['Less line spacing', 'More line spacing']));

  const flipV = h('input', { type: 'checkbox', role: 'switch' });
  const flipH = h('input', { type: 'checkbox', role: 'switch' });
  flipV.addEventListener('change', () => cmd.toggleFlipV());
  flipH.addEventListener('change', () => cmd.toggleFlipH());
  const lockBtn = h('button.btn.lock-btn', { onclick: () => toggleLock() });
  const toggles = h('div.toggles-wrap', {},
    h('span.stepper-label', {}, 'Flip display'),
    h('div.toggles', {},
      h('label.switch-row', {}, flipV, h('span.switch'), h('span', {}, 'Upside-down')),
      h('label.switch-row', {}, flipH, h('span.switch'), h('span', {}, 'Left-right')),
      lockBtn));

  const controls = h('div.ctl-controls', {}, transport, speedRow, textControls, toggles);
  const el = h('div.controller', {}, top, h('div.ctl-main', {}, viewArea, controls));
  root.replaceChildren(el);

  // ── State ─────────────────────────────────────────────────────────────────
  let stopped = false;
  let settings = withDefaults(null);
  let vp = { w: FALLBACK_VIEWPORT.w, h: FALLBACK_VIEWPORT.h };
  let pb = EMPTY_PLAYBACK;
  let scriptId = null;
  let scriptData = null;
  let unsubScript = null;
  let renderedHtml = null;
  let localLayout = null;
  let geo = { scale: 1, refY: 0, stageH: 0, offsetX: 0 };
  let correction = 0;
  let targetCorrection = 0;
  let lastDelta = 0;
  let lastReportKey = '';
  let hold = null;
  let dragPos = null;
  let lastLocalPos = 0;
  let raf = 0;
  let lastFrameAt = performance.now();
  let speedDragging = false;
  let locked = true;
  let editorCleanup = null;

  cmd.setLocalLayoutProvider(() => localLayout);

  const displayLayout = () => {
    const dl = getRig().layout;
    return dl && localLayout && dl.hash === localLayout.hash && dl.totalHeight > 0 &&
      dl.blockTops?.length === localLayout.blockTops.length
      ? dl
      : null;
  };
  const toLocal = (p, dl = displayLayout()) => (dl ? mapPos(p, dl, localLayout) : p);
  const toDisplay = (p, dl = displayLayout()) => (dl ? mapPos(p, localLayout, dl) : p);

  // ── Rig updates ───────────────────────────────────────────────────────────
  function onRig(rig, presence) {
    if (stopped) return;
    const prevSettings = settings;
    const prevVp = vp;
    settings = withDefaults(rig.settings);
    vp = rig.display?.viewportW
      ? { w: rig.display.viewportW, h: rig.display.viewportH }
      : { w: FALLBACK_VIEWPORT.w, h: FALLBACK_VIEWPORT.h };
    const nextPb = rig.playback || EMPTY_PLAYBACK;
    if (pbKey(nextPb) !== pbKey(pb)) {
      pb = nextPb;
      if (hold && pbKey(pb) !== hold.baseKey) hold = null;
    }

    const newScriptId = rig.script?.id || null;
    if (newScriptId !== scriptId) switchScript(newScriptId);
    else if (layoutKey(prevSettings, prevVp) !== layoutKey(settings, vp)) relayoutLocal(prevSettings);

    // Quietly correct toward the display's reported position.
    const rep = rig.report;
    const dl = displayLayout();
    const repKey = rep ? `${rep.at}|${rep.seq}` : '';
    if (rep && repKey !== lastReportKey && dl && rep.layoutHash === dl.hash && rep.seq === (pb.seq || 0)) {
      lastReportKey = repKey;
      const expected = computePos(pb, settings, rep.at, dl.maxPos);
      lastDelta = rep.pos - expected;
      targetCorrection = Math.abs(lastDelta) <= linePx(settings) ? lastDelta : 0;
    }

    updateControls();
    updateDevices(rig, presence);
    updateStatus();
  }

  function switchScript(id) {
    unsubScript?.();
    unsubScript = null;
    scriptId = id;
    scriptData = null;
    localLayout = null;
    renderedHtml = null;
    hold = null;
    correction = targetCorrection = lastDelta = 0;
    parts.content.innerHTML = '';
    titleBtn.querySelector('.script-title-text').textContent = id ? 'Loading…' : 'No script loaded';
    emptyMsg.classList.toggle('hidden', !!id);
    if (!locked) setLocked(true);
    if (!id) return;
    unsubScript = watchScript(id, (data) => {
      if (stopped || scriptId !== id) return;
      scriptData = data && !data.deletedAt ? data : null;
      titleBtn.querySelector('.script-title-text').textContent = scriptData ? scriptData.title || 'Untitled' : 'Script not found';
      relayoutLocal(settings);
    });
  }

  /** Render and measure the mirror. Predict the place-keeping re-anchor until the display confirms it. */
  async function relayoutLocal(oldSettings) {
    if (mirror.classList.contains('hidden')) return; // editing: re-measured when the mirror returns
    layoutMirror();
    if (!scriptData) {
      localLayout = null;
      return;
    }
    await fontsReady();
    if (stopped || !scriptData) return;
    if (renderedHtml !== scriptData.content) {
      renderContent(parts, scriptData.content);
      renderedHtml = scriptData.content;
    }
    const m = measureLayout(parts.content, settings);
    const next = {
      ...m,
      scriptId: scriptData.id,
      revision: scriptData.revision || 0,
      hash: layoutHash({
        scriptId: scriptData.id, revision: scriptData.revision || 0,
        fontSizePx: settings.fontSizePx, lineHeight: settings.lineHeight, viewportW: vp.w, viewportH: vp.h,
      }),
    };
    const old = localLayout;
    if (old && old.scriptId === next.scriptId && old.hash !== next.hash && dragPos == null) {
      const now = serverNow();
      const oldDl = getRig().layout?.hash === old.hash ? getRig().layout : null;
      const oldDisp = computePos(pb, oldSettings || settings, now, oldDl ? oldDl.maxPos : old.maxPos);
      const oldLocal = oldDl ? mapPos(oldDisp, oldDl, old) : oldDisp;
      hold = {
        baseKey: pbKey(pb),
        localPos: clamp(remapAcrossLayouts(oldLocal, old, next), 0, next.maxPos),
        at: now,
        playing: pb.state === 'playing',
        speed: pb.speedLpm,
        until: performance.now() + 2500,
      };
    }
    localLayout = next;
  }

  /** Scale the display-sized stage to fit the mirror box; frame the display's visible area. */
  function layoutMirror() {
    const rect = mirror.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let scale = rect.width / vp.w;
    if (vp.h * scale * 1.06 > rect.height) scale = Math.min(scale, rect.height / (vp.h * 1.06));
    const stageH = rect.height / scale;
    const offsetX = (rect.width - vp.w * scale) / 2;
    const frameTop = stageH >= vp.h ? (stageH - vp.h) / 2 : stageH * 0.4 - vp.h * REF_LINE_FRACTION;
    const refY = frameTop + vp.h * REF_LINE_FRACTION;
    geo = { scale, refY, stageH, offsetX };
    stageHost.style.transform = `translate(${offsetX}px, 0) scale(${scale})`;
    applyStage(parts, { w: vp.w, h: stageH, settings, flips: false });
    Object.assign(frameEl.style, {
      left: `${offsetX}px`, top: `${frameTop * scale}px`, width: `${vp.w * scale}px`, height: `${vp.h * scale}px`,
    });
    caret.style.top = `${refY * scale}px`;
    caret.style.left = `${offsetX}px`;
  }

  const ro = new ResizeObserver(() => relayoutLocal(settings));
  ro.observe(mirror);

  // ── Frame loop ────────────────────────────────────────────────────────────
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!shouldRenderFrame(t)) return;
    const dt = Math.min(100, t - lastFrameAt);
    lastFrameAt = t;
    if (!localLayout) return;
    const now = serverNow();
    if (hold && (pbKey(pb) !== hold.baseKey || performance.now() > hold.until)) hold = null;
    correction += (targetCorrection - correction) * Math.min(1, dt / SYNC.easeMs);

    let localPos;
    let dispPos;
    const dl = displayLayout();
    if (dragPos != null) {
      localPos = dragPos;
    } else if (hold) {
      localPos = hold.localPos + (hold.playing ? (pxPerSecond(settings, hold.speed) * (now - hold.at)) / 1000 : 0);
      localPos = clamp(localPos, 0, localLayout.maxPos);
    } else {
      const maxDisp = dl ? dl.maxPos : localLayout.maxPos;
      dispPos = computePos(pb, settings, now, maxDisp);
      if (pb.state === 'playing') dispPos = clamp(dispPos + correction, 0, maxDisp);
      localPos = toLocal(dispPos, dl);
    }
    lastLocalPos = localPos;
    setScroll(parts, localPos, geo.refY);
    debugStats.pos = dispPos ?? toDisplay(localPos, dl);
    debugStats.seq = pb.seq;
    debugStats.state = pb.state;
    debugStats.offset = clockOffset();
    debugStats.reportAge = getRig().report ? serverNow() - getRig().report.at : null;
    debugStats.delta = lastDelta;
  }

  // ── Scrubbing and tap-to-paragraph ────────────────────────────────────────
  const scrubWrite = throttle((p) => cmd.seekTo(p, 'scrub'), SYNC.scrubWriteMs);
  let drag = null;

  mirror.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !localLayout || e.target.closest('button')) return;
    drag = { id: e.pointerId, startY: e.clientY, startLocal: lastLocalPos, moved: false };
    mirror.setPointerCapture(e.pointerId);
  });
  mirror.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) < 6) return;
      drag.moved = true;
      if (cmd.isPlaying()) cmd.pause(); // dragging pauses first, then seeks
      hold = null;
      drag.startLocal = lastLocalPos;
      drag.startY = e.clientY;
      return;
    }
    dragPos = clamp(drag.startLocal - dy / geo.scale, 0, localLayout.maxPos);
    scrubWrite(toDisplay(dragPos));
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasMoved = drag.moved;
    drag = null;
    if (wasMoved) {
      scrubWrite.cancel();
      if (dragPos != null) cmd.seekTo(toDisplay(dragPos), 'scrub');
      dragPos = null;
    } else if (e.type === 'pointerup' && !cmd.isPlaying()) {
      tapToParagraph(e);
    }
  };
  mirror.addEventListener('pointerup', endDrag);
  mirror.addEventListener('pointercancel', endDrag);

  function tapToParagraph(e) {
    const rect = mirror.getBoundingClientRect();
    const yStage = (e.clientY - rect.top) / geo.scale;
    const contentY = yStage - (geo.refY - lastLocalPos);
    if (contentY < 0 || contentY > localLayout.totalHeight) return;
    const i = blockIndexAt(contentY, localLayout.blockTops);
    const dl = displayLayout();
    const target = dl ? dl.blockTops[i] : localLayout.blockTops[i];
    if (target != null) cmd.seekTo(target, 'tap');
  }

  let wheelTimer = null;
  mirror.addEventListener('wheel', (e) => {
    if (!localLayout) return;
    e.preventDefault();
    if (cmd.isPlaying()) cmd.pause();
    hold = null;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? mirror.clientHeight : 1;
    const base = dragPos ?? lastLocalPos;
    dragPos = clamp(base + (e.deltaY * unit) / geo.scale, 0, localLayout.maxPos);
    scrubWrite(toDisplay(dragPos));
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      scrubWrite.cancel();
      if (dragPos != null) cmd.seekTo(toDisplay(dragPos), 'scrub');
      dragPos = null;
    }, 180);
  }, { passive: false });

  // ── Controls ──────────────────────────────────────────────────────────────
  const speedWrite = throttle((v) => cmd.setSpeed(v), SYNC.speedWriteMs);
  speed.addEventListener('input', () => {
    speedDragging = true;
    speedVal.textContent = `${speed.value} lines/min`;
    speedWrite(Number(speed.value));
  });
  speed.addEventListener('change', () => {
    speedWrite.cancel();
    cmd.setSpeed(Number(speed.value)); // always write the final value
    speedDragging = false;
  });
  speed.addEventListener('pointerup', () => setTimeout(() => (speedDragging = false), 50));

  function updateControls() {
    const playing = pb.state === 'playing';
    playBtn.textContent = playing ? '❚❚' : '▶';
    playBtn.classList.toggle('playing', playing);
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    for (const b of [topBtn, backBtn, fwdBtn]) b.disabled = playing || !scriptId;
    playBtn.disabled = !scriptId;
    if (!speedDragging) {
      speed.value = pb.speedLpm || DEFAULT_SPEED_LPM;
      speedVal.textContent = `${speed.value} lines/min`;
    }
    sizeVal.textContent = `${settings.fontSizePx}`;
    lhVal.textContent = settings.lineHeight.toFixed(1);
    flipV.checked = !!settings.flipV;
    flipH.checked = !!settings.flipH;
    badge.textContent = 'End of script';
    badge.classList.toggle('hidden', pb.state !== 'ended');
    lockBtn.textContent = locked ? '🔒 Edit locked' : '🔓 Editing';
    lockBtn.classList.toggle('active', !locked);
  }

  function updateDevices(rig, presence) {
    const displayId = rig.display?.deviceId;
    const entries = Object.entries(presence || {});
    entries.sort(([a], [b]) => (a === displayId ? -1 : b === displayId ? 1 : 0));
    devicesEl.replaceChildren(
      ...entries.map(([id, p]) =>
        h('span.device' + (id === displayId ? '.is-display' : '') + (id === deviceId ? '.is-me' : ''), {
          title: `${p.role || ''}${p.email ? ' · ' + p.email : ''}`,
        }, p.name || 'Device')),
    );
  }

  function updateStatus() {
    const rig = getRig();
    let state = 'green';
    let text = 'In sync';
    const disp = rig.display;
    const age = rig.report ? serverNow() - rig.report.at : Infinity;
    if (!isConnected()) {
      state = 'red';
      text = 'This device is offline';
    } else if (!disp || !isOnline(disp.deviceId) || age > SYNC.offlineAgeMs) {
      state = 'red';
      text = disp ? `${disp.name || 'Display'} offline — check the iPad's Wi-Fi` : 'No display connected';
    } else if (!scriptId) {
      text = `${disp.name || 'Display'} ready`;
    } else if (age > SYNC.greenMaxAgeMs || Math.abs(lastDelta) > linePx(settings) * SYNC.inSyncLines) {
      state = 'yellow';
      text = 'Catching up';
    }
    statusLight.className = 'status-light ' + state;
    statusText.textContent = text;
  }
  const statusTimer = setInterval(updateStatus, 250);

  // ── Script picker and edit lock ───────────────────────────────────────────
  async function chooseScript() {
    const id = await pickScript({ title: 'Load a script on the prompter' });
    if (id) loadOnPrompter(id);
  }

  function toggleLock() {
    if (locked && !scriptId) return toast('Load a script first');
    setLocked(!locked);
  }

  function setLocked(value) {
    locked = value;
    editorCleanup?.();
    editorCleanup = null;
    mirror.classList.toggle('hidden', !locked);
    editorHost.classList.toggle('hidden', locked);
    if (!locked) editorCleanup = mountEditor(editorHost, scriptId, { compact: true });
    else requestAnimationFrame(() => relayoutLocal(settings));
    updateControls();
  }

  const detachKeys = attachShortcuts();
  const unsub = subscribe(onRig);
  raf = requestAnimationFrame(frame);
  updateControls();

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    clearInterval(statusTimer);
    clearTimeout(wheelTimer);
    ro.disconnect();
    unsub();
    unsubScript?.();
    editorCleanup?.();
    detachKeys();
    cmd.setLocalLayoutProvider(null);
  };
}
