// ui/seasonPass.js — PHASE 4 (workstream 1): Season Pass panel, Daily Delve
// banner, and weekly leaderboard panel.
//
// Wires into main.js via:
//   import { initSeasonPass } from './ui/seasonPass.js';
//   this.seasonUI = initSeasonPass({
//     network, hud: this.ui && this.ui.hud,
//     getAuthToken: () => this.authToken,
//     getPlayerName: () => ..., getChosenClass: () => ...,
//     mergeCosmeticDefs: (defs) => { ... },
//     onClaim: () => this.audio.playSFX('powerup')
//   });
//   this.seasonUI.refresh(); // after init / after login
//
// REST: GET /api/season/state, GET /api/pass/state, POST /api/pass/claim,
// POST /api/pass/checkout, GET/POST /api/pass/verify, GET /api/pass/cosmetics,
// GET /api/leaderboards. WS out: daily_delve_matchmaking.
//
// WCAG 2.1 AA: the pass/leaderboard panel is a real dialog (role=dialog,
// aria-modal), all actions are native <button>s, focus is trapped while open
// and restored on close, Escape closes, tabs use roving arrow-key navigation,
// claim/purchase results are announced via an aria-live region, and all text
// meets 4.5:1 contrast on the covenant dark background.

import { COVENANT_THEME } from './theme.js';

const T = COVENANT_THEME;

const css = (el, styles) => Object.assign(el.style, styles);
const mk = (tag, html = '', styles = {}) => {
  const n = document.createElement(tag);
  if (html) n.innerHTML = html;
  css(n, styles);
  return n;
};

const PASS_NOTICE = 'COSMETICS ONLY — NEVER PAY-TO-WIN';

function injectStyles() {
  if (document.getElementById('season-pass-styles')) return;
  const s = document.createElement('style');
  s.id = 'season-pass-styles';
  s.textContent = `
    #daily-delve-banner {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      width: 100%; margin: 10px 0; padding: 10px 16px;
      background: linear-gradient(135deg, rgba(45,20,77,0.92), rgba(10,7,18,0.95));
      border: 1px solid ${T.violet}; border-radius: 12px;
      color: ${T.parchment}; font-family: ${T.fontBody};
    }
    #daily-delve-banner .delve-title { font-family: ${T.fontDisplay}; color: ${T.goldHi};
      font-size: 15px; letter-spacing: 0.08em; }
    #daily-delve-banner .delve-meta { font-size: 12px; color: ${T.parchmentDim}; }
    #daily-delve-banner .delve-fastest { font-size: 12px; color: ${T.goldSoft}; }
    #btn-daily-delve, #btn-season-pass { cursor: pointer; }
    #daily-delve-banner button:focus-visible, #btn-season-pass:focus-visible,
    .pass-dialog button:focus-visible, .pass-dialog [role="tab"]:focus-visible {
      outline: 3px solid ${T.goldHi}; outline-offset: 2px;
    }
    .pass-overlay {
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(4,2,10,0.82); display: flex;
      align-items: center; justify-content: center; padding: 16px;
    }
    .pass-dialog {
      width: min(980px, 96vw); max-height: 92vh; overflow: auto;
      background: ${T.panel}; border: 1px solid ${T.panelLine}; border-radius: 14px;
      color: ${T.parchment}; font-family: ${T.fontBody}; padding: 20px 22px;
    }
    .pass-dialog h2 { font-family: ${T.fontDisplay}; color: ${T.goldHi}; margin: 0 0 4px; }
    .pass-notice {
      display: inline-block; margin: 8px 0; padding: 6px 12px;
      border: 1px solid ${T.gold}; border-radius: 8px; color: ${T.goldHi};
      font-weight: 700; letter-spacing: 0.06em; font-size: 12px;
    }
    .pass-tabs { display: flex; gap: 8px; margin: 12px 0; }
    .pass-tab {
      background: transparent; border: 1px solid ${T.panelLine}; color: ${T.parchment};
      border-radius: 8px; padding: 8px 16px; cursor: pointer; font-size: 14px;
    }
    .pass-tab[aria-selected="true"] { background: rgba(212,175,55,0.18); border-color: ${T.gold}; color: ${T.goldHi}; }
    .pass-tier {
      display: grid; grid-template-columns: 64px 1fr 1fr; gap: 10px; align-items: stretch;
      border: 1px solid rgba(212,175,55,0.18); border-radius: 10px;
      padding: 8px; margin: 6px 0; background: rgba(23,16,38,0.6);
    }
    .pass-tier.reached { border-color: ${T.goldDim}; }
    .pass-tier-num { font-family: ${T.fontDisplay}; color: ${T.goldSoft}; font-size: 14px;
      display: flex; flex-direction: column; justify-content: center; align-items: center; }
    .pass-tier-num small { color: ${T.parchmentDim}; font-family: ${T.fontBody}; font-size: 10px; }
    .pass-reward {
      border: 1px solid rgba(157,78,221,0.35); border-radius: 8px; padding: 8px 10px;
      display: flex; gap: 10px; align-items: center; background: rgba(10,7,18,0.5);
    }
    .pass-reward .r-icon { font-size: 26px; }
    .pass-reward .r-name { font-weight: 700; color: ${T.parchment}; font-size: 13px; }
    .pass-reward .r-kind { font-size: 11px; color: ${T.parchmentDim}; }
    .pass-reward .r-state { margin-left: auto; font-size: 11px; }
    .pass-reward.claimed { opacity: 0.75; border-color: ${T.heal}; }
    .pass-reward.locked { opacity: 0.55; }
    .pass-claim-btn {
      background: rgba(212,175,55,0.2); border: 1px solid ${T.gold}; color: ${T.goldHi};
      border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 700;
    }
    .pass-buy-btn {
      background: linear-gradient(135deg, #d4af37, #8a6d2b); color: #0a0712;
      border: none; border-radius: 10px; padding: 10px 20px; cursor: pointer;
      font-weight: 800; font-size: 14px;
    }
    .lb-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .lb-table th, .lb-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(212,175,55,0.15); }
    .lb-table th { color: ${T.goldSoft}; font-family: ${T.fontDisplay}; letter-spacing: 0.05em; font-size: 12px; }
    .lb-table td { color: ${T.parchment}; }
    .lb-table tr.me td { color: ${T.goldHi}; font-weight: 700; }
    .pass-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .pass-progress { height: 10px; background: rgba(212,175,55,0.15); border-radius: 6px; overflow: hidden; }
    .pass-progress > div { height: 100%; background: linear-gradient(90deg, ${T.violet}, ${T.gold}); }
  `;
  document.head.appendChild(s);
}

export function initSeasonPass({
  network = null,
  hud = null,
  getAuthToken = () => null,
  getPlayerName = () => 'Hero',
  getChosenClass = () => 'juggernaut',
  mergeCosmeticDefs = null,
  onClaim = null
} = {}) {
  injectStyles();

  let seasonInfo = null;   // /api/season/state
  let passState = null;    // /api/pass/state (needs login)
  let boards = null;       // /api/leaderboards
  let overlay = null;
  let activeTab = 'pass';
  let activeBoard = 'daily_delve_speed';
  let lastFocus = null;
  let liveRegion = null;

  const toast = (text, kind = 'info') => { if (hud && hud.toast) hud.toast(text, kind); };
  const announce = (msg) => {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    requestAnimationFrame(() => { liveRegion.textContent = msg; });
  };

  // ------------------------------------------------------------ API --------
  async function apiGet(path, needsToken = false) {
    const token = getAuthToken();
    if (needsToken && !token) return null;
    const url = needsToken ? `${path}?token=${encodeURIComponent(token)}` : path;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `request_failed_${res.status}`);
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
    if (!res.ok || data.ok === false) throw new Error(data.error || `request_failed_${res.status}`);
    return data;
  }

  async function refresh() {
    try { seasonInfo = await apiGet('/api/season/state'); } catch (e) { seasonInfo = null; }
    try { passState = await apiGet('/api/pass/state', true); } catch (e) { passState = null; }
    try { boards = await apiGet('/api/leaderboards'); } catch (e) { boards = null; }
    try {
      const defs = await apiGet('/api/pass/cosmetics');
      if (defs && Array.isArray(defs.defs) && mergeCosmeticDefs) mergeCosmeticDefs(defs.defs);
    } catch (e) { /* cosmetics render is best-effort */ }
    renderBanner();
    renderSeasonChip();
    await maybeVerifyPassCheckout();
    return { seasonInfo, passState, boards };
  }

  // After a Stripe redirect back from a pass checkout, verify the session
  // server-side (the same verification the shop uses) and record premium.
  async function maybeVerifyPassCheckout() {
    let pending = null;
    try { pending = localStorage.getItem('covenant_pass_checkout'); } catch (e) { /* ignore */ }
    const params = new URLSearchParams(window.location.search);
    const success = params.get('stripe_success');
    const sessionId = params.get('session_id');
    if (!pending || success !== '1' || !sessionId) return;
    try { localStorage.removeItem('covenant_pass_checkout'); } catch (e) { /* ignore */ }
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/pass/verify?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token || '')}`);
      const data = await res.json().catch(() => ({}));
      if (data && data.ok && data.verified && data.premium) {
        toast('Season Pass premium unlocked — the premium track is yours.', 'success');
        announce('Season Pass premium unlocked.');
        if (data.pass) passState = data.pass;
        renderBanner();
        renderSeasonChip();
      } else {
        toast('Pass purchase could not be verified: ' + (data.error || 'unknown error'), 'error');
      }
    } catch (e) {
      toast('Pass purchase verification failed: ' + e.message, 'error');
    }
    // Clean the Stripe params out of the URL without reloading.
    params.delete('stripe_success');
    params.delete('session_id');
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '');
    window.history.replaceState({}, '', clean);
  }

  // ----------------------------------------------------- banner + chip ------
  function renderBanner() {
    const playActions = document.querySelector('.room-buttons.play-actions');
    if (!playActions) return;
    let banner = document.getElementById('daily-delve-banner');
    if (!banner) {
      banner = mk('div', '', { });
      banner.id = 'daily-delve-banner';
      banner.setAttribute('role', 'region');
      banner.setAttribute('aria-label', "Today's daily delve");
      const quickBtn = document.getElementById('btn-quickplay-match');
      if (quickBtn && quickBtn.parentElement === playActions) playActions.insertBefore(banner, quickBtn);
      else playActions.appendChild(banner);
    }
    const d = seasonInfo && seasonInfo.dailyDelve;
    const fastest = boards && boards.boards && boards.boards.daily_delve_speed;
    const best = fastest && fastest.entries && fastest.entries[0];
    banner.innerHTML = '';
    const title = mk('span', '🗡️ TODAY\u2019S DELVE', { className: 'delve-title' });
    title.className = 'delve-title';
    const meta = mk('span', '', { className: 'delve-meta' });
    meta.className = 'delve-meta';
    meta.textContent = d
      ? `Seed #${d.seed} — same dungeon for every hero today. ${seasonInfo.season.name}.`
      : 'The daily delve awakens…';
    const fast = mk('span', '', { className: 'delve-fastest' });
    fast.className = 'delve-fastest';
    if (best) fast.textContent = `⚡ Week's fastest: ${best.displayValue} — ${best.displayName}`;
    const btn = mk('button', '⚔️ ENTER TODAY\u2019S DELVE');
    btn.id = 'btn-daily-delve';
    btn.className = 'btn btn-primary';
    btn.setAttribute('aria-label', "Enter today's daily delve dungeon");
    btn.addEventListener('click', () => {
      if (!network) { toast('Not connected to the covenant server.', 'error'); return; }
      toast('Descending into today\u2019s delve…', 'info');
      network.dailyDelveMatchmaking(getPlayerName(), getChosenClass(), null, getAuthToken());
    });
    banner.append(title, meta, fast, btn);
  }

  function renderSeasonChip() {
    const bar = document.getElementById('auth-account-summary');
    if (!bar) return;
    let chip = document.getElementById('season-chip');
    if (!chip) {
      chip = mk('span');
      chip.id = 'season-chip';
      chip.className = 'account-chip'; // wraps inside the bar; see .account-bar-summary .account-chip
      bar.appendChild(chip);
      const passBtn = mk('button', '🎟️ SEASON PASS');
      passBtn.id = 'btn-season-pass';
      passBtn.className = 'btn btn-secondary';
      passBtn.setAttribute('aria-label', 'Open the season pass panel');
      passBtn.addEventListener('click', () => open());
      const playActions = document.querySelector('.room-buttons.play-actions');
      if (playActions && !document.getElementById('btn-season-pass')) {
        const vaultBtn = document.getElementById('btn-covenant-vault');
        if (vaultBtn) playActions.insertBefore(passBtn, vaultBtn);
        else playActions.appendChild(passBtn);
      }
    }
    if (!seasonInfo) { chip.style.display = 'none'; return; }
    chip.style.display = '';
    const s = seasonInfo.season;
    const tier = passState ? ` • Tier ${passState.tier}/20` : '';
    const xp = passState ? ` • ${passState.xp.toLocaleString('en-US')} season XP` : '';
    chip.innerHTML = `🌙 <strong>${escapeHtml(s.name)}</strong>${tier}${xp}`;
    chip.title = `Season ${s.id} — ends ${s.endISO.slice(0, 10)}`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ------------------------------------------------------------- dialog ----
  function trapFocus(e) {
    if (!overlay || e.key !== 'Tab') return;
    const focusables = overlay.querySelectorAll('button, [href], [role="tab"], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    close();
    lastFocus = document.activeElement;
    overlay = mk('div', '', { className: 'pass-overlay' });
    const dialog = mk('div', '', { className: 'pass-dialog' });
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Season pass and weekly leaderboards');
    overlay.appendChild(dialog);
    liveRegion = mk('div', '', { className: 'pass-sr-only' });
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    overlay.appendChild(liveRegion);

    const head = mk('div', '', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    const h2 = mk('h2', '🎟️ SEASON PASS');
    const closeBtn = mk('button', '✖ Close');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.setAttribute('aria-label', 'Close season pass panel');
    closeBtn.addEventListener('click', close);
    head.append(h2, closeBtn);
    dialog.appendChild(head);

    if (seasonInfo) {
      const s = seasonInfo.season;
      const sub = mk('p', '', { color: T.parchmentDim, fontSize: '13px', margin: '0 0 4px' });
      sub.textContent = `${s.name} — Season ${s.id} (ends ${s.endISO.slice(0, 10)})`;
      dialog.appendChild(sub);
    }
    const notice = mk('div', PASS_NOTICE, { className: 'pass-notice' });
    notice.setAttribute('role', 'note');
    dialog.appendChild(notice);

    const tabs = mk('div', '', { className: 'pass-tabs', role: 'tablist', 'aria-label': 'Season pass sections' });
    const tabDefs = [
      { id: 'pass', label: '🎟️ Pass Tiers' },
      { id: 'boards', label: '🏆 Weekly Leaderboards' }
    ];
    const tabBtns = [];
    tabDefs.forEach((td, i) => {
      const b = mk('button', td.label, { className: 'pass-tab' });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', td.id === activeTab ? 'true' : 'false');
      b.tabIndex = td.id === activeTab ? 0 : -1;
      b.addEventListener('click', () => { activeTab = td.id; syncTabs(tabBtns, tabDefs); renderBody(dialog); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const next = (i + dir + tabDefs.length) % tabDefs.length;
        activeTab = tabDefs[next].id;
        syncTabs(tabBtns, tabDefs);
        renderBody(dialog);
        tabBtns[next].focus();
      });
      tabBtns.push(b);
      tabs.appendChild(b);
    });
    dialog.appendChild(tabs);

    const body = mk('div', '', { id: 'pass-dialog-body' });
    body.setAttribute('role', 'tabpanel');
    dialog.appendChild(body);
    renderBody(dialog);

    overlay.addEventListener('keydown', trapFocus);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    closeBtn.focus();
  }

  function syncTabs(btns, defs) {
    btns.forEach((b, i) => {
      const sel = defs[i].id === activeTab;
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
      b.tabIndex = sel ? 0 : -1;
    });
  }

  function close() {
    if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
    overlay = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
    lastFocus = null;
  }

  function renderBody(dialog) {
    const body = dialog.querySelector('#pass-dialog-body');
    if (!body) return;
    body.innerHTML = '';
    if (activeTab === 'pass') renderPassTab(body);
    else renderBoardsTab(body);
  }

  // -------------------------------------------------------------- pass tab -
  function renderPassTab(body) {
    if (!getAuthToken()) {
      const p = mk('p', '🔐 Log in to track season XP and claim pass rewards. Season XP is earned from runs — victories, kills, and objectives all feed the pass.', { fontSize: '14px' });
      body.appendChild(p);
    }
    if (!passState) {
      const p = mk('p', 'The covenant ledger is unreachable. Check your connection and try again.', { fontSize: '14px', color: T.parchmentDim });
      body.appendChild(p);
      return;
    }

    const info = mk('div', '', { margin: '6px 0 12px' });
    const progText = passState.xpToNextTier == null
      ? `Tier ${passState.tier}/${passState.totalTiers} — MAX TIER — ${passState.xp.toLocaleString('en-US')} season XP`
      : `Tier ${passState.tier}/${passState.totalTiers} — ${passState.xp.toLocaleString('en-US')} season XP (${passState.xpToNextTier.toLocaleString('en-US')} to next tier)`;
    const progLabel = mk('p', escapeHtml(progText), { fontSize: '14px', margin: '0 0 6px' });
    info.appendChild(progLabel);
    const bar = mk('div', '', { className: 'pass-progress' });
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(passState.totalTiers * passState.xpPerTier));
    bar.setAttribute('aria-valuenow', String(Math.min(passState.xp, passState.totalTiers * passState.xpPerTier)));
    bar.setAttribute('aria-label', 'Season pass progress');
    const fill = mk('div', '');
    fill.style.width = `${Math.min(100, (passState.xp / (passState.totalTiers * passState.xpPerTier)) * 100)}%`;
    bar.appendChild(fill);
    info.appendChild(bar);
    const premiumLine = mk('p', passState.premium
      ? '✨ PREMIUM UNLOCKED — the premium track is yours this season.'
      : '🎟️ Premium track locked. Premium unlocks 20 extra cosmetics for this season.',
      { fontSize: '13px', color: passState.premium ? T.goldHi : T.parchmentDim });
    info.appendChild(premiumLine);
    if (!passState.premium) {
      const buy = mk('button', '🎟️ UNLOCK PREMIUM — $9.99 (this season)');
      buy.className = 'pass-buy-btn';
      buy.setAttribute('aria-label', 'Unlock the premium season pass track for 9 dollars 99, this season only');
      buy.addEventListener('click', buyPremium);
      info.appendChild(buy);
    }
    body.appendChild(info);

    const list = mk('div', '', { role: 'list', 'aria-label': 'Season pass tiers' });
    for (let t = 1; t <= passState.totalTiers; t++) {
      const free = passState.free[t - 1];
      const prem = passState.premiumTrack[t - 1];
      const row = mk('div', '', { className: 'pass-tier' + (t <= passState.tier ? ' reached' : ''), role: 'listitem' });
      const num = mk('div', `TIER ${t}<small>${free.xpRequired.toLocaleString('en-US')} XP</small>`, { className: 'pass-tier-num' });
      num.className = 'pass-tier-num';
      row.appendChild(num);
      row.appendChild(rewardCard(free, 'free', t));
      row.appendChild(rewardCard(prem, 'premium', t));
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  function rewardCard(entry, track, tier) {
    const r = entry.reward;
    const card = mk('div', '', { className: `pass-reward ${entry.state}` });
    const icon = mk('span', escapeHtml(r.icon || '❓'), { className: 'r-icon' });
    icon.className = 'r-icon';
    icon.setAttribute('aria-hidden', 'true');
    const txt = mk('div', '');
    const name = mk('div', escapeHtml(r.name || r.id), { className: 'r-name' });
    name.className = 'r-name';
    const kind = mk('div', `${track === 'free' ? 'Free' : 'Premium'} • ${kindLabel(r.kind)}`, { className: 'r-kind' });
    kind.className = 'r-kind';
    txt.append(name, kind);
    card.append(icon, txt);
    const state = mk('div', '', { className: 'r-state' });
    state.className = 'r-state';
    if (entry.state === 'claimed') {
      state.textContent = '✅ Claimed';
      state.setAttribute('aria-label', `${r.name}, tier ${tier} ${track}, claimed`);
    } else if (entry.state === 'locked') {
      state.textContent = '🔒 Locked';
    } else if (entry.state === 'premium_locked') {
      state.textContent = '🎟️ Premium';
    } else {
      const btn = mk('button', 'Claim');
      btn.className = 'pass-claim-btn';
      btn.setAttribute('aria-label', `Claim ${r.name}, tier ${tier} ${track} reward`);
      btn.addEventListener('click', () => claimReward(track, tier));
      state.appendChild(btn);
    }
    card.appendChild(state);
    return card;
  }

  function kindLabel(kind) {
    if (kind === 'skin') return 'Hero Skin';
    if (kind === 'weaponGlow') return 'Weapon Glow';
    if (kind === 'emote') return 'Emote';
    return 'Cosmetic';
  }

  async function claimReward(track, tier) {
    announce(`Claiming tier ${tier} ${track} reward…`);
    try {
      const data = await apiPost('/api/pass/claim', { track, tier });
      if (data.pass) passState = data.pass;
      const rw = data.reward || {};
      const msg = rw.alreadyOwned
        ? `${rw.name} claimed (already owned) — tier ${tier} ${track}.`
        : `${rw.icon || ''} ${rw.name} claimed! Check your hero.`;
      announce(msg);
      toast(msg, 'success');
      if (onClaim) { try { onClaim(); } catch (e) { /* ignore */ } }
      if (overlay) {
        const dialog = overlay.querySelector('.pass-dialog');
        if (dialog) renderBody(dialog);
      }
      renderSeasonChip();
    } catch (e) {
      announce('Claim failed: ' + e.message);
      toast('Claim failed: ' + e.message, 'error');
    }
  }

  async function buyPremium() {
    announce('Opening secure checkout for the Season Pass…');
    try {
      const data = await apiPost('/api/pass/checkout', {});
      if (!data.checkoutUrl) throw new Error('No checkout URL returned.');
      try { localStorage.setItem('covenant_pass_checkout', JSON.stringify({ at: Date.now() })); } catch (e) { /* ignore */ }
      window.location.href = data.checkoutUrl;
    } catch (e) {
      if (e.message === 'not_logged_in') {
        announce('Log in first to buy the Season Pass.');
        toast('Log in first to buy the Season Pass.', 'error');
      } else {
        announce('Checkout unavailable: ' + e.message);
        toast('Checkout unavailable: ' + e.message, 'error');
      }
    }
  }

  // ---------------------------------------------------------- boards tab ---
  const BOARD_ORDER = ['daily_delve_speed', 'rift_depth', 'season_xp'];

  function renderBoardsTab(body) {
    if (!boards || !boards.boards) {
      body.appendChild(mk('p', 'Leaderboards are unreachable right now.', { fontSize: '14px', color: T.parchmentDim }));
      return;
    }
    const week = mk('p', `Week ${escapeHtml(boards.weekId)} — resets weekly. All values measured server-side.`, { fontSize: '12px', color: T.parchmentDim });
    body.appendChild(week);
    const tabs = mk('div', '', { className: 'pass-tabs', role: 'tablist', 'aria-label': 'Leaderboard boards' });
    const btns = [];
    BOARD_ORDER.forEach((id, i) => {
      const b = boards.boards[id];
      if (!b || !b.ok) return;
      const btn = mk('button', escapeHtml(b.board.name), { className: 'pass-tab' });
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', id === activeBoard ? 'true' : 'false');
      btn.tabIndex = id === activeBoard ? 0 : -1;
      btn.addEventListener('click', () => { activeBoard = id; syncBoardTabs(btns, ids); renderBoardList(body); });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const next = (i + dir + ids.length) % ids.length;
        activeBoard = ids[next];
        syncBoardTabs(btns, ids);
        renderBoardList(body);
        btns[next].focus();
      });
      btns.push(btn);
      tabs.appendChild(btn);
    });
    const ids = BOARD_ORDER.filter(id => boards.boards[id] && boards.boards[id].ok);
    body.appendChild(tabs);
    const wrap = mk('div', '', { id: 'lb-list-wrap' });
    wrap.setAttribute('role', 'tabpanel');
    body.appendChild(wrap);
    renderBoardList(body);
  }

  function syncBoardTabs(btns, ids) {
    btns.forEach((b, i) => {
      const sel = ids[i] === activeBoard;
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
      b.tabIndex = sel ? 0 : -1;
    });
  }

  function renderBoardList(body) {
    const wrap = body.querySelector('#lb-list-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    const b = boards.boards[activeBoard];
    if (!b || !b.ok) {
      wrap.appendChild(mk('p', 'Board unavailable.', { fontSize: '14px' }));
      return;
    }
    const desc = mk('p', escapeHtml(b.board.description || ''), { fontSize: '12px', color: T.parchmentDim });
    wrap.appendChild(desc);
    if (!b.entries.length) {
      wrap.appendChild(mk('p', 'No entries this week — be the first to carve your name.', { fontSize: '14px' }));
      return;
    }
    const table = mk('table', '', { className: 'lb-table' });
    const myName = (getPlayerName() || '').toLowerCase();
    table.innerHTML = `<caption class="pass-sr-only">${escapeHtml(b.board.name)} standings</caption>
      <thead><tr><th scope="col">Rank</th><th scope="col">Hero</th><th scope="col">Result</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const e of b.entries) {
      const tr = document.createElement('tr');
      if (e.displayName && e.displayName.toLowerCase() === myName) tr.className = 'me';
      tr.innerHTML = `<td>${e.rank}</td><td>${escapeHtml(e.displayName || e.username)}</td><td>${escapeHtml(e.displayValue)}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  return {
    refresh,
    open,
    close,
    getState: () => ({ seasonInfo, passState, boards })
  };
}
