// propInstancer.js - Phase 4 (workstream 6: PERFORMANCE PASS)
//
// InstancedMesh batching for the Phase-1 procedural prop builders.
//
// The level generator places dozens of seeded props per biome zone; each
// prop used to be 4-12 individual meshes (= draw calls). This module batches
// identical prop types into InstancedMeshes: one draw call per (prop type x
// template), with per-instance rotation / uniform scale /
// subtle tint variation so levels never look tiled.
//
// Design notes:
// - Only STATIC_PROP_TYPES are instanced. Props that register atmosphere
//   effects (ember_vent / lava_channel / crucible pulses, brazier / torch
//   flame sprites + point lights) keep their individual groups — batching
//   them would break their per-instance animation.
// - A single template per (type, biome template) is baked with a fixed
//   seed; per-instance rotation, uniform scale, and subtle tint provide the
//   variety so repeated props never look tiled.
// - The template builder closure is injected by propPlacer.js so this
//   module never reaches into propPlacer internals.
// - Decor parts (small radius) are LOD-gated per prop type: beyond
//   PROP_LOD_DIST the decor InstancedMeshes toggle off with hysteresis.
//   Switches happen in fog, so they are seamless at play distance.

import * as THREE from '/vendor/three.module.js';

// Prop types that are fully static (no atmosphere pulses, flames or lights).
export const STATIC_PROP_TYPES = new Set([
  'sarcophagus', 'bone_pile', 'crypt_pillar', 'altar',
  'stalagmite', 'stalactite_cluster', 'rock_spire',
  'anvil', 'hanging_chain',
  'throne', 'grand_pillar', 'banner', 'chest',
  'rubble'
]);

const VARIANTS = 1; // single template variant; per-instance rot/scale/tint is the anti-tiling mechanism
const PROP_LOD_DIST = 55;
const PROP_LOD_HYST = 8;
// Parts smaller than this (local units) are "decor" for the prop LOD tier.
const DECOR_MAX_R = 0.5;

// Tiny deterministic rng (self-contained; must NOT consume the level rng
// stream, so placement sampling stays identical with instancing on/off).
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class PropInstancer {
  // buildTemplate(type, template, seed) -> { group, radius }
  constructor(buildTemplate) {
    this.buildTemplate = buildTemplate;
    this.reset();
  }

  reset() {
    // Release per-floor instance buffers (geometry/material are shared
    // caches — InstancedMesh.dispose() only frees instance attributes).
    if (this._meshes) for (const im of this._meshes) im.dispose();
    this._meshes = [];
    this._variants = new Map();   // key -> [ { parts: [...] } x VARIANTS ]
    this._placements = new Map(); // key -> [ {x, z, rotY, scale, variant} ]
    this._lodSets = new Map();    // key -> { center, decorMeshes, level }
    this._finalized = false;
    this._lodTick = 0;
  }

  _key(type, template) { return `${type}|${template.id}`; }

  addPlacement(type, template, x, z, rotY, placementIndex) {
    const key = this._key(type, template);
    let variants = this._variants.get(key);
    if (!variants) {
      variants = this._buildVariants(type, template);
      this._variants.set(key, variants);
    }
    let list = this._placements.get(key);
    if (!list) { list = []; this._placements.set(key, list); }
    // Deterministic per-instance scale (no level-rng consumption).
    const h = hashStr(`${key}#${placementIndex}`);
    const scale = 0.92 + (h % 1000) / 1000 * 0.20;
    list.push({ x, z, rotY, scale, variant: list.length % VARIANTS });
  }

  _buildVariants(type, template) {
    const out = [];
    for (let v = 0; v < VARIANTS; v++) {
      const rng = mulberry(hashStr(`${type}|${template.id}|v${v}`));
      const built = this.buildTemplate(type, template, rng);
      built.group.updateMatrixWorld(true);
      const parts = [];
      built.group.traverse((child) => {
        if (!child.isMesh) return;
        const g = child.geometry;
        if (!g) return;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const maxS = Math.max(
          Math.abs(child.scale.x), Math.abs(child.scale.y), Math.abs(child.scale.z), 1e-6);
        const radius = g.boundingSphere.radius * maxS;
        parts.push({
          geometry: g,
          material: child.material,
          matrix: child.matrixWorld.clone(),
          castShadow: !!child.castShadow,
          receiveShadow: !!child.receiveShadow,
          radius,
          decor: radius < DECOR_MAX_R,
          tintable: !!child.material && child.material.isMeshStandardMaterial
        });
      });
      out.push({ parts });
    }
    return out;
  }

  // Build every InstancedMesh and attach to parent. Idempotent per reset().
  finalize(parent) {
    if (this._finalized) return;
    this._finalized = true;
    for (const [key, variants] of this._variants) {
      const list = this._placements.get(key) || [];
      if (list.length === 0) continue;
      const center = new THREE.Vector3();
      const decorMeshes = [];
      variants.forEach((variant, vi) => {
        const mine = list.filter((pl) => pl.variant === vi);
        if (mine.length === 0) return;
        variant.parts.forEach((part) => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, mine.length);
          mine.forEach((pl, i) => {
            _e.set(0, pl.rotY, 0);
            _q.setFromEuler(_e);
            _p.set(pl.x, 0, pl.z);
            _s.set(pl.scale, pl.scale, pl.scale);
            _m.compose(_p, _q, _s);
            _m.multiply(part.matrix);
            im.setMatrixAt(i, _m);
            if (part.tintable) {
              const t = 0.90 + ((hashStr(`${key}#${vi}#${i}`) % 1000) / 1000) * 0.18;
              im.setColorAt(i, _c.setRGB(t, t, t));
            }
          });
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.castShadow = part.castShadow;
          im.receiveShadow = part.receiveShadow;
          im.frustumCulled = true;
          im.computeBoundingSphere();
          im.userData.propKey = key;
          im.userData.propDecor = part.decor;
          parent.add(im);
          this._meshes.push(im);
          if (part.decor) decorMeshes.push(im);
        });
        for (const pl of mine) center.add(_p.set(pl.x, 0, pl.z));
      });
      center.divideScalar(Math.max(1, list.length));
      this._lodSets.set(key, { center, decorMeshes, level: 0 });
    }
  }

  // Distance LOD for instanced decor parts. Cheap: one distance check per
  // prop type per call; callers should throttle (every few frames).
  updateLOD(camera) {
    if (!camera || this._lodSets.size === 0) return;
    if ((this._lodTick++ & 3) !== 0) return; // every 4th call
    for (const set of this._lodSets.values()) {
      if (set.decorMeshes.length === 0) continue;
      const d = camera.position.distanceTo(set.center);
      let next = set.level;
      if (set.level === 0 && d > PROP_LOD_DIST + PROP_LOD_HYST) next = 1;
      else if (set.level === 1 && d < PROP_LOD_DIST - PROP_LOD_HYST) next = 0;
      if (next !== set.level) {
        set.level = next;
        const vis = next === 0;
        for (const im of set.decorMeshes) im.visible = vis;
      }
    }
  }

  // Stats for the benchmark / audit.
  stats() {
    let instancedMeshes = 0, instances = 0;
    for (const [key, variants] of this._variants) {
      const list = this._placements.get(key) || [];
      instances += list.length;
      variants.forEach((v, vi) => {
        if (list.some((pl) => pl.variant === vi)) instancedMeshes += v.parts.length;
      });
    }
    return { types: this._variants.size, instancedMeshes, instances };
  }
}
