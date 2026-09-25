// staticBatcher.js — Workstream 6 (Performance Pass) Phase 4
//
// One-time static-geometry batching for the citadel architecture built by
// DungeonBuilder (walls, caps, floors, pillars, sconce bowls, archways, rune
// circles, fountains, carpets, lava planes, overlays). These meshes are never
// animated, moved, or individually hidden after construction, so they can be
// merged per material into a single draw call each.
//
// Safety rules:
// - Only plain Meshes are merged (no SkinnedMesh, no InstancedMesh, no
//   multi-material groups, no morph targets).
// - Materials are shared by reference, so the existing per-biome retint path
//   (materials.wall.color.set(...), etc.) keeps working unchanged.
// - World transforms are baked into the merged geometry; castShadow /
//   receiveShadow are unioned per material bucket.
// - If a bucket holds a single mesh, or mergeGeometries fails (mixed
//   attribute sets), the original meshes are restored untouched.

import * as THREE from 'three';
import { mergeGeometries } from '/vendor/addons/utils/BufferGeometryUtils.js';

// Master switch for all static batching (citadel architecture + dynamic prop
// part merging). The perf benchmark disables it to measure the true original
// baseline; the game always runs with it on.
let batchingEnabled = true;
export function setBatchingEnabled(on) { batchingEnabled = !!on; }
export function isBatchingEnabled() { return batchingEnabled; }

export function batchStaticMeshes(root, opts = {}) {
  const exclude = opts.exclude || (() => false);
  root.updateMatrixWorld(true);

  const buckets = new Map(); // material.uuid -> bucket
  const it = meshIterator(root, exclude);
  for (;;) {
    const next = it.next();
    if (next.done) break;
    const m = next.value;
    const parent = m.parent;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const key = m.material.uuid;
    let b = buckets.get(key);
    if (!b) {
      b = { material: m.material, items: [], castShadow: false, receiveShadow: false };
      buckets.set(key, b);
    }
    b.items.push({ mesh: m, parent, geo });
    b.castShadow = b.castShadow || m.castShadow;
    b.receiveShadow = b.receiveShadow || m.receiveShadow;
    parent.remove(m);
  }

  let mergedMeshes = 0;
  let restoredMeshes = 0;
  for (const b of buckets.values()) {
    if (b.items.length === 1) {
      // Singleton: nothing to gain, restore the original.
      const it0 = b.items[0];
      it0.parent.add(it0.mesh);
      it0.geo.dispose();
      restoredMeshes++;
      continue;
    }
    let merged = null;
    try {
      merged = mergeGeometries(b.items.map(i => i.geo), false);
    } catch (e) {
      merged = null;
    }
    if (merged) {
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = b.receiveShadow;
      mesh.matrixAutoUpdate = false; // world transform already baked in
      mesh.userData.batched = true; // marks batcher-owned geometry for disposal
      root.add(mesh);
      mergedMeshes++;
      for (const it0 of b.items) it0.geo.dispose();
    } else {
      // Attribute mismatch (e.g. indexed mixed with non-indexed): restore.
      for (const it0 of b.items) {
        it0.parent.add(it0.mesh);
        it0.geo.dispose();
        restoredMeshes++;
      }
    }
  }
  return { buckets: buckets.size, mergedMeshes, restoredMeshes };
}

function* meshIterator(root, exclude) {
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (o.isMesh && !exclude(o) && !o.isSkinnedMesh && !o.isInstancedMesh &&
        !Array.isArray(o.material) && !(o.morphTargetInfluences && o.morphTargetInfluences.length)) {
      yield o;
    }
    for (let i = o.children.length - 1; i >= 0; i--) stack.push(o.children[i]);
  }
}

// Dispose geometries owned by the batcher (merged clones) under root.
// Call before discarding a batched group (e.g. per-floor prop rebuilds) so
// GPU buffers don't drip across floor changes. Shared source geometries and
// materials are never touched — only meshes flagged userData.batched.
export function disposeBatchedMeshes(root) {
  if (!root) return;
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.batched && o.geometry) {
      o.geometry.dispose();
      n++;
    }
  });
  return n;
}
