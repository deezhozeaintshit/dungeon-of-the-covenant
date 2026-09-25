// ui/oathModal.js — Covenant Oath swear-ceremony UI + oath shrine rendering.
//
// Wires into main.js via:
//   import { initOathModal } from './ui/oathModal.js?v=5.0';
//   const oathUI = initOathModal({ network, hud, scene, getLocalPlayerId: () => myPlayerId });
//   Object.assign(networkCallbacks, oathUI.handlers);
//   // in the render loop: oathUI.tick(dt, elapsed)
//   // on snapshot.signature: oathUI.syncShrines(shrines)
//
// Server messages handled: oath_shrine_available, oath_shrines_spawned,
// oath_sworn, oath_swear_denied, oath_broken, dungeon_whisper,
// dungeon_adaptation, nemesis_fled, nemesis_returned, nemesis_slain.

import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { COVENANT_THEME } from './theme.js';

const T = COVENANT_THEME;
const MODEL_URLS = {
  oath_obelisk: '/assets/models/covenant_obelisk.glb',
  oath_altar: '/assets/models/soul_altar.glb'
};
const HOLD_MS = 1200;

const css = (el, styles) => Object.assign(el.style, styles);
const el = (tag, html = '', styles = {}) => {
  const n = document.createElement(tag);
  if (html) n.innerHTML = html;
  css(n, styles);
  return n;
};

export function initOathModal({ network, hud, scene = null, getLocalPlayerId = () => null } = {}) {
  const gltfLoader = new GLTFLoader();
  const modelCache = {};
  const shrineNodes = new Map(); // shrineId -> { group, ring, light, baseY }
  let overlay = null;
  let currentOffer = null; // { shrineId, shrineName, choices }
  let selectedOathId = null;
  let holdTimer = null;
  let holdStart = 0;

  const myBadges = new Map(); // oathId -> badge element

  // ---------------------------------------------------------- shrine 3D ----
  function loadModel(url) {
    if (modelCache[url]) return Promise.resolve(modelCache[url]);
    return new Promise((resolve, reject) => {
      gltfLoader.load(url, (gltf) => {
        modelCache[url] = gltf.scene;
        resolve(gltf.scene);
      }, undefined, reject);
    });
  }

  function syncShrines(shrines = []) {
    if (!scene) return;
    const seen = new Set();
    for (const s of shrines) {
      seen.add(s.id);
      if (shrineNodes.has(s.id)) continue;
      const group = new THREE.Group();
      group.position.set(s.x, 0, s.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.2, 2.7, 48),
        new THREE.MeshBasicMaterial({ color: 0x9d4edd, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.12;
      group.add(ring);
      const light = new THREE.PointLight(0x9d4edd, 12, 14, 1.8);
      light.position.set(0, 3.2, 0);
      group.add(light);
      scene.add(group);
      const node = { group, ring, light };
      shrineNodes.set(s.id, node);
      loadModel(MODEL_URLS[s.model] || MODEL_URLS.oath_obelisk).then((model) => {
        const m = model.clone();
        m.scale.setScalar(s.model === 'oath_altar' ? 1.15 : 1.0);
        group.add(m);
      }).catch(() => {});
    }
    for (const [id, node] of shrineNodes) {
      if (!seen.has(id)) {
        scene.remove(node.group);
        shrineNodes.delete(id);
      }
    }
  }

  function tick(dt, elapsed) {
    for (const node of shrineNodes.values()) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4);
      node.ring.material.opacity = 0.3 + 0.4 * pulse;
      node.ring.scale.setScalar(1 + 0.08 * pulse);
      node.light.intensity = 8 + 8 * pulse;
    }
  }

  // ---------------------------------------------------------- badges -------
  function ensureBadgeBar() {
    let bar = document.getElementById('oath-badges');
    if (!bar) {
      bar = el('div', '', {
        position: 'fixed', top: '86px', right: '14px', zIndex: 6000,
        display: 'flex', flexDirection: 'column', gap: '6px', pointerEvents: 'none'
      });
      bar.id = 'oath-badges';
      document.body.appendChild(bar);
    }
    return bar;
  }

  function addBadge(oathId, oathName, icon) {
    if (myBadges.has(oathId)) return;
    const bar = ensureBadgeBar();
    const b = el('div',
      `<span style="font-size:18px">${icon}</span><span>${oathName}</span>`, {
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(20,8,28,0.92)', border: `1px solid ${T.violet}`,
        borderRadius: '8px', padding: '6px 10px', color: T.parchment,
        fontFamily: T.fontBody, fontSize: '12px', letterSpacing: '0.04em',
        boxShadow: '0 0 12px rgba(157,78,221,0.35)'
      });
    b.title = 'A sworn covenant oath — breaking it invites a curse';
    bar.appendChild(b);
    myBadges.set(oathId, b);
  }

  function removeBadge(oathId) {
    const b = myBadges.get(oathId);
    if (b) { b.remove(); myBadges.delete(oathId); }
  }

  // ---------------------------------------------------------- ceremony -----
  function closeModal() {
    if (overlay) { overlay.remove(); overlay = null; }
    currentOffer = null;
    selectedOathId = null;
    cancelHold();
  }

  function cancelHold() {
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
    const fill = document.getElementById('oath-seal-fill');
    if (fill) fill.style.width = '0%';
  }

  function requestSwear() {
    if (!currentOffer || !selectedOathId || !network) return;
    network.send({ type: 'swear_oath', shrineId: currentOffer.shrineId, oathId: selectedOathId });
    closeModal();
    if (hud) hud.toast('The dark powers consider your offer...', 'warning');
  }

  function startHold(btn) {
    cancelHold();
    holdStart = performance.now();
    const fill = document.getElementById('oath-seal-fill');
    holdTimer = setInterval(() => {
      const pct = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
      if (fill) fill.style.width = `${pct * 100}%`;
      if (pct >= 1) { clearInterval(holdTimer); holdTimer = null; requestSwear(); }
    }, 30);
  }

  function showOffer({ shrineId, shrineName, choices }) {
    closeModal();
    currentOffer = { shrineId, shrineName, choices };

    overlay = el('div', '', {
      position: 'fixed', inset: '0', zIndex: 9000,
      background: 'rgba(6,3,9,0.90)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '20px'
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Swear a covenant oath');

    const panel = el('div', '', {
      maxWidth: '920px', width: '100%', maxHeight: '92vh', overflowY: 'auto',
      background: T.panel, border: `2px solid ${T.gold}`, borderRadius: '14px',
      padding: '28px 30px', boxShadow: '0 0 60px rgba(157,78,221,0.35), inset 0 0 40px rgba(0,0,0,0.6)'
    });

    panel.appendChild(el('div', 'A DARK POWER STIRS', {
      fontFamily: T.fontDisplay, color: T.violetHi, fontSize: '15px',
      letterSpacing: '0.35em', textAlign: 'center', marginBottom: '6px'
    }));
    panel.appendChild(el('div', `🕯️ ${shrineName} 🕯️`, {
      fontFamily: T.fontDisplay, color: T.goldHi, fontSize: '24px',
      textAlign: 'center', marginBottom: '8px'
    }));
    panel.appendChild(el('div',
      'Three bargains are offered. Each grants <b>real power</b> — each demands a <b>real price</b>, ' +
      'and each binds you to <b>terms</b>. Break the terms and a <b>curse</b> falls upon you, ' +
      'witnessed by the whole party. Choose carefully.', {
        fontFamily: T.fontBody, color: T.parchmentDim, fontSize: '14px',
        textAlign: 'center', marginBottom: '20px', lineHeight: '1.5'
      }));

    const grid = el('div', '', {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: '14px', marginBottom: '18px'
    });

    for (const c of choices) {
      const card = el('div', '', {
        border: `1px solid ${T.panelLine}`, borderRadius: '10px',
        padding: '16px', background: 'rgba(10,6,18,0.85)', cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s'
      });
      card.innerHTML = `
        <div style="font-size:34px;text-align:center;margin-bottom:6px">${c.icon}</div>
        <div style="font-family:${T.fontDisplay};color:${T.goldHi};font-size:16px;text-align:center;margin-bottom:2px">${c.name}</div>
        <div style="font-family:${T.fontBody};color:${T.violetHi};font-style:italic;font-size:12px;text-align:center;margin-bottom:8px">${c.patron}</div>
        <div style="font-family:${T.fontBody};color:${T.parchmentDim};font-style:italic;font-size:12px;text-align:center;margin-bottom:10px;line-height:1.4">"${c.flavor.replace(/^"|"$/g, '')}"</div>
        <div style="font-size:13px;color:${T.heal};margin-bottom:6px;line-height:1.4">✦ ${c.benefit}</div>
        <div style="font-size:13px;color:${T.bloodHi};margin-bottom:6px;line-height:1.4">✖ ${c.cost}</div>
        <div style="font-size:12px;color:${T.parchmentDim};margin-bottom:10px;line-height:1.4"><b style="color:${T.violetHi}">Terms:</b> ${c.term}</div>
        <div style="font-size:12px;color:${T.bloodHi};line-height:1.4"><b>Curse if broken:</b> ${c.curseName} — ${c.curseDesc}</div>`;
      card.addEventListener('click', () => {
        selectedOathId = c.id;
        grid.querySelectorAll(':scope > div').forEach((d) => {
          d.style.borderColor = T.panelLine; d.style.boxShadow = 'none';
        });
        card.style.borderColor = T.bloodHi;
        card.style.boxShadow = '0 0 18px rgba(185,28,28,0.5)';
        confirmBar.style.display = 'block';
        confirmLabel.textContent = `Seal the ${c.name} in blood`;
      });
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    const confirmBar = el('div', '', { display: 'none', marginBottom: '12px', textAlign: 'center' });
    const confirmLabel = el('div', '', {
      fontFamily: T.fontDisplay, color: T.bloodHi, fontSize: '15px',
      letterSpacing: '0.12em', marginBottom: '8px'
    });
    const sealBtn = el('button', '<span id="oath-seal-fill"></span><span style="position:relative">HOLD TO SEAL IN BLOOD</span>', {
      position: 'relative', overflow: 'hidden', width: '100%', padding: '14px',
      fontFamily: T.fontDisplay, fontSize: '15px', letterSpacing: '0.2em',
      color: T.parchment, background: 'rgba(60,8,12,0.9)',
      border: `1px solid ${T.bloodHi}`, borderRadius: '8px', cursor: 'pointer'
    });
    const fill = sealBtn.querySelector('#oath-seal-fill');
    css(fill, {
      position: 'absolute', left: '0', top: '0', bottom: '0', width: '0%',
      background: 'rgba(185,28,28,0.55)', pointerEvents: 'none'
    });
    sealBtn.addEventListener('pointerdown', () => startHold(sealBtn));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      sealBtn.addEventListener(ev, cancelHold));
    confirmBar.appendChild(confirmLabel);
    confirmBar.appendChild(sealBtn);
    panel.appendChild(confirmBar);

    const walkAway = el('button', 'Walk away (refuse all bargains)', {
      display: 'block', margin: '0 auto', padding: '10px 26px',
      fontFamily: T.fontBody, fontSize: '13px', color: T.parchmentDim,
      background: 'transparent', border: `1px solid ${T.goldDim}`,
      borderRadius: '8px', cursor: 'pointer'
    });
    walkAway.addEventListener('click', closeModal);
    panel.appendChild(walkAway);

    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
  }

  // ---------------------------------------------------------- handlers -----
  const toast = (text, kind = 'info') => {
    if (hud && hud.toast) hud.toast(text, kind);
  };

  const handlers = {
    oath_shrine_available(msg) {
      if (msg.playerId && msg.playerId !== getLocalPlayerId()) return;
      showOffer({ shrineId: msg.shrineId, shrineName: msg.shrineName, choices: msg.choices || [] });
    },

    oath_shrines_spawned(msg) {
      syncShrines(msg.shrines || []);
      if (msg.text) toast(msg.text, 'warning');
    },

    oath_sworn(msg) {
      toast(msg.partyText || `${msg.playerName} swore ${msg.oathName}!`, 'warning');
      if (msg.playerId === getLocalPlayerId()) addBadge(msg.oathId, msg.oathName, msg.icon);
    },

    oath_swear_denied(msg) {
      if (msg.playerId && msg.playerId !== getLocalPlayerId()) return;
      toast(`⛔ The powers refuse: ${msg.reason}`, 'danger');
    },

    oath_broken(msg) {
      toast(msg.partyText || `${msg.playerName} broke ${msg.oathName}!`, 'danger');
      if (msg.playerId === getLocalPlayerId()) removeBadge(msg.oathId);
    },

    dungeon_whisper(msg) {
      toast(msg.text, 'warning');
    },

    dungeon_adaptation() { /* spawn VFX hook point for the coordinator */ },

    nemesis_fled(msg) {
      toast(msg.text, 'danger');
    },

    nemesis_returned(msg) {
      toast(msg.text, 'danger');
    },

    nemesis_slain(msg) {
      toast(msg.text, 'info');
    }
  };

  return { handlers, syncShrines, tick, showOffer, closeModal };
}

export default { initOathModal };
