// ringBatcher.js — Workstream 6 (Performance Pass) Phase 4
//
// Every mob carries a flat threat ring (RingGeometry, per-type color). At
// 24+ mobs that is 24+ individual draw calls for an unanimated, radially
// symmetric quad. This batches all mob threat rings into ONE InstancedMesh
// with per-instance color; per-frame matrices are rebuilt from each mob
// group's position/scale (24 matrix composes — negligible vs 23 draw calls).
//
// The ring is radially symmetric, so mob facing rotation is irrelevant; only
// position, the 0.05 height offset, the -90° X tilt, and group scale matter.
// A hidden or scene-detached mob collapses to a zero-scale instance.

import * as THREE from '/vendor/three.module.js';

const RING_INNER = 0.8;
const RING_OUTER = 1.04;
const RING_SEGMENTS = 28;
const RING_Y = 0.05;

let sharedGeo = null;
function ringGeometry() {
  if (!sharedGeo) sharedGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, RING_SEGMENTS);
  return sharedGeo;
}

// Master switch mirroring staticBatcher: the perf benchmark disables ring
// batching to measure the true original baseline; the game always runs
// with it on.
let ringBatchingEnabled = true;
export function setRingBatchingEnabled(on) { ringBatchingEnabled = !!on; }
export function isRingBatchingEnabled() { return ringBatchingEnabled; }

export class RingBatcher {
  constructor(scene, capacity = 128) {
    this.scene = scene;
    this.entries = []; // { group, color: THREE.Color }
    this.capacity = capacity;
    const mat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.82
    });
    this.mesh = new THREE.InstancedMesh(ringGeometry(), mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // instances span the dungeon
    this.mesh.count = 0;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(-Math.PI / 2, 0, 0);
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    // Start hidden until the first update() fills real matrices.
    this._m.makeScale(0.0001, 0.0001, 0.0001);
    this._m.setPosition(0, -100, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  register(group, colorHex) {
    this.unregister(group);
    this.entries.push({ group, color: new THREE.Color(colorHex) });
  }

  unregister(group) {
    const i = this.entries.findIndex((e) => e.group === group);
    if (i >= 0) this.entries.splice(i, 1);
  }

  has(group) {
    return this.entries.some((e) => e.group === group);
  }

  get count() {
    return this.entries.length;
  }

  update() {
    const n = Math.min(this.entries.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const e = this.entries[i];
      const g = e.group;
      if (g.visible && g.parent) {
        this._p.set(g.position.x, g.position.y + RING_Y, g.position.z);
        this._q.setFromEuler(this._e);
        this._s.set(g.scale.x, g.scale.y, g.scale.z);
      } else {
        this._p.set(0, -100, 0);
        this._q.identity();
        this._s.set(0.0001, 0.0001, 0.0001);
      }
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, e.color);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.entries.length = 0;
  }
}
