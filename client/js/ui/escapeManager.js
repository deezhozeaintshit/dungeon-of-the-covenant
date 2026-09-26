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

export function registerEscapeLayer(layer) {
  if (!layer || typeof layer.isOpen !== 'function' || typeof layer.close !== 'function') {
    throw new Error('[escapeManager] layer needs { id, isOpen(), close() }');
  }
  const entry = {
    id: String(layer.id || 'layer'),
    isOpen: layer.isOpen,
    close: layer.close,
    priority: typeof layer.priority === 'number' ? layer.priority : 50,
  };
  layers.push(entry);
  return function unregister() {
    const i = layers.indexOf(entry);
    if (i !== -1) layers.splice(i, 1);
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

export function initEscapeManager({ togglePause } = {}) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (!e || e.key !== 'Escape') return;
    if (isTypingTarget(e)) return; // typing wins

    let top = null;
    for (const l of layers) {
      let open = false;
      try { open = !!l.isOpen(); } catch (err) { open = false; }
      if (open && (!top || l.priority > top.priority)) top = l;
    }

    if (top) {
      e.preventDefault();
      e.stopPropagation();
      try { top.close(); } catch (err) { console.warn('[escapeManager] close failed:', top.id, err); }
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

export default { registerEscapeLayer, unregisterAllEscapeLayers, initEscapeManager, isRunActive };
