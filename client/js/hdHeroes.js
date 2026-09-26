// hdHeroes.js — HD hero model integration for Dungeon of the Covenant.
//
// Replaces the procedural blocky heroes (entities.js createArticulatedPlayerMesh)
// with real rigged GLB models when HD_HEROES_ENABLED is true AND the model for
// the class has been preloaded. Everything else is OFF: the flag defaults to
// false, so the shipped game is 100% procedural until real models land as
//   client/assets/models/hero_<class>_hd.glb
//
// Design constraints (do not regress):
//  - NO gameplay changes: same hitboxes, same classScales, same state names,
//    same group-level systems (ground ring, overhead bar, auras, LOD, combat
//    anim, cosmetics sync).
//  - The mounted group MUST present a real THREE.Skeleton with Mixamo-style
//    bone names so animation/detectRig.js takes the SKINNED path (full
//    bone->bone clip retargeting). It must NOT stamp userData.rootBone,
//    leftLeg/rightLeg/leftArm/rightArm/chestGroup/bodyRoot — any of those
//    forces the low-detail virtual-pivot path.
//  - DOM-free module: safe to import in node smoke tests.
//
// Boot sequence when the flag flips (see HD_HERO_CONTRACT.md):
//    import { preloadHdHeroes } from './hdHeroes.js';
//    await preloadHdHeroes();   // once, during client init

import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/vendor/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from '/vendor/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Feature flag + model registry
// ---------------------------------------------------------------------------

// Master switch. false = procedural heroes everywhere (shipped behavior).
// Flip to true only when the hero_<class>_hd.glb files exist and pass the
// acceptance checklist in client/assets/models/HD_HERO_CONTRACT.md.
export const HD_HEROES_ENABLED = false;

export const HD_HERO_CLASSES = [
  'juggernaut', 'cleric', 'rogue', 'mage', 'ranger', 'necromancer'
];

// Same class presence scales as the procedural path (entities.js classScales).
// Author every HD model at the SAME base height; presence comes from here.
export const HD_CLASS_SCALES = {
  juggernaut:  [1.45, 1.36, 1.45],
  cleric:      [1.18, 1.28, 1.18],
  rogue:       [1.15, 1.12, 1.15],
  mage:        [1.22, 1.30, 1.22],
  ranger:      [1.20, 1.26, 1.20],
  necromancer: [1.26, 1.35, 1.26]
};

// Levitate offsets, same values as the procedural path. Applied to the HD
// model root; the ground ring stays planted at group origin.
export const HD_LEVITATE_Y = {
  cleric: 0.34,
  necromancer: 0.18
};

// Vault classes reuse base-family models (contract doc). Wired at flag-flip
// time; inert while the flag is off.
export const VAULT_HD_MODEL_MAP = {
  plaguecaller: 'necromancer',
  gravewarden:  'juggernaut',
  hexblade:     'rogue'
};

export function hdModelUrl(classKey) {
  return `assets/models/hero_${classKey}_hd.glb`;
}

export function resolveHdClass(classKey) {
  if (HD_HERO_CLASSES.includes(classKey)) return classKey;
  return VAULT_HD_MODEL_MAP[classKey] || null;
}

// ---------------------------------------------------------------------------
// Preload cache
// ---------------------------------------------------------------------------

const _hdCache = new Map(); // resolved classKey -> parsed gltf
let _hdLoader = null;
let _hdPreloadState = 'idle'; // idle | loading | ready | failed

function _getLoader() {
  if (!_hdLoader) {
    _hdLoader = new GLTFLoader();
    // Batch-1 HD heroes are meshopt-compressed (gltfpack -c with
    // KHR_mesh_quantization); decode them client-side.
    _hdLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return _hdLoader;
}

// Load all six HD hero GLBs up front (called once at client boot when the
// flag is on). Missing files are tolerated per-class: that class simply
// falls back to the procedural hero. Never throws.
export async function preloadHdHeroes() {
  if (!HD_HEROES_ENABLED) return { state: 'disabled', loaded: [] };
  if (_hdPreloadState === 'ready') return { state: 'ready', loaded: [..._hdCache.keys()] };
  if (_hdPreloadState === 'loading') return { state: 'loading', loaded: [] };
  _hdPreloadState = 'loading';
  const loaded = [];
  const loader = _getLoader();
  for (const classKey of HD_HERO_CLASSES) {
    const url = hdModelUrl(classKey);
    try {
      const gltf = await loader.loadAsync(url);
      if (gltf && gltf.scene) {
        _hdCache.set(classKey, gltf);
        loaded.push(classKey);
      }
    } catch (e) {
      // 404 / parse error -> procedural fallback for this class.
      if (typeof console !== 'undefined') {
        console.warn(`[hdHeroes] HD model missing for ${classKey} (${url}); procedural fallback active.`);
      }
    }
  }
  _hdPreloadState = loaded.length ? 'ready' : 'failed';
  return { state: _hdPreloadState, loaded };
}

// Test seam: inject a parsed gltf without the network (used by the node
// smoke test with a synthetic rig).
export function _injectHdModelForTest(classKey, gltf) {
  _hdCache.set(classKey, gltf);
}

export function _clearHdCacheForTest() {
  _hdCache.clear();
  _hdPreloadState = 'idle';
}

// Returns the cached gltf for a class, or null when the flag is off, the
// class is unknown, or the model isn't preloaded. entities.js branches on
// this: null => procedural hero, unchanged behavior.
export function getHdModel(classKey) {
  if (!HD_HEROES_ENABLED) return null;
  const resolved = resolveHdClass(classKey);
  if (!resolved) return null;
  return _hdCache.get(resolved) || null;
}

// ---------------------------------------------------------------------------
// Shared bits (kept behavior-identical to the procedural path)
// ---------------------------------------------------------------------------

// Ground identifier + drop-shadow ring. Same geometry/material recipe as
// createArticulatedPlayerMesh: local hero = green, remote = class trim color.
// syncPlayers replants it every frame via group.userData.heroRing.
export function createGroundRing(isLocal, trimColor) {
  const ringMat = new THREE.MeshBasicMaterial({
    color: isLocal ? 0x2ecc71 : trimColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92
  });
  const heroRing = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.96, 32), ringMat);
  heroRing.rotation.x = -Math.PI / 2;
  heroRing.position.y = 0.03;
  return heroRing;
}

// First THREE.Skeleton found under the group (bones may live under the
// SkinnedMesh or detached in skeleton.bones — detectRig handles both).
export function findHdSkeleton(group) {
  let found = null;
  group.traverse((o) => {
    if (!found && o.isSkinnedMesh && o.skeleton) found = o.skeleton;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

// Mount an HD hero into a fresh player group. Mirrors everything
// createArticulatedPlayerMesh does at the GROUP level (scale, levitate,
// ground ring, overhead bar/nameplate, finalize pass) but the body is the
// real skinned model instead of procedural primitives.
//
//   group    - fresh THREE.Group, already positioned at the spawn point
//   classKey - resolved base class key
//   gltf     - parsed gltf (gltf.scene); cloned with SkeletonUtils.clone so
//              every mounted hero gets its own skeleton instance
//   ctx      - { manager, name, isLocal, trimColor }
//              manager: EntityManager (createOverheadBar/finalizeCharacterGroup).
//              Optional in tests: when omitted, bar/finalize are skipped.
//
// Returns the group (for chaining), or null when gltf is unusable — the
// caller falls back to the procedural hero.
//
// What is deliberately NOT stamped on userData: rootBone, leftLeg, rightLeg,
// leftArm, rightArm, chestGroup, bodyRoot. Those keys select the virtual
// pivot rigs in detectRig(); their absence + a real Skeleton selects SKINNED.
export function mountHdHero(group, classKey, gltf, ctx = {}) {
  if (!group || !gltf || !gltf.scene) return null;
  const resolved = resolveHdClass(classKey) || classKey;

  // Own skeleton instance per hero (SkeletonUtils.clone remaps bone
  // references; plain .clone() would leave bones pointing at the cache).
  const model = skeletonClone(gltf.scene);

  // Shadow + culling hygiene for skinned meshes (bone animation moves
  // vertices outside the bind-pose bounds; never let the mesh get culled).
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
    }
  });

  // Levitate root: cleric / necromancer hover, ring stays at group origin.
  const baseLevitateY = HD_LEVITATE_Y[resolved] || 0;
  const modelRoot = new THREE.Group();
  modelRoot.name = 'hdModelRoot';
  modelRoot.position.y = baseLevitateY;
  modelRoot.add(model);
  group.add(modelRoot);

  // Same class presence scales as the procedural heroes.
  const [sx, sy, sz] = HD_CLASS_SCALES[resolved] || [1.25, 1.25, 1.25];
  group.scale.set(sx, sy, sz);

  // Ground identifier ring (syncPlayers replants it every frame).
  const heroRing = createGroundRing(!!ctx.isLocal, ctx.trimColor || 0xffffff);
  group.add(heroRing);

  // Skeleton ref for anything that needs it (clip binding goes through
  // detectRig, which finds it on its own).
  const skeleton = findHdSkeleton(group);

  group.userData = {
    classKey: resolved,
    hdModel: true, // marker: this group came from the HD path
    heroRing,
    hdModelRoot: modelRoot,
    skeleton,
    baseLevitateY,
    // Phase 3 cosmetic shop: HD models bake their weapons in, so there is no
    // separate weapon group to retint — applyWeaponGlow no-ops safely.
    weaponGroup: null,
    jumpHeight: 0,
    walkPhase: Math.random() * Math.PI * 2,
    idlePhase: Math.random() * Math.PI * 2,
    attackTimer: 0,
    isMoving: false,
    isRunning: false
  };

  // Nameplate / level-badge + PBR / rim-light / blob shadow / combat state /
  // animator — identical to the procedural path. The animator's procedural
  // driver detects the SKINNED rig and the clip set retargets bone->bone.
  if (ctx.manager) {
    ctx.manager.createOverheadBar(group, ctx.name, false, !!ctx.isLocal);
    ctx.manager.finalizeCharacterGroup(group, resolved === 'juggernaut' ? 1.35 : 1.05, 0.55);
  }

  return group;
}
