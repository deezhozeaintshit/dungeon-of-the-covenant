// js/ui/escapeManager.js — ONE Escape handler for the whole client.
//
// Problem it fixes: Escape was wired in ~9 places (window keydown in screens.js
// + main.js, document-capture in hudDrawer/clipUI/seasonPass/riftUI, element
// keydown in covenUI/metaProgression/tutorial). Two window handlers both fired
// on one press (main.js closed the modal, screens.js saw nothing open and
// toggled PAUSE on top), and several modals ignored Escape entirely.
//
// Contract:
//   registerEscapeLayer({ id, isOpen, close, priority }) -> unregister()
//     - `isOpen()` must be cheap and side-effect free.
//     - `close()` must hide the layer and restore focus where sensible.
//     - Higher `priority` closes first. Reserved bands:
//         100 = tutorial tooltip (blocks everything while active)
//          90 = full-screen modal dialogs (season pass, vault, rift, coven,
//               emporium, inventory, forge/secret panels, clip preview, drawer)
//          70 = pause screen
//          40 = dismissible banners (narrator, ping wheel)
//   While any layer is open, `menu-open` is toggled on document.body so the
//   touch controls drop below every menu in the CSS layer scale (a menu's
//   close button can never be buried under the joystick zone on phones).
//   closeAllEscapeLayers() dismisses every registered layer topmost-first
//   (never the tutorial) — called when a match starts.
//   initEscapeManager({ togglePause }) installs the single capture-phase
//     window listener. Priority order per press:
//       1. If focus is inside a text field/select/contenteditable, do nothing
//          (typing wins over dismissing).
//       2. Close the single highest-priority open layer (stopPropagation so
//          no legacy handler double-fires).
//       3. If nothing is open AND a run is active (game HUD visible), toggle
//          the pause screen. Escape never opens pause from the lobby/menus.
//
// WCAG 2.1 AA: every layer keeps its own focus-trap; close() implementations
// restore focus to the element that opened the layer.

const layers = [];

// --- menu-open body class -------------------------------------------------
// While at least one dismissible layer is open, the touch controls
// (#joystick-zone + .abilities-zone) drop below every menu in the CSS layer
// scale (see style.css: body.menu-open rules), so a menu's close button can
// never be buried under the joystick's invisible touch area on phones.

function anyLayerOpen() {
  for (const l of layers) {
    try { if (l.isOpen()) return true; } catch (_) { /* ignore */ }
  }
  return false;
}

export function updateMenuOpenClass() {
  if (typeof document === 'undefined' || !document.body || !document.body.classList) return;
  try {
    document.body.classList.toggle('menu-open', anyLayerOpen());
  } catch (_) { /* non-DOM environment */ }
}

export function registerEscapeLayer(layer) {
  if (!layer || typeof layer.isOpen !== 'function' || typeof layer.close !== 'function') {
    throw new Error('[escapeManager] layer needs { id, isOpen(), close() }');
  }
  const rawClose = layer.close;
  const entry = {
    id: String(layer.id || 'layer'),
    isOpen: layer.isOpen,
    // Wrap close so the menu-open class re-evaluates no matter which code
    // path dismissed the layer (Escape key, tap on X, scrim, item click...).
    close: function (...args) {
      try {
        return rawClose.apply(layer, args);
      } finally {
        updateMenuOpenClass();
      }
    },
    priority: typeof layer.priority === 'number' ? layer.priority : 50,
  };
  layers.push(entry);
  updateMenuOpenClass();
  return function unregister() {
    const i = layers.indexOf(entry);
    if (i !== -1) layers.splice(i, 1);
    updateMenuOpenClass();
  };
}

export function unregisterAllEscapeLayers() {
  layers.length = 0;
}

// True while a dungeon run is on screen (pause only makes sense then).
export function isRunActive() {
  const hud = document.getElementById('game-hud');
  return !!hud && !hud.classList.contains('hidden');
}

function isTypingTarget(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!(t.isContentEditable && t.isContentEditable);
}

let installed = false;

// Highest-priority open layer, or null. skipTutorial keeps the first-run
// tutorial out of bulk-dismiss paths (it is never auto-closed). `exclude`
// lets bulk-dismiss skip layers whose close() didn't take.
function topmostOpenLayer({ skipTutorial = false, exclude = null } = {}) {
  let top = null;
  for (const l of layers) {
    if (skipTutorial && l.id === 'tutorial') continue;
    if (exclude && exclude.has(l)) continue;
    let open = false;
    try { open = !!l.isOpen(); } catch (err) { open = false; }
    if (open && (!top || l.priority > top.priority)) top = l;
  }
  return top;
}

// The single guarded close path: same behavior whether the user pressed
// Escape, tapped an X, or the game dismissed layers on match start.
function closeLayer(top) {
  try { top.close(); } catch (err) { console.warn('[escapeManager] close failed:', top.id, err); }
  updateMenuOpenClass();
}

// Dismiss every registered dismissible layer, topmost-first, reusing the
// same guarded close path the Escape key uses. Used when a match starts so
// no menu, panel, drawer, or expanded minimap carries into the fight.
// Never touches the first-run tutorial; the HUD and damage numbers are not
// registered layers and are left alone.
export function closeAllEscapeLayers() {
  const exclude = new Set();
  for (let i = 0; i <= layers.length; i++) {
    const top = topmostOpenLayer({ skipTutorial: true, exclude });
    if (!top) break;
    closeLayer(top);
    // If close() didn't actually dismiss it (threw, or isOpen still true),
    // skip past it so one broken layer can't block the rest — or loop us.
    let stillOpen = false;
    try { stillOpen = !!top.isOpen(); } catch (_) { stillOpen = false; }
    if (stillOpen) exclude.add(top);
  }
  updateMenuOpenClass();
}

export function initEscapeManager({ togglePause } = {}) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (!e || e.key !== 'Escape') return;
    if (isTypingTarget(e)) return; // typing wins

    const top = topmostOpenLayer();

    if (top) {
      e.preventDefault();
      e.stopPropagation();
      closeLayer(top);
      return;
    }

    // Nothing open: pause toggle is a run-only action.
    if (!isRunActive()) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof togglePause === 'function') {
      try { togglePause(); } catch (err) { console.warn('[escapeManager] togglePause failed:', err); }
    }
  }, true); // capture: runs before every bubble/document handler, stops double-fire
}

export default { registerEscapeLayer, unregisterAllEscapeLayers, initEscapeManager, isRunActive, closeAllEscapeLayers, updateMenuOpenClass };
