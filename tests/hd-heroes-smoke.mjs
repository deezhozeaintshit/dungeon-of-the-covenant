// hd-heroes-smoke.mjs — synthetic proof for the HD hero integration path.
//
// The real HD GLBs don't exist yet (art workers are producing reference
// images; Meshy generation happens later), so this test proves the ENTIRE
// integration path with a synthetic skinned humanoid:
//
//   1. Build a synthetic THREE.Skeleton humanoid with mixamorig* bone names.
//   2. Mount it through the REAL client/js/hdHeroes.js mountHdHero().
//   3. assert detectRig() sees RIG_SKINNED (not the virtual-pivot path).
//   4. Load the REAL Mixamo FBX clips (client/assets/models/hero_*.fbx — all
//      14) via FBXLoader and retargetClip() each onto the mounted group.
//   5. assert mapped tracks > 0 for hips/arms/legs; report mapped/dropped.
//
// If this passes, the real clips will drive the real models the moment they
// land — the only untested step then is the GLB file itself (covered by the
// contract checklist in HD_HERO_CONTRACT.md).
//
// Run: node --loader ./tests/perf-bench-loader.mjs tests/hd-heroes-smoke.mjs
// Exit 0 = all assertions pass.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { detectRig, RIG_SKINNED } from '../client/js/animation/ProceduralFallback.js';
import { retargetClip, canonicalBoneName } from '../client/js/animation/MixamoRig.js';
import {
  HD_HEROES_ENABLED,
  HD_CLASS_SCALES,
  HD_LEVITATE_Y,
  mountHdHero,
  getHdModel,
  _injectHdModelForTest,
  _clearHdCacheForTest
} from '../client/js/hdHeroes.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const MODELS = resolve(__dir, '..', 'client/assets/models');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------------
// 1. Synthetic skinned humanoid (stand-in for a real hero_<class>_hd.glb)
// ---------------------------------------------------------------------------

function buildSyntheticHumanoid() {
  const bones = {};
  const mk = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones[name] = b;
    return b;
  };
  // Mixamo-style hierarchy, ~1.75 m tall, feet at y=0, facing +Z.
  const hips = mk('mixamorigHips', null, 0, 0.95, 0);
  const spine = mk('mixamorigSpine', hips, 0, 0.12, 0);
  const spine1 = mk('mixamorigSpine1', spine, 0, 0.14, 0);
  const spine2 = mk('mixamorigSpine2', spine1, 0, 0.14, 0);
  const neck = mk('mixamorigNeck', spine2, 0, 0.16, 0);
  mk('mixamorigHead', neck, 0, 0.14, 0);
  for (const side of ['Left', 'Right']) {
    const sx = side === 'Left' ? -1 : 1;
    const sh = mk(`mixamorig${side}Shoulder`, spine2, sx * 0.20, 0.10, 0);
    const arm = mk(`mixamorig${side}Arm`, sh, sx * 0.10, -0.02, 0);
    const fore = mk(`mixamorig${side}ForeArm`, arm, sx * 0.28, 0, 0);
    mk(`mixamorig${side}Hand`, fore, sx * 0.26, 0, 0);
    const up = mk(`mixamorig${side}UpLeg`, hips, sx * 0.11, -0.06, 0);
    const leg = mk(`mixamorig${side}Leg`, up, 0, -0.40, 0);
    mk(`mixamorig${side}Foot`, leg, 0, -0.40, 0.07);
  }
  const list = Object.values(bones);
  const skeleton = new THREE.Skeleton(list);

  // One SkinnedMesh, all vertices bound to hips (enough for the rig proof;
  // real models carry real weights).
  const geo = new THREE.BoxGeometry(0.5, 1.75, 0.3);
  geo.translate(0, 0.875, 0);
  const n = geo.attributes.position.count;
  const skinIndex = new THREE.BufferAttribute(new Uint16Array(n * 4), 4);
  const skinWeight = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
  const hipsIdx = list.indexOf(hips);
  for (let i = 0; i < n; i++) { skinIndex.setX(i, hipsIdx); skinWeight.setX(i, 1); }
  geo.setAttribute('skinIndex', skinIndex);
  geo.setAttribute('skinWeight', skinWeight);

  const mesh = new THREE.SkinnedMesh(
    geo, new THREE.MeshStandardMaterial({ color: 0x8a8f9a, roughness: 0.6 })
  );
  mesh.name = 'syntheticHeroBody';
  const scene = new THREE.Group();
  scene.add(mesh);
  mesh.add(hips); // bones must live under the skinned mesh's graph
  scene.updateMatrixWorld(true);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();
  return { scene, skeleton, bones };
}

// Stub EntityManager: createOverheadBar/finalizeCharacterGroup need a DOM
// canvas, so the smoke test stubs them and asserts the mount calls them
// (proving the nameplate/finalize code paths stay wired).
const stubCalls = [];
const stubManager = {
  createOverheadBar: (group, name, isHostile, isLocal) => {
    stubCalls.push(['createOverheadBar', name, isHostile, isLocal]);
    group.userData.barCanvas = true; // marker the bar path ran
  },
  finalizeCharacterGroup: (group, shadowRadius, shadowOpacity) => {
    stubCalls.push(['finalizeCharacterGroup', shadowRadius, shadowOpacity]);
    group.userData.animator = { stub: true }; // marker the animator path ran
  }
};

// ---------------------------------------------------------------------------
// 2. Flag + fallback behavior (default path unaffected)
// ---------------------------------------------------------------------------

check('HD_HEROES_ENABLED defaults to false', HD_HEROES_ENABLED === false);
check('getHdModel returns null while disabled', getHdModel('mage') === null);
check('mountHdHero(null gltf) returns null (procedural fallback)',
  mountHdHero(new THREE.Group(), 'mage', null, {}) === null);

// ---------------------------------------------------------------------------
// 3. Mount the synthetic hero through the real mountHdHero()
// ---------------------------------------------------------------------------

const synth = buildSyntheticHumanoid();
_injectHdModelForTest('mage', { scene: synth.scene });

const group = new THREE.Group();
group.position.set(10, 0, 20);
const mounted = mountHdHero(group, 'mage', { scene: synth.scene }, {
  manager: stubManager, name: 'TestMage', isLocal: true, trimColor: 0x00ddff
});
check('mountHdHero returns the group', mounted === group);

const u = group.userData;
check('class scales preserved (mage 1.22/1.30/1.22)',
  group.scale.x === 1.22 && group.scale.y === 1.30 && group.scale.z === 1.22,
  `got ${group.scale.x}/${group.scale.y}/${group.scale.z}`);
check('no levitate for mage', u.hdModelRoot.position.y === 0);
check('ground ring mounted + registered on userData',
  !!u.heroRing && u.heroRing.isMesh);
check('overhead bar / finalize code paths ran',
  stubCalls.some((c) => c[0] === 'createOverheadBar') &&
  stubCalls.some((c) => c[0] === 'finalizeCharacterGroup'));
check('overhead bar got the hero name',
  stubCalls.some((c) => c[0] === 'createOverheadBar' && c[1] === 'TestMage'));

// The critical invariant: NO virtual-pivot keys, so detectRig can't take the
// low-detail path.
const pivotKeys = ['rootBone', 'leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'chestGroup', 'bodyRoot'];
check('no virtual-pivot keys stamped on userData',
  pivotKeys.every((k) => u[k] === undefined),
  `keys present: ${pivotKeys.filter((k) => u[k] !== undefined).join(',') || 'none'}`);
check('weaponGroup null (baked-in weapons; glow retint no-ops)',
  u.weaponGroup === null);

// Levitate classes get the offset on the model root (ring stays at origin).
const clericGroup = new THREE.Group();
mountHdHero(clericGroup, 'cleric', { scene: synth.scene }, { manager: stubManager });
check('cleric levitate offset 0.34 on model root',
  clericGroup.userData.hdModelRoot.position.y === HD_LEVITATE_Y.cleric);
const necroGroup = new THREE.Group();
mountHdHero(necroGroup, 'necromancer', { scene: synth.scene }, { manager: stubManager });
check('necromancer levitate offset 0.18 on model root',
  necroGroup.userData.hdModelRoot.position.y === HD_LEVITATE_Y.necromancer);

// Each mount gets its OWN skeleton instance (SkeletonUtils.clone remap).
check('mounted skeletons are independent instances',
  u.skeleton && clericGroup.userData.skeleton &&
  u.skeleton !== clericGroup.userData.skeleton);

// ---------------------------------------------------------------------------
// 4. detectRig must see SKINNED
// ---------------------------------------------------------------------------

const rig = detectRig(group);
check('detectRig kind is SKINNED', rig.kind === RIG_SKINNED, `got ${rig.kind}`);
check('SKINNED rig exposes a skeleton with mixamorig bones',
  !!(rig.refs && rig.refs.skeleton && rig.refs.skeleton.bones.length >= 19),
  `bones=${rig.refs && rig.refs.skeleton ? rig.refs.skeleton.bones.length : 0}`);

// ---------------------------------------------------------------------------
// 5. Retarget the REAL FBX clips onto the mounted synthetic hero
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

  // Bucket retargeted tracks by canonical target-bone name.
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
    `${file} [${state}] retargeted`,
    ok,
    `mapped=${mapped} dropped=${dropped} ` +
    `hips=${buckets.hips} spine=${buckets.spine} head=${buckets.head} ` +
    `arms=${buckets.arms} legs=${buckets.legs} other=${buckets.other}`
  );
}

check('all 14 hero FBX clips processed', clipCount === 14, `got ${clipCount}`);

_clearHdCacheForTest();

console.log(failures === 0 ? '\nHD HERO SMOKE: ALL CHECKS PASSED' : `\nHD HERO SMOKE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
