// ui/riftUI.js — Endless Rift client UI (Phase 4, workstream 4).
// ============================================================================
// Rift Gate portal (tier select + keystone/pact entry), in-rift HUD
// (tier badge + affix icons), and the tier-clear banner. Display-only: every
// number that matters (affixes, scaling, unlocks, keystones) arrives from the
// server; the client only renders state and sends { tier, payment }.
//
// WCAG 2.1 AA: real <button>s, role=dialog with aria-modal, labelled
// controls, Esc to close, visible focus states (see css/rift.css), and
// text contrast >= 4.5:1 on the dark-fantasy palette.

const AFFIX_CATALOG = {
  molten:     { icon: '🌋', name: 'Molten',     desc: 'Burning ground erupts beneath the party.' },
  frenzied:   { icon: '⚡', name: 'Frenzied',   desc: 'Enemies attack 45% faster.' },
  shielded:   { icon: '🛡️', name: 'Shielded',   desc: 'Enemies periodically raise absorb shields.' },
  vampiric:   { icon: '🩸', name: 'Vampiric',   desc: 'Enemies heal from damage they deal.' },
  volatile:   { icon: '💥', name: 'Volatile',   desc: 'Enemies detonate on death.' },
  relentless: { icon: '🗿', name: 'Relentless', desc: 'Enemies ignore stun, slow and fear.' },
  tyrannical: { icon: '👑', name: 'Tyrannical', desc: 'Bosses and elites: +100% HP, +35% DMG.' },
  swarming:   { icon: '🐀', name: 'Swarming',   desc: 'Foes may bring a twin.' }
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function initRiftUI({ network, getAuthToken, getPlayerName, getChosenClass } = {}) {
  const send = (msg) => { if (network) network.send(msg); };
  const state = {
    status: null,       // last rift_status payload
    selectedTier: 1,
    preview: null,      // last rift_tier_preview payload
    payment: 'keystone',
    inRift: false,
    lastFocus: null
  };

  // ---- Portal dialog -------------------------------------------------------
  const overlay = el('div', 'rift-overlay hidden');
  overlay.id = 'rift-portal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'rift-portal-title');
  overlay.innerHTML = `
    <div class="rift-panel">
      <div class="rift-panel-head">
        <h2 id="rift-portal-title">🌀 THE ENDLESS RIFT</h2>
        <button class="rift-close" id="rift-close" aria-label="Close the Rift Gate">✕</button>
      </div>
      <p class="rift-lore">Beyond the campaign the dark does not end — it <em>deepens</em>.
      Each tier compounds the enemy. Clear a tier to unseal the next. The gate
      demands a <strong>rift keystone</strong> — or a <strong>Rift Pact</strong> sworn in blood.</p>
      <div class="rift-keystones" id="rift-keystones" aria-live="polite"></div>
      <div id="rift-locked" class="rift-locked hidden"></div>
      <div id="rift-body" class="hidden">
        <h3 class="rift-h">SELECT TIER</h3>
        <div class="rift-tiers" id="rift-tiers" role="group" aria-label="Rift tiers"></div>
        <h3 class="rift-h">TIER AFFLICTIONS</h3>
        <div class="rift-preview" id="rift-preview" aria-live="polite"></div>
        <h3 class="rift-h">PAY THE GATE</h3>
        <div class="rift-pay" role="radiogroup" aria-label="Entry cost">
          <label class="rift-pay-opt"><input type="radio" name="rift-pay" value="keystone" checked>
            <span>🗝️ <strong>Rift Keystone</strong> — spend 1 keystone</span></label>
          <label class="rift-pay-opt"><input type="radio" name="rift-pay" value="pact">
            <span>⛓️ <strong>Rift Pact</strong> — −15% max HP, +10% damage taken, all run</span></label>
        </div>
        <div class="rift-error" id="rift-error" role="alert" aria-live="assertive"></div>
        <button class="btn btn-primary btn-large rift-enter" id="rift-enter">🌀 DESCEND</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (id) => overlay.querySelector(`#${id}`);
  const tiersEl = $('rift-tiers'), previewEl = $('rift-preview'),
    keystonesEl = $('rift-keystones'), errorEl = $('rift-error'),
    lockedEl = $('rift-locked'), bodyEl = $('rift-body');

  function refreshKeystones() {
    const k = state.status ? state.status.keystones : 0;
    keystonesEl.innerHTML = `🗝️ <strong>${k}</strong> keystone${k === 1 ? '' : 's'} &nbsp;•&nbsp; 🏆 best tier <strong>${state.status ? state.status.bestTier : 0}</strong>`;
  }

  function renderTiers() {
    tiersEl.innerHTML = '';
    const max = state.status ? state.status.unlockedTier : 0;
    const show = Math.min(max, 60);
    for (let t = 1; t <= show; t++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rift-tier-btn' + (t === state.selectedTier ? ' selected' : '');
      b.textContent = t;
      b.setAttribute('aria-label', `Rift tier ${t}`);
      b.setAttribute('aria-pressed', t === state.selectedTier ? 'true' : 'false');
      b.addEventListener('click', () => {
        state.selectedTier = t;
        errorEl.textContent = '';
        renderTiers();
        requestPreview();
      });
      tiersEl.appendChild(b);
    }
    if (max > show) {
      const more = el('span', 'rift-tiers-more', `+${max - show} more`);
      tiersEl.appendChild(more);
    }
  }

  function renderPreview() {
    const p = state.preview;
    if (!p || !p.ok) {
      previewEl.innerHTML = '<span class="rift-muted">Select a tier to scry its afflictions…</span>';
      return;
    }
    const chips = p.affixes.map(a => {
      const cat = AFFIX_CATALOG[a.id] || { icon: '❔', name: a.name, desc: a.desc };
      return `<span class="rift-affix-chip" title="${cat.name}: ${cat.desc}" aria-label="Affix ${cat.name}: ${cat.desc}" tabindex="0">
        <span aria-hidden="true">${cat.icon}</span> ${cat.name}</span>`;
    }).join('');
    const s = p.scaling;
    previewEl.innerHTML = `
      <div class="rift-affix-row">${chips}</div>
      <div class="rift-scale">Tier ${p.tier} — enemy HP <strong>×${s.hpMult}</strong> •
      damage <strong>×${s.dmgMult}</strong> • speed <strong>×${s.speedMult}</strong></div>
      ${p.allowed ? '' : `<div class="rift-warn">${p.reason || ''}</div>`}`;
    const enterBtn = $('rift-enter');
    if (enterBtn) enterBtn.disabled = !p.allowed;
  }

  function requestPreview() {
    state.preview = null;
    renderPreview();
    send({ type: 'rift_tier_preview', accountToken: getAuthToken && getAuthToken(), tier: state.selectedTier });
  }

  function refreshStatus() {
    send({ type: 'rift_status', accountToken: getAuthToken && getAuthToken() });
  }

  function renderStatus() {
    const st = state.status;
    refreshKeystones();
    if (!st || !st.ok) {
      lockedEl.classList.remove('hidden');
      lockedEl.textContent = (st && st.reason) || 'Link your covenant account to commune with the Rift.';
      bodyEl.classList.add('hidden');
      return;
    }
    if (!st.unlocked) {
      lockedEl.classList.remove('hidden');
      lockedEl.innerHTML = '🔒 <strong>The Rift is sealed.</strong><br>Defeat Malakor at the end of the campaign to earn your first rift keystone and unseal Tier 1.';
      bodyEl.classList.add('hidden');
      return;
    }
    lockedEl.classList.add('hidden');
    bodyEl.classList.remove('hidden');
    if (state.selectedTier > st.unlockedTier) state.selectedTier = st.unlockedTier;
    renderTiers();
    requestPreview();
  }

  function open() {
    state.lastFocus = document.activeElement;
    overlay.classList.remove('hidden');
    errorEl.textContent = '';
    refreshStatus();
    const close = $('rift-close');
    if (close) close.focus();
  }

  function close() {
    overlay.classList.add('hidden');
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  $('rift-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
  });
  overlay.querySelectorAll('input[name="rift-pay"]').forEach(r => {
    r.addEventListener('change', () => { state.payment = r.value; });
  });
  $('rift-enter').addEventListener('click', () => {
    errorEl.textContent = '';
    send({
      type: 'rift_start',
      accountToken: getAuthToken && getAuthToken(),
      tier: state.selectedTier,
      payment: state.payment,
      playerName: getPlayerName && getPlayerName(),
      chosenClass: getChosenClass && getChosenClass(),
      profile: null
    });
  });

  // ---- In-rift HUD ---------------------------------------------------------
  const hud = el('div', 'rift-hud hidden');
  hud.id = 'rift-hud';
  hud.setAttribute('role', 'status');
  hud.setAttribute('aria-label', 'Rift status');
  document.body.appendChild(hud);

  function showHud(tier, affixes, pact) {
    state.inRift = true;
    const chips = (affixes || []).map(a => {
      const id = typeof a === 'string' ? a : a.id;
      const cat = AFFIX_CATALOG[id] || { icon: '❔', name: id, desc: '' };
      return `<span class="rift-hud-chip" title="${cat.name}: ${cat.desc}" aria-label="Affix ${cat.name}: ${cat.desc}"><span aria-hidden="true">${cat.icon}</span></span>`;
    }).join('');
    hud.innerHTML = `<span class="rift-hud-tier">🌀 RIFT TIER ${tier}</span>${chips}` +
      (pact ? `<span class="rift-hud-pact" title="Rift Pact: −15% max HP, +10% damage taken" aria-label="Rift Pact active">⛓️</span>` : '');
    hud.classList.remove('hidden');
  }

  function hideHud() {
    state.inRift = false;
    hud.classList.add('hidden');
  }

  function syncHudFromSnapshot(snap) {
    if (snap && snap.rift && snap.rift.tier) {
      showHud(snap.rift.tier, snap.rift.affixes, snap.rift.pact);
    } else if (state.inRift) {
      hideHud();
    }
  }

  // ---- Tier-clear banner ----------------------------------------------------
  const banner = el('div', 'rift-banner hidden');
  banner.id = 'rift-banner';
  banner.setAttribute('role', 'alert');
  document.body.appendChild(banner);
  let bannerTimer = null;

  function showBanner(msg) {
    const lb = msg.leaderboard;
    banner.innerHTML = `
      <div class="rift-banner-card">
        <div class="rift-banner-title">🌀 RIFT TIER ${msg.tier} CLEARED</div>
        <div class="rift-banner-sub">in ${fmtTime(msg.clearTimeMs)} — Tier ${msg.tier + 1} unsealed</div>
        ${msg.dailyDelveBonus ? '<div class="rift-banner-bonus">🗝️ Daily delve bonus: +1 keystone</div>' : ''}
        ${lb && lb.rank ? `<div class="rift-banner-rank">🏆 Deepest-tier rank #${lb.rank} this week</div>` : ''}
      </div>`;
    banner.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add('hidden'), 9000);
  }

  // ---- Toast for keystone grants --------------------------------------------
  function toast(text) {
    const t = el('div', 'rift-toast', text);
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 5000);
  }

  const handlers = {
    rift_status: (msg) => {
      state.status = msg;
      if (!overlay.classList.contains('hidden')) renderStatus();
      refreshKeystones();
    },
    rift_tier_preview: (msg) => {
      state.preview = msg;
      renderPreview();
    },
    rift_started: (msg) => {
      close();
      showHud(msg.tier, msg.affixes, msg.pact);
      toast(`🌀 Descended into Rift Tier ${msg.tier} — ${msg.affixes.map(a => `${a.icon} ${a.name}`).join(' · ')}`);
    },
    rift_cleared: (msg) => {
      showBanner(msg);
      refreshStatus();
    },
    rift_denied: (msg) => {
      if (!overlay.classList.contains('hidden')) {
        errorEl.textContent = msg.reason || 'The gate rejects you.';
      } else {
        toast(`🌀 ${msg.reason || 'Rift entry denied.'}`);
      }
    },
    rift_keystone_granted: (msg) => {
      toast(`🗝️ ${msg.text || 'Rift keystone earned!'}`);
      refreshStatus();
    },
    // Snapshot-driven HUD sync (covers reconnects + late joins).
    room_joined: (msg) => syncHudFromSnapshot(msg.room),
    dungeon_started: (msg) => syncHudFromSnapshot(msg.snapshot)
  };

  return { open, close, refresh: refreshStatus, handlers };
}
