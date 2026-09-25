// atmosphere.js - Per-biome atmosphere: exponential fog, particle systems,
// torch flame sprites with flicker, and emissive pulse animation.
//
// Perf budget (mobile-sane):
//   - Real PointLights capped at MAX_TORCH_LIGHTS (8). Everything else is
//     emissive materials + additive sprites (no light cost).
//   - One THREE.Points system per zone, ~130-190 points each.
//   - Geometries/materials for sprites are shared; particle positions are
//     the only per-frame CPU write (~1.2k floats total).

import * as THREE from '/vendor/three.module.js';

function makeFlameTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 36, 2, 32, 36, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.85)');
  g.addColorStop(0.55, 'rgba(255,180,80,0.38)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeSoftDotTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); // biome-owned props (particles, torch lights)
    this.scene.add(this.group);

    // Mood lights owned by the atmosphere (not the renderer), so biome
    // switches never fight the base lighting rig.
    this.ambient = new THREE.AmbientLight(0x33465e, 0.55);
    this.hemi = new THREE.HemisphereLight(0x5a7a9a, 0x0b0906, 0.4);
    this.scene.add(this.ambient);
    this.scene.add(this.hemi);

    this.flameTexture = makeFlameTexture();
    this.dotTexture = makeSoftDotTexture();

    this.flickerLights = []; // {light, base, amp, speed, phase} — all, incl. persistent
    this.flickerSprites = []; // {sprite, ...} — biome pass only (cleared per floor)
    this.persistentSprites = []; // {sprite, ...} — citadel torches (never cleared)
    this.pulses = []; // {mat, base, amp, speed, phase}
    this.particleSystems = []; // {points, data:Float32Array meta, cfg}
    this.torchLights = []; // biome-pass torch lights (cleared per floor)
    this.persistentLights = []; // citadel torch lights (never cleared)
    this.MAX_TORCH_LIGHTS = 8;
  }

  // ---- biome mood -------------------------------------------------------
  applyMood(template) {
    const m = template.mood;
    this.scene.fog = new THREE.FogExp2(template.fog.color, template.fog.density);
    this.ambient.color.setHex(m.ambient);
    this.ambient.intensity = m.ambientIntensity;
    this.hemi.color.setHex(m.hemiSky);
    this.hemi.groundColor.setHex(m.hemiGround);
    this.hemi.intensity = m.hemiIntensity;
  }

  // ---- flames -----------------------------------------------------------
  // persistent=true: citadel torches that survive biome switches.
  makeFlameSprite(colorHex, scale = 0.9, persistent = false) {
    const mat = new THREE.SpriteMaterial({
      map: this.flameTexture,
      color: colorHex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale * 0.75, scale, 1);
    const entry = {
      sprite,
      baseScale: scale,
      speed: 9 + Math.random() * 5,
      phase: Math.random() * Math.PI * 2
    };
    if (persistent) this.persistentSprites.push(entry);
    else this.flickerSprites.push(entry);
    return sprite;
  }

  // Registers a real point light for a torch; returns null once capped.
  // The caller parents the light (scene for citadel torches, prop group for
  // biome props) so local coordinates stay correct.
  // persistent=true: citadel torches that survive biome switches.
  registerTorchLight(x, y, z, colorHex, intensity = 1.6, distance = 11, persistent = false) {
    if (this.torchLights.length + this.persistentLights.length >= this.MAX_TORCH_LIGHTS) return null;
    const light = new THREE.PointLight(colorHex, intensity, distance, 1.6);
    light.position.set(x, y, z);
    this.flickerLights.push({
      light,
      base: intensity,
      amp: 0.28,
      speed: 11 + Math.random() * 6,
      phase: Math.random() * Math.PI * 2
    });
    if (persistent) this.persistentLights.push(light);
    else this.torchLights.push(light);
    return light;
  }

  // Emissive pulse for lava channels / ember vents / rune inlays.
  registerPulse(material, base = 2.0, amp = 0.7, speed = 2.2) {
    this.pulses.push({ mat: material, base, amp, speed, phase: Math.random() * Math.PI * 2 });
  }

  // ---- particles ---------------------------------------------------------
  buildParticles(zone, template) {
    const cfg = template.particles;
    const b = zone.bounds;
    const count = cfg.count;
    const positions = new Float32Array(count * 3);
    const meta = new Float32Array(count * 3); // phase, speedMul, swayAmp
    for (let i = 0; i < count; i++) {
      positions[i * 3] = b.minX + Math.random() * (b.maxX - b.minX);
      positions[i * 3 + 1] = Math.random() * 6;
      positions[i * 3 + 2] = b.minZ + Math.random() * (b.maxZ - b.minZ);
      meta[i * 3] = Math.random() * Math.PI * 2;
      meta[i * 3 + 1] = 0.6 + Math.random() * 0.8;
      meta[i * 3 + 2] = 0.2 + Math.random() * 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      map: this.dotTexture,
      color: cfg.color,
      size: cfg.size,
      transparent: true,
      opacity: cfg.kind === 'embers' ? 0.85 : 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.particleSystems.push({
      points,
      meta,
      kind: cfg.kind,
      speed: cfg.speed,
      rise: cfg.rise,
      bounds: b,
      count
    });
  }

  // ---- lifecycle ----------------------------------------------------------
  clearBiome() {
    // Remove particles + biome torch lights; persistent citadel torches stay.
    for (const ps of this.particleSystems) {
      this.group.remove(ps.points);
      ps.points.geometry.dispose();
      ps.points.material.dispose();
    }
    for (const l of this.torchLights) {
      if (l.parent) l.parent.remove(l);
      const fi = this.flickerLights.findIndex((f) => f.light === l);
      if (fi >= 0) this.flickerLights.splice(fi, 1);
    }
    for (const s of this.flickerSprites) {
      if (s.sprite.parent) s.sprite.parent.remove(s.sprite);
      s.sprite.material.dispose();
    }
    this.particleSystems = [];
    this.torchLights = [];
    this.flickerSprites = [];
    this.pulses = [];
  }

  // ---- per-frame -----------------------------------------------------------
  update(dt, t) {
    const dtc = Math.min(dt, 0.05);

    // Torch light flicker: layered sines read as flame turbulence.
    for (const f of this.flickerLights) {
      const n =
        Math.sin(t * f.speed + f.phase) * 0.5 +
        Math.sin(t * f.speed * 2.7 + f.phase * 1.7) * 0.3 +
        Math.sin(t * f.speed * 6.1 + f.phase * 0.6) * 0.2;
      f.light.intensity = f.base * (1 + f.amp * n);
    }

    // Flame sprite flicker (scale only; cheap). Biome + persistent torches.
    for (const f of this.flickerSprites.concat(this.persistentSprites)) {
      const n = Math.sin(t * f.speed + f.phase) * 0.5 + Math.sin(t * f.speed * 2.3 + f.phase) * 0.5;
      const s = f.baseScale * (1 + 0.16 * n);
      f.sprite.scale.set(s * 0.75, s * (1 + 0.1 * n), 1);
    }

    // Emissive pulses (lava, ember vents).
    for (const p of this.pulses) {
      p.mat.emissiveIntensity = p.base + p.amp * (0.5 + 0.5 * Math.sin(t * p.speed + p.phase));
    }

    // Particle drift.
    for (const ps of this.particleSystems) {
      const pos = ps.points.geometry.attributes.position;
      const arr = pos.array;
      const b = ps.bounds;
      for (let i = 0; i < ps.count; i++) {
        const ph = ps.meta[i * 3];
        const sm = ps.meta[i * 3 + 1];
        const sa = ps.meta[i * 3 + 2];
        let y = arr[i * 3 + 1] + (ps.rise ? ps.speed : -ps.speed * 0.25) * sm * dtc;
        if (y > 6.5) y = 0.1;
        if (y < 0) y = 6.4;
        arr[i * 3 + 1] = y;
        arr[i * 3] += Math.sin(t * 0.9 + ph) * sa * dtc;
        // soft horizontal wrap
        if (arr[i * 3] < b.minX) arr[i * 3] = b.maxX;
        if (arr[i * 3] > b.maxX) arr[i * 3] = b.minX;
      }
      pos.needsUpdate = true;
    }
  }
}
