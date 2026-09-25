// ui/covenUI.js — PHASE 4 (workstream 2): Coven panel.
//
// Server-authoritative: every action goes through /api/coven/* (account token
// in body) and the client only renders state. Live whispers ride the
// websocket: 'coven_chat' (new message) and 'coven_update' (roster/XP/rank
// changes) are subscribed via network.on(); 'coven_subscribe' is sent on
// connect and after login.
//
// Wires into main.js via:
//   import { initCovenUI } from './ui/covenUI.js';
//   this.covenUI = initCovenUI({ network, hud, getAuthToken: () => this.authToken });
//   for (const [type, cb] of Object.entries(this.covenUI.handlers)) this.network.on(type, (m) => cb(m));
//   this.covenUI.refresh();
//
// WCAG 2.1 AA: the panel is a real dialog (role=dialog, aria-modal) with
// focus trap + restore, Escape closes, tabs use arrow-key navigation with
// aria-selected, every action is a native <button>, form fields have real
// <label>s, the XP bar uses role=progressbar, new whispers and rank changes
// are announced via an aria-live region, and all text meets 4.5:1 contrast on
// the covenant dark background.

import { COVENANT_THEME } from './theme.js';

const T = COVENANT_THEME;

const RANK_LABEL = { founder: 'Founder', officer: 'Officer', member: 'Member' };
const RANK_ICON = { founder: '👑', officer: '⚔️', member: '🕯️' };

function injectStyles() {
  if (document.getElementById('coven-ui-styles')) return;
  const s = document.createElement('style');
  s.id = 'coven-ui-styles';
  s.textContent = `
    .coven-overlay {
      position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center;
      background: rgba(6, 3, 9, 0.82); backdrop-filter: blur(3px); padding: 16px;
    }
    .coven-dialog {
      width: min(760px, 96vw); max-height: 92vh; display: flex; flex-direction: column;
      background: ${T.panel}; border: 1px solid ${T.panelLine}; border-radius: 14px;
      box-shadow: 0 0 60px rgba(157, 78, 221, 0.25), 0 0 24px rgba(212, 175, 55, 0.18);
      color: ${T.parchment}; font-family: ${T.fontBody}; overflow: hidden;
    }
    .coven-head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 18px; border-bottom: 1px solid rgba(212,175,55,0.25);
      background: linear-gradient(180deg, rgba(45,20,77,0.55), transparent);
    }
    .coven-title { font-family: ${T.fontDisplay}; color: ${T.goldHi}; font-size: 20px; letter-spacing: 0.06em; margin: 0; }
    .coven-sub { color: ${T.parchmentDim}; font-size: 13px; font-style: italic; }
    .coven-close {
      background: transparent; border: 1px solid ${T.goldDim}; color: ${T.goldHi};
      border-radius: 8px; width: 36px; height: 36px; font-size: 18px; cursor: pointer;
    }
    .coven-close:hover, .coven-close:focus-visible { border-color: ${T.goldHi}; box-shadow: 0 0 0 2px ${T.goldHi}; outline: none; }
    .coven-tabs { display: flex; gap: 4px; padding: 10px 14px 0; border-bottom: 1px solid rgba(212,175,55,0.2); }
    .coven-tab {
      background: transparent; border: none; border-bottom: 3px solid transparent; color: ${T.parchmentDim};
      font-family: ${T.fontDisplay}; font-size: 14px; letter-spacing: 0.04em; padding: 8px 14px; cursor: pointer;
    }
    .coven-tab[aria-selected="true"] { color: ${T.goldHi}; border-bottom-color: ${T.gold}; }
    .coven-tab:hover { color: ${T.goldSoft}; }
    .coven-tab:focus-visible { outline: 2px solid ${T.goldHi}; outline-offset: -2px; border-radius: 6px 6px 0 0; }
    .coven-body { padding: 16px 18px; overflow-y: auto; min-height: 280px; }
    .coven-btn {
      background: rgba(212,175,55,0.16); border: 1px solid ${T.gold}; color: ${T.goldHi};
      border-radius: 8px; padding: 7px 14px; cursor: pointer; font-size: 13px; font-weight: 700;
    }
    .coven-btn:hover:not(:disabled) { background: rgba(212,175,55,0.32); }
    .coven-btn:focus-visible { outline: 2px solid ${T.goldHi}; outline-offset: 2px; }
    .coven-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .coven-btn.danger { border-color: ${T.bloodHi}; color: ${T.bloodHi}; background: rgba(185,28,28,0.14); }
    .coven-btn.small { padding: 4px 10px; font-size: 12px; }
    .coven-field { margin-bottom: 12px; }
    .coven-field label { display: block; color: ${T.goldSoft}; font-size: 12px; letter-spacing: 0.05em; margin-bottom: 5px; font-weight: 700; }
    .coven-field input {
      width: 100%; box-sizing: border-box; background: rgba(6,3,9,0.7); border: 1px solid rgba(212,175,55,0.35);
      border-radius: 8px; color: ${T.parchment}; padding: 9px 12px; font-size: 14px;
    }
    .coven-field input:focus-visible { outline: 2px solid ${T.goldHi}; outline-offset: 1px; }
    .coven-err { color: ${T.bloodHi}; font-size: 13px; margin: 8px 0; min-height: 18px; }
    .coven-ok { color: ${T.heal}; font-size: 13px; margin: 8px 0; min-height: 18px; }
    .coven-xpbar { height: 14px; background: rgba(168,85,247,0.18); border: 1px solid rgba(168,85,247,0.45); border-radius: 8px; overflow: hidden; margin: 8px 0 4px; }
    .coven-xpbar > div { height: 100%; background: linear-gradient(90deg, ${T.violet}, ${T.xp}, ${T.gold}); transition: width 0.4s; }
    .coven-levelname { font-family: ${T.fontDisplay}; color: ${T.violetHi}; font-size: 16px; letter-spacing: 0.04em; }
    .coven-invite { font-family: monospace; font-size: 20px; letter-spacing: 0.35em; color: ${T.goldHi}; }
    .coven-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .coven-table th, .coven-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(212,175,55,0.15); }
    .coven-table th { color: ${T.goldSoft}; font-family: ${T.fontDisplay}; letter-spacing: 0.05em; font-size: 12px; }
    .coven-table td { color: ${T.parchment}; }
    .coven-table tr.me td { color: ${T.goldHi}; font-weight: 700; }
    .coven-rank-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid; }
    .coven-rank-founder { color: ${T.goldHi}; border-color: ${T.gold}; background: rgba(212,175,55,0.15); }
    .coven-rank-officer { color: ${T.violetHi}; border-color: ${T.violet}; background: rgba(157,78,221,0.15); }
    .coven-rank-member { color: ${T.parchmentDim}; border-color: rgba(203,184,157,0.4); background: rgba(203,184,157,0.08); }
    .coven-chatlog {
      height: 260px; overflow-y: auto; border: 1px solid rgba(212,175,55,0.25); border-radius: 10px;
      background: rgba(6,3,9,0.6); padding: 10px 12px; margin-bottom: 10px;
    }
    .coven-msg { margin-bottom: 8px; font-size: 13.5px; line-height: 1.45; }
    .coven-msg .who { color: ${T.goldSoft}; font-weight: 700; }
    .coven-msg .when { color: ${T.parchmentDim}; font-size: 11px; margin-left: 6px; }
    .coven-msg .text { color: ${T.parchment}; word-wrap: break-word; }
    .coven-chatrow { display: flex; gap: 8px; }
    .coven-chatrow input {
      flex: 1; background: rgba(6,3,9,0.7); border: 1px solid rgba(212,175,55,0.35);
      border-radius: 8px; color: ${T.parchment}; padding: 9px 12px; font-size: 14px;
    }
    .coven-chatrow input:focus-visible { outline: 2px solid ${T.goldHi}; outline-offset: 1px; }
    .coven-banner {
      border: 1px solid ${T.gold}; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px;
      background: linear-gradient(135deg, rgba(212,175,55,0.12), rgba(157,78,221,0.10)); font-size: 14px;
    }
    .coven-banner strong { color: ${T.goldHi}; }
    .coven-h3 { font-family: ${T.fontDisplay}; color: ${T.goldSoft}; font-size: 15px; letter-spacing: 0.05em; margin: 18px 0 8px; }
    .coven-hint { color: ${T.parchmentDim}; font-size: 12.5px; }
    .coven-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .coven-row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  `;
  document.head.appendChild(s);
}

export function initCovenUI({
  network = null,
  hud = null,
  getAuthToken = () => null
} = {}) {
  injectStyles();

  let state = null;        // /api/coven/state
  let overlay = null;
  let activeTab = 'roster';
  let lastFocus = null;
  let liveRegion = null;
  let chatAfter = 0;
  let msg = '';

  const toast = (text, kind = 'info') => { if (hud && hud.toast) hud.toast(text, kind); };
  const announce = (text) => {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    requestAnimationFrame(() => { liveRegion.textContent = text; });
  };
  const loggedIn = () => !!getAuthToken();

  // ------------------------------------------------------------ API --------
  async function apiGet(path) {
    const token = getAuthToken();
    const url = token ? `${path}?token=${encodeURIComponent(token)}` : path;
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

  function sendSubscribe() {
    const token = getAuthToken();
    if (!token || !network) return;
    try { network.send({ type: 'coven_subscribe', accountToken: token }); } catch (e) { /* offline */ }
  }

  async function refresh() {
    try {
      state = await apiGet('/api/coven/state');
    } catch (e) {
      state = null;
    }
    if (overlay) render();
    return state;
  }

  // --------------------------------------------------------- render --------
  function el(tag, cls, html) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function open() {
    if (overlay) { overlay.style.display = 'flex'; lastFocus = document.activeElement; trapFocus(); render(); return; }
    lastFocus = document.activeElement;
    overlay = el('div', 'coven-overlay');
    const dialog = el('div', 'coven-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Coven — your fellowship of the dark');
    dialog.innerHTML = `
      <div class="coven-head">
        <div>
          <h2 class="coven-title">🕯️ COVEN</h2>
          <div class="coven-sub">Bound by oath, fed by the delve.</div>
        </div>
        <button class="coven-close" data-act="close" aria-label="Close coven panel">✕</button>
      </div>
      <div class="coven-tabs" role="tablist" aria-label="Coven sections"></div>
      <div class="coven-body" role="tabpanel"></div>
      <div class="coven-sr-only" role="status" aria-live="polite"></div>
    `;
    liveRegion = dialog.querySelector('[role="status"]');
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) handleAction(act.dataset.act, act.dataset, e.target);
      const tab = e.target.closest('[data-tab]');
      if (tab) setTab(tab.dataset.tab);
    });
    render();
    sendSubscribe();
    trapFocus();
  }

  function close() {
    if (!overlay) return;
    overlay.style.display = 'none';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function trapFocus() {
    const dialog = overlay.querySelector('.coven-dialog');
    const focusables = dialog.querySelectorAll('button, input, [tabindex="0"]');
    if (focusables.length) focusables[0].focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      const dialog = overlay.querySelector('.coven-dialog');
      const items = [...dialog.querySelectorAll('button:not(:disabled), input, [tabindex="0"]')].filter(x => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    // Arrow-key tab navigation (roving).
    if (e.target.matches && e.target.matches('.coven-tab') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const tabs = [...overlay.querySelectorAll('.coven-tab')];
      let i = tabs.indexOf(e.target);
      i = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
      tabs[i].focus();
      setTab(tabs[i].dataset.tab);
    }
  }

  function setTab(tab) {
    activeTab = tab;
    render();
  }

  function tabsFor() {
    const inCoven = !!(state && state.inCoven);
    const tabs = [];
    if (inCoven) tabs.push(['roster', '🛡️ Roster'], ['ritewar', '⚔️ Rite War'], ['whispers', '💬 Whispers']);
    else tabs.push(['oath', '🤝 Swear the Oath'], ['ritewar', '⚔️ Rite War']);
    if (inCoven) tabs.push(['oath', '🕯️ Rites']);
    return tabs;
  }

  function render() {
    if (!overlay) return;
    const line = msg; msg = ''; // consumed once per render
    const tabsEl = overlay.querySelector('.coven-tabs');
    const body = overlay.querySelector('.coven-body');
    const tabs = tabsFor();
    if (!tabs.some(([id]) => id === activeTab)) activeTab = tabs[0][0];
    tabsEl.innerHTML = tabs.map(([id, label]) =>
      `<button class="coven-tab" role="tab" data-tab="${id}" aria-selected="${id === activeTab}" tabindex="${id === activeTab ? '0' : '-1'}">${label}</button>`
    ).join('');
    if (activeTab === 'roster') renderRoster(body, line);
    else if (activeTab === 'ritewar') renderRiteWar(body, line);
    else if (activeTab === 'whispers') renderWhispers(body, line);
    else renderOath(body, line);
    if (line) announce(line);
  }

  function msgLine(line) {
    return line ? `<div class="coven-msgline coven-sr-only">${escapeHtml(line)}</div>` : '';
  }

  // --------------------------------------------------------- roster --------
  function renderRoster(body, line) {
    const coven = state && state.coven;
    if (!coven) { body.innerHTML = `<p class="coven-hint">You belong to no coven. Swear the oath to begin.</p>`; return; }
    const myName = state && state.username;
    const pct = coven.xpForNextLevel > 0 ? Math.min(100, (coven.xpIntoLevel / coven.xpForNextLevel) * 100) : 100;
    const rows = coven.members.map(m => {
      const isMe = myName && m.username === myName;
      const canPromote = coven.myRank === 'founder' && m.rank === 'member';
      const canDemote = coven.myRank === 'founder' && m.rank === 'officer';
      const canKick = (coven.myRank === 'founder' && m.rank !== 'founder' && !isMe)
        || (coven.myRank === 'officer' && m.rank === 'member');
      const actions = [];
      if (canPromote) actions.push(`<button class="coven-btn small" data-act="promote" data-username="${escapeHtml(m.username)}">Raise to Officer</button>`);
      if (canDemote) actions.push(`<button class="coven-btn small" data-act="demote" data-username="${escapeHtml(m.username)}">Lower to Member</button>`);
      if (canKick) actions.push(`<button class="coven-btn small danger" data-act="kick" data-username="${escapeHtml(m.username)}">Exile</button>`);
      return `<tr class="${isMe ? 'me' : ''}">
        <td>${escapeHtml(m.displayName)}${isMe ? ' (you)' : ''}</td>
        <td><span class="coven-rank-badge coven-rank-${m.rank}">${RANK_ICON[m.rank]} ${RANK_LABEL[m.rank]}</span></td>
        <td>${actions.length ? `<div class="coven-row-actions">${actions.join('')}</div>` : '<span class="coven-hint">—</span>'}</td>
      </tr>`;
    }).join('');
    body.innerHTML = `
      ${msgLine(line)}
      <h3 class="coven-title" style="font-size:17px;margin:0 0 2px">${escapeHtml(coven.name)}</h3>
      ${coven.tagline ? `<p class="coven-sub" style="margin:0 0 10px">“${escapeHtml(coven.tagline)}”</p>` : ''}
      <div class="coven-levelname">Level ${coven.level} — ${escapeHtml(coven.levelName)}</div>
      <div class="coven-xpbar" role="progressbar" aria-label="Coven experience" aria-valuemin="0"
           aria-valuemax="${coven.xpForNextLevel}" aria-valuenow="${coven.xpIntoLevel}"
           aria-valuetext="${coven.xpIntoLevel} of ${coven.xpForNextLevel} XP toward the next rite">
        <div style="width:${pct}%"></div>
      </div>
      <div class="coven-hint">${coven.xpIntoLevel.toLocaleString('en-US')} / ${coven.xpForNextLevel.toLocaleString('en-US')} XP to the next rite · ${coven.xp.toLocaleString('en-US')} total</div>
      ${coven.inviteCode ? `
        <h3 class="coven-h3">INVITE RITE</h3>
        <div class="coven-invite" aria-label="Coven invite code">${escapeHtml(coven.inviteCode)}</div>
        <p class="coven-hint">Speak this code to those you would bind. Officers may reveal it; never shout it in the open.</p>
        <button class="coven-btn small" data-act="rotate">🔁 Speak a new rite (rotate code)</button>
      ` : ''}
      <h3 class="coven-h3">THE SWORN (${coven.memberCount})</h3>
      <table class="coven-table">
        <thead><tr><th scope="col">Name</th><th scope="col">Rank</th><th scope="col">Rites</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        ${coven.myRank === 'founder'
          ? `<button class="coven-btn danger" data-act="disband">💀 Disband the coven</button>`
          : `<button class="coven-btn danger" data-act="leave">🚪 Leave the coven</button>`}
      </div>
    `;
  }

  // -------------------------------------------------------- rite war --------
  function renderRiteWar(body, line) {
    const race = state && state.race;
    const winner = race && race.lastWinner;
    const rows = (race && race.standings.length ? race.standings : []).map(s => `
      <tr class="${state && state.inCoven && state.coven && state.coven.id === s.covenId ? 'me' : ''}">
        <td>${s.rank}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.bestTime)}</td>
        <td>${s.runs}</td><td>${s.memberCount}</td>
      </tr>`).join('');
    body.innerHTML = `
      ${msgLine(line)}
      <h3 class="coven-title" style="font-size:17px;margin:0 0 6px">⚔️ THE RITE WAR</h3>
      <p class="coven-hint">Each week, covens race the Daily Delve's seeded dungeon. Fastest clear wins the week — measured by the server, never the client.</p>
      ${winner ? `
        <div class="coven-banner" role="note" aria-label="Last week's rite war winner">
          🏆 <strong>${escapeHtml(winner.winnerName)}</strong> claimed the last rite war
          (${escapeHtml(winner.weekId)}) with a <strong>${escapeHtml(CovenService_fmt(winner.bestSec))}</strong> delve.
        </div>` : `<p class="coven-hint">No rite war has been fought yet. Be the first to bleed.</p>`}
      ${rows ? `
        <table class="coven-table">
          <thead><tr><th scope="col">#</th><th scope="col">Coven</th><th scope="col">Best clear</th><th scope="col">Runs</th><th scope="col">Sworn</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : `<p class="coven-hint">This week's standings are empty — no coven has cleared the delve yet.</p>`}
    `;
  }

  function CovenService_fmt(secs) {
    const s = Math.max(0, Math.floor(secs || 0));
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  // -------------------------------------------------------- whispers --------
  let chatMessages = [];
  let chatLoading = false;

  async function loadChat() {
    if (chatLoading || !state || !state.inCoven) return;
    chatLoading = true;
    try {
      const data = await apiGet(`/api/coven/chat?covenId=${encodeURIComponent(state.coven.id)}&after=${chatAfter}`);
      if (data && Array.isArray(data.messages)) {
        chatMessages = [...chatMessages, ...data.messages].slice(-100);
        chatAfter = data.latestSeq || chatAfter;
      }
    } catch (e) { /* best effort; live whispers still arrive over ws */ }
    chatLoading = false;
    if (activeTab === 'whispers' && overlay) render();
  }

  function renderWhispers(body, line) {
    const coven = state && state.coven;
    if (!coven) { body.innerHTML = `<p class="coven-hint">You belong to no coven.</p>`; return; }
    const items = chatMessages.map(m => `
      <div class="coven-msg">
        <span class="who">${escapeHtml(m.displayName)}</span>
        <span class="when">${escapeHtml(new Date(m.at).toLocaleTimeString())}</span><br>
        <span class="text">${escapeHtml(m.text)}</span>
      </div>`).join('');
    body.innerHTML = `
      ${msgLine(line)}
      <h3 class="coven-title" style="font-size:17px;margin:0 0 8px">💬 WHISPERS OF THE ${escapeHtml(coven.name.toUpperCase())}</h3>
      <div class="coven-chatlog" role="log" aria-live="polite" aria-label="Coven chat messages" tabindex="0">
        ${items || '<p class="coven-hint">The dark is silent. Be the first to whisper.</p>'}
      </div>
      <div class="coven-chatrow">
        <label for="coven-chat-input" class="coven-sr-only">Whisper to your coven</label>
        <input id="coven-chat-input" type="text" maxlength="500" placeholder="Whisper to your coven…" autocomplete="off">
        <button class="coven-btn" data-act="send-chat">Whisper</button>
      </div>
      <p class="coven-hint">The coven keeps the last 100 whispers. Speak true — the founder hears all.</p>
    `;
    const input = body.querySelector('#coven-chat-input');
    const log = body.querySelector('.coven-chatlog');
    if (log) log.scrollTop = log.scrollHeight;
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendChatMsg(); }
        e.stopPropagation();
      });
    }
    loadChat();
  }

  async function sendChatMsg() {
    const input = overlay.querySelector('#coven-chat-input');
    const text = input ? input.value : '';
    if (!text.trim()) return;
    try {
      const data = await apiPost('/api/coven/chat', { text });
      if (input) input.value = '';
      // The ws broadcast will echo it back; optimistic add keeps it snappy.
      if (data && data.message) {
        chatMessages = [...chatMessages, data.message].slice(-100);
        chatAfter = Math.max(chatAfter, data.message.seq || 0);
        if (activeTab === 'whispers' && overlay) render();
      }
    } catch (e) {
      msg = e.message === 'not_logged_in' ? 'Log in to whisper.' : e.message;
      render();
    }
  }

  // ------------------------------------------------------------ oath ---------
  function renderOath(body, line) {
    const inCoven = !!(state && state.inCoven);
    body.innerHTML = `
      ${msgLine(line)}
      ${inCoven ? `
        <h3 class="coven-title" style="font-size:17px;margin:0 0 6px">🕯️ RITES OF THE COVEN</h3>
        <p class="coven-hint">You are sworn to <strong style="color:${T.goldHi}">${escapeHtml(state.coven.name)}</strong>.
        Leave the coven to swear a new oath elsewhere.</p>
      ` : `
        <h3 class="coven-title" style="font-size:17px;margin:0 0 6px">🤝 SWEAR THE OATH</h3>
        <p class="coven-hint">Found a coven of your own, or join one by its invite rite. One soul, one coven.</p>
        <div class="coven-field">
          <label for="coven-name">Coven name (3-24 characters, unique)</label>
          <input id="coven-name" type="text" maxlength="24" placeholder="e.g. The Hollow Choir" autocomplete="off">
        </div>
        <div class="coven-field">
          <label for="coven-tagline">Dark tagline (optional, 80 characters)</label>
          <input id="coven-tagline" type="text" maxlength="80" placeholder="e.g. We drink the dark and call it wine" autocomplete="off">
        </div>
        <button class="coven-btn" data-act="create">🕯️ FOUND THE COVEN</button>
        <h3 class="coven-h3">OR JOIN BY INVITE RITE</h3>
        <div class="coven-field">
          <label for="coven-code">Invite code (4 characters)</label>
          <input id="coven-code" type="text" maxlength="4" placeholder="e.g. XK7Q" autocomplete="off"
                 style="font-family:monospace;letter-spacing:0.3em;text-transform:uppercase">
        </div>
        <button class="coven-btn" data-act="join">⚔️ JOIN THE COVEN</button>
      `}
      <div class="coven-err" role="alert" id="coven-form-err"></div>
      <div class="coven-ok" id="coven-form-ok"></div>
    `;
  }

  // ---------------------------------------------------------- actions --------
  async function handleAction(act, ds) {
    try {
      if (act === 'close') { close(); return; }
      if (act === 'send-chat') { await sendChatMsg(); return; }
      if (act === 'create') {
        const name = overlay.querySelector('#coven-name').value;
        const tagline = overlay.querySelector('#coven-tagline').value;
        const r = await apiPost('/api/coven/create', { name, tagline });
        msg = `The coven "${r.coven.name}" rises. Invite rite: ${r.coven.inviteCode}`;
        await refresh();
        chatMessages = []; chatAfter = 0;
        sendSubscribe();
        toast(`🕯️ Coven "${r.coven.name}" founded!`, 'success');
        announce(msg);
        return;
      }
      if (act === 'join') {
        const code = overlay.querySelector('#coven-code').value;
        const r = await apiPost('/api/coven/join', { code });
        msg = `You are sworn to "${r.coven.name}".`;
        await refresh();
        chatMessages = []; chatAfter = 0;
        sendSubscribe();
        toast(msg, 'success');
        return;
      }
      if (act === 'leave') {
        const r = await apiPost('/api/coven/leave', {});
        msg = `You have left "${r.covenName}". The dark forgets slowly.`;
        await refresh();
        chatMessages = []; chatAfter = 0;
        return;
      }
      if (act === 'disband') {
        if (!confirm('Disband the coven? This cannot be undone. Its whispers, XP, and glory die with it.')) return;
        const r = await apiPost('/api/coven/disband', {});
        msg = `"${r.covenName}" is scattered to the wind.`;
        await refresh();
        chatMessages = []; chatAfter = 0;
        return;
      }
      if (act === 'promote' || act === 'demote') {
        const r = await apiPost(`/api/coven/${act}`, { username: ds.username });
        msg = act === 'promote' ? 'Raised to officer. The coven watches.' : 'Lowered to member.';
        await refresh();
        return;
      }
      if (act === 'kick') {
        if (!confirm(`Exile ${ds.username} from the coven?`)) return;
        const r = await apiPost('/api/coven/kick', { username: ds.username });
        msg = `${ds.username} has been exiled.`;
        await refresh();
        return;
      }
      if (act === 'rotate') {
        const r = await apiPost('/api/coven/invite/rotate', {});
        msg = `A new invite rite is spoken: ${r.coven.inviteCode}`;
        await refresh();
        return;
      }
    } catch (e) {
      const human = e.message === 'not_logged_in' ? 'Log in to swear the oath.' : e.message;
      const errEl = overlay.querySelector('#coven-form-err');
      if (errEl) errEl.textContent = human;
      announce(`Coven rite failed: ${human}`);
    }
  }

  // --------------------------------------------------------- ws in ---------
  const handlers = {
    coven_chat: (m) => {
      if (!m || !m.message) return;
      const coven = state && state.coven;
      if (coven && m.covenId === coven.id) {
        chatMessages = [...chatMessages, m.message].slice(-100);
        chatAfter = Math.max(chatAfter, m.message.seq || 0);
        announce(`Whisper from ${m.message.displayName}: ${m.message.text}`);
        if (activeTab === 'whispers' && overlay && overlay.style.display !== 'none') render();
        else toast(`💬 ${m.message.displayName}: ${m.message.text.slice(0, 60)}`, 'info');
      }
    },
    coven_update: (m) => {
      if (!m) return;
      state = m;
      if (overlay && overlay.style.display !== 'none') render();
    },
    coven_disbanded: (m) => {
      chatMessages = []; chatAfter = 0;
      refresh();
      toast(`💀 ${(m && m.covenName) || 'Your coven'} has been disbanded.`, 'info');
      announce('Your coven has been disbanded.');
    },
    coven_subscribe: (m) => {
      if (m && m.ok === false && m.reason && m.reason !== 'no_coven') toast(m.reason, 'info');
    },
    run_completed: () => { refresh(); },
    meta_rewards: () => { refresh(); }
  };

  return {
    open,
    close,
    refresh,
    handlers,
    onConnect: sendSubscribe,
    isOpen: () => !!overlay && overlay.style.display !== 'none'
  };
}

export default { initCovenUI };
