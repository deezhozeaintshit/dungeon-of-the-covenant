// ui/mainMenu.js — main-menu behavior: lobby tab switching, full settings
// panel wiring, and the hidden quickplay alias used by gamepad input.
// Takes the existing game app as an arg; creates no competing singletons.

import { SettingsPanel } from '../settingspanel.js';
import { initLobbyBrowser } from './lobbyBrowser.js?v=5.0';
import { initObjectiveTracker } from './objectiveTracker.js?v=5.0';

export function initMainMenu({ game } = {}) {
  const tabs = Array.from(document.querySelectorAll('.lobby-tab'));
  const panels = {
    'lobby-panel-play': document.getElementById('lobby-panel-play'),
    'lobby-panel-chamber': document.getElementById('lobby-panel-chamber'),
    'lobby-panel-settings': document.getElementById('lobby-panel-settings'),
  };

  function selectTab(tabEl) {
    if (!tabEl) return;
    tabs.forEach(t => t.classList.toggle('active', t === tabEl));
    const panelId = tabEl.dataset.panel;
    for (const [id, el] of Object.entries(panels)) {
      if (el) el.classList.toggle('hidden', id !== panelId);
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => selectTab(tab));
  });

  // Instantiate the real settings panel (previously constructed nowhere).
  let settings = null;
  try {
    settings = new SettingsPanel(game || window.gameApp || {});
    settings.create();
  } catch (err) {
    console.warn('[ui/mainMenu] SettingsPanel failed to init:', err);
  }

  function openSettings() {
    if (settings) settings.open();
  }

  const openSettingsBtn = document.getElementById('btn-menu-open-settings');
  if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettings);

  // Hidden alias: gamepad "start" triggers the real quickplay match button.
  const quickAlias = document.getElementById('btn-quickplay');
  const quickReal = document.getElementById('btn-quickplay-match');
  if (quickAlias && quickReal) {
    quickAlias.addEventListener('click', () => quickReal.click());
  }

  // ---- Phase 2 (workstreams 3 + 5): lobby browser + objective tracker ----
  // initNetwork() runs before initMainMenu in main.js, so game.network exists.
  let lobbyBrowser = null;
  let objectiveTracker = null;
  try {
    const net = (game && game.network) || (window.gameApp && window.gameApp.network);
    if (net) {
      lobbyBrowser = initLobbyBrowser({ game: game || window.gameApp, network: net });
      objectiveTracker = initObjectiveTracker({ game: game || window.gameApp, network: net });
      const app = game || window.gameApp;
      if (app) {
        app.ui = app.ui || {};
        app.ui.lobbyBrowser = lobbyBrowser;
        app.ui.objectives = objectiveTracker;
      }
      // The chamber panel is labeled "PRIVATE PARTY CHAMBER" — route the
      // generic createRoom() call at the network layer to the private room
      // endpoint so the chamber is actually private (invite-only). main.js's
      // own btn-create-room listener calls network.createRoom(), so wrapping
      // here changes it without touching main.js.
      if (!net._createRoomRoutedPrivate) {
        net._createRoomRoutedPrivate = true;
        net.createRoom = function (playerName, chosenClass, profile = null) {
          return this.createPrivateRoom(playerName, chosenClass, profile);
        };
      }
    }
  } catch (err) {
    console.warn('[ui/mainMenu] Phase 2 UI modules failed to init:', err);
  }

  // "Browse open games" buttons — play panel (prominent, next to Quick Play)
  // and chamber panel. The browser keeps its own big QUICK PLAY button too.
  const openBrowser = () => { if (lobbyBrowser) lobbyBrowser.open(); };
  const playActions = document.querySelector('.room-buttons.play-actions');
  if (playActions && !document.getElementById('btn-browse-rooms')) {
    const browseBtn = document.createElement('button');
    browseBtn.id = 'btn-browse-rooms';
    browseBtn.className = 'btn btn-secondary';
    browseBtn.innerHTML = '🎭 BROWSE OPEN GAMES';
    browseBtn.title = 'Browse joinable public chambers';
    browseBtn.addEventListener('click', openBrowser);
    const emporiumBtn = document.getElementById('btn-lobby-emporium');
    if (emporiumBtn) playActions.insertBefore(browseBtn, emporiumBtn);
    else playActions.appendChild(browseBtn);
  }
  const chamberCard = document.querySelector('#lobby-panel-chamber .chamber-card');
  if (chamberCard && !document.getElementById('btn-browse-rooms-2')) {
    const browseBtn2 = document.createElement('button');
    browseBtn2.id = 'btn-browse-rooms-2';
    browseBtn2.className = 'btn btn-secondary';
    browseBtn2.innerHTML = '🎭 BROWSE OPEN GAMES';
    browseBtn2.addEventListener('click', openBrowser);
    chamberCard.appendChild(browseBtn2);
  }

  // ---- Invite links: copy button + click-to-copy on the room-lobby code ----
  const roomHeader = document.querySelector('#room-lobby-screen .room-header');
  if (roomHeader && !document.getElementById('btn-copy-invite')) {
    const inviteBtn = document.createElement('button');
    inviteBtn.id = 'btn-copy-invite';
    inviteBtn.className = 'btn btn-secondary';
    inviteBtn.innerHTML = '🔗 COPY INVITE LINK';
    inviteBtn.title = 'Copy a link that joins this chamber directly';
    inviteBtn.addEventListener('click', (e) => {
      const code = (game && game.currentRoomCode) || (window.gameApp && window.gameApp.currentRoomCode);
      if (!code) return;
      const link = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
      const done = () => {
        e.currentTarget.innerHTML = '✓ LINK COPIED';
        setTimeout(() => { e.currentTarget.innerHTML = '🔗 COPY INVITE LINK'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done).catch(done);
      } else { done(); }
    });
    roomHeader.appendChild(inviteBtn);
  }
  const codeDisplay = document.getElementById('display-room-code');
  if (codeDisplay && !codeDisplay._copyWired) {
    codeDisplay._copyWired = true;
    codeDisplay.style.cursor = 'pointer';
    codeDisplay.title = 'Click to copy chamber code';
    codeDisplay.addEventListener('click', () => {
      const code = codeDisplay.innerText.trim();
      if (!code || code === '----') return;
      const finish = () => {
        const prev = codeDisplay.innerText;
        codeDisplay.innerText = '✓ COPIED';
        setTimeout(() => { codeDisplay.innerText = prev; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(finish).catch(finish);
      } else { finish(); }
    });
  }

  // ---- Invite links: ?room=CODE on page load ----
  // Pre-fill the chamber code input, switch to the CHAMBER tab, and show an
  // invite banner. The hero still enters a name / picks a class, then hits
  // JOIN CHAMBER (normal join_room flow). Query param is stripped so a
  // refresh does not re-trigger.
  try {
    const params = new URLSearchParams(window.location.search);
    const invited = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (invited && invited.length === 4) {
      const input = document.getElementById('room-code-input');
      if (input) input.value = invited;
      const chamberTab = document.querySelector('.lobby-tab[data-panel="lobby-panel-chamber"]');
      if (chamberTab) selectTab(chamberTab);
      const joinBox = document.querySelector('#lobby-panel-chamber .join-room-box');
      if (joinBox && !document.getElementById('invite-banner')) {
        const banner = document.createElement('div');
        banner.id = 'invite-banner';
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'margin-top:10px;padding:10px 14px;border:1px solid rgba(212,175,55,0.5);border-radius:8px;background:rgba(212,175,55,0.10);color:#f4e6c6;font-size:13px;text-align:center;';
        banner.innerHTML = `⚔️ You were invited to chamber <strong style="color:#ffd700;letter-spacing:2px">${invited}</strong> — enter your hero name and hit <strong>JOIN CHAMBER</strong>.`;
        joinBox.appendChild(banner);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  } catch (err) {
    console.warn('[ui/mainMenu] invite-link parse failed:', err);
  }

  return { selectTab, openSettings, settings, lobbyBrowser, objectiveTracker };
}

export default { initMainMenu };
