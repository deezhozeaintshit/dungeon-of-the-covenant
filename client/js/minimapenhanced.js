// client/js/minimapenhanced.js — Phase 3 (workstream 4): canvas minimap with
// fog of war, party/enemy/objective markers, boss-arena frame, legend,
// keyboard toggle. Render-only: reads the server room_state snapshot the
// same way the legacy HUD did — no gameplay logic here.
//
// Fog model (see minimapFog.js):
//   unexplored -> black, explored -> dim room color, visible-now -> bright.
// Enemies render only on explored/visible cells (no wall-hack info leak).
// Markers use shape + legend label, never color alone (WCAG 2.1 AA).
//
// NOTE: the old static-room class was never wired anywhere (main.js kept an
// inline updateMinimap). This rewrite keeps the exported class name so any
// stale references still construct.

import { COVENANT_THEME } from './ui/theme.js';
import {
  DUNGEON_ROOMS, WORLD, VISIBILITY_RADIUS, FogOfWar,
  zoneNameFor, FOG_VISIBLE, FOG_EXPLORED, FOG_UNEXPLORED
} from './minimapFog.js';

const T = COVENANT_THEME;

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class MinimapEnhanced {
  constructor(canvas, opts = {}) {
    this.canvas = canvas || null;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.W = canvas ? canvas.width : 132;
    this.H = canvas ? canvas.height : 132;
    this.network = opts.network || null;

    this.fog = new FogOfWar(1);
    this.visible = true;
    this.objectives = [];
    this._lastMobs = [];
    this._lastBoss = null;
    this._legendOpen = false;
    this._time = 0;

    // Precompute cell -> room index for the 120x128 fog grid.
    this._cellRoom = new Int16Array(this.fog.cols * this.fog.rows).fill(-1);
    for (let r = 0; r < this.fog.rows; r++) {
      for (let c = 0; c < this.fog.cols; c++) {
        const x = WORLD.minX + (c + 0.5);
        const z = WORLD.minZ + (r + 0.5);
        for (let i = 0; i < DUNGEON_ROOMS.length; i++) {
          const rm = DUNGEON_ROOMS[i];
          if (x >= rm.minX && x <= rm.maxX && z >= rm.minZ && z <= rm.maxZ) {
            this._cellRoom[r * this.fog.cols + c] = i;
            break;
          }
        }
      }
    }
    this._roomRgb = DUNGEON_ROOMS.map(r => hexToRgb(r.color));
    this._img = this.ctx ? this.ctx.createImageData(this.fog.cols, this.fog.rows) : null;

    if (canvas) {
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Dungeon minimap');
    }
    this._ensureStyles();
    this._buildLegend();
    this._wireNetwork();
  }

  // -- public API --------------------------------------------------------
  setVisible(v) {
    this.visible = !!v;
    if (this.canvas) this.canvas.style.display = this.visible ? '' : 'none';
    if (this._legendEl) this._legendEl.style.display = (this.visible && this._legendOpen) ? '' : 'none';
    const zl = document.getElementById('minimap-zone-label');
    if (zl) zl.style.display = this.visible ? '' : 'none';
    const btn = document.getElementById('btn-minimap-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(this.visible));
      btn.innerHTML = this.visible ? '📍 MAP [G]' : '📍 MAP [G] (off)';
    }
  }

  toggle() { this.setVisible(!this.visible); }
  isVisible() { return this.visible; }

  setObjectives(objectives) {
    this.objectives = Array.isArray(objectives) ? objectives : [];
  }

  resetFog() { this.fog.reset(); }

  // -- network subscriptions --------------------------------------------
  _wireNetwork() {
    if (!this.network || typeof this.network.on !== 'function') return;
    this.network.on('objectives_update', (msg) => {
      if (msg && Array.isArray(msg.objectives)) this.setObjectives(msg.objectives);
    });
    const upsert = (msg) => {
      if (!msg || !msg.objective) return;
      const i = this.objectives.findIndex(o => o.id === msg.objective.id);
      if (i !== -1) this.objectives[i] = msg.objective;
      else this.objectives.push(msg.objective);
    };
    this.network.on('objective_complete', upsert);
    this.network.on('objective_failed', upsert);
    this.network.on('procedural_floor_generated', () => {
      this.setObjectives([]);
      this.resetFog();
    });
  }

  // -- legend (WCAG: shape + text label, never color alone) ----------------
  _ensureStyles() {
    if (document.getElementById('minimap-legend-styles')) return;
    const st = document.createElement('style');
    st.id = 'minimap-legend-styles';
    st.textContent = [
      '#minimap-legend-btn{position:absolute;right:4px;bottom:4px;z-index:6;',
      `background:${T.panel};border:1px solid ${T.panelLine};color:${T.gold};`,
      'border-radius:4px;font-size:11px;line-height:1;padding:3px 6px;cursor:pointer;}',
      '#minimap-legend-btn:focus-visible,#btn-minimap-toggle:focus-visible{',
      `outline:2px solid ${T.goldHi};outline-offset:2px;}`,
      '#minimap-legend{position:absolute;left:4px;top:4px;z-index:6;max-width:172px;',
      `background:${T.panel};border:1px solid ${T.panelLine};border-radius:6px;`,
      `color:${T.parchment};font-family:${T.fontBody};font-size:10px;line-height:1.5;`,
      'padding:6px 8px;box-shadow:0 4px 14px rgba(0,0,0,.6);}',
      '#minimap-legend h4{margin:0 0 4px;font-size:10px;letter-spacing:1px;',
      `color:${T.gold};font-family:${T.fontDisplay};}`,
      '#minimap-legend ul{list-style:none;margin:0;padding:0;}',
      '#minimap-legend li{margin:1px 0;white-space:nowrap;}',
      '#minimap-legend .sw{display:inline-block;width:14px;text-align:center;margin-right:5px;}',
      '#minimap-fogkey{border-top:1px solid rgba(212,175,55,.25);margin-top:5px;padding-top:4px;}'
    ].join('');
    document.head.appendChild(st);
  }

  _buildLegend() {
    const frame = this.canvas ? this.canvas.parentElement : null;
    if (!frame) return;
    if (getComputedStyle(frame).position === 'static') frame.style.position = 'relative';
    const mk = (tag, id) => {
      let el = document.getElementById(id);
      if (!el) { el = document.createElement(tag); el.id = id; frame.appendChild(el); }
      return el;
    };
    const btn = mk('button', 'minimap-legend-btn');
    btn.type = 'button';
    btn.textContent = '?';
    btn.title = 'Minimap legend';
    btn.setAttribute('aria-label', 'Toggle minimap legend');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._legendOpen = !this._legendOpen;
      btn.setAttribute('aria-expanded', String(this._legendOpen));
      if (this._legendEl) this._legendEl.style.display = (this.visible && this._legendOpen) ? '' : 'none';
    });
    const lg = mk('div', 'minimap-legend');
    lg.setAttribute('role', 'note');
    lg.setAttribute('aria-label', 'Minimap legend');
    lg.style.display = 'none';
    lg.innerHTML =
      '<h4>MAP LEGEND</h4><ul>' +
      '<li><span class="sw" style="color:#2ecc71">●</span>You (direction tick)</li>' +
      '<li><span class="sw" style="color:#3ba4ff">■</span>Party ally</li>' +
      '<li><span class="sw" style="color:#ff4444">▲</span>Enemy (explored areas)</li>' +
      '<li><span class="sw" style="color:#ffd700">▲</span>Elite (gold outline)</li>' +
      '<li><span class="sw" style="color:#ff6600">★</span>Boss</li>' +
      '<li><span class="sw" style="color:#f4e6c6">◆</span>Objective marker</li>' +
      '<li><span class="sw" style="color:#ffd700">□</span>Chest / loot</li>' +
      '</ul><div id="minimap-fogkey">' +
      '<div><span class="sw">▓</span>Visible now</div>' +
      '<div><span class="sw">░</span>Explored (dim)</div>' +
      '<div><span class="sw">█</span>Unexplored</div>' +
      '</div>';
    this._legendEl = lg;
  }

  // -- coordinate transform (matches legacy HUD) ---------------------------
  _toMapX(wx) { return ((wx - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * this.W; }
  _toMapY(wz) { return ((wz - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ)) * this.H; }

  // -- main update ---------------------------------------------------------
  update(snapshot, localPlayer, dt = 0.016) {
    if (!this.ctx || !snapshot || !localPlayer) return;
    this._time += dt;
    const fog = this.fog;
    fog.beginFrame();

    // Shared party vision: every alive party member reveals their disc.
    const party = [localPlayer, ...(Array.isArray(snapshot.players) ? snapshot.players : [])];
    for (const p of party) {
      if (!p || p.isDead || p.isDowned) continue;
      fog.reveal(p.x, p.z, VISIBILITY_RADIUS);
    }

    this._lastMobs = Array.isArray(snapshot.mobs) ? snapshot.mobs : [];
    this._lastBoss = snapshot.boss || null;

    this._drawBase();
    this._drawBossArena();
    this._drawLoot(snapshot.floorLoot);
    this._drawObjectives();
    this._drawMobs();
    this._drawBoss();
    this._drawParty(snapshot.players, localPlayer);
    this._drawLocalPlayer(localPlayer);
    this._updateZoneLabel(localPlayer, snapshot);
  }

  _drawBase() {
    const cols = this.fog.cols, rows = this.fog.rows;
    const img = this._img, data = img.data;
    const fs = this.fog.state;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i], o = i * 4;
      if (f === FOG_UNEXPLORED) {
        data[o] = 6; data[o + 1] = 4; data[o + 2] = 10; data[o + 3] = 255;
        continue;
      }
      const ri = this._cellRoom[i];
      if (ri < 0) { // outside rooms: corridor void
        data[o] = f === FOG_VISIBLE ? 18 : 8;
        data[o + 1] = f === FOG_VISIBLE ? 14 : 6;
        data[o + 2] = f === FOG_VISIBLE ? 30 : 12;
        data[o + 3] = 255;
        continue;
      }
      const rgb = this._roomRgb[ri];
      const dim = f === FOG_VISIBLE ? 1.0 : 0.32;
      data[o] = Math.round(rgb[0] * dim);
      data[o + 1] = Math.round(rgb[1] * dim);
      data[o + 2] = Math.round(rgb[2] * dim);
      data[o + 3] = 255;
    }
    // Blit the 120x128 fog grid onto the 132x132 canvas (no smoothing).
    const off = MinimapEnhanced._blit || (MinimapEnhanced._blit = document.createElement('canvas'));
    off.width = cols; off.height = rows;
    off.getContext('2d').putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.ctx.drawImage(off, 0, 0, this.W, this.H);
    this.ctx.imageSmoothingEnabled = true;

    // Gold room outlines on visible cells only (cheap: room rects clipped).
    this.ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
    this.ctx.lineWidth = 1;
    for (const rm of DUNGEON_ROOMS) {
      if (!this._roomTouched(rm)) continue;
      this.ctx.strokeRect(
        this._toMapX(rm.minX), this._toMapY(rm.minZ),
        this._toMapX(rm.maxX) - this._toMapX(rm.minX),
        this._toMapY(rm.maxZ) - this._toMapY(rm.minZ)
      );
    }
  }

  _roomTouched(rm) {
    // Room is worth outlining if any cell inside it is explored.
    const c0 = Math.max(0, Math.floor(rm.minX - WORLD.minX));
    const c1 = Math.min(this.fog.cols - 1, Math.ceil(rm.maxX - WORLD.minX));
    const r0 = Math.max(0, Math.floor(rm.minZ - WORLD.minZ));
    const r1 = Math.min(this.fog.rows - 1, Math.ceil(rm.maxZ - WORLD.minZ));
    for (let r = r0; r <= r1; r += 2) {
      for (let c = c0; c <= c1; c += 2) {
        if (this.fog.state[r * this.fog.cols + c] !== FOG_UNEXPLORED) return true;
      }
    }
    return false;
  }

  _drawBossArena() {
    const b = this._lastBoss;
    if (!b || b.isDead) return;
    const rm = DUNGEON_ROOMS.find(r => r.zoneId === 'boss_sanctum');
    if (!rm || !this._roomTouched(rm)) return;
    const pulse = 0.55 + 0.45 * Math.sin(this._time * 4);
    this.ctx.strokeStyle = `rgba(255, 80, 40, ${0.5 + 0.4 * pulse})`;
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeRect(
      this._toMapX(rm.minX) - 2, this._toMapY(rm.minZ) - 2,
      (this._toMapX(rm.maxX) - this._toMapX(rm.minX)) + 4,
      (this._toMapY(rm.maxZ) - this._toMapY(rm.minZ)) + 4
    );
    this.ctx.strokeStyle = `rgba(212, 175, 55, ${0.35 + 0.3 * pulse})`;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      this._toMapX(rm.minX) - 4, this._toMapY(rm.minZ) - 4,
      (this._toMapX(rm.maxX) - this._toMapX(rm.minX)) + 8,
      (this._toMapY(rm.maxZ) - this._toMapY(rm.minZ)) + 8
    );
    if (b.isAwake) {
      this.ctx.fillStyle = '#ff6a3d';
      this.ctx.font = '700 7px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('BOSS', (this._toMapX(rm.minX) + this._toMapX(rm.maxX)) / 2, this._toMapY(rm.minZ) - 7);
    }
  }

  _drawLoot(floorLoot) {
    if (!Array.isArray(floorLoot)) return;
    for (const l of floorLoot) {
      if (!l || l.pickedUp) continue;
      if (!this.fog.isExplored(l.x, l.z)) continue; // fog-gated
      const x = this._toMapX(l.x), y = this._toMapY(l.z);
      if (l.type === 'treasure_chest' || l.type === 'epic_chest' || l.type === 'objective_relic') {
        this.ctx.strokeStyle = l.type === 'objective_relic' ? T.parchment : T.gold;
        this.ctx.lineWidth = 1.2;
        this.ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
        this.ctx.fillStyle = l.type === 'objective_relic' ? T.parchment : T.goldHi;
        this.ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      } else if (l.type === 'shrine_blood' || l.type === 'shrine_arcane') {
        this.ctx.strokeStyle = l.type === 'shrine_blood' ? '#ff3366' : '#33ccff';
        this.ctx.lineWidth = 1.2;
        this.ctx.beginPath(); this.ctx.arc(x, y, 2.6, 0, Math.PI * 2); this.ctx.stroke();
      }
    }
  }

  _objectiveMarkers() {
    const out = [];
    for (const o of this.objectives) {
      if (!o || o.state !== 'active') continue;
      if (o.type === 'DESTROY_SHRINES' && Array.isArray(o.shrines)) {
        for (const s of o.shrines) {
          if (s && !s.isDead) out.push({ x: s.x, z: s.z, label: 'Shrine' });
        }
      } else if (o.type === 'RECOVER_RELIC') {
        if (o.relicSpot && !o.carrierId) out.push({ x: o.relicSpot.x, z: o.relicSpot.z, label: 'Relic' });
        if (o.altar) out.push({ x: o.altar.x, z: o.altar.z, label: 'Altar' });
      } else if (o.type === 'SLAY_WARDEN' && o.wardenType) {
        for (const m of this._lastMobs) {
          if (m && m.type === o.wardenType && !m.isDead) out.push({ x: m.x, z: m.z, label: 'Warden' });
        }
      }
      // SURVIVE_AMBUSH has no location — no marker (honest, not a guess).
    }
    return out;
  }

  _drawObjectives() {
    for (const mk of this._objectiveMarkers()) {
      const x = this._toMapX(mk.x), y = this._toMapY(mk.z);
      const dim = this.fog.isExplored(mk.x, mk.z) ? 1 : 0.45;
      this.ctx.save();
      this.ctx.globalAlpha = dim;
      // Diamond (rotated square) + parchment fill — shape differs from every
      // combat marker so it never reads as an enemy.
      this.ctx.translate(x, y);
      this.ctx.rotate(Math.PI / 4);
      this.ctx.fillStyle = T.parchment;
      this.ctx.strokeStyle = T.gold;
      this.ctx.lineWidth = 1.2;
      const s = 3.4;
      this.ctx.beginPath();
      this.ctx.rect(-s / 2, -s / 2, s, s);
      this.ctx.fill(); this.ctx.stroke();
      this.ctx.restore();
      this.ctx.fillStyle = T.ink;
      this.ctx.font = '700 5px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('!', x, y + 1.8);
    }
  }

  _drawMobs() {
    for (const m of this._lastMobs) {
      if (!m || m.isDead) continue;
      if (!this.fog.isExplored(m.x, m.z)) continue; // no intel on unexplored cells
      const x = this._toMapX(m.x), y = this._toMapY(m.z);
      const isElite = m.role === 'elite' || m.type === 'elite_executioner' || m.type === 'elite_lich' || m.type === 'cinder_thrall';
      const s = isElite ? 4.2 : 3;
      // Triangle marker (shape != player circle / ally square).
      this.ctx.beginPath();
      this.ctx.moveTo(x, y - s);
      this.ctx.lineTo(x + s * 0.9, y + s * 0.7);
      this.ctx.lineTo(x - s * 0.9, y + s * 0.7);
      this.ctx.closePath();
      this.ctx.fillStyle = '#ff4444';
      this.ctx.fill();
      if (isElite) {
        this.ctx.strokeStyle = T.goldHi;
        this.ctx.lineWidth = 1.4;
        this.ctx.stroke();
      }
    }
  }

  _drawBoss() {
    const b = this._lastBoss;
    if (!b || b.isDead) return;
    if (!this.fog.isExplored(b.x, b.z)) return;
    const x = this._toMapX(b.x), y = this._toMapY(b.z);
    const pulse = 0.7 + 0.3 * Math.sin(this._time * 5);
    this._star(x, y, 5, 5.2 * pulse, 2.4, '#ff6600');
    this.ctx.strokeStyle = T.goldHi;
    this.ctx.lineWidth = 1.2;
    this.ctx.beginPath(); this.ctx.arc(x, y, 6.4 * pulse, 0, Math.PI * 2); this.ctx.stroke();
  }

  _drawParty(players, localId) {
    if (!Array.isArray(players)) return;
    for (const p of players) {
      if (!p || p.id === localId || p.isDead) continue;
      const x = this._toMapX(p.x), y = this._toMapY(p.z);
      const s = 3;
      this.ctx.fillStyle = p.isDowned ? '#ff8800' : '#3ba4ff';
      this.ctx.fillRect(x - s / 2, y - s / 2, s, s);
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }

  _drawLocalPlayer(p) {
    const x = this._toMapX(p.x), y = this._toMapY(p.z);
    this.ctx.fillStyle = '#2ecc71';
    this.ctx.beginPath(); this.ctx.arc(x, y, 3.6, 0, Math.PI * 2); this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1.4;
    this.ctx.stroke();
    // Heading tick.
    const dx = Math.sin(p.rotation || 0), dy = -Math.cos(p.rotation || 0);
    this.ctx.strokeStyle = '#2ecc71';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + dx * 7, y + dy * 7);
    this.ctx.stroke();
  }

  _star(cx, cy, points, outer, inner, fill) {
    this.ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i * Math.PI) / points - Math.PI / 2;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) this.ctx.moveTo(px, py); else this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fillStyle = fill;
    this.ctx.fill();
  }

  _updateZoneLabel(localPlayer, snapshot) {
    const zone = zoneNameFor(localPlayer.x, localPlayer.z);
    const zoneLabel = document.getElementById('minimap-zone-label');
    if (zoneLabel) zoneLabel.innerText = zone;
    // Screen-reader summary (WCAG: canvas content described in text).
    const mobs = this._lastMobs.filter(m => m && !m.isDead && this.fog.isExplored(m.x, m.z)).length;
    const b = this._lastBoss;
    const bossTxt = b && !b.isDead ? ` Boss ${b.name || ''} phase ${b.phase || 1}.` : '';
    this.canvas.setAttribute('aria-label',
      `Dungeon minimap. Zone: ${zone}. ${mobs} enemies tracked in explored areas.${bossTxt} Press G to toggle the minimap.`);
  }
}

export default { MinimapEnhanced };
