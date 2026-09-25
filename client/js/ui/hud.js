// ui/hud.js — in-game HUD helpers: player vitals, buff/debuff icons,
// kill feed, and event toasts. DOM lookups are lazy so the module can init
// before #game-hud is shown. Takes the game app as an arg for future hooks.

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function initHUD({ game } = {}) {
  const api = {};

  // ---- Player vitals (HP / mana bars, bottom-left) ----
  api.updateVitals = ({ hp = 0, maxHp = 1, mana = 0, maxMana = 1 } = {}) => {
    const hpFill = $('player-hp-fill');
    const hpText = $('player-hp-text');
    const manaFill = $('player-mana-fill');
    const manaText = $('player-mana-text');
    const hpPct = clamp01(hp / Math.max(1, maxHp));
    const manaPct = clamp01(mana / Math.max(1, maxMana));
    if (hpFill) {
      hpFill.style.width = `${hpPct * 100}%`;
      hpFill.classList.toggle('low', hpPct <= 0.3 && hpPct > 0);
    }
    if (hpText) hpText.textContent = `${Math.max(0, Math.ceil(hp))} / ${Math.ceil(maxHp)}`;
    if (manaFill) manaFill.style.width = `${manaPct * 100}%`;
    if (manaText) manaText.textContent = `${Math.max(0, Math.ceil(mana))} / ${Math.ceil(maxMana)}`;
  };

  // ---- Buff / debuff icons ----
  // buffs: [{ icon: '🛡️', name: 'Iron Bastion', remaining: 4.2, debuff: false }]
  api.setBuffs = (buffs = []) => {
    const bar = $('buff-bar');
    if (!bar) return;
    bar.innerHTML = '';
    for (const b of buffs.slice(0, 12)) {
      const el = document.createElement('div');
      el.className = `buff-icon${b.debuff ? ' debuff' : ''}`;
      el.title = b.name || '';
      el.setAttribute('aria-label', b.name || 'effect');
      const secs = b.remaining != null ? Math.ceil(b.remaining) : null;
      el.innerHTML = `<span aria-hidden="true">${b.icon || '✨'}</span>` +
        (secs != null ? `<span class="buff-timer">${secs}s</span>` : '');
      bar.appendChild(el);
    }
  };

  // ---- Kill feed ----
  api.pushKillFeed = ({ killer = '', victim = '', boss = false } = {}) => {
    const feed = $('kill-feed');
    if (!feed) return;
    const entry = document.createElement('div');
    entry.className = `kill-entry${boss ? ' boss' : ''}`;
    const k = document.createElement('span');
    k.className = 'kf-killer';
    k.textContent = killer;
    const v = document.createElement('span');
    v.className = 'kf-victim';
    v.textContent = victim;
    entry.append(k, document.createTextNode(' ⚔️ '), v);
    feed.prepend(entry);
    while (feed.children.length > 6) feed.lastChild.remove();
    setTimeout(() => entry.classList.add('fade'), 4200);
    setTimeout(() => entry.remove(), 5000);
  };

  // ---- Event toasts ----
  // kind: 'info' | 'gold' | 'violet' | 'blood' | 'heal'
  api.toast = (text, kind = 'info') => {
    const box = $('event-toasts');
    if (!box || !text) return;
    const el = document.createElement('div');
    el.className = `event-toast${kind !== 'info' ? ' ' + kind : ''}`;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 2600);
    setTimeout(() => el.remove(), 3200);
  };

  // ---- Boss bar convenience (main.js owns the authoritative updates) ----
  api.setBoss = ({ name, phase, pct } = {}) => {
    if (name != null) { const el = $('boss-name'); if (el) el.textContent = name; }
    if (phase != null) { const el = $('boss-phase-tag'); if (el) el.textContent = phase; }
    if (pct != null) {
      const fill = $('boss-hp-fill');
      const txt = $('boss-hp-text');
      const p = Math.max(0, Math.min(100, pct));
      if (fill) fill.style.width = `${p}%`;
      if (txt) txt.textContent = `${Math.round(p)}%`;
    }
  };

  api.game = game || null;
  return api;
}

export default { initHUD };
