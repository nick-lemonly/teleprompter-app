// Display: the studio iPad in the mirror rig. Renders the script flipped, computes its
// own scroll position every frame, publishes its layout, and reports where it is.
import { h } from '../ui.js';
import { createStage, applyStage, renderContent, setScroll, refLineY, fontsReady } from '../render.js';
import {
  subscribe, getRig, writeRig, whenRigLoaded, isOnline, isConnected, shouldRenderFrame, debugStats,
} from '../rig/state.js';
import {
  computePos, rawPos, withDefaults, linePx, clamp, easeOutCubic, EMPTY_PLAYBACK,
} from '../rig/playback.js';
import { measureLayout, layoutHash, remapAcrossLayouts } from '../rig/layout.js';
import { serverNow, clockOffset } from '../clock.js';
import { deviceId, getDeviceName, setDeviceName, getPref, setPref } from '../device.js';
import { watchScript } from '../script-doc.js';
import { attachShortcuts } from '../shortcuts.js';
import { icon } from '../icons.js';
import * as cmd from '../rig/commands.js';
import { DEFAULT_SETTINGS, DEFAULT_SPEED_LPM, SYNC } from '../config.js';

const SNAP_KINDS = new Set(['seek', 'top', 'nudge', 'load', 'layout', 'tap', 'session', 'end']);
const pbKey = (pb) => (pb ? `${pb.seq}|${pb.by}|${pb.anchorTime}` : '');
const layoutKey = (s) => `${s.fontSizePx}|${s.lineHeight}`;

export function mountDisplay(root, ctx) {
  const host = h('div.display-host');
  const parts = createStage(host);
  const idleName = h('div.idle-name');
  const idleStatus = h('div.idle-status');
  const idle = h('div.display-idle', {}, idleName, idleStatus);
  const dot = h('div.display-dot', { title: 'Connection' });
  const notice = h('div.display-notice.hidden');
  const overlay = buildOverlay();
  const el = h('div.display-root', {}, host, idle, dot, notice, overlay.el);
  root.replaceChildren(el);
  document.body.classList.add('is-display');

  let claimed = false;
  let stopped = false;
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let settings = withDefaults(null);
  let scriptId = null;
  let scriptData = null;
  let scriptMissing = false;
  let unsubScript = null;
  let renderedHtml = null;
  let layout = null;
  let pb = null;
  let lastPbKey = '';
  let ease = null;
  let renderedPos = 0;
  let endedSeq = -1;
  let raf = 0;
  let wakeLock = null;

  const name = () => getDeviceName('display');

  // ── Claiming the rig ──────────────────────────────────────────────────────

  function claim() {
    const now = serverNow();
    const old = getRig().playback || EMPTY_PLAYBACK;
    const next = {
      state: 'paused', anchorPos: 0, anchorTime: now, speedLpm: DEFAULT_SPEED_LPM,
      seq: (old.seq || 0) + 1, by: deviceId, kind: 'session',
    };
    claimed = true;
    layout = null;
    writeRig({
      display: { deviceId, name: name(), viewportW: vw, viewportH: vh, claimedAt: now },
      sessionId: cmd.newId(),
      settings: { ...DEFAULT_SETTINGS },
      playback: next,
      layout: null,
      report: null,
    });
    hideNotice();
  }

  function resume() {
    claimed = true;
    writeRig({ 'display/viewportW': vw, 'display/viewportH': vh, 'display/name': name() });
    hideNotice();
  }

  function askToReplace(currentName) {
    showNotice(
      `${currentName || 'Another device'} is the current display.`,
      'Replace it?',
      [
        { label: 'Replace it', primary: true, onclick: () => { claim(); onRig(getRig()); } },
        { label: 'Use as controller', onclick: () => ctx.switchRole('controller') },
      ],
    );
  }

  function becomeReplaced(byName) {
    claimed = false;
    layout = null;
    parts.content.innerHTML = '';
    renderedHtml = null;
    showNotice('This display was replaced', `${byName || 'Another device'} is now the display.`, [
      { label: 'Make this the display again', primary: true, onclick: () => askOrClaim() },
      { label: 'Use as controller', onclick: () => ctx.switchRole('controller') },
    ]);
  }

  function askOrClaim() {
    const rig = getRig();
    if (rig.display?.deviceId === deviceId) resume();
    else if (rig.display?.deviceId && isOnline(rig.display.deviceId)) askToReplace(rig.display.name);
    else claim();
    onRig(getRig());
  }

  // ── Reacting to the rig ───────────────────────────────────────────────────

  function onRig(rig) {
    if (stopped) return;
    updateDot();
    if (!claimed) return updateIdle();
    if (rig.display && rig.display.deviceId !== deviceId) return becomeReplaced(rig.display.name);
    if (!rig.display) {
      // Someone cleared the rig: quietly claim it back.
      writeRig({ display: { deviceId, name: name(), viewportW: vw, viewportH: vh, claimedAt: serverNow() } });
    }

    const prevSettings = settings;
    settings = withDefaults(rig.settings);

    const newScriptId = rig.script?.id || null;
    if (newScriptId !== scriptId) switchScript(newScriptId);

    const nextPb = rig.playback || EMPTY_PLAYBACK;
    if (pbKey(nextPb) !== lastPbKey) onNewPlayback(nextPb);

    if (layoutKey(prevSettings) !== layoutKey(settings)) relayout(prevSettings);
    applyStage(parts, { w: vw, h: vh, settings, flips: true });
    updateIdle();
  }

  function onNewPlayback(next) {
    const first = !lastPbKey;
    const lp = linePx(settings);
    const target = computePos(next, settings, serverNow(), layout ? layout.maxPos : Infinity, layout ? layout.minPos : 0);
    const jump = target - renderedPos;
    if (first || !layout) ease = null;
    else if (next.kind === 'scrub') {
      ease = Math.abs(jump) < 20 * lp ? { from: -jump, start: performance.now(), dur: 150 } : null;
    } else if (SNAP_KINDS.has(next.kind) || Math.abs(jump) > SYNC.snapLines * lp) ease = null;
    else ease = { from: -jump, start: performance.now(), dur: SYNC.easeMs };
    pb = next;
    lastPbKey = pbKey(next);
  }

  function switchScript(id) {
    unsubScript?.();
    unsubScript = null;
    scriptId = id;
    scriptData = null;
    scriptMissing = false;
    layout = null;
    renderedHtml = null;
    parts.content.innerHTML = '';
    if (!id) return;
    unsubScript = watchScript(id, (data) => {
      if (stopped || scriptId !== id) return;
      if (!data || data.deletedAt) {
        scriptMissing = true;
        scriptData = null;
        updateIdle();
        return;
      }
      scriptMissing = false;
      scriptData = data;
      updateIdle(); // unhide the stage first: hidden elements measure as zero
      relayout(settings);
    });
  }

  /** Re-render and re-measure. If the layout changed mid-script, keep the reader's place (§6.5). */
  function relayout(oldSettings) {
    if (!claimed || !scriptData) return;
    host.classList.remove('hidden');
    applyStage(parts, { w: vw, h: vh, settings, flips: true });
    if (renderedHtml !== scriptData.content) {
      renderContent(parts, scriptData.content);
      renderedHtml = scriptData.content;
    }
    const m = measureLayout(parts.content, settings, vh);
    const next = {
      ...m,
      scriptId: scriptData.id,
      revision: scriptData.revision || 0,
      viewportW: vw,
      viewportH: vh,
      hash: layoutHash({
        scriptId: scriptData.id, revision: scriptData.revision || 0,
        fontSizePx: settings.fontSizePx, lineHeight: settings.lineHeight, viewportW: vw, viewportH: vh,
      }),
    };
    const old = layout;
    layout = next;
    const publish = {
      hash: next.hash, scriptId: next.scriptId, revision: next.revision, blockTops: next.blockTops,
      totalHeight: next.totalHeight, maxPos: next.maxPos, minPos: next.minPos, viewportW: vw, viewportH: vh,
    };
    const rateChanged = oldSettings && linePx(oldSettings) !== linePx(settings);
    if (old && old.scriptId === next.scriptId && (old.hash !== next.hash || rateChanged)) {
      const cur = pb || EMPTY_PLAYBACK;
      const now = serverNow();
      const oldPos = computePos(cur, oldSettings || settings, now, old.maxPos, old.minPos);
      const newPos = clamp(remapAcrossLayouts(oldPos, old, next), next.minPos, next.maxPos);
      const re = {
        ...cur,
        anchorPos: cur.state === 'ended' ? next.maxPos : newPos,
        anchorTime: now,
        seq: (cur.seq || 0) + 1,
        by: deviceId,
        kind: 'layout',
      };
      pb = re;
      lastPbKey = pbKey(re);
      ease = null;
      writeRig({ playback: re, layout: publish });
    } else if (!old || old.hash !== next.hash || getRig().layout?.hash !== next.hash) {
      writeRig({ layout: publish });
    }
  }

  // ── Frame loop and reports ────────────────────────────────────────────────

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!shouldRenderFrame(t) || !claimed || !layout || !pb) return;
    const now = serverNow();
    const raw = rawPos(pb, settings, now);
    if (pb.state === 'playing' && raw >= layout.maxPos && endedSeq !== pb.seq) {
      endedSeq = pb.seq;
      const end = {
        ...pb, state: 'ended', anchorPos: layout.maxPos, anchorTime: now,
        seq: (pb.seq || 0) + 1, by: deviceId, kind: 'end',
      };
      pb = end;
      lastPbKey = pbKey(end);
      writeRig({ playback: end });
    }
    const target = clamp(raw, layout.minPos, layout.maxPos);
    let off = 0;
    if (ease) {
      const k = (performance.now() - ease.start) / ease.dur;
      if (k >= 1) ease = null;
      else off = ease.from * (1 - easeOutCubic(k));
    }
    renderedPos = target + off;
    setScroll(parts, renderedPos, refLineY(vh));
    debugStats.pos = renderedPos;
    debugStats.seq = pb.seq;
    debugStats.state = pb.state;
    debugStats.offset = clockOffset();
  }

  const reportTimer = setInterval(() => {
    // Report even with no script loaded, so controllers know the display is alive.
    if (!claimed || !isConnected()) return;
    writeRig({
      report: {
        pos: layout ? Math.round(renderedPos * 10) / 10 : 0,
        at: Math.round(serverNow()),
        layoutHash: layout?.hash || null,
        seq: pb?.seq || 0,
      },
    });
  }, SYNC.reportIntervalMs);

  // ── Idle screen, status dot, notices ──────────────────────────────────────

  function updateIdle() {
    const showIdle = claimed && (!scriptId || scriptMissing || !scriptData);
    idle.classList.toggle('hidden', !showIdle);
    host.classList.toggle('hidden', !claimed || !scriptData);
    idleName.textContent = name();
    idleStatus.textContent = !isConnected()
      ? 'Offline: check the Wi-Fi'
      : scriptMissing
        ? 'That script was deleted. Waiting for a controller…'
        : scriptId
          ? 'Loading script…'
          : 'Waiting for a controller…';
    idle.classList.toggle('offline', !isConnected());
  }

  function updateDot() {
    dot.classList.toggle('offline', !isConnected());
    dot.classList.toggle('hidden', !getPref('showDot', true));
  }

  function showNotice(title, message, actions) {
    notice.replaceChildren(
      h('div.notice-box', {},
        h('h1', {}, title),
        message ? h('p', {}, message) : null,
        h('div.notice-actions', {}, actions.map((a) =>
          h('button.btn' + (a.primary ? '.primary' : ''), { onclick: a.onclick }, a.label))),
      ),
    );
    notice.classList.remove('hidden');
    idle.classList.add('hidden');
    host.classList.add('hidden');
  }

  function hideNotice() {
    notice.classList.add('hidden');
  }

  // ── Tap-anywhere overlay (unflipped, auto-hides) ──────────────────────────

  function buildOverlay() {
    const nameInput = h('input.input', { type: 'text', 'aria-label': 'Display name' });
    const flipV = h('input', { type: 'checkbox' });
    const flipH = h('input', { type: 'checkbox' });
    const showDot = h('input', { type: 'checkbox' });
    let timer = null;
    const panel = h('div.overlay-panel', {},
      h('div.overlay-head', {},
        h('img', { src: 'assets/lemonly-logo.svg', alt: '', class: 'logo-sm' }),
        h('strong', {}, 'Display settings'),
        h('button.btn.icon.ghost', { 'aria-label': 'Close', onclick: () => hide(), html: icon('x') }),
      ),
      h('label.field-label', {}, 'Display name'),
      nameInput,
      h('label.switch-row', {}, flipV, h('span.switch'), h('span', {}, 'Flip upside-down')),
      h('label.switch-row', {}, flipH, h('span.switch'), h('span', {}, 'Flip left-right')),
      h('label.switch-row', {}, showDot, h('span.switch'), h('span', {}, 'Show connection dot')),
      h('div.overlay-actions', {},
        h('button.btn', { onclick: () => ctx.switchRole() }, 'Switch role'),
        h('button.btn', { onclick: () => ctx.signOut() }, 'Sign out'),
      ),
    );
    const wrap = h('div.display-overlay.hidden', {}, panel);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(hide, 10000);
    };
    const show = () => {
      const s = withDefaults(getRig().settings);
      nameInput.value = name();
      flipV.checked = s.flipV;
      flipH.checked = s.flipH;
      showDot.checked = getPref('showDot', true);
      wrap.classList.remove('hidden');
      bump();
    };
    let closedAt = 0;
    const hide = () => {
      clearTimeout(timer);
      closedAt = performance.now();
      wrap.classList.add('hidden');
      nameInput.blur();
    };
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim() || 'Studio iPad';
      setDeviceName('display', v);
      if (claimed) writeRig({ 'display/name': v });
      ctx.refreshPresence();
      updateIdle();
    });
    flipV.addEventListener('change', () => cmd.toggleFlipV());
    flipH.addEventListener('change', () => cmd.toggleFlipH());
    showDot.addEventListener('change', () => {
      setPref('showDot', showDot.checked);
      updateDot();
    });
    wrap.addEventListener('pointerdown', bump);
    wrap.addEventListener('input', bump);
    // Tap outside the panel closes it. Close on click, not pointerdown: hiding on
    // pointerdown sends the rest of the tap to the screen behind, which reopens it.
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) hide();
    });
    return {
      el: wrap,
      show,
      hide,
      isOpen: () => !wrap.classList.contains('hidden'),
      justClosed: () => performance.now() - closedAt < 400,
    };
  }

  const onTap = (e) => {
    // Clicks inside the overlay (✕, backdrop) close it; don't let them bubble up and reopen it.
    if (overlay.isOpen() || overlay.justClosed() || overlay.el.contains(e.target) || notice.contains(e.target) || !claimed) return;
    overlay.show();
  };
  el.addEventListener('click', onTap);

  // ── Wake lock, resize, visibility ─────────────────────────────────────────

  async function requestWake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Wake lock unavailable', err);
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      requestWake();
      onRig(getRig()); // re-read and ease to the right place
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth === vw && window.innerHeight === vh) return;
      vw = window.innerWidth;
      vh = window.innerHeight;
      if (claimed) writeRig({ 'display/viewportW': vw, 'display/viewportH': vh });
      relayout(settings);
    }, 250);
  };
  window.addEventListener('resize', onResize);

  const detachKeys = attachShortcuts();
  let unsubRig = null;

  (async () => {
    updateIdle();
    await fontsReady();
    await whenRigLoaded();
    if (stopped) return;
    const rig = getRig();
    if (rig.display?.deviceId === deviceId) resume();
    else if (rig.display?.deviceId && isOnline(rig.display.deviceId)) askToReplace(rig.display.name);
    else claim();
    unsubRig = subscribe(onRig);
    raf = requestAnimationFrame(frame);
    requestWake();
  })();

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    clearInterval(reportTimer);
    clearTimeout(resizeTimer);
    unsubRig?.();
    unsubScript?.();
    detachKeys();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
    wakeLock?.release?.().catch(() => {});
    document.body.classList.remove('is-display');
  };
}
