// lodSystem.js - Phase 4 (workstream 6: PERFORMANCE PASS)
//
// Distance-based LOD tiers for enemies with hysteresis to avoid popping
// flicker. Two entry kinds:
//
//   'mob'    - procedural Phase-2 mob groups. Tiers operate on the bodyRoot
//              subtree only (rings, overhead bars, blob shadows, auras and
//              veils live on the group root and are never touched). Meshes
//              are auto-classified by size at registration time:
//                core  - always visible (torso, head, shield...)
//                decor - hidden at FAR  (pauldrons, quivers, orbiters...)
//                fine  - hidden at MID+ (eyes, arrows, spikes, teeth...)
//              Late-added bodyRoot children are classified lazily.
//   'cinder' - the Cinder Thrall elite (37k-vert GLB). Tiers:
//                near - full GLB + ember wisps
//                mid  - full GLB, wisps off (cheap fill-rate win)
//                far  - GLB off, low-poly impostor on (~250 tris)
//
// Distances are tuned for the game's camera (default distance ~24.5 from
// the follow target, fog density ~0.03): tier switches happen deep enough
// in the fog that they are visually seamless at normal play distance.
//
// Usage (see main.js):
//   const lod = new LODManager();
//   entities.setLodManager(lod);          // createMobMesh registers each mob
//   // per frame:
//   lod.update(camera);

import * as THREE from '/vendor/three.module.js';
import { buildCinderImpostor } from './cinderImpostor.js';

// Tier boundaries (world units, camera -> mob root).
export const LOD_NEAR_DIST = 30;  // < 30 : full detail
export const LOD_MID_DIST = 70;   // 30..70 : fine detail hidden
// > 70 : decor + fine hidden (or impostor for cinder)
export const LOD_HYSTERESIS = 4;

// Size classification thresholds (local units, before group scale).
const FINE_MAX_R = 0.20;
const DECOR_MAX_R = 0.55;

const TIER_CORE = 0;
const TIER_DECOR = 1;
const TIER_FINE = 2;

export class LODManager {
  constructor() {
    this.entries = [];
    this._byRoot = new Map();
    this._cursor = 0;
    this._tmp = new THREE.Vector3();
    this.enabled = true;
    this.stats = { evaluated: 0, switches: 0 };
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      // Restore full detail everywhere so disabling never leaves a mob stuck
      // in a reduced tier.
      for (const e of this.entries) this._apply(e, 0, true);
    }
  }

  // Register a mob group (called from EntityManager.createMobMesh).
  registerMob(root) {
    if (!root || this._byRoot.has(root)) return this._byRoot.get(root) || null;
    const isCinder = !!(root.userData && root.userData.cinder);
    const entry = {
      root,
      kind: isCinder ? 'cinder' : 'mob',
      level: 0,
      bodyRoot: root.userData ? root.userData.bodyRoot || null : null,
      tiers: new Map() // mesh -> TIER_*
    };
    this.entries.push(entry);
    this._byRoot.set(root, entry);
    return entry;
  }

  // Attach the far-tier impostor to a cinder thrall group. Called from
  // EntityManager._mountCinderThrall once the GLB clone is mounted.
  registerCinder(root) {
    let entry = this._byRoot.get(root);
    if (!entry) entry = this.registerMob(root);
    if (!entry) return;
    const c = root.userData ? root.userData.cinder : null;
    if (!c || !c.model || c.impostor) return;
    const imp = buildCinderImpostor();
    imp.scale.copy(c.model.scale);
    imp.visible = false;
    c.root.add(imp);
    c.impostor = imp;
    entry.kind = 'cinder';
    entry.cinder = c;
    // Apply the current tier immediately so a far thrall never flashes
    // the full GLB for a frame.
    this._apply(entry, entry.level, true);
  }

  unregister(root) {
    const entry = this._byRoot.get(root);
    if (!entry) return;
    this._byRoot.delete(root);
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
  }

  // Classify a mesh by its effective radius. Non-mesh objects (sprites,
  // points) and anything we can't measure are 'core' = never hidden.
  _classify(mesh) {
    if (!mesh || !mesh.isMesh || !mesh.geometry) return TIER_CORE;
    let r = 0.3;
    try {
      const g = mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const s = mesh.scale;
      const maxS = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z), 1e-6);
      r = g.boundingSphere.radius * maxS;
    } catch (e) { /* keep default */ }
    // Mob groups are scaled ~1.22x; fold that in so thresholds stay in
    // authoring units.
    return r < FINE_MAX_R ? TIER_FINE : (r < DECOR_MAX_R ? TIER_DECOR : TIER_CORE);
  }

  _tierOf(entry, mesh) {
    let t = entry.tiers.get(mesh);
    if (t === undefined) {
      t = this._classify(mesh);
      entry.tiers.set(mesh, t);
    }
    return t;
  }

  _pickLevel(dist, cur) {
    const h = LOD_HYSTERESIS;
    if (cur === 0) return dist > LOD_NEAR_DIST + h ? 1 : 0;
    if (cur === 1) {
      if (dist > LOD_MID_DIST + h) return 2;
      if (dist < LOD_NEAR_DIST - h) return 0;
      return 1;
    }
    // cur === 2
    return dist < LOD_MID_DIST - h ? 1 : 2;
  }

  _evaluate(entry, camera) {
    entry.root.getWorldPosition(this._tmp);
    const d = camera.position.distanceTo(this._tmp);
    const next = this._pickLevel(d, entry.level);
    this.stats.evaluated++;
    if (next !== entry.level) {
      entry.level = next;
      this.stats.switches++;
      this._apply(entry, next, false);
    }
  }

  _apply(entry, level, force) {
    if (entry.kind === 'cinder') { this._applyCinder(entry, level); return; }
    const body = entry.bodyRoot;
    if (!body) return;
    body.traverse((o) => {
      if (!o.isMesh) return;
      const t = this._tierOf(entry, o);
      const vis = level === 0 || (level === 1 ? t !== TIER_FINE : t === TIER_CORE);
      if (force || o.visible !== vis) o.visible = vis;
    });
  }

  _applyCinder(entry, level) {
    const c = entry.cinder || (entry.root.userData ? entry.root.userData.cinder : null);
    if (!c || !c.loaded || !c.model) return;
    const model = c.model;
    const imp = c.impostor;
    const wisps = c.wisps;
    if (level === 0) {
      model.visible = true;
      if (imp) imp.visible = false;
      if (wisps) wisps.visible = true;
    } else if (level === 1) {
      model.visible = true;
      if (imp) imp.visible = false;
      if (wisps) wisps.visible = false;
    } else {
      model.visible = false;
      if (imp) imp.visible = true;
      if (wisps) wisps.visible = false;
    }
  }

  // Per-frame update. Evaluates ~1/4 of entries per frame (round-robin) so
  // the LOD pass itself stays off the hot path with 24+ mobs.
  update(camera) {
    if (!this.enabled || !camera) return;
    const n = this.entries.length;
    if (n === 0) return;
    const slice = Math.max(1, Math.ceil(n / 4));
    for (let i = 0; i < slice; i++) {
      this._evaluate(this.entries[(this._cursor + i) % n], camera);
    }
    this._cursor = (this._cursor + slice) % n;
  }

  // Test/debug helper: evaluate every entry immediately.
  updateAll(camera) {
    if (!camera) return;
    for (const e of this.entries) this._evaluate(e, camera);
  }
}
