// ui/levelup.js — level-up choice modal, skill-tree panel, XP bar hook,
// death-respawn countdown. Display-only: every pick/spend/respawn goes to
// the server, which validates and broadcasts the authoritative result.
// Styling is self-contained (scoped <style> injected once) using the
// Covenant dark-fantasy tokens from theme.js. Additive: hud.js is untouched;
// main.js calls updateXPBar() from handleSnapshot next to updateVitals.

import { COVENANT_THEME as T } from './theme.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const css = `
  .cov-levelup-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse at center, rgba(20,10,40,.82), rgba(6,3,9,.94));backdrop-filter:blur(3px)}
  .cov-levelup-overlay.hidden{display:none}
  .cov-levelup-frame{max-width:980px;width:min(94vw,980px);text-align:center;padding:26px 18px 30px;
    background:${T.panel};border:1px solid ${T.panelLine};border-radius:14px;
    box-shadow:0 0 60px rgba(157,78,221,.35), inset 0 0 40px rgba(0,0,0,.55)}
  .cov-levelup-title{font-family:${T.fontDisplay};color:${T.goldHi};font-size:34px;letter-spacing:4px;margin:0 0 4px;
    text-shadow:0 0 18px rgba(255,215,0,.45)}
  .cov-levelup-sub{font-family:${T.fontBody};color:${T.parchmentDim};font-size:14px;margin:0 0 20px;letter-spacing:1px}
  .cov-choice-row{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
  .cov-choice-card{width:250px;min-height:300px;padding:20px 16px 22px;cursor:pointer;text-align:center;
    background:linear-gradient(180deg, rgba(45,20,77,.9), rgba(16,11,28,.96));
    border:1px solid ${T.violet};border-radius:10px;color:${T.parchment};
    transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease}
  .cov-choice-card:hover,.cov-choice-card:focus-visible{transform:translateY(-6px) scale(1.02);
    border-color:${T.goldHi};box-shadow:0 0 28px rgba(212,175,55,.5);outline:none}
  .cov-choice-icon{font-size:52px;line-height:1.2;filter:drop-shadow(0 0 10px rgba(157,78,221,.8))}
  .cov-choice-name{font-family:${T.fontDisplay};color:${T.gold};font-size:20px;margin:10px 0 2px;letter-spacing:1px}
  .cov-choice-branch{font-size:11px;letter-spacing:3px;color:${T.violetHi};text-transform:uppercase;margin-bottom:8px}
  .cov-choice-desc{font-family:${T.fontBody};font-size:13.5px;color:${T.parchmentDim};line-height:1.5;min-height:64px}
  .cov-choice-rank{margin-top:10px;font-size:12px;color:${T.goldSoft};letter-spacing:1px}
  .cov-choice-pick{margin-top:12px;display:inline-block;padding:8px 22px;border:1px solid ${T.gold};
    color:${T.goldHi};font-family:${T.fontDisplay};letter-spacing:2px;font-size:13px;border-radius:6px}
  .cov-choice-card:hover .cov-choice-pick{background:rgba(212,175,55,.16)}
  .cov-tree-overlay{position:fixed;inset:0;z-index:8900;display:flex;align-items:center;justify-content:center;
    background:rgba(6,3,9,.88);backdrop-filter:blur(2px)}
  .cov-tree-overlay.hidden{display:none}
  .cov-tree-frame{width:min(96vw,1020px);max-height:92vh;overflow-y:auto;padding:24px 22px 28px;
    background:${T.panel};border:1px solid ${T.panelLine};border-radius:14px}
  .cov-tree-head{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px}
  .cov-tree-title{font-family:${T.fontDisplay};color:${T.goldHi};font-size:26px;letter-spacing:3px;margin:0}
  .cov-tree-points{font-family:${T.fontBody};color:${T.parchment};font-size:15px}
  .cov-tree-points strong{color:${T.goldHi};font-size:19px}
  .cov-tree-close{background:none;border:1px solid ${T.panelLine};color:${T.parchmentDim};border-radius:6px;
    padding:6px 14px;cursor:pointer;font-family:${T.fontBody};font-size:13px;letter-spacing:1px}
  .cov-tree-close:hover{color:${T.goldHi};border-color:${T.gold}}
  .cov-branch{margin-top:18px}
  .cov-branch-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .cov-branch-icon{font-size:26px}
  .cov-branch-name{font-family:${T.fontDisplay};color:${T.gold};font-size:18px;letter-spacing:2px}
  .cov-branch-tag{font-size:12px;color:${T.parchmentDim}}
  .cov-tree-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  .cov-node{padding:14px;border:1px solid rgba(157,78,221,.4);border-radius:8px;background:rgba(23,16,38,.7)}
  .cov-node.locked{opacity:.45}
  .cov-node-top{display:flex;align-items:center;gap:10px}
  .cov-node-icon{font-size:30px}
  .cov-node-name{font-family:${T.fontDisplay};color:${T.parchment};font-size:15px}
  .cov-node-pips{margin-left:auto;font-size:13px;letter-spacing:2px;color:${T.goldSoft}}
  .cov-node-desc{font-size:12.5px;color:${T.parchmentDim};line-height:1.45;margin:8px 0 10px;min-height:38px}
  .cov-node-btn{width:100%;padding:8px;border-radius:6px;cursor:pointer;font-family:${T.fontDisplay};
    letter-spacing:2px;font-size:13px;border:1px solid ${T.gold};color:${T.goldHi};background:rgba(212,175,55,.08)}
  .cov-node-btn:hover:not(:disabled){background:rgba(212,175,55,.22)}
  .cov-node-btn:disabled{opacity:.35;cursor:not-allowed;border-color:${T.parchmentDim};color:${T.parchmentDim}}
  .cov-death-timer{margin-top:14px;font-family:${T.fontDisplay};color:${T.bloodHi};font-size:17px;letter-spacing:2px}
  `;
  const el = document.createElement('style');
  el.id = 'cov-levelup-styles';
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

// ---------------- level-up choice modal ----------------
// onPick(abilityId) -> client sends { type: 'ability_pick', abilityId }.
export function initLevelUpModal({ onPick } = {}) {
  injectStyles();
  const overlay = el('div', 'cov-levelup-overlay hidden');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Choose a covenant blessing');
  const frame = el('div', 'cov-levelup-frame');
  const title = el('h2', 'cov-levelup-title', '✦ COVENANT BLESSING ✦');
  const sub = el('p', 'cov-levelup-sub', 'The dark offers power. Choose ONE.');
  const row = el('div', 'cov-choice-row');
  frame.append(title, sub, row);
  overlay.append(frame);
  document.body.appendChild(overlay);

  const api = {
    isOpen: false,
    // choices: [{ id, name, icon, description, branchName, rank, maxRanks }]
    show({ level = 1, choices = [] } = {}) {
      title.textContent = `✦ LEVEL ${level} — COVENANT BLESSING ✦`;
      row.innerHTML = '';
      for (const c of choices) {
        const card = el('button', 'cov-choice-card');
        card.type = 'button';
        card.setAttribute('aria-label', `Choose ${c.name}`);
        const pips = '●'.repeat(c.rank) + '○'.repeat(Math.max(0, c.maxRanks - c.rank));
        card.innerHTML =
          `<div class="cov-choice-icon" aria-hidden="true">${esc(c.icon)}</div>` +
          `<div class="cov-choice-name">${esc(c.name)}</div>` +
          `<div class="cov-choice-branch">${esc(c.branchName || c.branch || '')}</div>` +
          `<div class="cov-choice-desc">${esc(c.description)}</div>` +
          `<div class="cov-choice-rank">RANK ${c.rank} / ${c.maxRanks} &nbsp;<span aria-hidden="true">${pips}</span></div>` +
          `<span class="cov-choice-pick">CHOOSE</span>`;
        card.addEventListener('click', () => {
          api.hide();
          if (typeof onPick === 'function') onPick(c.id);
        });
        row.append(card);
      }
      overlay.classList.remove('hidden');
      api.isOpen = true;
      const first = row.querySelector('.cov-choice-card');
      if (first) first.focus();
    },
    hide() {
      overlay.classList.add('hidden');
      api.isOpen = false;
    }
  };
  return api;
}

// ---------------- skill tree panel ----------------
// onSpend(abilityId) -> client sends { type: 'skill_tree_spend', abilityId }.
// render(build, classKey): build = server build_update payload's `build`.
export function initSkillTreePanel({ onSpend } = {}) {
  injectStyles();
  const overlay = el('div', 'cov-tree-overlay hidden');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Covenant skill tree');
  const frame = el('div', 'cov-tree-frame');
  const head = el('div', 'cov-tree-head');
  const title = el('h2', 'cov-tree-title', '🌑 COVENANT SKILL TREE');
  const points = el('div', 'cov-tree-points', '');
  const close = el('button', 'cov-tree-close', 'CLOSE [T]');
  close.type = 'button';
  head.append(title, points, close);
  const body = el('div', '', '');
  frame.append(head, body);
  overlay.append(frame);
  document.body.appendChild(overlay);

  const api = {
    isOpen: false,
    show() { overlay.classList.remove('hidden'); api.isOpen = true; },
    hide() { overlay.classList.add('hidden'); api.isOpen = false; },
    toggle() { api.isOpen ? api.hide() : api.show(); },
    render(build = {}) {
      const pts = build.abilityPoints || 0;
      points.innerHTML = `Skill points: <strong>${pts}</strong> &nbsp;•&nbsp; Level ${build.level || 1} ${esc(build.name || '')}`;
      body.innerHTML = '';
      const branches = { wrath: { name: 'Wrath', icon: '⚔️', tag: 'Offense — shred them faster' }, aegis: { name: 'Aegis', icon: '🛡️', tag: 'Defense — endure the dark' } };
      const tree = build.tree || {};
      for (const branchId of ['wrath', 'aegis']) {
        const b = branches[branchId];
        const nodes = tree[branchId] || [];
        if (!nodes.length) continue;
        const sec = el('section', 'cov-branch');
        sec.innerHTML = `<div class="cov-branch-head"><span class="cov-branch-icon" aria-hidden="true">${b.icon}</span>` +
          `<span class="cov-branch-name">${b.name.toUpperCase()}</span><span class="cov-branch-tag">${b.tag}</span></div>`;
        const grid = el('div', 'cov-tree-grid');
        for (const n of nodes) {
          const maxed = n.rank >= n.maxRanks;
          const canAfford = n.affordable && !maxed;
          const node = el('div', `cov-node${n.eligible ? '' : ' locked'}`);
          const pips = '●'.repeat(n.rank) + '○'.repeat(Math.max(0, n.maxRanks - n.rank));
          node.innerHTML =
            `<div class="cov-node-top"><span class="cov-node-icon" aria-hidden="true">${esc(n.icon)}</span>` +
            `<span class="cov-node-name">${esc(n.name)}</span>` +
            `<span class="cov-node-pips" aria-hidden="true">${pips}</span></div>` +
            `<div class="cov-node-desc">${esc(n.description)}</div>`;
          const btn = el('button', 'cov-node-btn',
            !n.eligible ? 'CLASS LOCKED' : maxed ? 'MAX RANK' : pts > 0 ? `SPEND POINT (${n.rank + 1}/${n.maxRanks})` : 'NO POINTS');
          btn.type = 'button';
          btn.disabled = !canAfford;
          btn.addEventListener('click', () => {
            if (typeof onSpend === 'function') onSpend(n.id);
          });
          node.append(btn);
          grid.append(node);
        }
        sec.append(grid);
        body.append(sec);
      }
    }
  };

  close.addEventListener('click', () => api.hide());
  window.addEventListener('keydown', (e) => {
    if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!document.querySelector('.cov-levelup-overlay:not(.hidden)')) api.toggle();
    }
  });

  return api;
}

// ---------------- XP bar hook (additive; hud.js untouched) ----------------
// main.js handleSnapshot calls this next to hud.updateVitals():
//   LevelUp.updateXPBar({ level: lp.level, xp: lp.xp, nextLevelXp: lp.nextLevelXp });
export function updateXPBar({ level = 1, xp = 0, nextLevelXp = 100 } = {}) {
  const fill = $('hud-xp-fill');
  const lvl = $('hud-hero-level');
  if (fill) fill.style.width = `${clamp01(xp / Math.max(1, nextLevelXp)) * 100}%`;
  if (lvl) lvl.textContent = `LVL ${Math.max(1, Math.floor(level))}`;
}

// ---------------- death-respawn countdown ----------------
// Call on `player_died` (start) and each tick while dead. Writes into the
// existing death screen; no screens.js changes needed.
export function renderRespawnCountdown(sec) {
  let timerEl = $('death-respawn-timer');
  if (!timerEl) {
    const actions = document.querySelector('#death-screen .death-actions');
    timerEl = document.createElement('div');
    timerEl.id = 'death-respawn-timer';
    timerEl.className = 'cov-death-timer';
    timerEl.setAttribute('aria-live', 'polite');
    if (actions) actions.before(timerEl);
    else $('death-screen')?.append(timerEl);
  }
  const s = Math.max(0, Math.ceil(Number(sec) || 0));
  timerEl.textContent = s > 0
    ? `REFORGING IN ${s}s — or respawn NOW for 10% XP`
    : 'REFORGING…';
}

// Rewires the existing death-screen respawn button to the server-authoritative
// early-respawn path. main.js currently sends sendInput({action:'respawn'})
// which Room ignores; call bindRespawnButton({ onRequest }) once at boot and
// have onRequest send { type: 'respawn_request' } over the socket.
export function bindRespawnButton({ onRequest } = {}) {
  const btn = $('btn-respawn');
  if (!btn || btn.dataset.covBound) return;
  btn.dataset.covBound = '1';
  btn.addEventListener('click', () => {
    if (typeof onRequest === 'function') onRequest();
  });
}

export default { initLevelUpModal, initSkillTreePanel, updateXPBar, renderRespawnCountdown, bindRespawnButton };
