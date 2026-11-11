// Boot, sign-in gate, hash routing, app shell, role selection.
import { watchAuth, isAllowed, signIn, signOutUser, firstName, getUser } from './auth.js';
import { startClock } from './clock.js';
import { startRig, setPresence, clearPresence } from './rig/state.js';
import * as cmd from './rig/commands.js';
import { getRole, setRole, isDesktop, getDeviceName, setDeviceName } from './device.js';
import { h, confirmDialog, promptDialog, toast } from './ui.js';
import { APP_VERSION, DEMO_ENABLED } from './config.js';
import { startLibrary } from './library/store.js';
import { mountLibrary } from './library/library.js';
import { mountEditor } from './editor/editor.js';
import { mountController } from './controller/controller.js';
import { mountDisplay } from './display/display.js';

const appEl = document.getElementById('app');
let user = null;
let unmount = null;
let started = false;
let currentRoute = '';

// ── Auth gate ───────────────────────────────────────────────────────────────

watchAuth((u) => {
  user = u;
  if (!u) return showSignIn();
  if (!isAllowed(u)) return showBlocked(u);
  startApp();
});

function setView(node) {
  unmount?.();
  unmount = null;
  appEl.replaceChildren(node);
}

function showSignIn(errorText = '') {
  const err = h('p.signin-error', {}, errorText);
  const btn = h('button.btn.primary.big', {
    onclick: async () => {
      btn.disabled = true;
      err.textContent = '';
      try {
        await signIn();
      } catch (e) {
        btn.disabled = false;
        if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
        err.textContent = e?.code === 'auth/popup-blocked'
          ? 'The sign-in window was blocked. Allow pop-ups for this site and try again.'
          : `Sign-in didn't work (${e?.code || e?.message || 'unknown error'}).`;
      }
    },
  }, 'Sign in with Google');
  setView(h('div.center-screen', {},
    h('div.signin', {},
      h('img.logo-lg', { src: 'assets/lemonly-logo.svg', alt: 'Lemonly' }),
      h('h1', {}, 'Lemonly Prompter'),
      h('p.muted', {}, 'Sign in with your Lemonly or Click Rain Google account.'),
      btn,
      err)));
}

function showBlocked(u) {
  setView(h('div.center-screen', {},
    h('div.signin', {},
      h('img.logo-lg', { src: 'assets/lemonly-logo.svg', alt: 'Lemonly' }),
      h('h1', {}, 'This app is for Lemonly and Click Rain team members'),
      h('p.muted', {}, `You're signed in as ${u.email}.`),
      h('button.btn.big', { onclick: () => signOutUser() }, 'Sign out'))));
}

function startApp() {
  if (!started) {
    started = true;
    startClock();
    startRig();
    startLibrary();
    window.addEventListener('hashchange', route);
  }
  currentRoute = '';
  route();
}

// ── Routing ─────────────────────────────────────────────────────────────────

const ctx = {
  get user() {
    return user;
  },
  go(hash, { replace = false } = {}) {
    if (location.hash === hash) return route();
    if (replace) {
      history.replaceState(null, '', hash);
      route();
    } else {
      location.hash = hash;
    }
  },
  switchRole(role) {
    if (!role) return ctx.go('#/role');
    setRole(role);
    ctx.go(role === 'display' ? '#/display' : '#/controller');
  },
  async signOut() {
    clearPresence();
    await signOutUser();
  },
  refreshPresence,
};

function defaultRoute() {
  const role = getRole();
  if (role === 'display') return '#/display';
  if (isDesktop()) return '#/library';
  if (role === 'controller') return '#/controller';
  return '#/role';
}

function route() {
  if (!user || !isAllowed(user)) return;
  const hash = location.hash || '';
  const m = hash.match(/^#\/([^/?]*)\/?([^?]*)/);
  if (!m || !m[1]) return ctx.go(defaultRoute(), { replace: true });
  if (hash === currentRoute) return;
  currentRoute = hash;
  const [, view, param] = m;

  switch (view) {
    case 'role':
      return mountRolePicker();
    case 'display':
      setRole('display');
      setView(h('div.view-display'));
      unmount = mountDisplay(appEl.firstChild, ctx);
      break;
    case 'controller':
      if (getRole() !== 'controller') setRole('controller');
      mountInShell('Prompter', 'controller', (main) => mountController(main, ctx));
      break;
    case 'library':
      mountInShell('Library', 'library', (main) => mountLibrary(main, ctx, { folderId: param || null }));
      break;
    case 'trash':
      mountInShell('Trash', 'library', (main) => mountLibrary(main, ctx, { trash: true }));
      break;
    case 'edit':
      if (!param) return ctx.go('#/library', { replace: true });
      mountInShell('Edit script', 'library', (main) => mountEditor(main, param, { onBack: () => history.length > 1 ? history.back() : ctx.go('#/library') }));
      break;
    default:
      return ctx.go(defaultRoute(), { replace: true });
  }
  refreshPresence();
}

function refreshPresence() {
  const role = getRole() === 'display' && currentRoute.startsWith('#/display') ? 'display' : 'controller';
  setPresence({
    role,
    name: getDeviceName(role, firstName(user)),
    email: user?.email || '',
  });
}

// ── Shell ───────────────────────────────────────────────────────────────────

function mountInShell(title, section, mountFn) {
  const main = h('main.shell-main');
  const nav = h('nav.shell-nav', {},
    h('a.nav-link' + (section === 'library' ? '.active' : ''), { href: '#/library' }, 'Library'),
    h('a.nav-link' + (section === 'controller' ? '.active' : ''), { href: '#/controller' }, 'Prompter'));
  const accountBtn = h('button.account-btn', { 'aria-label': 'Account and settings', 'aria-haspopup': 'menu' },
    (user?.displayName || user?.email || '?').trim().charAt(0).toUpperCase());
  accountBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAccountMenu(accountBtn);
  });
  const header = h('header.shell-header', {},
    h('a.brand', { href: '#/', 'aria-label': 'Lemonly Prompter home' },
      h('img.logo', { src: 'assets/lemonly-logo.svg', alt: '' }),
      h('span.brand-title', {}, title)),
    nav,
    DEMO_ENABLED ? h('span.demo-badge', {}, 'DEMO') : null,
    accountBtn);
  setView(h('div.shell.section-' + section, {}, header, main));
  document.title = `${title} · Lemonly Prompter`;
  unmount = mountFn(main);
}

function mountRolePicker() {
  const choose = (role) => ctx.switchRole(role);
  setView(h('div.center-screen', {},
    h('div.role-picker', {},
      h('img.logo-lg', { src: 'assets/lemonly-logo.svg', alt: 'Lemonly' }),
      h('h1', {}, 'Use this device as…'),
      h('div.role-buttons', {},
        h('button.role-btn', { onclick: () => choose('display') },
          h('span.role-ico', {}, '🖥'), h('strong', {}, 'Display'), h('span.muted', {}, 'The iPad in the prompter rig')),
        h('button.role-btn', { onclick: () => choose('controller') },
          h('span.role-ico', {}, '🎛'), h('strong', {}, 'Controller'), h('span.muted', {}, 'Drive the prompter from here'))),
      h('p.muted.small', {}, 'You can change this later in the account menu.'),
      h('button.btn.ghost', { onclick: () => ctx.signOut() }, 'Sign out'))));
  document.title = 'Lemonly Prompter';
}

let menuEl = null;
function closeAccountMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', onDocDown, true);
}
function onDocDown(e) {
  if (menuEl && !menuEl.contains(e.target)) closeAccountMenu();
}

function openAccountMenu(anchor) {
  closeAccountMenu();
  const role = getRole() || 'controller';
  const item = (label, fn, cls = '') => h('button.menu-item' + cls, {
    role: 'menuitem',
    onclick: () => {
      closeAccountMenu();
      fn();
    },
  }, label);
  menuEl = h('div.popover-menu.account-menu', { role: 'menu' },
    h('div.menu-info', {},
      h('strong', {}, user?.displayName || ''),
      h('span.muted', {}, user?.email || ''),
      h('span.muted', {}, `This device: ${getDeviceName('controller', firstName(user))}`)),
    item('Rename this device…', async () => {
      const v = await promptDialog({ title: 'Device name', value: getDeviceName('controller', firstName(user)), confirmLabel: 'Save' });
      if (v) {
        setDeviceName('controller', v);
        refreshPresence();
      }
    }),
    item('Use as display', () => ctx.switchRole('display')),
    role !== 'controller' || isDesktop() ? item('Use as controller', () => ctx.switchRole('controller')) : null,
    item('New session (reset settings)', async () => {
      const ok = await confirmDialog({
        title: 'Start a new session?',
        message: 'Resets text size, line spacing, speed, and flips to the defaults. The script and place stay.',
        confirmLabel: 'New session',
      });
      if (ok) {
        cmd.newSession();
        toast('New session started');
      }
    }),
    item('Sign out', () => ctx.signOut()),
    h('div.menu-foot.muted', {}, `Version ${APP_VERSION}`));
  document.body.append(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = `${r.bottom + 6}px`;
  menuEl.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
}

// Surface unexpected errors instead of failing silently.
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.code || e.reason?.message || '');
  if (msg.includes('permission')) toast("You don't have access to that data.", { error: true });
});

export { getUser };
