// hud-drawer-smoke.mjs — Track 2 headless smoke test.
// Covers the touch-only HUD drawer consolidation with a stub DOM:
// desktop builds nothing and moves nothing; touch builds the drawer and
// moves every secondary button into it (handlers are preserved because the
// nodes move); open/close/Esc/item-click/focus-restore behave per WCAG;
// restoring on touch-off returns every button to its original slot.
// Zero real DOM required; HudDrawerManager gets stub envs.
import {
  DRAWER_ITEM_IDS,
  MENU_BUTTON_ID,
  DRAWER_ID,
  DRAWER_LIST_ID,
  DRAWER_CLOSE_ID,
  DRAWER_SCRIM_ID,
  isDrawerTouchActive,
  HudDrawerManager,
  initHudDrawer
} from '../client/js/ui/hudDrawer.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) failures++;
}

// ---------- minimal stub DOM ----------
function makeClassList() {
  const s = new Set();
  return {
    add: (c) => { s.add(c); },
    remove: (c) => { s.delete(c); },
    contains: (c) => s.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !s.has(c) : !!force;
      if (on) s.add(c); else s.delete(c);
      return on;
    }
  };
}

function makeEl(id, doc) {
  const attrs = {};
  const listeners = {};
  const el = {
    id,
    tagName: id === 'hud-drawer' ? 'DIV' : 'BUTTON',
    parentNode: null,
    nextSibling: null,
    children: [],
    classList: makeClassList(),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k) => { delete attrs[k]; },
    hasAttribute: (k) => (k in attrs),
    appendChild(child) {
      if (child.parentNode && child.parentNode !== el && typeof child.parentNode.removeChild === 'function') {
        child.parentNode.removeChild(child);
      } else if (child.parentNode === el) {
        const i = el.children.indexOf(child);
        if (i >= 0) el.children.splice(i, 1);
      }
      el.children.push(child);
      child.parentNode = el;
      child.nextSibling = null;
      const prev = el.children[el.children.length - 2];
      if (prev) prev.nextSibling = child;
      return child;
    },
    insertBefore(child, ref) {
      if (child.parentNode && child.parentNode !== el && typeof child.parentNode.removeChild === 'function') {
        child.parentNode.removeChild(child);
      }
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i < 0) return el.appendChild(child);
      el.children.splice(i, 0, child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      child.nextSibling = null;
      return child;
    },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => {
      if (!listeners[t]) return;
      const i = listeners[t].indexOf(fn);
      if (i >= 0) listeners[t].splice(i, 1);
    },
    _fire: (t, evt) => { (listeners[t] || []).forEach((fn) => fn(evt)); },
    focus: () => { if (doc) doc.activeElement = el; },
    closest: (sel) => (sel === 'button' ? el : null),
    querySelectorAll: () => []
  };
  return el;
}

function makeDoc() {
  const doc = {
    body: null,
    activeElement: null,
    _byId: {},
    getElementById(id) { return this._byId[id] || null; },
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {}
  };
  doc.body = makeEl('body', doc);
  doc._byId.body = doc.body;
  return doc;
}

// Build the HUD skeleton the real index.html has: top bar with the
// secondary buttons in their original containers + drawer skeleton.
function makeHudDoc() {
  const doc = makeDoc();
  const topActions = makeEl('top-actions', doc);
  const topBar = makeEl('top-bar', doc);
  const partyWrapper = makeEl('party-wrapper', doc);
  const rightStackHead = makeEl('right-stack-head', doc);
  const gameHud = makeEl('game-hud', doc);
  topActions.parentNode = topBar; topBar.children.push(topActions);
  topBar.parentNode = gameHud; gameHud.children.push(topBar);
  partyWrapper.parentNode = topBar; topBar.children.push(partyWrapper);
  rightStackHead.parentNode = gameHud; gameHud.children.push(rightStackHead);

  const originals = {};
  const put = (id, parent) => {
    const el = makeEl(id, doc);
    doc._byId[id] = el;
    parent.appendChild(el);
    originals[id] = parent;
    return el;
  };
  // drawer skeleton (static markup from index.html)
  const menuBtn = put(MENU_BUTTON_ID, topActions);
  const scrim = put(DRAWER_SCRIM_ID, gameHud);
  const drawer = put(DRAWER_ID, gameHud);
  const closeBtn = put(DRAWER_CLOSE_ID, gameHud);
  const list = put(DRAWER_LIST_ID, gameHud);
  // drawer focusables: close button first
  drawer.querySelectorAll = () => [closeBtn];

  // secondary buttons in original homes (subset covers all containers)
  put('btn-war-horn', topBar);
  put('btn-min-party', partyWrapper);
  put('btn-clean-hud', topActions);
  put('btn-hud-emporium', topActions);
  put('btn-forge-toggle', topActions);
  put('btn-secret-toggle', topActions);
  put('btn-audio-toggle', topActions);
  put('btn-pause-open', topActions);
  put('btn-clip', topActions);
  put('btn-hud-lobby', topActions);
  put('btn-minimap-toggle', rightStackHead);
  put('btn-min-right-stack', rightStackHead);
  // 'hud-room-code-chip' intentionally absent: lazy-created by lobbyBrowser.js
  return { doc, originals, menuBtn, scrim, drawer, closeBtn, list, topActions, rightStackHead };
}

const noopWin = {}; // no MutationObserver: guarded best-effort path

// ---------- 1. pure gate ----------
check('gate: touch-active body => true', isDrawerTouchActive({ classList: makeClassList() && (() => { const c = makeClassList(); c.add('touch-active'); return c; })() }) === true);
check('gate: plain body => false', isDrawerTouchActive({ classList: makeClassList() }) === false);
check('gate: null body => false', isDrawerTouchActive(null) === false);

// ---------- 2. desktop: no moves, no wiring ----------
{
  const { doc, originals } = makeHudDoc();
  const mgr = initHudDrawer({ doc, win: noopWin });
  check('desktop: not built', mgr.built === false);
  let allHome = true;
  for (const id of DRAWER_ITEM_IDS) {
    const el = doc.getElementById(id);
    if (!el) continue; // lazy chip may not exist
    if (el.parentNode !== originals[id]) allHome = false;
  }
  check('desktop: every button stays in its original container', allHome);
  const drawer = doc.getElementById(DRAWER_ID);
  check('desktop: drawer never inert-toggled by us', !drawer.hasAttribute('inert'));
  check('desktop: sync is a no-op', mgr.sync() === false);
}

// ---------- 3. touch: build moves every secondary button ----------
{
  const { doc, originals, list } = makeHudDoc();
  doc.body.classList.add('touch-active');
  const mgr = initHudDrawer({ doc, win: noopWin });
  check('touch: built', mgr.built === true);
  let allMoved = true;
  for (const id of DRAWER_ITEM_IDS) {
    const el = doc.getElementById(id);
    if (!el) continue;
    if (el.parentNode !== list) { allMoved = false; console.log('  not moved: ' + id); }
    if (el.getAttribute('role')) { allMoved = false; console.log('  role overridden (breaks button semantics): ' + id); }
  }
  check('touch: all secondary buttons live in the drawer list', allMoved);
  const drawer = doc.getElementById(DRAWER_ID);
  check('touch: drawer starts closed+inert', drawer.hasAttribute('inert'));
  check('touch: drawer has no open class', !drawer.classList.contains('open'));
  // original containers keep their non-secondary children
  check('touch: menu button stays in top bar',
    doc.getElementById(MENU_BUTTON_ID).parentNode === originals[MENU_BUTTON_ID]);

  // ---------- 4. open / close / focus ----------
  doc.activeElement = doc.getElementById(MENU_BUTTON_ID); // user tapped the menu icon
  const menuBtn = doc.getElementById(MENU_BUTTON_ID);
  check('open: returns true', mgr.open() === true);
  check('open: opened state', mgr.isOpen() === true);
  check('open: drawer gets .open', drawer.classList.contains('open'));
  check('open: inert removed', !drawer.hasAttribute('inert'));
  check('open: aria-expanded true', menuBtn.getAttribute('aria-expanded') === 'true');
  check('open: scrim visible', doc.getElementById(DRAWER_SCRIM_ID).classList.contains('open'));
  check('open: focus moved into drawer', doc.activeElement === doc.getElementById(DRAWER_CLOSE_ID));

  // Esc closes and returns focus to the menu button
  mgr._handleKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  check('esc: closes', mgr.isOpen() === false);
  check('esc: .open removed', !drawer.classList.contains('open'));
  check('esc: inert restored', drawer.hasAttribute('inert'));
  check('esc: aria-expanded false', menuBtn.getAttribute('aria-expanded') === 'false');
  check('esc: focus returns to menu button', doc.activeElement === menuBtn);

  // ---------- 5. item click dismisses ----------
  doc.activeElement = menuBtn;
  mgr.open();
  const itemBtn = doc.getElementById('btn-clip');
  list._fire('click', { target: { closest: (sel) => (sel === 'button' ? itemBtn : null) } });
  check('item click: drawer dismisses after activation', mgr.isOpen() === false);

  // ---------- 6. menu button toggles ----------
  menuBtn._fire('click', {});
  check('menu click: opens', mgr.isOpen() === true);
  doc.getElementById(DRAWER_SCRIM_ID)._fire('click', {});
  check('scrim click: closes', mgr.isOpen() === false);
  doc.getElementById(DRAWER_CLOSE_ID)._fire('click', {});
  check('close button: opens? (was closed, stays closed)', mgr.isOpen() === false);
  menuBtn._fire('click', {});
  doc.getElementById(DRAWER_CLOSE_ID)._fire('click', {});
  check('close button: closes', mgr.isOpen() === false);

  // ---------- 7. touch off at runtime: exact restore ----------
  doc.body.classList.remove('touch-active');
  mgr.sync();
  check('restore: not built', mgr.built === false);
  let allBack = true;
  for (const id of DRAWER_ITEM_IDS) {
    const el = doc.getElementById(id);
    if (!el) continue;
    if (el.parentNode !== originals[id]) { allBack = false; console.log('  not restored: ' + id); }
  }
  check('restore: every button back in its original container', allBack);
  check('restore: drawer list empty', list.children.length === 0);
}

// ---------- 8. item ids sanity ----------
check('ids: includes war horn', DRAWER_ITEM_IDS.includes('btn-war-horn'));
check('ids: includes party', DRAWER_ITEM_IDS.includes('btn-min-party'));
check('ids: includes secret', DRAWER_ITEM_IDS.includes('btn-secret-toggle'));
check('ids: includes audio', DRAWER_ITEM_IDS.includes('btn-audio-toggle'));
check('ids: includes clip', DRAWER_ITEM_IDS.includes('btn-clip'));
check('ids: includes exit', DRAWER_ITEM_IDS.includes('btn-hud-lobby'));
check('ids: includes both map buttons',
  DRAWER_ITEM_IDS.includes('btn-minimap-toggle') && DRAWER_ITEM_IDS.includes('btn-min-right-stack'));
check('ids: includes invite chip', DRAWER_ITEM_IDS.includes('hud-room-code-chip'));
check('ids: includes pause menu', DRAWER_ITEM_IDS.includes('btn-pause-open'));
check('ids: next floor NOT consolidated', !DRAWER_ITEM_IDS.includes('btn-generate-floor'));

console.log(failures === 0 ? '\nALL HUD DRAWER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
