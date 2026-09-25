// ui/lobbyBrowser.js — Phase 2 workstream 3: public lobby browser panel,
// private-room creation, HUD room-code chip (click-to-copy), and invite links.
// Self-contained: injects its own DOM + styles; registers on the network's
// secondary listener map so main.js callbacks are untouched.

import { COVENANT_THEME } from './theme.js?v=5.0';

const T = COVENANT_THEME;

function ensureStyles() {
  if (document.getElementById('lobby-browser-styles')) return;
  const st = document.createElement('style');
  st.id = 'lobby-browser-styles';
  st.textContent = `
    #lb-overlay {
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(6, 3, 9, 0.82);
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(3px);
    }
    #lb-overlay.hidden { display: none; }
    .lb-panel {
      width: min(680px, 94vw); max-height: 86vh; overflow: hidden;
      display: flex; flex-direction: column;
      background: ${T.panel};
      border: 2px solid ${T.panelLine};
      border-radius: 14px;
      box-shadow: 0 0 40px rgba(212, 175, 55, 0.25), 0 18px 60px rgba(0,0,0,0.7);
      font-family: ${T.fontBody}; color: ${T.parchment};
    }
    .lb-head {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 18px;
      border-bottom: 1px solid ${T.panelLine};
      background: linear-gradient(180deg, rgba(212,175,55,0.10), transparent);
    }
    .lb-title {
      font-family: ${T.fontDisplay}; color: ${T.goldHi};
      font-size: 20px; letter-spacing: 2px; flex: 1; margin: 0;
      text-shadow: 0 0 12px rgba(255, 215, 0, 0.35);
    }
    .lb-icon-btn {
      background: rgba(212,175,55,0.12); color: ${T.gold};
      border: 1px solid ${T.panelLine}; border-radius: 8px;
      font-size: 16px; padding: 6px 12px; cursor: pointer;
    }
    .lb-icon-btn:hover { background: rgba(212,175,55,0.28); color: ${T.goldHi}; }
    .lb-actions {
      display: flex; gap: 10px; padding: 14px 18px 6px; flex-wrap: wrap;
    }
    .lb-quick {
      flex: 2 1 240px; font-family: ${T.fontDisplay}; font-size: 17px; font-weight: 700;
      letter-spacing: 1px; padding: 13px 10px; cursor: pointer;
      color: #1a1005; border: none; border-radius: 10px;
      background: linear-gradient(180deg, ${T.goldHi}, ${T.gold} 60%, ${T.goldDim});
      box-shadow: 0 0 18px rgba(255, 215, 0, 0.45);
    }
    .lb-quick:hover { filter: brightness(1.12); }
    .lb-private {
      flex: 1 1 180px; font-family: ${T.fontDisplay}; font-size: 14px;
      padding: 13px 10px; cursor: pointer; border-radius: 10px;
      color: ${T.violetHi}; background: rgba(157, 78, 221, 0.10);
      border: 1px solid rgba(157, 78, 221, 0.55);
    }
    .lb-private:hover { background: rgba(157, 78, 221, 0.24); }
    .lb-list {
      padding: 10px 18px 6px; overflow-y: auto; min-height: 120px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .lb-empty, .lb-loading {
      text-align: center; color: ${T.parchmentDim};
      padding: 26px 10px; font-style: italic;
    }
    .lb-error {
      text-align: center; color: ${T.bloodHi}; padding: 8px;
      font-size: 13px; min-height: 18px;
    }
    .lb-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: 10px;
      background: rgba(23, 16, 38, 0.85);
      border: 1px solid rgba(212, 175, 55, 0.22);
      transition: border-color 0.15s, transform 0.15s;
    }
    .lb-row:hover { border-color: ${T.gold}; transform: translateX(2px); }
    .lb-code {
      font-family: ${T.fontDisplay}; font-size: 22px; font-weight: 700;
      color: ${T.goldHi}; letter-spacing: 3px; min-width: 84px;
      text-shadow: 0 0 10px rgba(255, 215, 0, 0.4);
    }
    .lb-meta { flex: 1; min-width: 0; }
    .lb-biome {
      color: ${T.parchment}; font-size: 14px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .lb-sub { color: ${T.parchmentDim}; font-size: 12px; margin-top: 2px; }
    .lb-state {
      font-size: 10px; font-weight: 700; letter-spacing: 1px;
      padding: 3px 8px; border-radius: 20px; white-space: nowrap;
    }
    .lb-state.lobby { color: ${T.heal}; border: 1px solid ${T.heal}; }
    .lb-state.dungeon { color: ${T.goldSoft}; border: 1px solid ${T.goldSoft}; }
    .lb-join {
      font-family: ${T.fontDisplay}; font-size: 13px; font-weight: 700;
      padding: 9px 16px; cursor: pointer; border-radius: 8px;
      color: #0a0712; border: none;
      background: linear-gradient(180deg, ${T.goldSoft}, ${T.goldDim});
      white-space: nowrap;
    }
    .lb-join:hover { filter: brightness(1.15); }
    .lb-foot {
      padding: 10px 18px 14px; color: ${T.parchmentDim};
      font-size: 12px; text-align: center;
      border-top: 1px solid rgba(212, 175, 55, 0.18);
    }
    /* Private-room confirmation card */
    #lb-private-confirm {
      position: fixed; inset: 0; z-index: 9100;
      background: rgba(6, 3, 9, 0.78);
      display: flex; align-items: center; justify-content: center;
    }
    #lb-private-confirm.hidden { display: none; }
    .lb-confirm-card {
      background: ${T.panel}; border: 2px solid ${T.panelLine};
      border-radius: 14px; padding: 26px 30px; text-align: center;
      color: ${T.parchment}; font-family: ${T.fontBody};
      max-width: 92vw;
      box-shadow: 0 0 40px rgba(157, 78, 221, 0.30);
    }
    .lb-confirm-card h3 {
      font-family: ${T.fontDisplay}; color: ${T.violetHi};
      letter-spacing: 2px; margin: 0 0 8px;
    }
    .lb-confirm-code {
      font-family: ${T.fontDisplay}; font-size: 40px; letter-spacing: 8px;
      color: ${T.goldHi}; margin: 8px 0 4px;
      text-shadow: 0 0 16px rgba(255, 215, 0, 0.5);
    }
    .lb-confirm-card p { color: ${T.parchmentDim}; font-size: 13px; margin: 6px 0 16px; }
    .lb-confirm-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .lb-confirm-row button {
      font-family: ${T.fontDisplay}; font-size: 13px; font-weight: 700;
      padding: 10px 18px; border-radius: 8px; cursor: pointer;
    }
    .lb-btn-invite {
      color: #0a0712; border: none;
      background: linear-gradient(180deg, ${T.goldHi}, ${T.goldDim});
    }
    .lb-btn-code {
      color: ${T.gold}; background: rgba(212,175,55,0.10);
      border: 1px solid ${T.panelLine};
    }
    .lb-btn-done {
      color: ${T.parchmentDim}; background: transparent;
      border: 1px solid rgba(203, 184, 157, 0.35);
    }
    /* HUD room-code chip */
    #hud-room-code-chip {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: ${T.fontDisplay}; font-size: 13px; font-weight: 700;
      letter-spacing: 2px; color: ${T.goldHi};
      background: rgba(16, 11, 28, 0.85);
      border: 1px solid ${T.panelLine}; border-radius: 8px;
      padding: 7px 12px; cursor: pointer; user-select: none;
      text-shadow: 0 0 8px rgba(255, 215, 0, 0.35);
    }
    #hud-room-code-chip:hover { border-color: ${T.goldHi}; background: rgba(30, 20, 50, 0.92); }
    #hud-room-code-chip.hidden { display: none; }
    #hud-room-code-chip .copy-hint { font-size: 11px; color: ${T.parchmentDim}; letter-spacing: 0; }
  `;
  document.head.appendChild(st);
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* best effort */ }
  ta.remove();
}

export function buildInviteLink(code) {
  return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
}

export function initLobbyBrowser({ game, network } = {}) {
  ensureStyles();
  const state = { open: false, rooms: [], lastCode: null, loading: false };

  const playerInfo = () => ({
    name: document.getElementById('player-name-input')?.value.trim() || 'Vanguard',
    chosenClass: (game && game.selectedClass) || 'juggernaut',
    profile: (game && game.profile) || null
  });

  // ---------- overlay ----------
  let overlay = document.getElementById('lb-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lb-overlay';
    overlay.className = 'hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Open chambers browser');
    overlay.innerHTML = `
      <div class="lb-panel">
        <div class="lb-head">
          <h2 class="lb-title">⚔️ OPEN CHAMBERS</h2>
          <button class="lb-icon-btn" id="lb-refresh" title="Refresh list">🔄</button>
          <button class="lb-icon-btn" id="lb-close" title="Close">✕</button>
        </div>
        <div class="lb-actions">
          <button class="lb-quick" id="lb-quickplay">⚔️ QUICK PLAY — RANDOM MATCH</button>
          <button class="lb-private" id="lb-create-private">🏰 CREATE PRIVATE ROOM</button>
        </div>
        <div class="lb-error" id="lb-error" aria-live="polite"></div>
        <div class="lb-list" id="lb-list"></div>
        <div class="lb-foot">Private chambers are invite-only and never appear here.<br>Click a chamber code in-game to copy its invite link.</div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) api.close(); });
    document.getElementById('lb-close').addEventListener('click', () => api.close());
    document.getElementById('lb-refresh').addEventListener('click', () => api.refresh());
    document.getElementById('lb-quickplay').addEventListener('click', () => {
      api.close();
      // Preserve the canonical quickplay flow — click the real match button.
      document.getElementById('btn-quickplay-match')?.click();
    });
    document.getElementById('lb-create-private').addEventListener('click', () => {
      const info = playerInfo();
      network.createPrivateRoom(info.name, info.chosenClass, info.profile);
    });
  }
  const listEl = () => document.getElementById('lb-list');
  const errEl = () => document.getElementById('lb-error');

  function renderList() {
    const list = listEl();
    if (!list) return;
    list.innerHTML = '';
    if (state.loading) {
      list.innerHTML = `<div class="lb-loading">🔮 Seeking open chambers…</div>`;
      return;
    }
    if (state.rooms.length === 0) {
      list.innerHTML = `<div class="lb-empty">No open chambers right now.<br>Hit <strong>QUICK PLAY</strong> to forge a new dungeon, or create a private room.</div>`;
      return;
    }
    for (const r of state.rooms) {
      const row = document.createElement('div');
      row.className = 'lb-row';
      const age = r.ageSec < 60 ? `${r.ageSec}s` : `${Math.floor(r.ageSec / 60)}m`;
      const stateBadge = r.state === 'lobby'
        ? `<span class="lb-state lobby">IN LOBBY</span>`
        : `<span class="lb-state dungeon">IN DUNGEON</span>`;
      row.innerHTML = `
        <span class="lb-code">${escapeHtml(r.code)}</span>
        <div class="lb-meta">
          <div class="lb-biome">${escapeHtml(r.biome || 'Uncharted Depths')}</div>
          <div class="lb-sub">Floor ${r.floor} · 👥 ${r.playerCount}/${r.maxPlayers}${r.hasBots ? ' · 🤖 bots' : ''} · ${age} ago</div>
        </div>
        ${stateBadge}
        <button class="lb-join">JOIN ⚔️</button>`;
      row.querySelector('.lb-join').addEventListener('click', () => {
        const info = playerInfo();
        network.joinRoom(r.code, info.name, info.chosenClass, info.profile);
      });
      row.addEventListener('click', (e) => {
        if (e.target.closest('.lb-join')) return;
        const info = playerInfo();
        network.joinRoom(r.code, info.name, info.chosenClass, info.profile);
      });
      list.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- private-room confirmation ----------
  let confirmEl = document.getElementById('lb-private-confirm');
  if (!confirmEl) {
    confirmEl = document.createElement('div');
    confirmEl.id = 'lb-private-confirm';
    confirmEl.className = 'hidden';
    confirmEl.innerHTML = `
      <div class="lb-confirm-card">
        <h3>🏰 PRIVATE CHAMBER FORGED</h3>
        <div class="lb-confirm-code" id="lb-confirm-code">----</div>
        <p>Share the invite link — only those who hold it can enter.<br>This chamber is hidden from the browser and from Quick Play.</p>
        <div class="lb-confirm-row">
          <button class="lb-btn-invite" id="lb-copy-invite">🔗 COPY INVITE LINK</button>
          <button class="lb-btn-code" id="lb-copy-code">⧉ COPY CODE</button>
          <button class="lb-btn-done" id="lb-confirm-done">ENTER CHAMBER</button>
        </div>
      </div>`;
    document.body.appendChild(confirmEl);
    document.getElementById('lb-confirm-done').addEventListener('click', () => {
      confirmEl.classList.add('hidden');
    });
    document.getElementById('lb-copy-code').addEventListener('click', (e) => {
      const code = state.lastCode;
      if (!code) return;
      copyText(code);
      e.currentTarget.textContent = '✓ COPIED';
      setTimeout(() => { e.currentTarget.textContent = '⧉ COPY CODE'; }, 1600);
    });
    document.getElementById('lb-copy-invite').addEventListener('click', (e) => {
      const code = state.lastCode;
      if (!code) return;
      copyText(buildInviteLink(code));
      e.currentTarget.textContent = '✓ LINK COPIED';
      setTimeout(() => { e.currentTarget.textContent = '🔗 COPY INVITE LINK'; }, 1600);
    });
  }

  // ---------- HUD room-code chip (click-to-copy invite link) ----------
  function ensureChip() {
    let chip = document.getElementById('hud-room-code-chip');
    if (chip) return chip;
    const hud = document.getElementById('game-hud');
    if (!hud) return null;
    chip = document.createElement('button');
    chip.id = 'hud-room-code-chip';
    chip.className = 'hidden';
    chip.title = 'Copy invite link';
    chip.addEventListener('click', () => {
      const code = state.lastCode || (game && game.currentRoomCode);
      if (!code) return;
      copyText(buildInviteLink(code));
      const prev = chip.innerHTML;
      chip.innerHTML = `✓ LINK COPIED`;
      setTimeout(() => { chip.innerHTML = prev; }, 1400);
    });
    const topBar = hud.querySelector('.hud-top-bar');
    const actions = hud.querySelector('.hud-top-actions');
    if (topBar && actions) topBar.insertBefore(chip, actions);
    else if (topBar) topBar.appendChild(chip);
    else hud.prepend(chip);
    return chip;
  }

  function syncChip() {
    const chip = ensureChip();
    if (!chip) return;
    const hudVisible = !document.getElementById('game-hud')?.classList.contains('hidden');
    const code = state.lastCode || (game && game.currentRoomCode);
    if (hudVisible && code) {
      chip.classList.remove('hidden');
      chip.innerHTML = `🏰 ${escapeHtml(code)} <span class="copy-hint">⧉ invite</span>`;
    } else {
      chip.classList.add('hidden');
    }
  }

  const hudEl = document.getElementById('game-hud');
  if (hudEl && window.MutationObserver) {
    new MutationObserver(() => syncChip()).observe(hudEl, {
      attributes: true, attributeFilter: ['class']
    });
  }

  // ---------- network subscriptions ----------
  if (network && typeof network.on === 'function') {
    network.on('room_list', (msg) => {
      state.loading = false;
      state.rooms = Array.isArray(msg.rooms) ? msg.rooms : [];
      if (state.open) renderList();
    });
    network.on('room_created', (msg) => {
      if (msg && msg.roomCode) {
        state.lastCode = msg.roomCode;
        api.close();
        if (msg.private) {
          document.getElementById('lb-confirm-code').textContent = msg.roomCode;
          confirmEl.classList.remove('hidden');
        }
        syncChip();
      }
    });
    network.on('room_joined', (msg) => {
      if (msg && msg.roomCode) {
        state.lastCode = msg.roomCode;
        api.close();
        syncChip();
      }
    });
    network.on('error', (msg) => {
      if (state.open && msg && msg.message) {
        const el = errEl();
        if (el) {
          el.textContent = `⚠️ ${msg.message}`;
          setTimeout(() => { if (el.textContent.startsWith('⚠️')) el.textContent = ''; }, 5000);
        }
      }
    });
  }

  const api = {
    open() {
      state.open = true;
      document.getElementById('lb-overlay')?.classList.remove('hidden');
      api.refresh();
    },
    close() {
      state.open = false;
      document.getElementById('lb-overlay')?.classList.add('hidden');
    },
    refresh() {
      state.loading = true;
      renderList();
      if (network) network.listRooms();
      else { state.loading = false; renderList(); }
    },
    buildInviteLink,
    copyInviteLink(code) {
      return copyText(buildInviteLink(code || state.lastCode || ''));
    },
    getLastCode: () => state.lastCode,
    syncChip
  };
  return api;
}

export default { initLobbyBrowser, buildInviteLink };
