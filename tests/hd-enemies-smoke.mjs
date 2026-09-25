// hd-enemies-smoke.mjs — synthetic proof for the HD enemy/boss integration path.
//
// The real HD GLBs don't exist yet (art workers are producing reference
// images; Meshy generation happens later), and NO enemy/boss FBX clips have
// been delivered yet either (client/assets/models/ only carries hero_*.fbx
// as of 2026-09-25). So this test proves the ENTIRE integration path with
// synthetic rigs and the real hero FBX clips as a stand-in (they share the
// same canonical Mixamo bone set the enemy clips will use):
//
//   1. Build synthetic THREE.Skeleton rigs with mixamorig* bone names:
//      a biped enemy (~1.4 m, feet at y=0) and a quadruped rot-hound proxy.
//   2. Mount them through the REAL client/js/hdEnemies.js mountHdMob() /
//      mountHdBoss().
//   3. assert detectRig() sees RIG_SKINNED (not the virtual-pivot RIG_MOB —
//      bodyRoot is deliberately NOT stamped on userData).
//   4. Load the REAL Mixamo FBX clips (hero_*.fbx — all 14) via FBXLoader
//      and retargetClip() each onto the mounted enemy rig.
//   5. assert mapped tracks > 0 for hips/arms/legs; report mapped/dropped.
//   6. Verify clip-prefix discovery: every HD_MOB_CLIP_PREFIXES /
//      HD_BOSS_CLIP_PREFIXES entry resolves to the documented
//      <prefix>_<state>.fbx candidate URLs and reports them missing
//      (files not delivered yet) WITHOUT throwing.
//   7. Flag-default-false + graceful-fallback assertions.
//
// Run: node --loader ./tests/perf-bench-loader.mjs tests/hd-enemies-smoke.mjs
// Exit 0 = all assertions pass.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { detectRig, RIG_SKINNED } from '../client/js/animation/ProceduralFallback.js';
import { retargetClip, canonicalBoneName, MixamoClipSet } from '../client/js/animation/MixamoRig.js';
import {
  HD_ENEMIES_ENABLED,
  HD_MOB_TYPES,
  HD_BOSS_KEYS,
  HD_MOB_GROUP_SCALES,
  HD_MOB_GROUP_SCALE_DEFAULT,
  HD_BOSS_GROUP_SCALE,
  HD_MOB_CLIP_PREFIXES,
  HD_MOB_CLIP_STATES,
  HD_BOSS_CLIP_PREFIXES,
  HD_BOSS_CLIP_STATES,
  hdEnemyModelUrl,
  hdBossModelUrl,
  mountHdMob,
  mountHdBoss,
  getHdEnemyModel,
  getHdBossModel,
  _injectHdEnemyModelForTest,
  _injectHdBossModelForTest,
  _clearHdEnemyCacheForTest
} from '../client/js/hdEnemies.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const MODELS = resolve(__dir, '..', 'client/assets/models');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------------
// 1. Synthetic rigs (stand-ins for the real enemy_<type>_hd.glb files)
// ---------------------------------------------------------------------------

function skinnedSceneFromBones(bones, bindBoneName, geoHeight, geoRadius) {
  const list = Object.values(bones);
  const skeleton = new THREE.Skeleton(list);
  const geo = new THREE.BoxGeometry(geoRadius, geoHeight, geoRadius * 0.7);
  geo.translate(0, geoHeight / 2, 0);
  const n = geo.attributes.position.count;
  const skinIndex = new THREE.BufferAttribute(new Uint16Array(n * 4), 4);
  const skinWeight = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
  const bindIdx = Math.max(0, list.findIndex((b) => b.name === bindBoneName));
  for (let i = 0; i < n; i++) { skinIndex.setX(i, bindIdx); skinWeight.setX(i, 1); }
  geo.setAttribute('skinIndex', skinIndex);
  geo.setAttribute('skinWeight', skinWeight);
  const mesh = new THREE.SkinnedMesh(
    geo, new THREE.MeshStandardMaterial({ color: 0x7a6f8a, roughness: 0.7 })
  );
  const scene = new THREE.Group();
  scene.add(mesh);
  const root = list[0];
  mesh.add(root);
  scene.updateMatrixWorld(true);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();
  return { scene, skeleton, bones };
}

function buildSyntheticEnemy() {
  const bones = {};
  const mk = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones[name] = b;
    return b;
  };
  // Mixamo-style biped, ~1.4 m authored, feet at y=0, facing +Z.
  const hips = mk('mixamorigHips', null, 0, 0.78, 0);
  const spine = mk('mixamorigSpine', hips, 0, 0.10, 0);
  const spine1 = mk('mixamorigSpine1', spine, 0, 0.11, 0);
  const spine2 = mk('mixamorigSpine2', spine1, 0, 0.11, 0);
  const neck = mk('mixamorigNeck', spine2, 0, 0.13, 0);
  mk('mixamorigHead', neck, 0, 0.11, 0);
  for (const side of ['Left', 'Right']) {
    const sx = side === 'Left' ? -1 : 1;
    const sh = mk(`mixamorig${side}Shoulder`, spine2, sx * 0.16, 0.08, 0);
    const arm = mk(`mixamorig${side}Arm`, sh, sx * 0.08, -0.02, 0);
    const fore = mk(`mixamorig${side}ForeArm`, arm, sx * 0.22, 0, 0);
    mk(`mixamorig${side}Hand`, fore, sx * 0.21, 0, 0);
    const up = mk(`mixamorig${side}UpLeg`, hips, sx * 0.09, -0.05, 0);
    const leg = mk(`mixamorig${side}Leg`, up, 0, -0.33, 0);
    mk(`mixamorig${side}Foot`, leg, 0, -0.33, 0.06);
  }
  return skinnedSceneFromBones(bones, 'mixamorigHips', 1.4, 0.4);
}

function buildSyntheticHound() {
  const bones = {};
  const mk = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones[name] = b;
    return b;
  };
  // Custom quadruped rig (documented in HD_ENEMY_CONTRACT.md: no Mixamo
  // clips exist for quadrupeds). Spine runs along +Z, four legs, neck/head.
  const hips = mk('mixamorigHips', null, 0, 0.85, -0.45);
  const spine = mk('mixamorigSpine', hips, 0, 0.05, 0.35);
  const spine1 = mk('mixamorigSpine1', spine, 0, 0.02, 0.35);
  const neck = mk('mixamorigNeck', spine1, 0, 0.12, 0.25);
  mk('mixamorigHead', neck, 0, 0.12, 0.18);
  const legDefs = [
    ['LeftFront', -0.22, 0.28], ['RightFront', 0.22, 0.28],
    ['LeftBack', -0.22, -0.45], ['RightBack', 0.22, -0.45]
  ];
  for (const [tag, x, z] of legDefs) {
    const up = mk(`mixamorig${tag}UpLeg`, tag.includes('Front') ? spine1 : hips, x, -0.10, z);
    const lo = mk(`mixamorig${tag}Leg`, up, 0, -0.35, 0);
    mk(`mixamorig${tag}Foot`, lo, 0, -0.35, 0.05);
  }
  return skinnedSceneFromBones(bones, 'mixamorigHips', 1.1, 0.55);
}

// Stub EntityManager: createOverheadBar/finalizeCharacterGroup need a DOM
// canvas, so the smoke test stubs them and asserts the mount calls them
// (proving the nameplate/finalize code paths stay wired).
const stubCalls = [];
const stubManager = {
  createOverheadBar: (group, name, isHostile, isLocal) => {
    stubCalls.push(['createOverheadBar', name, isHostile, isLocal]);
    group.userData.barCanvas = true;
  },
  finalizeCharacterGroup: (group, shadowRadius, shadowOpacity) => {
    stubCalls.push(['finalizeCharacterGroup', shadowRadius, shadowOpacity]);
    group.userData.animator = { stub: true };
  }
};

// ---------------------------------------------------------------------------
// 2. Flag + fallback behavior (default path unaffected)
// ---------------------------------------------------------------------------

check('HD_ENEMIES_ENABLED defaults to false', HD_ENEMIES_ENABLED === false);
check('getHdEnemyModel returns null while disabled',
  getHdEnemyModel('skel_warrior') === null);
check('getHdBossModel returns null while disabled',
  getHdBossModel('crypt') === null);
check('mountHdMob(null gltf) returns null (procedural fallback)',
  mountHdMob(new THREE.Group(), 'skel_warrior', null, {}) === null);
check('mountHdBoss(null gltf) returns null (procedural fallback)',
  mountHdBoss(new THREE.Group(), 'crypt', null, {}) === null);
check('mountHdMob rejects unknown mob type',
  mountHdMob(new THREE.Group(), 'crypt_ghoul', { scene: new THREE.Group() }, {}) === null);
check('mountHdBoss rejects unknown boss key',
  mountHdBoss(new THREE.Group(), 'void_nexus', { scene: new THREE.Group() }, {}) === null);

// Registry shape assertions (the contract depends on these).
check('7 HD mob types (cinder_thrall excluded)',
  HD_MOB_TYPES.length === 7 && !HD_MOB_TYPES.includes('cinder_thrall'),
  `got [${HD_MOB_TYPES.join(',')}]`);
check('4 HD boss keys', HD_BOSS_KEYS.length === 4, `got [${HD_BOSS_KEYS.join(',')}]`);
check('model URL convention',
  hdEnemyModelUrl('skel_warrior') === 'assets/models/enemy_skel_warrior_hd.glb' &&
  hdBossModelUrl('throne_room') === 'assets/models/boss_throne_room_hd.glb');

// ---------------------------------------------------------------------------
// 3. Mount synthetic mobs through the real mountHdMob()
// ---------------------------------------------------------------------------

const synth = buildSyntheticEnemy();
const synthHound = buildSyntheticHound();
_injectHdEnemyModelForTest('skel_warrior', { scene: synth.scene });
_injectHdEnemyModelForTest('rot_hound', { scene: synthHound.scene });
_injectHdEnemyModelForTest('elite_executioner', { scene: synth.scene });
_injectHdBossModelForTest('crypt', { scene: synth.scene });

const group = new THREE.Group();
group.position.set(10, 0, 20);
const mounted = mountHdMob(group, 'skel_warrior', { scene: synth.scene }, {
  manager: stubManager, name: 'Skeleton Warrior', modelScale: 1.0
});
check('mountHdMob returns the group', mounted === group);

const u = group.userData;
check('regular group presence scale 1.22',
  group.scale.x === 1.22 && group.scale.y === 1.22 && group.scale.z === 1.22,
  `got ${group.scale.x}/${group.scale.y}/${group.scale.z}`);
check('inner model root takes server modelScale (1.0)',
  u.hdModelRoot.scale.x === 1.0 && u.hdModelRoot.scale.y === 1.0);
check('mobType stamped on userData', u.mobType === 'skel_warrior');
check('overhead bar / finalize code paths ran',
  stubCalls.some((c) => c[0] === 'createOverheadBar') &&
  stubCalls.some((c) => c[0] === 'finalizeCharacterGroup'));
check('overhead bar got the mob name, hostile=true',
  stubCalls.some((c) => c[0] === 'createOverheadBar' && c[1] === 'Skeleton Warrior' && c[2] === true));

// Elite presence scale parity with the procedural branch (1.68).
stubCalls.length = 0;
const eliteGroup = new THREE.Group();
mountHdMob(eliteGroup, 'elite_executioner', { scene: synth.scene }, {
  manager: stubManager, name: 'Vorgath, Bone-Executioner', modelScale: 1.25
});
check('elite presence scale 1.68 (procedural parity)',
  eliteGroup.scale.x === 1.68 && eliteGroup.scale.y === 1.68 && eliteGroup.scale.z === 1.68);
check('elite inner root takes server modelScale 1.25',
  eliteGroup.userData.hdModelRoot.scale.x === 1.25);

// The critical invariant: NO virtual-pivot keys, so detectRig can't take the
// low-detail RIG_MOB path (bodyRoot is checked BEFORE the skeleton).
const pivotKeys = ['rootBone', 'leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'chestGroup', 'bodyRoot'];
check('no virtual-pivot keys stamped on userData',
  pivotKeys.every((k) => u[k] === undefined),
  `keys present: ${pivotKeys.filter((k) => u[k] !== undefined).join(',') || 'none'}`);

// Each mount gets its OWN skeleton instance (SkeletonUtils.clone remap).
check('mounted skeletons are independent instances',
  u.skeleton && eliteGroup.userData.skeleton &&
  u.skeleton !== eliteGroup.userData.skeleton);

// Quadruped hound mount.
const houndGroup = new THREE.Group();
mountHdMob(houndGroup, 'rot_hound', { scene: synthHound.scene }, {
  manager: stubManager, name: 'Rot Hound', modelScale: 0.72
});
check('rot_hound mounts (modelScale 0.72 on inner root)',
  houndGroup.userData.hdModelRoot.scale.x === 0.72);
check('rot_hound binds NO clip prefix (quadruped, procedural-only)',
  HD_MOB_CLIP_PREFIXES.rot_hound === null && HD_MOB_CLIP_STATES.rot_hound.length === 0);

// ---------------------------------------------------------------------------
// 4. detectRig must see SKINNED on both rigs
// ---------------------------------------------------------------------------

const rig = detectRig(group);
check('detectRig(biped mob) kind is SKINNED', rig.kind === RIG_SKINNED, `got ${rig.kind}`);
check('SKINNED rig exposes mixamorig bones',
  !!(rig.refs && rig.refs.skeleton && rig.refs.skeleton.bones.length >= 19),
  `bones=${rig.refs && rig.refs.skeleton ? rig.refs.skeleton.bones.length : 0}`);

const houndRig = detectRig(houndGroup);
check('detectRig(quadruped hound) kind is SKINNED', houndRig.kind === RIG_SKINNED,
  `got ${houndRig.kind}`);

// ---------------------------------------------------------------------------
// 5. Retarget the REAL FBX clips onto the mounted synthetic enemy rig
//
// No enemy/boss FBX clips exist yet; the 14 hero clips are the stand-in —
// they use the same canonical Mixamo bone set the enemy clips will use, so
// mapped>0 here proves the bone->bone path for the real clips later.
// ---------------------------------------------------------------------------

const FILE_STATE = {
  'hero_idle.fbx': 'idle',
  'hero_idle_alt03.fbx': 'idle',
  'hero_juggernaut_idle.fbx': 'idle',
  'hero_walk.fbx': 'walk',
  'hero_run.fbx': 'run',
  'hero_attack.fbx': 'attack',
  'hero_rogue_attack.fbx': 'attack',
  'hero_hit.fbx': 'hit',
  'hero_death.fbx': 'death',
  'hero_death_alt_swordshield.fbx': 'death',
  'hero_cast.fbx': 'cast',
  'hero_mage_cast.fbx': 'cast',
  'hero_jump.fbx': 'jump',
  'hero_juggernaut_jump.fbx': 'jump'
};

const ARM_CANONS = new Set(['leftshoulder', 'leftarm', 'leftforearm', 'lefthand',
  'rightshoulder', 'rightarm', 'rightforearm', 'righthand']);
const LEG_CANONS = new Set(['leftupleg', 'leftleg', 'leftfoot',
  'rightupleg', 'rightleg', 'rightfoot']);

const loader = new FBXLoader();
const TRACK_RE = /^(.*)\.(position|quaternion|scale)$/;
let clipCount = 0;

for (const [file, state] of Object.entries(FILE_STATE)) {
  const path = resolve(MODELS, file);
  let clip;
  try {
    const buf = readFileSync(path);
    const parsed = loader.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path);
    const anims = parsed.animations || [];
    if (!anims.length) {
      check(`${file} [${state}] parses with animations`, false, 'no animations');
      continue;
    }
    clip = anims.reduce((a, b) => (a.duration >= b.duration ? a : b));
  } catch (e) {
    check(`${file} [${state}] parses`, false, e.message);
    continue;
  }

  const ret = retargetClip(clip, group);
  if (!ret) {
    check(`${file} [${state}] retargets (non-null)`, false, 'retargetClip returned null');
    continue;
  }
  const { mapped, dropped } = ret.userData;

  const buckets = { hips: 0, spine: 0, head: 0, arms: 0, legs: 0, other: 0 };
  for (const t of ret.tracks) {
    const m = TRACK_RE.exec(t.name);
    if (!m) { buckets.other++; continue; }
    const c = canonicalBoneName(m[1]);
    if (c === 'hips') buckets.hips++;
    else if (c.startsWith('spine')) buckets.spine++;
    else if (c === 'neck' || c === 'head') buckets.head++;
    else if (ARM_CANONS.has(c)) buckets.arms++;
    else if (LEG_CANONS.has(c)) buckets.legs++;
    else buckets.other++;
  }

  const ok = mapped > 0 && buckets.hips > 0 && buckets.arms > 0 && buckets.legs > 0;
  clipCount++;
  check(
    `${file} [${state}] retargeted onto enemy rig`,
    ok,
    `mapped=${mapped} dropped=${dropped} ` +
    `hips=${buckets.hips} spine=${buckets.spine} head=${buckets.head} ` +
    `arms=${buckets.arms} legs=${buckets.legs} other=${buckets.other}`
  );
}

check('all 14 FBX clips processed', clipCount === 14, `got ${clipCount}`);

// Hips carries the root-motion position track: a rig WITHOUT hips still
// retargets (non-null) but loses root motion — this is why Hips is a hard
// contract requirement.
{
  const noHips = buildSyntheticEnemy();
  const hipBone = noHips.bones.mixamorigHips;
  hipBone.name = 'renamed_root'; // break the canonical hips match
  const buf = readFileSync(resolve(MODELS, 'hero_walk.fbx'));
  const parsed = loader.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'hero_walk.fbx');
  const clip = parsed.animations.reduce((a, b) => (a.duration >= b.duration ? a : b));
  const g = new THREE.Group();
  g.add(noHips.scene);
  const ret = retargetClip(clip, g);
  const hipTracks = ret ? ret.tracks.filter((t) => {
    const m = TRACK_RE.exec(t.name);
    return m && canonicalBoneName(m[1]) === 'hips';
  }).length : -1;
  check('rig without Hips still retargets but maps 0 hips tracks (root-motion contract)',
    ret !== null && hipTracks === 0, `hips tracks=${hipTracks}`);
}

// ---------------------------------------------------------------------------
// 6. Clip-prefix discovery: documented filenames resolve; missing files
//    report cleanly without throwing.
// ---------------------------------------------------------------------------

const probeSet = new MixamoClipSet('probe', null, {});
let prefixChecks = 0;
for (const [mobType, prefix] of Object.entries(HD_MOB_CLIP_PREFIXES)) {
  if (!prefix) continue; // rot_hound: no clips by design
  const states = HD_MOB_CLIP_STATES[mobType];
  for (const state of states) {
    const urls = probeSet.candidateUrlsFor(prefix, state);
    const expected = `${prefix}_${state}.fbx`;
    const ok = urls.some((u2) => String(u2).endsWith(expected));
    if (!ok) check(`prefix ${prefix} state ${state} resolves ${expected}`, false, `urls=${urls.join(',')}`);
    prefixChecks++;
  }
}
for (const [bossKey, prefix] of Object.entries(HD_BOSS_CLIP_PREFIXES)) {
  for (const state of HD_BOSS_CLIP_STATES) {
    const urls = probeSet.candidateUrlsFor(prefix, state);
    const expected = `${prefix}_${state}.fbx`;
    const ok = urls.some((u2) => String(u2).endsWith(expected));
    if (!ok) check(`prefix ${prefix} state ${state} resolves ${expected}`, false, `urls=${urls.join(',')}`);
    prefixChecks++;
  }
}
check('all clip prefixes resolve to documented <prefix>_<state>.fbx names',
  prefixChecks > 0, `${prefixChecks} prefix/state combos verified`);

// loadState on an absent file must return null and record the state as
// missing — never throw (this is the graceful path until clips ship).
{
  const set = new MixamoClipSet('enemy_skeleton_warrior', group, {
    basePath: 'assets/models/', states: ['attack']
  });
  let threw = false;
  let clip = 'unset';
  try {
    clip = await set.loadState('attack');
  } catch (e) { threw = true; }
  check('absent enemy clip file -> null, recorded missing, no throw',
    !threw && clip === null && set.missing.includes('attack'),
    `threw=${threw} missing=[${set.missing.join(',')}]`);
}

// ---------------------------------------------------------------------------
// 7. Boss mount through the real mountHdBoss()
// ---------------------------------------------------------------------------

const bossGroup = new THREE.Group();
bossGroup.position.set(0, 0, -75);
const bossMounted = mountHdBoss(bossGroup, 'crypt', { scene: synth.scene }, {
  manager: stubManager
});
check('mountHdBoss returns the group', bossMounted === bossGroup);
check('boss group scale 1.35 (procedural parity)',
  bossGroup.scale.x === 1.35 && bossGroup.scale.y === 1.35 && bossGroup.scale.z === 1.35);
const bu = bossGroup.userData;
check('boss userData.bodyGroup set (syncBoss death sequence)',
  bu.bodyGroup === bu.hdModelRoot);
check('boss deathCrater present + hidden',
  !!bu.deathCrater && bu.deathCrater.visible === false);
check('boss userData.bossKey stamped', bu.bossKey === 'crypt');
check('boss finalize code path ran',
  stubCalls.some((c) => c[0] === 'finalizeCharacterGroup'));
const bossRig = detectRig(bossGroup);
check('detectRig(boss) kind is SKINNED', bossRig.kind === RIG_SKINNED, `got ${bossRig.kind}`);
check('boss: no virtual-pivot keys stamped',
  pivotKeys.every((k) => bu[k] === undefined));

_clearHdEnemyCacheForTest();

console.log(failures === 0 ? '\nHD ENEMY SMOKE: ALL CHECKS PASSED' : `\nHD ENEMY SMOKE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
