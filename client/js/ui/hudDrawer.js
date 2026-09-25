// hudDrawer.js — Track 2: touch-only consolidated HUD menu drawer.
//
// Problem: on phones the in-game HUD shows a dozen persistent buttons at
// once (party, UI, shop, forge, secret, audio, menu, clip, exit, map x2,
// war horn...). This module collapses those SECONDARY actions into a single
// expandable menu icon (☰). One tap opens a drawer containing the buttons;
// the rest of the HUD keeps only vitals, joystick, attack/ability buttons,
// the NEXT FLOOR prompt, and the menu icon.
//
// Desktop protection: every DOM move is gated on body.touch-active (the
// touch manager's class, see ui/touchControls.js). On non-touch bodies this
// module does nothing at all — markup, classes and handlers stay exactly as
// before. A MutationObserver re-syncs if the touch preference changes at
// runtime via Settings.
//
// Buttons are MOVED (appendChild), never cloned, so every existing handler
// wired by id in main.js / controls.js / clipUI.js / screens.js /
// minimapenhanced.js / lobbyBrowser.js keeps working unchanged.
//
// The class takes an injectable env (doc/win) so headless tests can stub it,
// following the touchControls.js pattern.

// Secondary HUD buttons that collapse into the drawer, in display order.
// 'hud-room-code-chip' is the lobbyBrowser.js invite chip; it is created
// lazily, so the sync tolerates it being absent at build time.
export const DRAWER_ITEM_IDS = [
  'btn-war-horn',
  'btn-min-party',
  'hud-room-code-chip',
  'btn-clean-hud',
  'btn-hud-emporium',
  'btn-forge-toggle',
  'btn-secret-toggle',
  'btn-audio-toggle',
  'btn-pause-open',
  'btn-clip',
  'btn-hud-lobby',
  'btn-minimap-toggle',
  'btn-min-right-stack'
];

export const MENU_BUTTON_ID = 'btn-hud-menu';
export const DRAWER_ID = 'hud-drawer';
export const DRAWER_LIST_ID = 'hud-drawer-list';
export const DRAWER_CLOSE_ID = 'btn-hud-drawer-close';
export const DRAWER_SCRIM_ID = 'hud-drawer-scrim';

// Pure helper: is the touch-gated drawer allowed to build on this body?
export function isDrawerTouchActive(body) {
  return !!(body && body.classList && typeof body.classList.contains === 'function' &&
    body.classList.contains('touch-active'));
}

function getEl(doc, id) {
  if (!doc || typeof doc.getElementById !== 'function') return null;
  return doc.getElementById(id) || null;
}

export class HudDrawerManager {
  constructor(env = {}) {
    this.doc = env.doc !== undefined ? env.doc : (typeof document !== 'undefined' ? document : null);
    this.win = env.win !== undefined ? env.win : (typeof window !== 'undefined' ? window : null);
    this.built = false;      // secondary buttons currently live in the drawer
    this.opened = false;
    this.moved = [];         // [{ el, parent, next }] for exact restore
    this.lastFocus = null;
    this._observer = null;
    this._hudObserver = null;
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onMenuClick = () => this.toggle();
    this._onCloseClick = () => this.close();
    this._onScrimClick = () => this.close();
    this._onItemClick = (e) => this._handleItemClick(e);
    this._wired = false;
  }

  // -- lifecycle -----------------------------------------------------------
  init() {
    if (!this.doc) return this;
    this.sync();
    // Re-sync if the touch preference flips at runtime (Settings toggle).
    try {
      const MO = this.win && this.win.MutationObserver;
      if (MO && this.doc.body) {
        this._observer = new MO(() => this.sync());
        this._observer.observe(this.doc.body, { attributes: true, attributeFilter: ['class'] });
      }
      // The invite chip is created lazily by lobbyBrowser.js; pick it up if
      // it lands in the top bar after we built the drawer.
      const topBar = this.doc.querySelector ? this.doc.querySelector('#game-hud .hud-top-bar') : null;
      if (MO && topBar) {
        this._hudObserver = new MO(() => this._adoptLateChip());
        this._hudObserver.observe(topBar, { childList: true });
      }
    } catch (_) { /* observers are best-effort; sync() is authoritative */ }
    return this;
  }

  sync() {
    const active = this.doc && isDrawerTouchActive(this.doc.body);
    if (active && !this.built) this.build();
    else if (!active && this.built) this.restore();
    return this.built;
  }

  // -- build / restore -----------------------------------------------------
  build() {
    if (this.built || !this.doc) return false;
    const list = getEl(this.doc, DRAWER_LIST_ID);
    if (!list) return false;
    for (const id of DRAWER_ITEM_IDS) {
      const el = getEl(this.doc, id);
      if (!el || !el.parentNode) continue;
      if (this.moved.some((m) => m.el === el)) continue; // already inside
      this.moved.push({ el, parent: el.parentNode, next: el.nextSibling || null });
      list.appendChild(el);
    }
    this._wire();
    // Start closed: inert + not focusable until opened.
    const drawer = getEl(this.doc, DRAWER_ID);
    if (drawer) drawer.setAttribute('inert', '');
    this.built = true;
    return true;
  }

  restore() {
    if (!this.built) return false;
    this.close(false);
    this._unwire();
    for (const { el, parent, next } of this.moved) {
      if (!el || !parent) continue;
      try {
        if (next && next.parentNode === parent) parent.insertBefore(el, next);
        else parent.appendChild(el);
      } catch (_) { /* best-effort restore */ }
    }
    this.moved = [];
    this.built = false;
    return true;
  }

  // Adopt the invite chip if lobbyBrowser.js created it after build().
  _adoptLateChip() {
    if (!this.built || !this.doc) return;
    const chip = getEl(this.doc, 'hud-room-code-chip');
    if (!chip || this.moved.some((m) => m.el === chip)) return;
    const list = getEl(this.doc, DRAWER_LIST_ID);
    if (!list || !chip.parentNode) return;
    this.moved.push({ el: chip, parent: chip.parentNode, next: chip.nextSibling || null });
    // Keep the chip's relative order: after party, before clean-hud.
    const anchor = getEl(this.doc, 'btn-clean-hud');
    if (anchor && anchor.parentNode === list) list.insertBefore(chip, anchor);
    else list.appendChild(chip);
  }

  // -- open / close / toggle -----------------------------------------------
  isOpen() { return this.opened; }

  toggle() {
    if (this.opened) this.close();
    else this.open();
    return this.opened;
  }

  open() {
    if (!this.built || this.opened || !this.doc) return false;
    const drawer = getEl(this.doc, DRAWER_ID);
    const scrim = getEl(this.doc, DRAWER_SCRIM_ID);
    const menuBtn = getEl(this.doc, MENU_BUTTON_ID);
    if (!drawer) return false;
    try { this.lastFocus = this.doc.activeElement || null; } catch (_) { this.lastFocus = null; }
    drawer.classList.add('open');
    drawer.removeAttribute('inert');
    if (scrim) scrim.classList.add('open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
    if (this.doc.addEventListener) this.doc.addEventListener('keydown', this._onKeyDown, true);
    this.opened = true;
    // WCAG: move focus into the dialog.
    const first = this._focusables()[0];
    if (first && typeof first.focus === 'function') {
      try { first.focus(); } catch (_) { /* focus is best-effort */ }
    }
    return true;
  }

  close(returnFocus = true) {
    if (!this.opened && returnFocus !== false) { /* fall through to reset state */ }
    if (!this.doc) { this.opened = false; return false; }
    const wasOpen = this.opened;
    const drawer = getEl(this.doc, DRAWER_ID);
    const scrim = getEl(this.doc, DRAWER_SCRIM_ID);
    const menuBtn = getEl(this.doc, MENU_BUTTON_ID);
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('inert', '');
    }
    if (scrim) scrim.classList.remove('open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    if (this.doc.removeEventListener) {
      try { this.doc.removeEventListener('keydown', this._onKeyDown, true); } catch (_) { /* ignore */ }
    }
    this.opened = false;
    // WCAG: Esc / close returns focus to the invoking control.
    if (returnFocus && wasOpen && this.lastFocus && typeof this.lastFocus.focus === 'function') {
      try { this.lastFocus.focus(); } catch (_) { /* ignore */ }
    } else if (returnFocus && wasOpen && menuBtn && typeof menuBtn.focus === 'function') {
      try { menuBtn.focus(); } catch (_) { /* ignore */ }
    }
    this.lastFocus = null;
    return wasOpen;
  }

  // -- events ----------------------------------------------------------------
  _wire() {
    if (this._wired || !this.doc) return;
    const menuBtn = getEl(this.doc, MENU_BUTTON_ID);
    const closeBtn = getEl(this.doc, DRAWER_CLOSE_ID);
    const scrim = getEl(this.doc, DRAWER_SCRIM_ID);
    const list = getEl(this.doc, DRAWER_LIST_ID);
    if (menuBtn && menuBtn.addEventListener) menuBtn.addEventListener('click', this._onMenuClick);
    if (closeBtn && closeBtn.addEventListener) closeBtn.addEventListener('click', this._onCloseClick);
    if (scrim && scrim.addEventListener) scrim.addEventListener('click', this._onScrimClick);
    if (list && list.addEventListener) list.addEventListener('click', this._onItemClick);
    this._wired = true;
  }

  _unwire() {
    if (!this._wired || !this.doc) return;
    const menuBtn = getEl(this.doc, MENU_BUTTON_ID);
    const closeBtn = getEl(this.doc, DRAWER_CLOSE_ID);
    const scrim = getEl(this.doc, DRAWER_SCRIM_ID);
    const list = getEl(this.doc, DRAWER_LIST_ID);
    if (menuBtn && menuBtn.removeEventListener) {
      try { menuBtn.removeEventListener('click', this._onMenuClick); } catch (_) { /* ignore */ }
    }
    if (closeBtn && closeBtn.removeEventListener) {
      try { closeBtn.removeEventListener('click', this._onCloseClick); } catch (_) { /* ignore */ }
    }
    if (scrim && scrim.removeEventListener) {
      try { scrim.removeEventListener('click', this._onScrimClick); } catch (_) { /* ignore */ }
    }
    if (list && list.removeEventListener) {
      try { list.removeEventListener('click', this._onItemClick); } catch (_) { /* ignore */ }
    }
    this._wired = false;
  }

  // A drawer item was activated: the item's own handler runs first (it was
  // wired by id long before the move), then the drawer dismisses itself.
  _handleItemClick(e) {
    if (!this.opened) return;
    const t = e && e.target;
    const btn = t && t.closest ? t.closest('button') : null;
    if (btn) this.close();
  }

  _focusables() {
    const drawer = getEl(this.doc, DRAWER_ID);
    if (!drawer || typeof drawer.querySelectorAll !== 'function') return [];
    try {
      return Array.from(drawer.querySelectorAll('button:not([disabled])'));
    } catch (_) { return []; }
  }

  _handleKeyDown(e) {
    if (!this.opened || !e) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;
    // Simple focus trap while the drawer is open.
    const items = this._focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.doc.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      if (typeof last.focus === 'function') last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      if (typeof first.focus === 'function') first.focus();
    }
  }
}

// Convenience: build + init in one call, mirroring initHUD().
export function initHudDrawer(env = {}) {
  const mgr = new HudDrawerManager(env);
  mgr.init();
  return mgr;
}

export default { initHudDrawer, HudDrawerManager, DRAWER_ITEM_IDS, isDrawerTouchActive };
