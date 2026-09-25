// ui/inventory.js — Phase 3 loot inventory + equipment panel.
// Display-only: pickup/equip/unequip are server-authoritative (systems/Gear.js).
// This panel sends only itemIds/slots and renders the authoritative
// inventory_update payload. Tooltip compares a candidate item against the
// currently equipped item in its slot (server data, deltas computed here).
// Styling is self-contained (scoped <style> injected once) using the
// Covenant dark-fantasy tokens from theme.js. Keyboard + screen-reader
// friendly: role=dialog, labelled controls, visible focus states.

import { COVENANT_THEME as T } from './theme.js';

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const css = `
  .cov-inv-overlay{position:fixed;inset:0;z-index:8800;display:flex;align-items:center;justify-content:center;
    background:rgba(6,3,9,.88);backdrop-filter:blur(2px)}
  .cov-inv-overlay.hidden{display:none}
  .cov-inv-frame{width:min(96vw,1060px);max-height:92vh;overflow-y:auto;padding:22px 22px 26px;
    background:${T.panel};border:1px solid ${T.panelLine};border-radius:14px;
    box-shadow:0 0 60px rgba(157,78,221,.3), inset 0 0 40px rgba(0,0,0,.55)}
  .cov-inv-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px}
  .cov-inv-title{font-family:${T.fontDisplay};color:${T.goldHi};font-size:26px;letter-spacing:3px;margin:0;
    text-shadow:0 0 18px rgba(255,215,0,.4)}
  .cov-inv-gs{font-family:${T.fontBody};color:${T.parchment};font-size:14px;letter-spacing:1px}
  .cov-inv-gs strong{color:${T.goldHi};font-size:18px}
  .cov-inv-close{margin-left:auto;background:none;border:1px solid ${T.panelLine};color:${T.parchmentDim};
    border-radius:6px;padding:6px 14px;cursor:pointer;font-family:${T.fontBody};font-size:13px;letter-spacing:1px}
  .cov-inv-close:hover,.cov-inv-close:focus-visible{color:${T.goldHi};border-color:${T.gold};outline:none;
    box-shadow:0 0 0 2px ${T.gold}66}
  .cov-inv-sub{font-family:${T.fontBody};color:${T.parchmentDim};font-size:13px;margin:0 0 14px;letter-spacing:1px}
  .cov-inv-sec-title{font-family:${T.fontDisplay};color:${T.gold};font-size:16px;letter-spacing:2px;margin:16px 0 10px}
  .cov-inv-slots{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:12px}
  .cov-inv-slot{padding:14px;border:1px dashed ${T.panelLine};border-radius:10px;background:rgba(23,16,38,.7);min-height:118px}
  .cov-inv-slot-label{font-size:11px;letter-spacing:3px;color:${T.parchmentDim};text-transform:uppercase;margin-bottom:6px}
  .cov-inv-item-name{font-family:${T.fontDisplay};font-size:15px;margin:0 0 2px;line-height:1.3}
  .cov-inv-item-sub{font-size:12px;color:${T.parchmentDim};line-height:1.45}
  .cov-inv-empty{color:${T.parchmentDim};font-size:13px;font-style:italic}
  .cov-inv-bonus{margin-top:12px;padding:10px 14px;border:1px solid rgba(157,78,221,.4);border-radius:8px;
    background:rgba(45,20,77,.55);font-size:13px;color:${T.parchment};line-height:1.7}
  .cov-inv-bonus strong{color:${T.goldSoft};letter-spacing:1px}
  .cov-inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:6px}
  .cov-inv-card{position:relative;text-align:left;padding:12px 12px 10px;border-radius:8px;cursor:pointer;
    background:rgba(23,16,38,.85);border:1px solid ${T.panelLine};color:${T.parchment};
    font-family:${T.fontBody};transition:border-color .12s ease, transform .12s ease, box-shadow .12s ease}
  .cov-inv-card:hover,.cov-inv-card:focus-visible{transform:translateY(-2px);border-color:${T.goldHi};
    box-shadow:0 0 18px rgba(212,175,55,.35);outline:none}
  .cov-inv-card:focus-visible{box-shadow:0 0 0 2px ${T.goldHi}, 0 0 18px rgba(212,175,55,.35)}
  .cov-inv-card .cov-inv-item-name{font-size:14px}
  .cov-inv-rarity{font-size:10.5px;letter-spacing:2px;text-transform:uppercase;font-weight:700}
  .cov-inv-gs-tag{position:absolute;top:8px;right:10px;font-size:11px;color:${T.goldSoft}}
  .cov-inv-act{margin-top:8px;display:flex;gap:8px}
  .cov-inv-btn{flex:1;padding:7px 10px;border-radius:6px;cursor:pointer;font-family:${T.fontDisplay};
    letter-spacing:2px;font-size:12px;border:1px solid ${T.gold};color:${T.goldHi};background:rgba(212,175,55,.08)}
  .cov-inv-btn:hover:not(:disabled),.cov-inv-btn:focus-visible:not(:disabled){background:rgba(212,175,55,.22);outline:none;
    box-shadow:0 0 0 2px ${T.gold}66}
  .cov-inv-btn:disabled{opacity:.35;cursor:not-allowed;border-color:${T.parchmentDim};color:${T.parchmentDim}}
  .cov-inv-btn.danger{border-color:${T.bloodHi};color:${T.bloodHi};background:rgba(239,68,68,.07)}
  .cov-inv-btn.danger:hover:not(:disabled),.cov-inv-btn.danger:focus-visible:not(:disabled){background:rgba(239,68,68,.18)}
  .cov-inv-tip{position:fixed;z-index:8900;pointer-events:none;max-width:300px;padding:12px 14px;border-radius:8px;
    background:rgba(10,7,18,.97);border:1px solid ${T.panelLine};box-shadow:0 8px 30px rgba(0,0,0,.7)}
  .cov-inv-tip.hidden{display:none}
  .cov-inv-tip-row{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;line-height:1.6;color:${T.parchment}}
  .cov-inv-tip-row .stat{color:${T.parchmentDim}}
  .cov-inv-tip-head{font-family:${T.fontDisplay};font-size:14px;margin-bottom:6px}
  .cov-inv-delta-up{color:${T.heal};font-weight:700}
  .cov-inv-delta-down{color:${T.bloodHi};font-weight:700}
  .cov-inv-delta-same{color:${T.parchmentDim}}
  .cov-inv-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  @media (max-width:720px){.cov-inv-slots{grid-template-columns:1fr}}
  `;
  const el = document.createElement('style');
  el.id = 'cov-inventory-styles';
  el.textContent = css;
  document.head.appendChild(el);
}

function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html != null) d.innerHTML = html;
  return d;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STAT_KEYS = ['damageBuff', 'maxHp', 'critChance', 'lifesteal', 'cooldownHaste', 'armor', 'resistAll'];
const STAT_LABELS = {
  damageBuff: 'Attack Power', maxHp: 'Max HP', critChance: 'Crit Chance',
  lifesteal: 'Lifesteal', cooldownHaste: 'Cooldown Haste', armor: 'Armor', resistAll: 'All Resist'
};
const STAT_FMT = {
  damageBuff: (v) => `+${Math.round(v * 100)}%`,
  maxHp: (v) => `+${Math.round(v)}`,
  critChance: (v) => `+${Math.round(v * 100)}%`,
  lifesteal: (v) => `+${Math.round(v * 100)}%`,
  cooldownHaste: (v) => `+${Math.round(v * 100)}%`,
  armor: (v) => `+${Math.round(v)}`,
  resistAll: (v) => `+${Math.round(v * 100)}%`
};
const SLOT_ICONS = { weapon: '⚔️', armor: '🛡️', relic: '🔮' };
const SLOT_NAMES = { weapon: 'Weapon', armor: 'Armor', relic: 'Relic' };

// onEquip(itemId), onUnequip(slot)
export function initInventoryPanel({ onEquip, onUnequip } = {}) {
  injectStyles();

  const overlay = el('div', 'cov-inv-overlay hidden');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Inventory and equipment');

  const frame = el('div', 'cov-inv-frame');
  const head = el('div', 'cov-inv-head');
  const title = el('h2', 'cov-inv-title', '🎒 INVENTORY');
  const gsLine = el('div', 'cov-inv-gs', 'Gear Score: <strong>0</strong>');
  const closeBtn = el('button', 'cov-inv-close', 'Close (Esc)');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close inventory');
  head.append(title, gsLine, closeBtn);

  const sub = el('p', 'cov-inv-sub', 'Drops land here first. Equip what serves the covenant — stats apply the moment the server confirms.');
  const live = el('div', 'cov-inv-live');
  live.setAttribute('aria-live', 'polite');

  const eqTitle = el('h3', 'cov-inv-sec-title', 'EQUIPPED');
  const slotRow = el('div', 'cov-inv-slots');
  const bonusBox = el('div', 'cov-inv-bonus');

  const invTitle = el('h3', 'cov-inv-sec-title', 'BACKPACK');
  const grid = el('div', 'cov-inv-grid');

  frame.append(head, sub, live, eqTitle, slotRow, bonusBox, invTitle, grid);
  overlay.append(frame);
  document.body.appendChild(overlay);

  // Floating comparison tooltip (follows the hovered/focused item card).
  const tip = el('div', 'cov-inv-tip hidden');
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  let state = { inventory: [], equipped: { weapon: null, armor: null, relic: null }, gearBonus: {}, gearScore: 0, cap: 40 };
  const api = { isOpen: false };

  function fmtBonus() {
    const b = state.gearBonus || {};
    const parts = [];
    for (const k of STAT_KEYS) {
      const v = Number(b[k] || 0);
      if (v > 0) parts.push(`${STAT_LABELS[k]} ${STAT_FMT[k](v)}`);
    }
    return parts.length ? parts.join(' · ') : 'No gear bonuses yet.';
  }

  function announce(msg) { live.textContent = msg; }

  function itemAriaLabel(item, action) {
    const statBits = [];
    for (const k of STAT_KEYS) {
      const v = Number(item.stats?.[k] || 0);
      if (v > 0) statBits.push(`${STAT_LABELS[k]} ${STAT_FMT[k](v)}`);
    }
    return `${action}: ${item.rarityName || item.rarity} ${item.name}, gear score ${item.gearScore}. ${statBits.join(', ') || 'No stats'}`;
  }

  function renderSlots() {
    slotRow.innerHTML = '';
    for (const slot of ['weapon', 'armor', 'relic']) {
      const card = el('div', 'cov-inv-slot');
      const label = el('div', 'cov-inv-slot-label', `${SLOT_ICONS[slot]} ${SLOT_NAMES[slot]}`);
      card.append(label);
      const item = state.equipped[slot];
      if (item) {
        const nm = el('p', 'cov-inv-item-name', esc(item.name));
        nm.style.color = item.color || T.parchment;
        const sb = el('div', 'cov-inv-item-sub', `${esc(item.rarityName || item.rarity)} · GS ${item.gearScore}<br>${esc(item.summary || '')}`);
        const btn = el('button', 'cov-inv-btn danger', 'Unequip');
        btn.type = 'button';
        btn.setAttribute('aria-label', `Unequip ${item.name}`);
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (onUnequip) onUnequip(slot); });
        card.append(nm, sb, btn);
      } else {
        card.append(el('div', 'cov-inv-empty', '— empty —'));
      }
      slotRow.append(card);
    }
  }

  function deltaClass(cand, cur) {
    const d = cand - cur;
    if (Math.abs(d) < 1e-9) return 'cov-inv-delta-same';
    return d > 0 ? 'cov-inv-delta-up' : 'cov-inv-delta-down';
  }
  function deltaArrow(cand, cur) {
    const d = cand - cur;
    if (Math.abs(d) < 1e-9) return '—';
    return d > 0 ? '▲' : '▼';
  }

  function showTip(item, anchorEl) {
    const equipped = state.equipped[item.slot];
    let html = `<div class="cov-inv-tip-head" style="color:${esc(item.color || T.parchment)}">${esc(item.name)}</div>`;
    html += `<div class="cov-inv-tip-row"><span class="stat">${esc(item.rarityName || item.rarity)} · GS ${item.gearScore}</span><span>${esc(SLOT_NAMES[item.slot] || item.slot)}</span></div>`;
    html += `<div style="margin:6px 0 2px;font-size:11px;letter-spacing:2px;color:${T.parchmentDim}">CANDIDATE vs EQUIPPED</div>`;
    for (const k of STAT_KEYS) {
      const cand = Number(item.stats?.[k] || 0);
      const cur = Number(equipped?.stats?.[k] || 0);
      if (cand === 0 && cur === 0) continue;
      const cls = deltaClass(cand, cur);
      html += `<div class="cov-inv-tip-row"><span class="stat">${STAT_LABELS[k]}</span>` +
        `<span><span class="${cls}">${deltaArrow(cand, cur)} ${STAT_FMT[k](cand)}</span>` +
        `<span style="color:${T.parchmentDim}"> / ${STAT_FMT[k](cur)}</span></span></div>`;
    }
    const gsD = item.gearScore - (equipped?.gearScore || 0);
    const gsCls = gsD === 0 ? 'cov-inv-delta-same' : (gsD > 0 ? 'cov-inv-delta-up' : 'cov-inv-delta-down');
    html += `<div class="cov-inv-tip-row" style="margin-top:4px"><span class="stat">Gear Score</span>` +
      `<span class="${gsCls}">${gsD === 0 ? '—' : (gsD > 0 ? '▲ +' : '▼ ') + gsD} (${item.gearScore})</span></div>`;
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const r = anchorEl.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 320, Math.max(8, r.right + 12)) + 'px';
    tip.style.top = Math.min(window.innerHeight - tip.offsetHeight - 8, Math.max(8, r.top)) + 'px';
  }
  function hideTip() { tip.classList.add('hidden'); }

  function renderGrid() {
    grid.innerHTML = '';
    if (!state.inventory.length) {
      grid.append(el('div', 'cov-inv-empty', 'Backpack is empty. Slay enemies, crack chests, fell the boss — loot lands here.'));
      return;
    }
    for (const item of state.inventory) {
      const card = el('button', 'cov-inv-card');
      card.type = 'button';
      card.setAttribute('aria-label', itemAriaLabel(item, `Equip ${SLOT_NAMES[item.slot] || item.slot}`));
      card.innerHTML =
        `<div class="cov-inv-rarity" style="color:${esc(item.color || T.parchment)}">${esc(item.rarityName || item.rarity)}</div>` +
        `<div class="cov-inv-gs-tag">GS ${item.gearScore}</div>` +
        `<div class="cov-inv-item-name">${esc(item.name)}</div>` +
        `<div class="cov-inv-item-sub">${esc(item.summary || '')}</div>` +
        `<div class="cov-inv-act"><span class="cov-inv-btn" aria-hidden="true" style="text-align:center;display:block">EQUIP</span></div>`;
      card.addEventListener('click', () => { if (onEquip) onEquip(item.id); announce(`Equipping ${item.name}…`); });
      card.addEventListener('mouseenter', () => showTip(item, card));
      card.addEventListener('mouseleave', hideTip);
      card.addEventListener('focus', () => showTip(item, card));
      card.addEventListener('blur', hideTip);
      grid.append(card);
    }
  }

  function render() {
    gsLine.innerHTML = `Gear Score: <strong>${state.gearScore}</strong> &nbsp;·&nbsp; Backpack ${state.inventory.length}/${state.cap}`;
    invTitle.textContent = `BACKPACK (${state.inventory.length}/${state.cap})`;
    renderSlots();
    bonusBox.innerHTML = `<strong>⚔️ GEAR BONUSES</strong><br>${esc(fmtBonus())}`;
    renderGrid();
  }

  api.update = (data = {}) => {
    state = {
      inventory: Array.isArray(data.inventory) ? data.inventory : [],
      equipped: data.equipped || { weapon: null, armor: null, relic: null },
      gearBonus: data.gearBonus || {},
      gearScore: Number(data.gearScore || 0),
      cap: Number(data.cap || 40)
    };
    render();
  };

  api.show = () => {
    api.isOpen = true;
    overlay.classList.remove('hidden');
    render();
    closeBtn.focus();
  };
  api.hide = () => {
    api.isOpen = false;
    overlay.classList.add('hidden');
    hideTip();
  };
  api.toggle = () => (api.isOpen ? api.hide() : api.show());
  api.announce = announce;

  closeBtn.addEventListener('click', () => api.hide());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) api.hide(); });

  return api;
}
