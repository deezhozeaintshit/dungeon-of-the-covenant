// enhancedcombatvfx.js - Pooled AAA particle engine for hit sparks, death bursts,
// loot beams, shockwave rings and the damage vignette.
//
// Phase 3 rewrite: the old implementation created one Mesh per particle and
// allocated Vector3s every frame, so it could never ship in the hot loop. This
// version is allocation-free after construction:
//   - one THREE.Points buffer per blend mode, fixed capacity, swap-remove
//     compaction, custom point shader (per-particle size/color/alpha)
//   - pooled loot beams and shockwave rings (fixed-size, reused meshes)
//   - DOM damage vignette pulsed by real player-hurt events
//   - particle budget multiplier (low/medium/high) wired to the settings panel
//
// Everything fires on real gameplay events only; nothing here is a mock.

import * as THREE from '/vendor/three.module.js';

// ---------------------------------------------------------------------------
// Fixed-capacity particle pool. Zero allocation in spawn()/update().
// ---------------------------------------------------------------------------
export class ParticlePool {
  constructor(scene, capacity, blending) {
    this.capacity = capacity;
    this.alive = 0;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('psize', this.aSize);
    geo.setAttribute('palpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    // frustumCulled must be off: positions stream every frame and the static
    // bounding sphere would cull live particles.
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      vertexColors: true,
      vertexShader: `
        attribute float psize;
        attribute float palpha;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (240.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float soft = 1.0 - smoothstep(0.12, 0.5, d);
          gl_FragColor = vec4(vColor, vAlpha * soft);
        }`
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    scene.add(this.points);
  }

  // Spawn one particle. Returns false when the pool is exhausted (drop, never grow).
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, gravity, drag, alpha) {
    if (this.alive >= this.capacity) return false;
    const i = this.alive++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grav[i] = gravity; this.drag[i] = drag;
    this.alpha[i] = alpha;
    return true;
  }

  _kill(i) {
    const last = --this.alive;
    if (i !== last) {
      const i3 = i * 3, l3 = last * 3;
      for (let k = 0; k < 3; k++) {
        this.pos[i3 + k] = this.pos[l3 + k];
        this.vel[i3 + k] = this.vel[l3 + k];
        this.col[i3 + k] = this.col[l3 + k];
      }
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.size[i] = this.size[last];
      this.grav[i] = this.grav[last];
      this.drag[i] = this.drag[last];
      this.alpha[i] = this.alpha[last];
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const i3 = i * 3;
      const dr = 1 - this.drag[i] * dt;
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05 && this.vel[i3 + 1] < 0) {
        this.pos[i3 + 1] = 0.05;
        this.vel[i3 + 1] *= -0.35; // cheap ground bounce for debris
      }
      // Write render attributes: fade alpha + shrink size over life.
      const t = this.life[i] / this.maxLife[i];
      this.aPos.array[i3] = this.pos[i3];
      this.aPos.array[i3 + 1] = this.pos[i3 + 1];
      this.aPos.array[i3 + 2] = this.pos[i3 + 2];
      this.aCol.array[i3] = this.col[i3];
      this.aCol.array[i3 + 1] = this.col[i3 + 1];
      this.aCol.array[i3 + 2] = this.col[i3 + 2];
      this.aSize.array[i] = this.size[i] * (0.35 + 0.65 * t);
      this.aAlpha.array[i] = this.alpha[i] * t * t;
      i++;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.alive);
  }

  dispose(scene) {
    scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// Scratch color (no allocation in hot paths)
const _c = { r: 0, g: 0, b: 0 };
function hexToRgb(hex) {
  _c.r = ((hex >> 16) & 255) / 255;
  _c.g = ((hex >> 8) & 255) / 255;
  _c.b = (hex & 255) / 255;
  return _c;
}

export class EnhancedCombatVFX {
  constructor(scene) {
    this.scene = scene;
    // Two blend pools: additive for sparks/magic, normal for blood/debris.
    this.sparks = new ParticlePool(scene, 1400, THREE.AdditiveBlending);
    this.debris = new ParticlePool(scene, 700, THREE.NormalBlending);
    this.budget = 1.0; // particle quality multiplier: 0.35 / 0.7 / 1.0

    this._initBeamPool();
    this._initRingPool();
    this._initVignette();
  }

  // -- Quality ---------------------------------------------------------------
  setParticleBudget(level) {
    if (level === 'low') this.budget = 0.35;
    else if (level === 'high') this.budget = 1.0;
    else this.budget = 0.7; // medium default
  }

  _budgeted(count) {
    const n = Math.round(count * this.budget);
    return n < 1 && count > 0 ? 1 : n;
  }

  // -- Pooled loot beams ------------------------------------------------------
  _initBeamPool() {
    this.beamPool = [];
    this.beamGeo = new THREE.CylinderGeometry(0.45, 0.9, 10, 12, 1, true);
    this.beamRingGeo = new THREE.RingGeometry(0.5, 1.4, 24);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
      });
      const mesh = new THREE.Mesh(this.beamGeo, mat);
      mesh.position.y = 5;
      mesh.visible = false;
      const rmat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
      });
      const ring = new THREE.Mesh(this.beamRingGeo, rmat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.1;
      const group = new THREE.Group();
      group.add(mesh); group.add(ring);
      group.visible = false;
      this.scene.add(group);
      this.beamPool.push({ group, mesh, ring, life: 0, maxLife: 1, active: false, spin: 0 });
    }
  }

  lootBeam(x, z, colorHex = 0xffd700, heightScale = 1) {
    let slot = null;
    for (const b of this.beamPool) { if (!b.active) { slot = b; break; } }
    if (!slot) return; // pool exhausted: drop, never allocate
    hexToRgb(colorHex);
    slot.active = true;
    slot.group.visible = true;
    slot.group.position.set(x, 0, z);
    slot.mesh.material.color.setRGB(_c.r, _c.g, _c.b);
    slot.ring.material.color.setRGB(_c.r, _c.g, _c.b);
    slot.mesh.scale.set(1, heightScale, 1);
    slot.mesh.position.y = 5 * heightScale;
    slot.life = slot.maxLife = 2.6;
    slot.spin = Math.random() * Math.PI * 2;
  }

  // -- Pooled shockwave rings --------------------------------------------------
  _initRingPool() {
    this.ringPool = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1.0, 48);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.ringPool.push({ mesh, life: 0, maxLife: 1, maxRadius: 5, active: false, y: 0.12 });
    }
  }

  shockwaveRing(x, z, colorHex, maxRadius = 5, life = 0.6, y = 0.12) {
    let slot = null;
    for (const r of this.ringPool) { if (!r.active) { slot = r; break; } }
    if (!slot) return;
    hexToRgb(colorHex);
    slot.active = true;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y, z);
    slot.mesh.material.color.setRGB(_c.r, _c.g, _c.b);
    slot.life = slot.maxLife = life;
    slot.maxRadius = maxRadius;
    slot.mesh.scale.setScalar(0.2);
  }

  // -- Damage vignette (DOM, no WebGL cost) ------------------------------------
  _initVignette() {
    this.vignette = 0;
    this.vignetteEl = null;
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.id = 'damage-vignette';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = [
        'position:fixed', 'inset:0', 'pointer-events:none', 'z-index:40',
        'opacity:0',
        'background:radial-gradient(ellipse at center, rgba(180,0,0,0) 42%, rgba(160,8,8,0.55) 78%, rgba(120,0,0,0.85) 100%)',
        'transition:none'
      ].join(';');
      document.body.appendChild(el);
      this.vignetteEl = el;
    }
  }

  // strength 0..1; called when the local player actually loses HP
  pulseDamageVignette(strength) {
    if (!(strength > 0)) return;
    this.vignette = Math.min(0.9, Math.max(this.vignette, strength * 0.85));
  }

  // -- Core combat feedback -----------------------------------------------------
  // Hit sparks: fired by the damage listener on every real hp drop.
  hitSparks(x, y, z, amount = 20, colorHex = 0xffcc66) {
    const n = this._budgeted(amount >= 120 ? 26 : 12);
    hexToRgb(colorHex);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * (amount >= 120 ? 9 : 5);
      const hot = Math.random() < 0.3;
      this.sparks.spawn(
        x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8, z + (Math.random() - 0.5) * 0.8,
        Math.cos(a) * sp, 1.5 + Math.random() * 4, Math.sin(a) * sp,
        0.35 + Math.random() * 0.35, 0.5 + Math.random() * 0.5,
        hot ? 1 : _c.r, hot ? 0.95 : _c.g, hot ? 0.75 : _c.b,
        9, 2.2, 0.95
      );
    }
  }

  // Death burst: mob removed from the snapshot = died.
  deathBurst(x, y, z, colorHex = 0x66ff88) {
    const n = this._budgeted(34);
    hexToRgb(colorHex);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;
      const sp = 2.5 + Math.random() * 5.5;
      this.sparks.spawn(
        x, y + Math.random() * 0.8, z,
        Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.9 + 1.5, Math.sin(ph) * Math.sin(th) * sp,
        0.5 + Math.random() * 0.5, 0.55 + Math.random() * 0.5,
        _c.r, _c.g, _c.b, 7, 1.8, 0.9
      );
    }
    this.shockwaveRing(x, z, colorHex, 4.2, 0.55);
  }

  // Big celebratory burst for boss kills / level-ups.
  grandBurst(x, y, z, colorHex = 0xffd700) {
    const n = this._budgeted(90);
    hexToRgb(colorHex);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 9;
      const gold = Math.random() < 0.55;
      this.sparks.spawn(
        x + (Math.random() - 0.5) * 2, y + Math.random() * 1.5, z + (Math.random() - 0.5) * 2,
        Math.cos(a) * sp, 2 + Math.random() * 7, Math.sin(a) * sp,
        0.7 + Math.random() * 0.8, 0.6 + Math.random() * 0.6,
        gold ? 1 : _c.r, gold ? 0.82 : _c.g, gold ? 0.25 : _c.b,
        6, 1.6, 0.95
      );
    }
    this.shockwaveRing(x, z, colorHex, 8, 0.8);
    this.shockwaveRing(x, z, 0xffffff, 5, 0.5);
  }

  // -- Preset spell effects (original API, now pooled) ---------------------------
  // Each keeps its old signature so existing call sites keep working; they all
  // route into the fixed pools above.

  createFireExplosion(x, y, z) {
    const n = this._budgeted(46);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      const ember = Math.random() < 0.6;
      this.sparks.spawn(
        x, y + 0.3, z,
        Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp,
        0.6 + Math.random() * 0.7, 0.7 + Math.random() * 0.6,
        1, ember ? 0.35 + Math.random() * 0.3 : 0.75, ember ? 0.05 : 0.25,
        -3, 1.9, 0.95
      );
    }
    this.shockwaveRing(x, z, 0xff6600, 6, 0.6);
  }

  createMagicSpell(x, y, z, colorHex = 0x8844ff) {
    const n = this._budgeted(26);
    hexToRgb(colorHex);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.sparks.spawn(
        x, y + 0.5, z,
        Math.cos(a) * 3.2, 0.8 + Math.random() * 1.6, Math.sin(a) * 3.2,
        0.8 + Math.random() * 0.6, 0.55 + Math.random() * 0.4,
        _c.r, _c.g, _c.b, -1.5, 1.1, 0.9
      );
    }
  }

  createHealEffect(x, y, z) {
    const n = this._budgeted(20);
    for (let i = 0; i < n; i++) {
      this.sparks.spawn(
        x + (Math.random() - 0.5) * 1.6, y + Math.random() * 0.5, z + (Math.random() - 0.5) * 1.6,
        (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 2.2, (Math.random() - 0.5) * 0.8,
        1.2 + Math.random() * 0.8, 0.55 + Math.random() * 0.4,
        0.3, 1, 0.55, -2.5, 0.7, 0.85
      );
    }
  }

  createBloodSplash(x, y, z) {
    const n = this._budgeted(30);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 4.5;
      this.debris.spawn(
        x, y + 0.8, z,
        Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp,
        0.5 + Math.random() * 0.5, 0.35 + Math.random() * 0.35,
        0.55 + Math.random() * 0.2, 0.02, 0.03, 12, 1.4, 0.95
      );
    }
  }

  createFrostNova(x, y, z) {
    const n = this._budgeted(44);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      this.sparks.spawn(
        x, y + 0.4, z,
        Math.cos(a) * (3.5 + Math.random() * 2), 0.4 + Math.random() * 1.2, Math.sin(a) * (3.5 + Math.random() * 2),
        0.9 + Math.random() * 0.6, 0.5 + Math.random() * 0.4,
        0.55, 0.85 + Math.random() * 0.15, 1, 1.5, 1.2, 0.9
      );
    }
    this.shockwaveRing(x, z, 0x88ddff, 7, 0.7);
  }

  createBoneSpikes(startX, startZ, dirX, dirZ, length = 10) {
    // Pooled bone-dust + chips along the spike line (the meshes live in combat.js)
    const count = Math.floor(length / 1.6);
    for (let i = 1; i <= count; i++) {
      const d = i * 1.6;
      const px = startX + dirX * d, pz = startZ + dirZ * d;
      const n = this._budgeted(4);
      for (let k = 0; k < n; k++) {
        this.debris.spawn(
          px + (Math.random() - 0.5) * 0.6, 0.4, pz + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 2, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2,
          0.5 + Math.random() * 0.4, 0.4 + Math.random() * 0.3,
          0.91, 0.89, 0.83, 10, 1.2, 0.95
        );
      }
    }
  }

  createCorpseExplosion(x, y, z) {
    this.deathBurst(x, y + 0.4, z, 0x33ff66);
    this.shockwaveRing(x, z, 0x33ff66, 6.5, 0.65);
  }

  createSeismicVortex(x, y, z) {
    const n = this._budgeted(30);
    for (let i = 0; i < n; i++) {
      const a = (i / 30) * Math.PI * 4;
      const r = 1 + (i / 30) * 3;
      this.debris.spawn(
        x + Math.cos(a) * r * 0.3, y + 0.3, z + Math.sin(a) * r * 0.3,
        Math.cos(a) * r * 0.7, 1 + Math.random() * 2.5, Math.sin(a) * r * 0.7,
        0.9 + Math.random() * 0.6, 0.55 + Math.random() * 0.4,
        0.55, 0.42, 0.3, 4, 1.0, 0.9
      );
    }
    this.shockwaveRing(x, z, 0x886644, 5.5, 0.8);
  }

  createMeteorStrike(x, y, z) {
    const n = this._budgeted(40);
    for (let i = 0; i < n; i++) {
      this.sparks.spawn(
        x + (Math.random() - 0.5) * 3, 12 + Math.random() * 6, z + (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 1.5, -9 - Math.random() * 5, (Math.random() - 0.5) * 1.5,
        1.4 + Math.random() * 0.6, 0.8 + Math.random() * 0.5,
        1, 0.45 + Math.random() * 0.2, 0.08, 0, 0.25, 1
      );
    }
    this.createFireExplosion(x, y, z);
  }

  // -- Frame update (zero allocation) --------------------------------------------
  update(dt) {
    this.sparks.update(dt);
    this.debris.update(dt);

    for (const b of this.beamPool) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        b.group.visible = false;
        continue;
      }
      const t = b.life / b.maxLife;
      b.spin += dt * 1.4;
      b.mesh.rotation.y = b.spin;
      b.mesh.material.opacity = 0.55 * t;
      b.ring.material.opacity = 0.8 * t;
      const rs = 1 + (1 - t) * 1.6;
      b.ring.scale.set(rs, rs, rs);
    }

    for (const r of this.ringPool) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const p = 1 - r.life / r.maxLife;
      const eased = 1 - (1 - p) * (1 - p); // ease-out
      r.mesh.scale.setScalar(0.2 + eased * r.maxRadius);
      r.mesh.material.opacity = 0.9 * (1 - p);
    }

    // Damage vignette decay
    if (this.vignette > 0.003) {
      this.vignette = Math.max(0, this.vignette - dt * 1.9);
      if (this.vignetteEl) this.vignetteEl.style.opacity = this.vignette.toFixed(3);
    } else if (this.vignette !== 0) {
      this.vignette = 0;
      if (this.vignetteEl) this.vignetteEl.style.opacity = '0';
    }
  }

  // Pool stats for the performance monitor HUD.
  get activeParticleCount() {
    return this.sparks.alive + this.debris.alive;
  }

  dispose() {
    this.sparks.dispose(this.scene);
    this.debris.dispose(this.scene);
    for (const b of this.beamPool) {
      this.scene.remove(b.group);
      b.mesh.material.dispose();
      b.ring.material.dispose();
    }
    for (const r of this.ringPool) {
      this.scene.remove(r.mesh);
      r.mesh.material.dispose();
    }
    this.beamGeo.dispose();
    this.beamRingGeo.dispose();
    this.ringGeo.dispose();
    if (this.vignetteEl) this.vignetteEl.remove();
  }
}
