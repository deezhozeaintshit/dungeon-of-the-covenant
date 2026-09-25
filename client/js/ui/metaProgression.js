// ui/metaProgression.js — Covenant Vault UI: persistent account progression.
//
// Wires into main.js via:
//   import { initMetaProgression } from './ui/metaProgression.js';
//   this.metaUI = initMetaProgression({
//     network, hud: this.ui && this.ui.hud,
//     getAuthToken: () => this.authToken,
//     onState: (state) => this.applyMetaClassLocks()
//   });
//   for (const [type, cb] of Object.entries(this.metaUI.handlers)) this.network.on(type, cb);
//   this.metaUI.refresh(); // after login / on lobby show
//
// Server messages handled: class_choice_denied, meta_rewards.
// REST: GET /api/meta/state, POST /api/meta/purchase, POST /api/meta/boons.
//
// WCAG 2.1 AA: the vault is a real dialog (role=dialog, aria-modal), all
// actions are native <button>s, focus is trapped while open and restored on
// close, Escape closes, tabs use roving arrow-key navigation, purchase
// results are announced via an aria-live region, and all text meets 4.5:1
// contrast on the covenant dark background.

import { COVENANT_THEME } from './theme.js';

const T = COVENANT_THEME;

const css = (el, styles) => Object.assign(el.style, styles);
const mk = (tag, html = '', styles = {}) => {
  const n = document.createElement(tag);
  if (html) n.innerHTML = html;
  css(n, styles);
  return n;
};

const TAB_DEFS = [
  { id: 'classes', label: '⚔️ Hero Classes', title: 'Unlockable hero classes' },
  { id: 'boons', label: '✨ Starting Boons', title: 'Run-start boons' },
  { id: 'stash', label: '📦 Stash Tabs', title: 'Account stash tabs' }
];

function injectStyles() {
  if (document.getElementById('meta-vault-styles')) return;
  const s = document.createElement('style');
  s.id = 'meta-vault-styles';
  s.textContent = `
    .meta-vault-btn:focus-visible, .meta-vault-tab:focus-visible,
    .meta-vault-card button:focus-visible, .meta-vault-close:focus-visible,
    .class-btn.locked:focus-visible { outline: 3px solid ${T.goldHi}; outline-offset: 2px; }
    .class-btn.locked { position: relative; opacity: 0.72; }
    .class-btn.locked .class-lock { position: absolute; top: 6px; right: 8px; font-size: 18px; }
    .class-btn.locked .class-lock-req { display: block; font-size: 10px; color: ${T.goldSoft}; margin-top: 4px; }
    .meta-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  `;
  document.head.appendChild(s);
}

export function initMetaProgression({
  network = null,
  hud = null,
  getAuthToken = () => null,
  getLocalPlayerId = () => null,
  onState = null,
  onClaim = null
} = {}) {
  injectStyles();
  let state = null;          // { meta, catalog } from /api/meta/state
  let overlay = null;
  let activeTab = 'classes';
  let lastFocus = null;
  let liveRegion = null;

  const toast = (text, kind = 'info') => { if (hud && hud.toast) hud.toast(text, kind); };

  // ------------------------------------------------------------ state ------
  async function apiGet(path) {
    const token = getAuthToken();
    if (!token) { state = null; renderChips(); return null; }
    const res = await fetch(`${path}?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `request_failed_${res.status}`);
    return data;
  }

  async function apiPost(path, body = {}) {
    const token = getAuthToken();
    if (!token) throw new Error('not_logged_in');
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `request_failed_${res.status}`);
    return data;
  }

  async function refresh() {
    try {
      const data = await apiGet('/api/meta/state');
      state = data ? { meta: data.meta, catalog: data.catalog } : null;
    } catch (e) {
      state = null;
    }
    renderChips();
    if (onState) onState(state);
    return state;
  }

  function getState() { return state; }

  // ------------------------------------------------------------ chips ------
  function ensureLobbyChip() {
    const bar = document.getElementById('auth-account-summary');
    if (!bar || document.getElementById('meta-rank-chip')) return;
    const chip = mk('span', '', { whiteSpace: 'nowrap' });
    chip.id = 'meta-rank-chip';
    chip.innerHTML = `🕯️ Rank: <strong id="meta-rank-name">—</strong> <span id="meta-rank-xp" class="meta-dim"></span> &nbsp;•&nbsp; 🔏 Seals: <strong id="meta-seals-balance">0</strong>`;
    bar.appendChild(chip);
  }

  function ensureHudChip() {
    const hudEl = document.getElementById('game-hud');
    if (!hudEl || document.getElementById('meta-hud-chip')) return;
    const chip = mk('div', '', {
      position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 5500, pointerEvents: 'none', display: 'none',
      fontFamily: T.fontBody, fontSize: '12px', color: T.parchment,
      background: 'rgba(10,6,18,0.85)', border: `1px solid ${T.panelLine}`,
      borderRadius: '20px', padding: '4px 14px', letterSpacing: '0.06em'
    });
    chip.id = 'meta-hud-chip';
    chip.setAttribute('aria-label', 'Covenant rank');
    hudEl.appendChild(chip);
  }

  function renderChips() {
    ensureLobbyChip();
    ensureHudChip();
    const lobbyChip = document.getElementById('meta-rank-chip');
    const hudChip = document.getElementById('meta-hud-chip');
    if (!state || !state.meta) {
      if (lobbyChip) lobbyChip.style.display = 'none';
      if (hudChip) hudChip.style.display = 'none';
      return;
    }
    const { rank, seals } = state.meta;
    if (lobbyChip) {
      lobbyChip.style.display = '';
      const rn = document.getElementById('meta-rank-name');
      const rx = document.getElementById('meta-rank-xp');
      const sb = document.getElementById('meta-seals-balance');
      if (rn) rn.textContent = `${rank.icon} ${rank.name}`;
      if (rx) rx.textContent = rank.isMax ? '(max rank)' : `(${rank.xp.toLocaleString()} / ${(rank.xp + rank.xpToNext).toLocaleString()} XP)`;
      if (sb) sb.textContent = seals.toLocaleString();
    }
    if (hudChip) {
      hudChip.style.display = '';
      hudChip.textContent = `${rank.icon} ${rank.name} • 🔏 ${seals.toLocaleString()}`;
      hudChip.setAttribute('aria-label', `Covenant rank ${rank.name}, ${seals} seals`);
    }
  }

  // ------------------------------------------------------------ vault ------
  function announce(text) {
    if (liveRegion) liveRegion.textContent = text;
  }

  function closeVault() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (e) {}
    }
    lastFocus = null;
  }

  function focusables() {
    if (!overlay) return [];
    return Array.from(overlay.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(elm => elm.offsetParent !== null);
  }

  function trapTab(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeVault(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function renderCards(container) {
    container.innerHTML = '';
    const items = (state?.catalog || []).filter(u => {
      if (activeTab === 'classes') return u.type === 'class';
      if (activeTab === 'boons') return u.type === 'boon';
      return u.type === 'stash';
    });
    if (!items.length) {
      container.appendChild(mk('p', 'The Vault is silent. Nothing here yet.', { color: T.parchmentDim }));
      return;
    }
    for (const item of items) {
      container.appendChild(cardFor(item));
    }
  }

  function cardFor(item) {
    const card = mk('div', '', {
      border: `1px solid ${item.owned ? T.heal : T.panelLine}`, borderRadius: '10px',
      padding: '16px', background: 'rgba(10,6,18,0.88)',
      display: 'flex', flexDirection: 'column', gap: '8px'
    });
    card.className = 'meta-vault-card';

    const head = mk('div', '', { display: 'flex', alignItems: 'center', gap: '10px' });
    head.appendChild(mk('span', item.icon, { fontSize: '30px' }));
    const titleBox = mk('div');
    titleBox.appendChild(mk('div', item.name, {
      fontFamily: T.fontDisplay, color: T.goldHi, fontSize: '16px'
    }));
    titleBox.appendChild(mk('div', `Requires: ${item.rankName}`, {
      fontFamily: T.fontBody, color: item.rankOk ? T.parchmentDim : T.bloodHi, fontSize: '11px'
    }));
    head.appendChild(titleBox);
    card.appendChild(head);

    card.appendChild(mk('div', item.flavor, {
      fontFamily: T.fontBody, fontStyle: 'italic', color: T.violetHi, fontSize: '12px', lineHeight: '1.4'
    }));
    card.appendChild(mk('div', item.effect, {
      fontFamily: T.fontBody, color: T.parchment, fontSize: '13px', lineHeight: '1.45'
    }));

    const status = mk('div', '', {
      fontFamily: T.fontBody, fontSize: '12px', color: T.parchmentDim, minHeight: '18px'
    });

    const actionRow = mk('div', '', { display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' });

    if (item.owned) {
      status.innerHTML = `✅ <strong style="color:${T.heal}">CLAIMED</strong>`;
      if (item.type === 'boon') {
        const btn = mk('button',
          item.active ? 'Unequip boon' : 'Equip boon (run start)', {
            padding: '10px 16px', fontFamily: T.fontBody, fontSize: '13px',
            color: T.ink, background: item.active ? T.parchmentDim : T.gold,
            border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700'
          });
        btn.className = 'meta-vault-btn';
        btn.setAttribute('aria-pressed', item.active ? 'true' : 'false');
        btn.setAttribute('aria-label', `${item.active ? 'Unequip' : 'Equip'} boon ${item.name}`);
        btn.addEventListener('click', () => toggleBoon(item));
        actionRow.appendChild(btn);
      } else if (item.type === 'class') {
        status.innerHTML += ' — pick it on the class select screen.';
      } else {
        status.innerHTML += ` — stash capacity: ${state.meta.stashCapacity.totalSlots} slots.`;
      }
    } else {
      const cost = mk('div', `🔏 ${item.cost.toLocaleString()} seals`, {
        fontFamily: T.fontBody, fontSize: '13px', color: T.goldSoft, fontWeight: '700'
      });
      actionRow.appendChild(cost);
      const btn = mk('button', 'Claim from the Vault', {
        padding: '10px 16px', fontFamily: T.fontBody, fontSize: '13px',
        color: T.parchment, background: 'rgba(60,8,12,0.9)',
        border: `1px solid ${T.bloodHi}`, borderRadius: '8px', cursor: 'pointer', fontWeight: '700'
      });
      btn.className = 'meta-vault-btn';
      const blockedReason = !item.rankOk
        ? `Requires covenant rank ${item.rankName}`
        : (!item.affordable ? `Need ${item.cost.toLocaleString()} seals` : null);
      if (blockedReason) {
        btn.disabled = true;
        css(btn, { opacity: '0.45', cursor: 'not-allowed' });
        status.textContent = `🔒 ${blockedReason}`;
      } else {
        btn.setAttribute('aria-label', `Claim ${item.name} for ${item.cost} seals`);
        btn.addEventListener('click', () => purchase(item));
      }
      actionRow.appendChild(btn);
    }

    card.appendChild(status);
    card.appendChild(actionRow);
    return card;
  }

  async function purchase(item) {
    try {
      const data = await apiPost('/api/meta/purchase', { itemId: item.id });
      state = { meta: data.meta, catalog: data.catalog };
      renderChips();
      if (onState) onState(state);
      const panel = document.getElementById('meta-vault-cards');
      if (panel) renderCards(panel);
      announce(`${item.name} claimed.`);
      toast(`📜 ${item.name} claimed from the Covenant Vault!`, 'info');
      if (onClaim) onClaim(item);
    } catch (e) {
      const msg = e.message === 'not_logged_in'
        ? 'Log in to claim vault relics.'
        : `The Vault refuses: ${e.message}`;
      announce(msg);
      toast(`⛔ ${msg}`, 'danger');
    }
  }

  async function toggleBoon(item) {
    try {
      const active = new Set(state.meta.activeBoons || []);
      if (active.has(item.boonId)) active.delete(item.boonId);
      else {
        if (active.size >= (state.meta.maxActiveBoons || 2)) {
          toast(`⛔ Only ${state.meta.maxActiveBoons || 2} boons may be equipped — unequip one first.`, 'danger');
          return;
        }
        active.add(item.boonId);
      }
      const data = await apiPost('/api/meta/boons', { boonIds: [...active] });
      state = { meta: data.meta, catalog: data.catalog };
      const panel = document.getElementById('meta-vault-cards');
      if (panel) renderCards(panel);
      announce(`Boon loadout updated: ${data.meta.activeBoons.length} equipped.`);
      toast('✨ Boon loadout updated — takes effect on your next run.', 'info');
    } catch (e) {
      toast(`⛔ ${e.message}`, 'danger');
    }
  }

  function openVault(openerTab = 'classes') {
    if (!getAuthToken()) {
      toast('🔐 Log in to open the Covenant Vault.', 'danger');
      return;
    }
    closeVault();
    lastFocus = document.activeElement;
    activeTab = openerTab;

    overlay = mk('div', '', {
      position: 'fixed', inset: '0', zIndex: 9500,
      background: 'rgba(6,3,9,0.92)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '20px'
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'meta-vault-title');
    overlay.addEventListener('keydown', trapTab);

    const panel = mk('div', '', {
      maxWidth: '980px', width: '100%', maxHeight: '92vh', overflowY: 'auto',
      background: T.panel, border: `2px solid ${T.gold}`, borderRadius: '14px',
      padding: '26px 28px', boxShadow: '0 0 60px rgba(212,175,55,0.25), inset 0 0 40px rgba(0,0,0,0.6)'
    });

    const header = mk('div', '', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      marginBottom: '6px', gap: '12px'
    });
    const titleBox = mk('div');
    titleBox.appendChild(mk('div', 'THE COVENANT VAULT', {
      fontFamily: T.fontDisplay, color: T.goldHi, fontSize: '24px', letterSpacing: '0.08em'
    }));
    titleBox.id = 'meta-vault-title';
    const sub = state?.meta
      ? `${state.meta.rank.icon} ${state.meta.rank.name} — 🔏 ${state.meta.seals.toLocaleString()} seals`
      : 'Persistent account progression — earned across runs, never reset.';
    titleBox.appendChild(mk('div', sub, {
      fontFamily: T.fontBody, color: T.parchmentDim, fontSize: '13px', marginTop: '4px'
    }));
    header.appendChild(titleBox);

    const closeBtn = mk('button', '✕ Close', {
      padding: '10px 18px', fontFamily: T.fontBody, fontSize: '13px',
      color: T.parchment, background: 'transparent',
      border: `1px solid ${T.goldDim}`, borderRadius: '8px', cursor: 'pointer',
      flexShrink: '0'
    });
    closeBtn.className = 'meta-vault-close';
    closeBtn.setAttribute('aria-label', 'Close the Covenant Vault');
    closeBtn.addEventListener('click', closeVault);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    panel.appendChild(mk('div',
      'Seals are earned from <b>completed runs</b> — kills, objectives, bosses, and victories feed the Vault. ' +
      'Unlocked classes appear on the class select screen; boons strike at the start of your next run.', {
        fontFamily: T.fontBody, color: T.parchmentDim, fontSize: '13px',
        marginBottom: '16px', lineHeight: '1.5'
      }));

    // Tabs
    const tablist = mk('div', '', { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' });
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Vault categories');
    const tabBtns = [];
    for (const t of TAB_DEFS) {
      const b = mk('button', t.label, {
        padding: '10px 18px', fontFamily: T.fontBody, fontSize: '13px', fontWeight: '700',
        color: T.parchment, background: 'rgba(20,10,30,0.9)',
        border: `1px solid ${T.panelLine}`, borderRadius: '8px', cursor: 'pointer'
      });
      b.className = 'meta-vault-tab';
      b.setAttribute('role', 'tab');
      b.id = `meta-tab-${t.id}`;
      b.setAttribute('aria-selected', t.id === activeTab ? 'true' : 'false');
      b.setAttribute('aria-controls', 'meta-vault-cards');
      b.tabIndex = t.id === activeTab ? 0 : -1;
      b.addEventListener('click', () => selectTab(t.id));
      tablist.appendChild(b);
      tabBtns.push(b);
    }
    tablist.addEventListener('keydown', (e) => {
      const idx = tabBtns.findIndex(b => b.id === `meta-tab-${activeTab}`);
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabBtns.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tabBtns.length) % tabBtns.length;
      else return;
      e.preventDefault();
      const id = TAB_DEFS[next].id;
      selectTab(id);
      document.getElementById(`meta-tab-${id}`)?.focus();
    });
    panel.appendChild(tablist);

    const cards = mk('div', '', {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '14px'
    });
    cards.id = 'meta-vault-cards';
    cards.setAttribute('role', 'tabpanel');
    cards.setAttribute('aria-label', 'Vault unlockables');
    panel.appendChild(cards);

    liveRegion = mk('div', '', {});
    liveRegion.className = 'meta-sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('role', 'status');
    panel.appendChild(liveRegion);

    function selectTab(id) {
      activeTab = id;
      for (const b of tabBtns) {
        const sel = b.id === `meta-tab-${id}`;
        b.setAttribute('aria-selected', sel ? 'true' : 'false');
        b.tabIndex = sel ? 0 : -1;
        css(b, {
          borderColor: sel ? T.goldHi : T.panelLine,
          boxShadow: sel ? '0 0 14px rgba(212,175,55,0.35)' : 'none'
        });
      }
      renderCards(cards);
    }

    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeVault(); });
    document.body.appendChild(overlay);
    selectTab(activeTab);
    refresh().then(() => {
      const subEl = titleBox.querySelector('div:last-child');
      if (subEl && state?.meta) {
        subEl.textContent = `${state.meta.rank.icon} ${state.meta.rank.name} — 🔏 ${state.meta.seals.toLocaleString()} seals`;
      }
      renderCards(cards);
    });
    closeBtn.focus();
  }

  // ------------------------------------------------------------ handlers ---
  const handlers = {
    class_choice_denied(msg) {
      const localId = getLocalPlayerId();
      if (localId && msg.playerId && msg.playerId !== localId) return;
      toast(`⛔ ${msg.reason || 'That class is sealed in the Covenant Vault.'}`, 'danger');
    },

    meta_rewards(msg) {
      const rewards = msg.rewards || [];
      const localId = getLocalPlayerId();
      const mine = rewards.find(r => !localId || r.playerId === localId) || rewards[0];
      if (mine) {
        toast(
          `🕯️ The covenant remembers: +${mine.accountXpGained} account XP, +${mine.sealsGained} seals` +
          (mine.rankUp ? ` — RANK UP: ${mine.rank.icon} ${mine.rank.name}!` : ''),
          mine.rankUp ? 'combo' : 'info'
        );
      }
      refresh();
    }
  };

  return { handlers, refresh, openVault, getState, renderChips };
}

export default { initMetaProgression };
