// ui/relicClaim.js — Track 3 UX: boss-reward claim affordance.
//
// When Malakor's epic relic chest is on the floor, shows an unmissable
// contextual "TAP TO CLAIM" button (DOM, large touch target) that fires the
// 'claim_chest' tactical command. Walking over the chest remains the fallback
// (server updateFloorLoot). The chest also carries an in-world pulsing
// "TAP TO CLAIM" billboard (client/js/loot.js) and a golden light beam.
//
// WCAG 2.1 AA: real <button> semantics, visible focus, 48px touch target,
// high-contrast gold-on-obsidian, aria-live announcement on appearance.

const CLAIM_RANGE = 12.0; // mirrors server/game/Room.js claim_chest range

function ensureStyles() {
  if (document.getElementById('relic-claim-styles')) return;
  const st = document.createElement('style');
  st.id = 'relic-claim-styles';
  st.textContent = `
    #relic-claim-btn {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(72px + var(--safe-b, 0px));
      z-index: 6000;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 52px;
      padding: 12px 22px;
      max-width: 92vw;
      font-family: Cinzel, 'Times New Roman', serif;
      font-size: 1rem; font-weight: 800; letter-spacing: 1px;
      color: #1a0f2e;
      background: linear-gradient(180deg, #ffe9a3 0%, #ffd700 45%, #c9962e 100%);
      border: 2px solid #fff2b0;
      border-radius: 14px;
      box-shadow: 0 0 28px rgba(255, 215, 0, 0.65), 0 4px 18px rgba(0, 0, 0, 0.6);
      cursor: pointer;
      white-space: nowrap;
      animation: relic-claim-pulse 1.1s ease-in-out infinite;
    }
    #relic-claim-btn.far {
      background: linear-gradient(180deg, #3a2f1e 0%, #241b10 100%);
      color: #ffd700;
      border-color: #ffd700;
      animation: none;
    }
    #relic-claim-btn.hidden { display: none; }
    #relic-claim-btn:focus-visible {
      outline: 3px solid #ffffff;
      outline-offset: 3px;
    }
    @keyframes relic-claim-pulse {
      0%, 100% { box-shadow: 0 0 18px rgba(255, 215, 0, 0.45), 0 4px 18px rgba(0, 0, 0, 0.6); }
      50% { box-shadow: 0 0 38px rgba(255, 215, 0, 0.85), 0 4px 18px rgba(0, 0, 0, 0.6); }
    }
    @media (prefers-reduced-motion: reduce) {
      #relic-claim-btn { animation: none; }
    }
    @media (max-width: 480px) {
      #relic-claim-btn { font-size: 0.9rem; padding: 12px 16px; }
    }
  `;
  document.head.appendChild(st);
}

export function initRelicClaim({ game = null, network = null } = {}) {
  ensureStyles();

  let btn = document.getElementById('relic-claim-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'relic-claim-btn';
    btn.className = 'relic-claim-btn hidden';
    btn.type = 'button';
    btn.setAttribute('aria-live', 'polite');
    document.body.appendChild(btn);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const net = network || (game && game.network);
      if (!net || typeof net.send !== 'function') return;
      if (game && game.gameState && game.gameState !== 'dungeon') return;
      net.send({ type: 'tactical_command', command: 'claim_chest' });
      try { game && game.audio && game.audio.playSFX && game.audio.playSFX('chest'); } catch (_) { /* best effort */ }
    });
  }

  function hide() {
    btn.classList.add('hidden');
  }

  // snap: the server snapshot (players, floorLoot). Called per tick from main.js.
  function update(snap) {
    const hudVisible = !document.getElementById('game-hud')?.classList.contains('hidden');
    if (!hudVisible || !snap || !Array.isArray(snap.floorLoot)) { hide(); return; }

    const chest = snap.floorLoot.find(l => l.type === 'epic_chest' && !l.pickedUp);
    if (!chest) { hide(); return; }

    const localId = game && game.localPlayerId;
    const me = Array.isArray(snap.players) ? snap.players.find(p => p.id === localId) : null;
    if (!me) { hide(); return; }

    const dist = Math.hypot((chest.x || 0) - (me.x || 0), (chest.z || 0) - (me.z || 0));
    const inRange = dist <= CLAIM_RANGE;
    btn.classList.toggle('far', !inRange);
    btn.setAttribute('aria-label', inRange
      ? 'Tap to claim Malakor\'s Molten Relic chest'
      : `Relic chest ${Math.round(dist)} meters away. Move closer to claim it.`);
    btn.innerHTML = inRange
      ? '👆 TAP TO CLAIM — MOLTEN RELIC'
      : `🏃 GET CLOSER — ${Math.round(dist)}m`;
    // aria-live="polite" on the button announces the label change when it appears.
    btn.classList.remove('hidden');
  }

  return { update, hide };
}

export default { initRelicClaim };
