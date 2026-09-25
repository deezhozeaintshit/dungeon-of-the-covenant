// ui/screens.js — full-screen flows: loading, pause menu, death/respawn.
// All actions are callback-driven (no game logic inlined); the coordinator
// supplies onRespawn / onQuitToLobby / onOpenSettings.

const $ = (id) => document.getElementById(id);

// Real gameplay guidance + dungeon lore drawn from the game's quest,
// classes, and combo systems (Tar Bombs, Wing Wardens, Soul-Forge, relics).
const LORE_TIPS = [
  'Tar Bombs ignite when touched by fire — coat the floor, then burn it.',
  'Slay the West & East Wing Wardens to shatter Malakor’s Soul-Seals.',
  'Frozen enemies shatter for 250% damage under the Juggernaut’s hammer.',
  'The Dreadweaver’s Corpse Explosion turns fallen foes into toxic clouds.',
  'Dash grants invulnerability frames — roll straight through boss slams.',
  'Temper your weapon at the Soul-Forge mid-run for +25% damage.',
  'The Radiant Cleric’s Judgement Brand makes every teammate attack erupt.',
  'Smoke Veil grants 100% evasion — the perfect cover for a clutch revive.',
  'Shadowstep behind a target, then Eviscerate burning foes for 300% bonus.',
  'Wing mini-bosses drop relics. Relics are power you keep for the whole run.',
  'The War Horn freezes time for 10 seconds. Spend them wisely.',
  'AI companion bots fill empty party slots — you are never truly alone down here.',
];

function cycleTips(tipEl, state) {
  if (!tipEl) return;
  state.tipIdx = (state.tipIdx + 1) % LORE_TIPS.length;
  tipEl.textContent = LORE_TIPS[state.tipIdx];
}

// ---------------- loading ----------------
export function initLoadingScreen() {
  const screen = $('loading-screen');
  const fill = $('loading-progress-fill');
  const pct = $('loading-progress-text');
  const tipEl = $('loading-lore-tip');
  const state = { tipIdx: Math.floor(Math.random() * LORE_TIPS.length), tipTimer: null };
  if (tipEl) tipEl.textContent = LORE_TIPS[state.tipIdx];

  return {
    show() { screen?.classList.remove('hidden'); screen?.classList.add('active'); },
    hide() {
      screen?.classList.add('hidden');
      screen?.classList.remove('active');
      if (state.tipTimer) { clearInterval(state.tipTimer); state.tipTimer = null; }
    },
    setProgress(p, label) {
      const v = Math.max(0, Math.min(100, p));
      if (fill) fill.style.width = `${v}%`;
      if (pct) pct.textContent = label || `${Math.round(v)}%`;
    },
    startTips(intervalMs = 5000) {
      if (state.tipTimer || !tipEl) return;
      state.tipTimer = setInterval(() => cycleTips(tipEl, state), intervalMs);
    },
    nextTip() { cycleTips(tipEl, state); },
  };
}

// ---------------- pause ----------------
export function initPauseScreen({ onOpenSettings, onQuitToLobby } = {}) {
  const screen = $('pause-screen');
  const api = {
    isOpen: false,
    show() {
      if (!screen) return;
      screen.classList.remove('hidden');
      api.isOpen = true;
    },
    hide() {
      if (!screen) return;
      screen.classList.add('hidden');
      api.isOpen = false;
    },
    toggle() { api.isOpen ? api.hide() : api.show(); },
  };

  $('btn-resume')?.addEventListener('click', () => api.hide());
  $('btn-pause-settings')?.addEventListener('click', () => {
    api.hide();
    if (typeof onOpenSettings === 'function') onOpenSettings();
  });
  $('btn-pause-quit')?.addEventListener('click', () => {
    api.hide();
    if (typeof onQuitToLobby === 'function') onQuitToLobby();
  });
  $('btn-pause-open')?.addEventListener('click', () => api.show());

  // Escape toggles pause only when no modal/drawer is already open
  // (main.js owns Escape-to-close for popups; this runs alongside it).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.key !== 'p' && e.key !== 'P') return;
    if (e.key === 'Escape') {
      const popupOpen =
        document.querySelector('.modal-overlay:not(.hidden)') ||
        document.querySelector('.secret-card:not(.hidden)') ||
        document.querySelector('#settings-panel:not(.hidden)');
      if (popupOpen) return;
    }
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    api.toggle();
  });

  return api;
}

// ---------------- death / respawn ----------------
export function initDeathScreen({ onRespawn, onQuitToLobby } = {}) {
  const screen = $('death-screen');
  const statsEl = $('death-stats');
  const api = {
    isOpen: false,
    // stats: { damageDealt, kills, goldCollected, floor }
    show(stats = {}) {
      if (statsEl) {
        const rows = [];
        if (stats.damageDealt != null) rows.push(`<span>⚔️ Damage <strong>${Number(stats.damageDealt).toLocaleString()}</strong></span>`);
        if (stats.kills != null) rows.push(`<span>💀 Kills <strong>${Number(stats.kills).toLocaleString()}</strong></span>`);
        if (stats.goldCollected != null) rows.push(`<span>💰 Gold <strong>${Number(stats.goldCollected).toLocaleString()}</strong></span>`);
        if (stats.floor != null) rows.push(`<span>🏰 Floor <strong>${stats.floor}</strong></span>`);
        statsEl.innerHTML = rows.join('');
        statsEl.style.display = rows.length ? '' : 'none';
      }
      screen?.classList.remove('hidden');
      api.isOpen = true;
    },
    hide() {
      screen?.classList.add('hidden');
      api.isOpen = false;
    },
  };

  $('btn-respawn')?.addEventListener('click', () => {
    api.hide();
    if (typeof onRespawn === 'function') onRespawn();
  });
  $('btn-death-lobby')?.addEventListener('click', () => {
    api.hide();
    if (typeof onQuitToLobby === 'function') onQuitToLobby();
  });

  return api;
}

export function initScreens(opts = {}) {
  return {
    loading: initLoadingScreen(),
    pause: initPauseScreen(opts),
    death: initDeathScreen(opts),
  };
}

export default { initLoadingScreen, initPauseScreen, initDeathScreen, initScreens };
