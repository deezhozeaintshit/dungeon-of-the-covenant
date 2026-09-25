// ui/mainMenu.js — main-menu behavior: lobby tab switching, full settings
// panel wiring, and the hidden quickplay alias used by gamepad input.
// Takes the existing game app as an arg; creates no competing singletons.

import { SettingsPanel } from '../settingspanel.js';

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

  return { selectTab, openSettings, settings };
}

export default { initMainMenu };
