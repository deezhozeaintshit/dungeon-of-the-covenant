// touchControls.js — Phase 4 Workstream 5: mobile touch controls layer.
//
// Responsibilities:
//   * Auto-detect touch-capable devices + manual preference (Auto / On / Off),
//     persisted to localStorage. Toggles the `touch-active` body class which
//     gates the touch layer (joystick zone + ability buttons) in CSS so it is
//     completely inert on non-touch desktop.
//   * Client-side optimistic cooldown sweeps for the touch ability buttons.
//     The server snapshot writer in main.js stays the source of truth; this
//     manager only fills the tap-to-first-snapshot latency gap using
//     per-action max cooldowns learned from server snapshots (falls back to
//     conservative maxima taken from server/game/Room.js).
//
// Pure helpers (detectTouchSupport, resolveTouchActive, computeStickVector,
// rotateInputByCameraYaw) are DOM-free so headless tests can import them.
// The class takes an injectable env so tests can stub document/window.

export const TOUCH_PREF_KEY = 'covenant_touch_controls_v1';
const VALID_PREFS = ['auto', 'on', 'off'];

// action -> cooldown overlay element id (mirrors client/index.html)
const ACTION_OVERLAY_IDS = {
  attack: 'attack-cd',
  skill1: 'skill-1-cd',
  skill2: 'skill-2-cd',
  skill3: 'skill-3-cd',
  dash: 'dash-cd',
  jump: 'jump-cd'
};

// Conservative fallback maxima (seconds) from server/game/Room.js per-class
// values: skill1 4.0-6.0, skill2 4.0-9.0, skill3 4.5-14.0, dash 3.0,
// attack 0.52, jump 0.65. Learned server values replace these at runtime.
const FALLBACK_MAX_CDS = {
  attack: 0.6,
  skill1: 6.0,
  skill2: 9.0,
  skill3: 14.0,
  dash: 3.0,
  jump: 0.65
};

export function detectTouchSupport(win, nav) {
  const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);
  const n = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : null);
  if (!w && !n) return false;
  const hasTouchStart = !!w && ('ontouchstart' in w);
  const maxTouch = !!n && typeof n.maxTouchPoints === 'number' && n.maxTouchPoints > 0;
  const msTouch = !!n && typeof n.msMaxTouchPoints === 'number' && n.msMaxTouchPoints > 0;
  return hasTouchStart || maxTouch || msTouch;
}

export function resolveTouchActive(pref, detected) {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return !!detected; // 'auto' (or anything unrecognized) follows detection
}

// Mirrors GameControls.updateStick math: screen-space drag -> normalized
// stick vector (x right, z down), dead zone + radius clamp.
export function computeStickVector(dx, dy, maxRadius = 55, deadZone = 6) {
  const dist = Math.hypot(dx, dy);
  if (dist <= deadZone) return { x: 0, z: 0 };
  const clamped = Math.min(dist, maxRadius);
  const angle = Math.atan2(dy, dx);
  return {
    x: (Math.cos(angle) * clamped) / maxRadius,
    z: (Math.sin(angle) * clamped) / maxRadius
  };
}

// Mirrors GameControls.update camera-relative transform: stick-space -> world.
export function rotateInputByCameraYaw(rx, rz, yaw = 0) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: rx * cos + rz * sin,
    z: -rx * sin + rz * cos
  };
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export class TouchControlsManager {
  constructor(env = {}) {
    this.win = env.win !== undefined ? env.win : (typeof window !== 'undefined' ? window : null);
    this.doc = env.doc !== undefined ? env.doc : (typeof document !== 'undefined' ? document : null);
    this.nav = env.nav !== undefined ? env.nav : (typeof navigator !== 'undefined' ? navigator : null);
    this.storage = env.storage !== undefined ? env.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.preference = 'auto';
    this.detected = false;
    this.active = false;
    this.maxCooldowns = { ...FALLBACK_MAX_CDS };
    this.pending = new Map(); // action -> start timestamp (ms)
  }

  readPreference() {
    try {
      const raw = this.storage ? this.storage.getItem(TOUCH_PREF_KEY) : null;
      if (raw && VALID_PREFS.includes(raw)) return raw;
    } catch (_) { /* storage unavailable: fall through to auto */ }
    return 'auto';
  }

  init() {
    this.preference = this.readPreference();
    this.detected = detectTouchSupport(this.win, this.nav);
    this.apply();
    return this.active;
  }

  setPreference(pref) {
    if (!VALID_PREFS.includes(pref)) return this.preference;
    this.preference = pref;
    try {
      if (this.storage) this.storage.setItem(TOUCH_PREF_KEY, pref);
    } catch (_) { /* ignore persistence failures */ }
    this.apply();
    return this.preference;
  }

  apply() {
    this.active = resolveTouchActive(this.preference, this.detected);
    if (this.doc && this.doc.body && this.doc.body.classList) {
      this.doc.body.classList.toggle('touch-active', this.active);
    }
    return this.active;
  }

  isActive() {
    return this.active;
  }

  // Learn authoritative per-action max cooldowns from server snapshots so the
  // optimistic sweep uses real class values instead of the fallbacks.
  observeServerCooldowns(cds) {
    if (!cds || typeof cds !== 'object') return;
    for (const action of Object.keys(this.maxCooldowns)) {
      const v = Number(cds[action]);
      if (Number.isFinite(v) && v > this.maxCooldowns[action]) {
        this.maxCooldowns[action] = v;
      }
    }
  }

  // Called the moment a touch ability button fires. Starts an optimistic
  // cooldown sweep on the button overlay; server snapshots take over when
  // they arrive (same element, same format).
  markActionFired(action, atMs) {
    if (!this.isActive()) return false;
    if (!ACTION_OVERLAY_IDS[action]) return false;
    const start = typeof atMs === 'number' ? atMs : nowMs();
    this.pending.set(action, start);
    this.renderOverlay(action, this.maxCooldowns[action], this.maxCooldowns[action]);
    return true;
  }

  // Advance optimistic sweeps; call every frame with a monotonic timestamp.
  tick(atMs) {
    const now = typeof atMs === 'number' ? atMs : nowMs();
    for (const [action, start] of this.pending) {
      const max = this.maxCooldowns[action] || 0;
      const rem = max - (now - start) / 1000;
      if (rem <= 0.05 || max <= 0) {
        this.clearOverlay(action);
        this.pending.delete(action);
      } else {
        this.renderOverlay(action, rem, max);
      }
    }
  }

  // Same overlay format as the server-driven writer in main.js:
  // bottom-up fill height + remaining seconds text.
  renderOverlay(action, rem, max) {
    if (!this.doc) return;
    const id = ACTION_OVERLAY_IDS[action];
    const el = id ? this.doc.getElementById(id) : null;
    if (!el || !el.style) return;
    const pct = rem > 0.05 && max > 0 ? Math.min(100, (rem / max) * 100) : 0;
    el.style.height = `${pct}%`;
    el.textContent = rem > 0.1 ? `${rem.toFixed(1)}s` : '';
  }

  clearOverlay(action) {
    if (!this.doc) return;
    const id = ACTION_OVERLAY_IDS[action];
    const el = id ? this.doc.getElementById(id) : null;
    if (!el || !el.style) return;
    el.style.height = '0%';
    el.textContent = '';
  }
}
