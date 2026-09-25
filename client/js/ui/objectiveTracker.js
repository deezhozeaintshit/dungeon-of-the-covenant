// ui/objectiveTracker.js — Phase 2 workstream 5: HUD objective tracker panel.
// Renders server-authoritative objectives (objectives_update), primary
// highlight, progress bars/counts, completion banner + toast. Dark-fantasy
// styling consistent with ui/theme.js (Cinzel gold on obsidian).

import { COVENANT_THEME } from './theme.js?v=5.0';
import { objectiveLineFor } from './objectiveLine.mjs?v=5.1';

const T = COVENANT_THEME;

const TYPE_ICON = {
  SLAY_WARDEN: '⚔️',
  DESTROY_SHRINES: '💥',
  RECOVER_RELIC: '🏺',
  SURVIVE_AMBUSH: '🛡️'
};

function ensureStyles() {
  if (document.getElementById('objective-tracker-styles')) return;
  const st = document.createElement('style');
  st.id = 'objective-tracker-styles';
  st.textContent = `
    #objective-tracker {
      position: fixed; top: 78px; right: 12px; z-index: 5000;
      width: 304px; max-width: 86vw;
      background: ${T.panel};
      border: 1px solid ${T.panelLine};
      border-radius: 12px;
      box-shadow: 0 0 24px rgba(0, 0, 0, 0.6);
      color: ${T.parchment}; font-family: ${T.fontBody};
      overflow: hidden;
    }
    #objective-tracker.hidden { display: none; }
    #objective-tracker .ot-head {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; cursor: pointer; user-select: none;
      background: linear-gradient(180deg, rgba(212,175,55,0.14), transparent);
      border-bottom: 1px solid ${T.panelLine};
    }
    #objective-tracker .ot-head h3 {
      margin: 0; flex: 1;
      font-family: ${T.fontDisplay}; font-size: 13px; letter-spacing: 2px;
      color: ${T.gold};
    }
    #objective-tracker .ot-toggle {
      background: none; border: none; color: ${T.gold};
      font-size: 14px; cursor: pointer; padding: 2px 6px;
    }
    #objective-tracker .ot-list { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
    #objective-tracker .ot-list.collapsed { display: none; }
    #objective-tracker .ot-floor-tag {
      font-size: 10px; letter-spacing: 2px; color: ${T.parchmentDim};
      text-align: center; padding: 2px 0 0;
    }
    .ot-obj {
      border: 1px solid rgba(212, 175, 55, 0.22);
      border-radius: 8px; padding: 8px 10px;
      background: rgba(23, 16, 38, 0.75);
    }
    .ot-obj.primary {
      border: 1px solid ${T.gold};
      box-shadow: 0 0 14px rgba(212, 175, 55, 0.35), inset 0 0 18px rgba(212,175,55,0.08);
      background: rgba(35, 24, 12, 0.85);
    }
    .ot-obj.complete { border-color: ${T.heal}; opacity: 0.85; }
    .ot-obj.failed { border-color: ${T.blood}; opacity: 0.7; }
    .ot-name {
      font-family: ${T.fontDisplay}; font-size: 13px; font-weight: 700;
      color: ${T.parchment}; display: flex; align-items: center; gap: 6px;
    }
    .ot-obj.primary .ot-name { color: ${T.goldHi}; }
    .ot-obj.complete .ot-name { color: ${T.heal}; }
    .ot-obj.failed .ot-name { color: ${T.bloodHi}; }
    .ot-primary-tag {
      font-size: 9px; letter-spacing: 2px; color: #1a1005;
      background: linear-gradient(180deg, ${T.goldHi}, ${T.goldDim});
      border-radius: 4px; padding: 2px 6px; margin-left: auto; font-weight: 700;
    }
    .ot-state-tag {
      font-size: 9px; letter-spacing: 2px; border-radius: 4px;
      padding: 2px 6px; margin-left: auto; font-weight: 700;
    }
    .ot-obj.complete .ot-state-tag { color: #062b1a; background: ${T.heal}; }
    .ot-obj.failed .ot-state-tag { color: #fff; background: ${T.blood}; }
    .ot-desc { font-size: 11.5px; color: ${T.parchmentDim}; margin: 5px 0 7px; line-height: 1.45; }
    .ot-obj.complete .ot-desc { text-decoration: line-through; }
    .ot-bar-track {
      height: 8px; border-radius: 6px; overflow: hidden;
      background: rgba(6, 3, 9, 0.9);
      border: 1px solid rgba(212, 175, 55, 0.25);
    }
    .ot-bar-fill {
      height: 100%; width: 0%;
      background: linear-gradient(90deg, ${T.goldDim}, ${T.goldHi});
      box-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
      transition: width 0.4s ease;
    }
    .ot-obj.complete .ot-bar-fill { background: linear-gradient(90deg, #0f7a4d, ${T.heal}); }
    .ot-count {
      font-size: 11px; color: ${T.goldSoft}; margin-top: 4px;
      display: flex; justify-content: space-between;
    }
    .ot-timer { color: ${T.violetHi}; font-weight: 700; }
    /* Completion banner */
    #ot-complete-banner {
      position: fixed; inset: 0; z-index: 9500;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
    }
    #ot-complete-banner.hidden { display: none; }
    .ot-banner-card {
      text-align: center; padding: 30px 54px;
      background: rgba(10, 7, 18, 0.88);
      border: 2px solid ${T.gold};
      border-radius: 16px;
      box-shadow: 0 0 60px rgba(212, 175, 55, 0.55);
      animation: ot-banner-in 0.55s cubic-bezier(0.2, 1.4, 0.4, 1);
    }
    .ot-banner-card h2 {
      margin: 0 0 6px; font-family: ${T.fontDisplay};
      font-size: 26px; letter-spacing: 4px; color: ${T.goldHi};
      text-shadow: 0 0 20px rgba(255, 215, 0, 0.7);
    }
    .ot-banner-card .ot-banner-name {
      font-family: ${T.fontDisplay}; font-size: 18px; color: ${T.parchment};
      letter-spacing: 1px; margin-bottom: 8px;
    }
    .ot-banner-card .ot-banner-reward {
      font-size: 14px; color: ${T.goldSoft};
    }
    .ot-banner-card.banner-out { animation: ot-banner-out 0.5s ease forwards; }
    @keyframes ot-banner-in {
      0% { transform: scale(0.7); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes ot-banner-out {
      0% { transform: scale(1); opacity: 1; }
      100% { transform: scale(1.08); opacity: 0; }
    }
  `;
  document.head.appendChild(st);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function initObjectiveTracker({ game, network } = {}) {
  ensureStyles();
  const state = { objectives: [], floor: null, collapsed: false, bannerTimer: null };

  // ---------- panel ----------
  let panel = document.getElementById('objective-tracker');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'objective-tracker';
    panel.className = 'hidden';
    panel.setAttribute('aria-label', 'Covenant objectives');
    panel.innerHTML = `
      <div class="ot-head" id="ot-head">
        <h3>📜 OBJECTIVES</h3>
        <button class="ot-toggle" id="ot-toggle" title="Minimize / expand">−</button>
      </div>
      <div class="ot-floor-tag" id="ot-floor-tag"></div>
      <div class="ot-list" id="ot-list"></div>`;
    document.body.appendChild(panel);
    document.getElementById('ot-head').addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      document.getElementById('ot-list')?.classList.toggle('collapsed', state.collapsed);
      document.getElementById('ot-toggle').textContent = state.collapsed ? '+' : '−';
    });
  }

  // ---------- banner ----------
  let banner = document.getElementById('ot-complete-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'ot-complete-banner';
    banner.className = 'hidden';
    document.body.appendChild(banner);
  }

  function toast(text, kind = 'gold') {
    const hudToast = game && game.ui && game.ui.hud && game.ui.hud.toast;
    if (typeof hudToast === 'function') { hudToast(text, kind); return; }
    const box = document.getElementById('event-toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `event-toast ${kind}`;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  function render() {
    const listEl = document.getElementById('ot-list');
    const tagEl = document.getElementById('ot-floor-tag');
    if (!listEl) return;
    const hudVisible = !document.getElementById('game-hud')?.classList.contains('hidden');
    if (!hudVisible || state.objectives.length === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    if (tagEl && state.floor != null) tagEl.textContent = `— FLOOR ${state.floor} —`;
    listEl.innerHTML = '';
    const ordered = [...state.objectives].sort((a, b) =>
      (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
    for (const o of ordered) {
      const pct = o.progress && o.progress.target > 0
        ? Math.max(0, Math.min(100, (o.progress.current / o.progress.target) * 100)) : 0;
      const icon = TYPE_ICON[o.type] || '🎯';
      const tag = o.primary
        ? `<span class="ot-primary-tag">PRIMARY</span>`
        : o.state === 'complete'
          ? `<span class="ot-state-tag">✓ DONE</span>`
          : o.state === 'failed'
            ? `<span class="ot-state-tag">✕ FAILED</span>` : '';
      let countLine;
      if (o.type === 'SURVIVE_AMBUSH' && o.timeRemaining != null && o.state === 'active') {
        countLine = `<span class="ot-timer">⏳ ${o.timeRemaining}s remaining</span><span>${Math.round(pct)}%</span>`;
      } else if (o.type === 'RECOVER_RELIC' && o.state === 'active') {
        countLine = `<span>${o.carrierId ? '🏺 Carried — reach the Extraction Altar!' : '🏺 Relic awaits in the East Wing vault'}</span>`;
      } else {
        countLine = `<span>${o.progress.current} / ${o.progress.target}</span><span>${Math.round(pct)}%</span>`;
      }
      const row = document.createElement('div');
      row.className = `ot-obj${o.primary ? ' primary' : ''}${o.state === 'complete' ? ' complete' : ''}${o.state === 'failed' ? ' failed' : ''}`;
      row.innerHTML = `
        <div class="ot-name"><span aria-hidden="true">${icon}</span> ${escapeHtml(o.name)} ${tag}</div>
        <div class="ot-desc">${escapeHtml(o.description)}</div>
        <div class="ot-bar-track"><div class="ot-bar-fill" style="width:${pct}%"></div></div>
        <div class="ot-count">${countLine}</div>`;
      listEl.appendChild(row);
    }
  }

  function showBanner(objective, reward) {
    const card = document.createElement('div');
    card.className = 'ot-banner-card';
    card.innerHTML = `
      <h2>🏆 OBJECTIVE COMPLETE</h2>
      <div class="ot-banner-name">${escapeHtml(objective.name)}${objective.primary ? ' ★ PRIMARY' : ''}</div>
      <div class="ot-banner-reward">+${reward?.xp ?? 0} XP &nbsp;·&nbsp; 💰 bounty cache dropped</div>`;
    banner.innerHTML = '';
    banner.appendChild(card);
    banner.classList.remove('hidden');
    if (state.bannerTimer) clearTimeout(state.bannerTimer);
    state.bannerTimer = setTimeout(() => {
      card.classList.add('banner-out');
      setTimeout(() => banner.classList.add('hidden'), 500);
    }, 3000);
  }

  function applyObjectives(msg) {
    if (!msg || !Array.isArray(msg.objectives)) return;
    state.floor = msg.floor ?? state.floor;
    state.objectives = msg.objectives;
    render();
  }

  // ---------- subscriptions ----------
  if (network && typeof network.on === 'function') {
    network.on('objectives_update', applyObjectives);
    network.on('objective_complete', (msg) => {
      if (!msg || !msg.objective) return;
      const i = state.objectives.findIndex(o => o.id === msg.objective.id);
      if (i !== -1) state.objectives[i] = msg.objective;
      else state.objectives.push(msg.objective);
      render();
      showBanner(msg.objective, msg.reward);
      toast(`🏆 Objective complete: ${msg.objective.name} (+${msg.reward?.xp ?? 0} XP)`, 'gold');
      if (game && game.audio && typeof game.audio.playSFX === 'function') {
        try { game.audio.playSFX('powerup'); } catch (e) { /* best effort */ }
      }
    });
    network.on('objective_failed', (msg) => {
      if (!msg || !msg.objective) return;
      const i = state.objectives.findIndex(o => o.id === msg.objective.id);
      if (i !== -1) state.objectives[i] = msg.objective;
      render();
      toast(`💀 Objective failed: ${msg.objective.name}`, 'blood');
    });
    // New floor → server pushes fresh objectives_update; until then clear stale.
    network.on('procedural_floor_generated', () => {
      state.objectives = [];
      render();
    });
  }

  // Hide when leaving the dungeon (game-hud hidden = lobby/menu).
  const hudEl = document.getElementById('game-hud');
  if (hudEl && window.MutationObserver) {
    new MutationObserver(() => render()).observe(hudEl, {
      attributes: true, attributeFilter: ['class']
    });
  }

  return {
    setObjectives: (objectives, floor) => {
      state.objectives = Array.isArray(objectives) ? objectives : [];
      if (floor != null) state.floor = floor;
      render();
    },
    clear: () => { state.objectives = []; state.floor = null; render(); },
    render,
    // Track 3 UX: one-line "what to do right now" for the persistent top
    // objective line (#hud-quest-text). Driven by the real objective state;
    // returns null when there is nothing to summarize so callers fall back
    // to the legacy quest-flow text.
    getCurrentLine: () => objectiveLineFor(state.objectives)
  };
}

export default { initObjectiveTracker };
