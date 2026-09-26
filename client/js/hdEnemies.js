// hdEnemies.js — HD enemy/boss model integration for Dungeon of the Covenant.
//
// Replaces the procedural mobs (entities.js createMobMesh) and the procedural
// molten-colossus boss (entities.js createBossMesh) with real rigged GLB
// models when HD_ENEMIES_ENABLED is true AND the model for the type has been
// preloaded. Everything else is OFF: the flag defaults to false, so the
// shipped game is 100% procedural until real models land as
//   client/assets/models/enemy_<type>_hd.glb
//   client/assets/models/boss_<key>_hd.glb
//
// cinder_thrall is DELIBERATELY excluded: it already mounts its real Meshy
// GLB (cinder_thrall.glb, unrigged lava-rock brute) through _mountCinderThrall
// with its own procedural profile, ember wisps, and crumble/sink death.
//
// Design constraints (do not regress):
//  - NO gameplay changes: same hitboxes, same group presence scales, same
//    server modelScale, same state names, same group-level systems (threat
//    ring, overhead bar, blob shadow, combat anim, death fade).
//  - The mounted group MUST present a real THREE.Skeleton with Mixamo-style
//    bone names so animation/detectRig.js takes the SKINNED path (full
//    bone->bone clip retargeting). It must NOT stamp userData.rootBone,
//    leftLeg/rightLeg/leftArm/rightArm/chestGroup/bodyRoot — bodyRoot in
//    particular would select RIG_MOB (detectRig checks it BEFORE the
//    skeleton), not SKINNED.
//  - DOM-free module: safe to import in node smoke tests.
//
// Mob types use the CANONICAL server ids (Room.spawnMob stores
// stats.type after LEGACY_TYPE_MAP resolution; the broadcast mob.type the
// client receives is canonical). See client/assets/models/HD_ENEMY_CONTRACT.md
// for the verified m.type -> model file mapping.
//
// Boot sequence when the flag flips (see HD_ENEMY_CONTRACT.md):
//    import { preloadHdEnemies } from './hdEnemies.js';
//    await preloadHdEnemies();   // once, during client init

import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/vendor/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from '/vendor/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Feature flag + registries
// ---------------------------------------------------------------------------

// Master switch. false = procedural mobs/bosses everywhere (shipped behavior).
// Flip to true only when the enemy_<type>_hd.glb / boss_<key>_hd.glb files
// exist and pass the acceptance checklist in HD_ENEMY_CONTRACT.md.
export const HD_ENEMIES_ENABLED = false;

// Canonical server mob types with HD models. cinder_thrall mounts its real
// GLB already and is excluded on purpose.
export const HD_MOB_TYPES = [
  'skel_warrior',
  'cultist_archer',
  'rot_hound',
  'blight_necrolyte',
  'void_assassin',
  'elite_executioner',
  'elite_lich'
];

// Boss keys are the boss biome ids from server/game/enemies/BossPhases.js
// BOSS_TABLE (what the client receives as bossData.biomeId).
export const HD_BOSS_KEYS = ['crypt', 'cavern', 'forge', 'throne_room'];

// Group-level presence scales — IDENTICAL numbers to the procedural mob
// branches in entities.js createMobMesh (1.22 default; 1.68 executioner;
// 1.64 lich) so HD models read at the same world size.
export const HD_MOB_GROUP_SCALES = {
  elite_executioner: [1.68, 1.68, 1.68],
  elite_lich: [1.64, 1.64, 1.64]
};
export const HD_MOB_GROUP_SCALE_DEFAULT = [1.22, 1.22, 1.22];

// Boss group scale — identical to createBossMesh (1.35).
export const HD_BOSS_GROUP_SCALE = [1.35, 1.35, 1.35];

// Mixamo clip file prefixes per type. The clip pipeline auto-discovers
// <prefix>_<state>.fbx. Prefixes are NOT derivable from the type id by
// string concat (skel_warrior -> enemy_skeleton_warrior), hence this map.
// rot_hound is a quadruped: no Mixamo quadruped clips exist, so its set is
// null and the procedural driver owns it entirely.
export const HD_MOB_CLIP_PREFIXES = {
  skel_warrior: 'enemy_skeleton_warrior',
  cultist_archer: 'enemy_cultist_archer',
  rot_hound: null,
  blight_necrolyte: 'enemy_blight_necrolyte',
  void_assassin: 'enemy_void_assassin',
  elite_executioner: 'enemy_elite_executioner',
  elite_lich: 'enemy_elite_lich'
};

// Clip states per mob role. Casters get 'cast'; everyone biped gets the
// six universal states. Missing files stay procedural — by design.
export const HD_MOB_CLIP_STATES = {
  skel_warrior: ['idle', 'walk', 'run', 'attack', 'hit', 'death'],
  cultist_archer: ['idle', 'walk', 'run', 'attack', 'hit', 'death'],
  rot_hound: [],
  blight_necrolyte: ['idle', 'walk', 'run', 'attack', 'cast', 'hit', 'death'],
  void_assassin: ['idle', 'walk', 'run', 'attack', 'hit', 'death'],
  elite_executioner: ['idle', 'walk', 'run', 'attack', 'hit', 'death'],
  elite_lich: ['idle', 'walk', 'run', 'attack', 'cast', 'hit', 'death']
};

// Boss clip prefixes (boss_<key>_<state>.fbx). boss_sovereign is the only
// one with documented clips (sword slash + magic); the others bind empty
// sets until their clips are delivered — procedural covers them.
export const HD_BOSS_CLIP_PREFIXES = {
  crypt: 'boss_veylith',
  cavern: 'boss_glacius',
  forge: 'boss_malakor',
  throne_room: 'boss_sovereign'
};
export const HD_BOSS_CLIP_STATES = ['idle', 'walk', 'run', 'attack', 'cast', 'hit', 'death'];

export function hdEnemyModelUrl(mobType) {
  return `assets/models/enemy_${mobType}_hd.glb`;
}

export function hdBossModelUrl(bossKey) {
  return `assets/models/boss_${bossKey}_hd.glb`;
}

// ---------------------------------------------------------------------------
// Preload cache
// ---------------------------------------------------------------------------

const _hdMobCache = new Map();  // mobType -> parsed gltf
const _hdBossCache = new Map(); // bossKey -> parsed gltf
let _hdLoader = null;
let _hdPreloadState = 'idle'; // idle | loading | ready | failed

function _getLoader() {
  if (!_hdLoader) {
    _hdLoader = new GLTFLoader();
    // Batch-2 HD enemy/boss models are meshopt-compressed (gltfpack -c with
    // KHR_mesh_quantization); decode them client-side.
    _hdLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return _hdLoader;
}

async function _loadInto(urls, cache) {
  const loader = _getLoader();
  const loaded = [];
  for (const [key, url] of urls) {
    try {
      const gltf = await loader.loadAsync(url);
      if (gltf && gltf.scene) {
        cache.set(key, gltf);
        loaded.push(key);
      }
    } catch (e) {
      // 404 / parse error -> procedural fallback for this type.
      if (typeof console !== 'undefined') {
        console.warn(`[hdEnemies] HD model missing for ${key} (${url}); procedural fallback active.`);
      }
    }
  }
  return loaded;
}

// Load all HD enemy + boss GLBs up front (called once at client boot when
// the flag is on). Missing files are tolerated per-type: that type simply
// falls back to the procedural mob/boss. Never throws.
export async function preloadHdEnemies() {
  if (!HD_ENEMIES_ENABLED) return { state: 'disabled', loaded: [] };
  if (_hdPreloadState === 'ready') {
    return { state: 'ready', loaded: [..._hdMobCache.keys(), ..._hdBossCache.keys()] };
  }
  if (_hdPreloadState === 'loading') return { state: 'loading', loaded: [] };
  _hdPreloadState = 'loading';
  const mobUrls = HD_MOB_TYPES.map((t) => [t, hdEnemyModelUrl(t)]);
  const bossUrls = HD_BOSS_KEYS.map((k) => [k, hdBossModelUrl(k)]);
  const loaded = [
    ...(await _loadInto(mobUrls, _hdMobCache)),
    ...(await _loadInto(bossUrls, _hdBossCache))
  ];
  _hdPreloadState = loaded.length ? 'ready' : 'failed';
  return { state: _hdPreloadState, loaded };
}

// Test seams: inject parsed gltfs without the network.
export function _injectHdEnemyModelForTest(mobType, gltf) {
  _hdMobCache.set(mobType, gltf);
}
export function _injectHdBossModelForTest(bossKey, gltf) {
  _hdBossCache.set(bossKey, gltf);
}
export function _clearHdEnemyCacheForTest() {
  _hdMobCache.clear();
  _hdBossCache.clear();
  _hdPreloadState = 'idle';
}

// Returns the cached gltf, or null when the flag is off, the type/key is
// unknown, or the model isn't preloaded. entities.js branches on this:
// null => procedural mob/boss, unchanged behavior.
export function getHdEnemyModel(mobType) {
  if (!HD_ENEMIES_ENABLED) return null;
  if (!HD_MOB_TYPES.includes(mobType)) return null;
  return _hdMobCache.get(mobType) || null;
}

export function getHdBossModel(bossKey) {
  if (!HD_ENEMIES_ENABLED) return null;
  if (!HD_BOSS_KEYS.includes(bossKey)) return null;
  return _hdBossCache.get(bossKey) || null;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

// First THREE.Skeleton found under the group (bones may live under the
// SkinnedMesh or detached in skeleton.bones — detectRig handles both).
export function findHdSkeleton(group) {
  let found = null;
  group.traverse((o) => {
    if (!found && o.isSkinnedMesh && o.skeleton) found = o.skeleton;
  });
  return found;
}

function prepSkinnedModel(gltf) {
  // Own skeleton instance per mount (SkeletonUtils.clone remaps bone
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
  return model;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

// Mount an HD mob into the group created by createMobMesh (position + threat
// ring already set; group scale set here to the procedural presence value).
// Mirrors everything the procedural path does at the GROUP level (overhead
// bar, finalize pass: PBR/rim-light/blob shadow/combat anim/animator) but
// the body is the real skinned model instead of procedural primitives.
//
//   group   - the fresh THREE.Group from createMobMesh
//   mobType - canonical server mob type (e.g. 'skel_warrior')
//   gltf    - parsed gltf (gltf.scene)
//   ctx     - { manager, name, modelScale }
//             manager: EntityManager (createOverheadBar/finalizeCharacterGroup).
//             Optional in tests: when omitted, bar/finalize are skipped.
//             modelScale: server m.modelScale (1.0 regulars, 1.25 elites,
//             0.72 rot_hound) — applied to the inner model root.
//
// Returns the group (for chaining), or null when gltf is unusable — the
// caller falls back to the procedural mob.
//
// What is deliberately NOT stamped on userData: rootBone, leftLeg, rightLeg,
// leftArm, rightArm, chestGroup, bodyRoot. bodyRoot would select RIG_MOB in
// detectRig (it is checked BEFORE the skeleton); their absence + a real
// Skeleton selects SKINNED. The model root is kept under userData.hdModelRoot
// instead. (Distance-LOD registration is skipped like the HD hero path — the
// LOD tiers operate on the procedural bodyRoot subtree, which doesn't exist
// here.)
export function mountHdMob(group, mobType, gltf, ctx = {}) {
  if (!group || !gltf || !gltf.scene) return null;
  if (!HD_MOB_TYPES.includes(mobType)) return null;

  const model = prepSkinnedModel(gltf);

  // Server-authoritative per-archetype model scale on the inner root;
  // group presence scale mirrors the procedural branches exactly.
  const modelRoot = new THREE.Group();
  modelRoot.name = 'hdModelRoot';
  const ms = ctx.modelScale || 1.0;
  modelRoot.scale.set(ms, ms, ms);
  modelRoot.add(model);
  group.add(modelRoot);

  const [sx, sy, sz] = HD_MOB_GROUP_SCALES[mobType] || HD_MOB_GROUP_SCALE_DEFAULT;
  group.scale.set(sx, sy, sz);

  const skeleton = findHdSkeleton(group);

  group.userData = {
    mobType,
    hdModel: true, // marker: this group came from the HD path
    hdModelRoot: modelRoot,
    skeleton,
    phase: Math.random() * Math.PI * 2,
    isMoving: false,
    isRunning: false
  };

  // Nameplate + PBR / rim-light / blob shadow / combat state / animator —
  // identical to the procedural path. The animator's procedural driver
  // detects the SKINNED rig; _bindMobClipSet (entities.js) retargets any
  // delivered <prefix>_<state>.fbx clips bone->bone. rot_hound binds no
  // clips — its custom quadruped rig is procedural-only by design.
  if (ctx.manager) {
    ctx.manager.createOverheadBar(group, ctx.name, true, false);
    ctx.manager.finalizeCharacterGroup(group, 1.0, 0.55);
  }

  return group;
}

// Mount an HD boss into the group created by createBossMesh (positioned at
// the spawn point). Mirrors the group-level contract of the procedural
// molten colossus: bodyGroup (drives the death tip-over + fade in syncBoss),
// deathCrater (toggled visible on boss death), finalize pass, group scale
// 1.35. No overhead bar — the procedural boss has none (boss name comes
// from the banner UI).
//
//   group   - fresh THREE.Group from createBossMesh
//   bossKey - biome id: 'crypt' | 'cavern' | 'forge' | 'throne_room'
//   gltf    - parsed gltf (gltf.scene)
//   ctx     - { manager } (optional in tests)
//
// Returns the group, or null when gltf is unusable — the caller falls back
// to the procedural colossus.
export function mountHdBoss(group, bossKey, gltf, ctx = {}) {
  if (!group || !gltf || !gltf.scene) return null;
  if (!HD_BOSS_KEYS.includes(bossKey)) return null;

  const model = prepSkinnedModel(gltf);

  const modelRoot = new THREE.Group();
  modelRoot.name = 'hdModelRoot';
  modelRoot.add(model);
  group.add(modelRoot);

  // syncBoss drives the death sequence through userData.bodyGroup
  // (triggerDeathFade / resetDeathFade + combatAnim state), so the HD model
  // root IS the bodyGroup here.
  group.userData.bodyGroup = modelRoot;

  const [sx, sy, sz] = HD_BOSS_GROUP_SCALE;
  group.scale.set(sx, sy, sz);

  // Death crater ring (shown when the boss is vanquished) — same recipe as
  // the procedural path; syncBoss toggles userData.deathCrater.visible.
  const deathCrater = new THREE.Group();
  const craterRing = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 3.2, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff6600, side: THREE.DoubleSide, transparent: true, opacity: 0.75
    })
  );
  craterRing.rotation.x = -Math.PI / 2;
  craterRing.position.y = 0.04;
  deathCrater.add(craterRing);
  deathCrater.visible = false;
  group.add(deathCrater);

  const skeleton = findHdSkeleton(group);

  group.userData.hdModel = true;
  group.userData.hdModelRoot = modelRoot;
  group.userData.deathCrater = deathCrater;
  group.userData.skeleton = skeleton;
  group.userData.bossKey = bossKey;
  group.userData.isMoving = false;

  // PBR / rim-light / blob shadow / combat state / animator — identical to
  // the procedural path. _bindBossClipSet (entities.js) retargets any
  // delivered boss_<key>_<state>.fbx clips bone->bone.
  if (ctx.manager) {
    ctx.manager.finalizeCharacterGroup(group, 2.4, 0.65);
  }

  return group;
}
