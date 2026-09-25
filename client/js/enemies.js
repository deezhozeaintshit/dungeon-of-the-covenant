// ============================================================
// Dungeon of the Covenant — Phase 2 (workstream 1: ENEMIES + LOGIC)
// client/js/enemies.js
// Client-side enemy visuals. RENDER ONLY — never computes damage,
// never sends gameplay messages.
//
// - enemy_telegraph -> ground decals (red circles / cones / points)
//   with a fill sweep showing windup progress
// - enemy_spawn / room_state mobs -> elite aura rings + stealth veil
// - boss_spawn / boss_phase / room_state boss -> boss HP bar + phase banner
//
// Wire-up (coordinator, see server/game/enemies/PROTOCOL.md):
//   const enemyVisuals = new EnemyVisuals(scene, {
//     getMobMesh: (id) => entityManager.mobMeshes.get(id)
//   });
//   // ws dispatch: enemyVisuals.handleMessage(msg)
//   // per frame:   enemyVisuals.update(dt)
//   // on room_state: enemyVisuals.syncElites(state.mobs); enemyVisuals.syncBoss(state.boss);
// ============================================================

import * as THREE from '/vendor/three.module.js';

const DECAL_Y = 0.07;

export class EnemyVisuals {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.getMobMesh = opts.getMobMesh || (() => null);
    this.telegraphs = new Map(); // telId -> { group, fill, start, windupMs }
    this.pendingAuras = new Map(); // enemyId -> { auraColor, stealthed }
    this._buildBossBar();
    this._buildPhaseBanner();
  }

  // -- message entry point -------------------------------------------
  handleMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'enemy_telegraph': this.handleTelegraph(msg); break;
      case 'enemy_spawn': this.handleSpawn(msg); break;
      case 'boss_spawn': this.handleBossSpawn(msg); break;
      case 'boss_phase': this.handleBossPhase(msg); break;
      default: break;
    }
  }

  // -- telegraph decals ------------------------------------------------
  // msg: { telegraph: {id, shape, x, z, radius, angle, coneAngle, duration, color}, windupMs }
  handleTelegraph(msg) {
    const tel = msg.telegraph || msg;
    if (!tel || !tel.id) return;
    const windupMs = msg.windupMs || Math.round((tel.duration || 1) * 1000);
    const radius = Math.max(0.5, tel.radius || 3);
    const color = tel.color != null ? tel.color : 0xff2222;
    // Phase 3: boss telegraphs get a heavier treatment (thicker edge ring,
    // stronger pulse) so multi-phase boss attacks read differently from mob
    // attacks — the decal geometry path is shared with the legacy handler.
    const isBoss = !!msg.isBoss;

    // Replace any duplicate id (re-telegraph).
    this._removeTelegraph(tel.id);

    // Cinder thrall: drive the procedural heavy-attack lunge on windup start.
    // (Mob attacks otherwise show only the telegraph decal; this keeps the
    // elite's strike synced to its telegraph.)
    try {
      const mesh = msg.enemyId ? this.getMobMesh(msg.enemyId) : null;
      if (mesh && mesh.userData && mesh.userData.cinder && mesh.userData.animator) {
        mesh.userData.animator.play('attack', { duration: Math.max(0.45, windupMs / 1000) });
      }
    } catch (e) { /* telegraph rendering must never break */ }

    const group = new THREE.Group();
    group.position.set(tel.x || 0, DECAL_Y, tel.z || 0);

    const edgeMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false
    });
    const fillMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false
    });

    let fill = null;
    const edgeWidth = isBoss ? 0.34 : 0.14;
    if (tel.shape === 'cone') {
      const arc = tel.coneAngle || Math.PI * 0.66;
      const geo = new THREE.CircleGeometry(radius, 28, -arc / 2, arc);
      const mesh = new THREE.Mesh(geo, fillMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = (tel.angle || 0) + Math.PI / 2;
      group.add(mesh);
      fill = mesh;
      fill.scale.set(0.01, 0.01, 0.01); // sweep grows with windup
      const edgeGeo = new THREE.RingGeometry(radius - edgeWidth, radius, 28, 1, -arc / 2, arc);
      const edge = new THREE.Mesh(edgeGeo, edgeMat);
      edge.rotation.x = -Math.PI / 2;
      edge.rotation.z = (tel.angle || 0) + Math.PI / 2;
      group.add(edge);
    } else if (tel.shape === 'point') {
      const geo = new THREE.RingGeometry(0.35, isBoss ? 0.85 : 0.55, 20);
      const mesh = new THREE.Mesh(geo, edgeMat);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
    } else {
      // circle (default)
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 36), fillMat);
      disc.rotation.x = -Math.PI / 2;
      group.add(disc);
      fill = disc;
      fill.scale.set(0.01, 0.01, 0.01);
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius - edgeWidth, radius, 48), edgeMat);
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);
    }

    group.renderOrder = 5;
    this.scene.add(group);
    this.telegraphs.set(tel.id, {
      group, fill,
      start: performance.now(),
      windupMs: Math.max(200, windupMs),
      pulse: Math.random() * Math.PI * 2,
      isBoss
    });
  }

  _removeTelegraph(id) {
    const t = this.telegraphs.get(id);
    if (!t) return;
    this.scene.remove(t.group);
    t.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.telegraphs.delete(id);
  }

  // -- spawns ----------------------------------------------------------
  handleSpawn(msg) {
    const e = msg.enemy;
    if (!e || !e.id) return;
    // Remember aura/stealth so syncElites can apply them the moment the
    // mob mesh exists (mesh creation lags one room_state behind).
    if (e.auraColor != null || e.stealthed) {
      this.pendingAuras.set(e.id, { auraColor: e.auraColor, stealthed: !!e.stealthed });
    }
  }

  // -- elite auras + stealth -------------------------------------------
  // mobsData: room_state.mobs[] entries (see PROTOCOL.md for fields).
  syncElites(mobsData) {
    if (!Array.isArray(mobsData)) return;
    for (const m of mobsData) {
      const pending = this.pendingAuras.get(m.id);
      const auraColor = m.auraColor != null ? m.auraColor : (pending ? pending.auraColor : null);
      const stealthed = !!(m.stealthed || (pending && pending.stealthed));
      if (auraColor == null && !stealthed) continue;
      const mesh = this.getMobMesh(m.id);
      if (!mesh) continue; // mesh not created yet; retry next sync
      this.pendingAuras.delete(m.id);

      if (auraColor != null) {
        let aura = mesh.userData.eliteAura;
        if (!aura || aura.userData.color !== auraColor) {
          if (aura) mesh.remove(aura);
          aura = this._makeAuraRing(auraColor);
          aura.userData.color = auraColor;
          mesh.userData.eliteAura = aura;
          mesh.add(aura);
        }
        aura.visible = true;
      }
      // Stealth veil: additive shimmer shell, non-destructive (we never
      // touch the mob's own materials).
      let veil = mesh.userData.stealthVeil;
      if (stealthed && !veil) {
        veil = new THREE.Mesh(
          new THREE.SphereGeometry(1.15, 18, 14),
          new THREE.MeshBasicMaterial({
            color: 0x8833ff, transparent: true, opacity: 0.16,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.BackSide
          })
        );
        veil.position.y = 1.0;
        mesh.userData.stealthVeil = veil;
        mesh.add(veil);
      } else if (!stealthed && veil) {
        mesh.remove(veil);
        veil.geometry.dispose();
        veil.material.dispose();
        mesh.userData.stealthVeil = null;
      }
      if (veil) veil.visible = stealthed;
    }
  }

  _makeAuraRing(color) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75,
      side: THREE.DoubleSide, depthWrite: false
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.35, 40), mat);
    ring.rotation.x = -Math.PI / 2;
    grp.add(ring);
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 40),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.14,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    inner.rotation.x = -Math.PI / 2;
    grp.add(inner);
    grp.position.y = 0.09;
    grp.renderOrder = 4;
    return grp;
  }

  // -- boss bar + phase banner (DOM) ------------------------------------
  _buildBossBar() {
    const bar = document.createElement('div');
    bar.id = 'phase2-boss-bar';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', 'Boss health');
    bar.style.cssText = [
      'position:fixed', 'top:14px', 'left:50%', 'transform:translateX(-50%)',
      'width:min(560px,72vw)', 'z-index:40', 'display:none',
      'font-family:inherit', 'pointer-events:none', 'text-align:center'
    ].join(';');
    bar.innerHTML = [
      '<div id="p2-boss-name" style="color:#fff;font-weight:700;letter-spacing:2px;',
      'font-size:15px;text-shadow:0 2px 6px #000,0 0 18px rgba(255,60,60,.55);',
      'margin-bottom:4px"></div>',
      '<div id="p2-boss-pips" style="margin-bottom:4px"></div>',
      '<div style="height:14px;background:rgba(0,0,0,.72);border:1px solid #6b6b6b;',
      'border-radius:7px;overflow:hidden">',
      '<div id="p2-boss-fill" style="height:100%;width:100%;border-radius:6px;',
      'background:linear-gradient(90deg,#ff2f2f,#ff7a2f);transition:width .25s"></div></div>',
      '<div id="p2-boss-phase" style="color:#ffd9a0;font-size:12px;margin-top:3px;',
      'letter-spacing:1px;text-shadow:0 1px 4px #000"></div>'
    ].join('');
    document.body.appendChild(bar);
    this.bossBar = bar;
    this.bossFill = bar.querySelector('#p2-boss-fill');
    this.bossName = bar.querySelector('#p2-boss-name');
    this.bossPips = bar.querySelector('#p2-boss-pips');
    this.bossPhaseLabel = bar.querySelector('#p2-boss-phase');
    this._bossId = null;
  }

  _buildPhaseBanner() {
    const b = document.createElement('div');
    b.id = 'phase2-phase-banner';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.style.cssText = [
      'position:fixed', 'top:34%', 'left:50%', 'transform:translate(-50%,-50%) scale(.9)',
      'z-index:60', 'display:none', 'pointer-events:none', 'text-align:center',
      'color:#fff', 'font-weight:800', 'font-size:clamp(22px,4vw,44px)',
      'letter-spacing:4px', 'text-shadow:0 3px 10px #000,0 0 30px rgba(170,51,255,.8)',
      'opacity:0', 'transition:opacity .45s,transform .45s', 'max-width:90vw'
    ].join(';');
    document.body.appendChild(b);
    this.phaseBanner = b;
    this._bannerTimer = null;
  }

  handleBossSpawn(msg) {
    const b = msg.boss;
    if (!b) return;
    this._bossId = b.id;
    this.bossBar.style.display = 'block';
    this.bossName.textContent = (b.name || 'BOSS').toUpperCase();
    this._renderPips(1, 3);
    this.bossPhaseLabel.textContent = b.phaseName || '';
    this._setBossHp(b.hp, b.maxHp);
  }

  handleBossPhase(msg) {
    if (msg.bossId && this._bossId && msg.bossId !== this._bossId) return;
    const phase = msg.phase || 1;
    this._renderPips(phase, 3);
    const label = msg.name ? `PHASE ${phase} — ${msg.name.toUpperCase()}` : `PHASE ${phase}`;
    this.bossPhaseLabel.textContent = msg.name || '';
    // Banner slam.
    const el = this.phaseBanner;
    el.textContent = label;
    el.style.display = 'block';
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translate(-50%,-50%) scale(1)';
    });
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%,-50%) scale(.94)';
      setTimeout(() => { el.style.display = 'none'; }, 500);
    }, 2600);
  }

  _renderPips(phase, total) {
    let html = '';
    for (let i = 1; i <= total; i++) {
      const on = i <= phase;
      html += `<span style="display:inline-block;width:26px;height:6px;margin:0 3px;` +
        `border-radius:3px;background:${on ? '#ffcf5e' : 'rgba(255,255,255,.22)'};` +
        `box-shadow:${on ? '0 0 8px #ffcf5e' : 'none'}"></span>`;
    }
    this.bossPips.innerHTML = html;
  }

  _setBossHp(hp, maxHp) {
    const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    this.bossFill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.bossBar.setAttribute('aria-label', `Boss health ${Math.round(frac * 100)} percent`);
  }

  // bossData: room_state.boss (PhaseBoss.getState() shape, or legacy).
  syncBoss(bossData) {
    if (!bossData || bossData.isDead) {
      if (!bossData) {
        this.bossBar.style.display = 'none';
        this._bossId = null;
      } else {
        // Death: leave the bar up briefly at 0, then hide.
        this._setBossHp(0, bossData.maxHp || 1);
        setTimeout(() => {
          if (this._bossId === bossData.id) {
            this.bossBar.style.display = 'none';
            this._bossId = null;
          }
        }, 4000);
      }
      return;
    }
    if (this._bossId && bossData.id !== this._bossId) return;
    this._bossId = bossData.id;
    if (bossData.isAwake || (bossData.hp < bossData.maxHp)) {
      this.bossBar.style.display = 'block';
    }
    if (bossData.name) this.bossName.textContent = String(bossData.name).toUpperCase();
    this._setBossHp(bossData.hp, bossData.maxHp);
    if (bossData.phase) {
      this._renderPips(bossData.phase, 3);
      this.bossPhaseLabel.textContent = bossData.phaseName || '';
    }
  }

  // -- per-frame ---------------------------------------------------------
  update(dt) {
    const now = performance.now();
    for (const [id, t] of this.telegraphs.entries()) {
      const elapsed = now - t.start;
      const k = Math.min(1, elapsed / t.windupMs);
      // Fill sweep shows windup progress; edge pulses faster near impact.
      if (t.fill) {
        const s = Math.max(0.01, k);
        t.fill.scale.set(s, s, s);
      }
      t.pulse += (dt || 0.016) * (4 + k * 10) * (t.isBoss ? 1.5 : 1);
      const pulse = 0.55 + 0.45 * Math.sin(t.pulse);
      t.group.traverse((o) => {
        if (o.material && o.material.transparent) {
          const base = o === t.fill ? 0.28 : 0.85;
          // Boss decals pulse harder and hold a stronger glow mid-fight.
          o.material.opacity = t.isBoss
            ? base * (0.75 + 0.45 * pulse)
            : base * (0.6 + 0.4 * pulse);
        }
      });
      if (k >= 1) {
        // Linger 120ms so the impact reads, then remove.
        if (elapsed > t.windupMs + 120) this._removeTelegraph(id);
      }
    }
  }

  dispose() {
    for (const id of [...this.telegraphs.keys()]) this._removeTelegraph(id);
    this.pendingAuras.clear();
    if (this.bossBar) this.bossBar.remove();
    if (this.phaseBanner) this.phaseBanner.remove();
    clearTimeout(this._bannerTimer);
  }
}
