// necro_clip_test.mjs — retarget ALL 14 real Mixamo FBX clips onto the REAL
// packed hero_necromancer_hd.glb skeleton (parsed from GLB like GLTFLoader)
// using the REAL retargetClip() from client/js/animation/MixamoRig.js.
// Mirrors tests/hd-heroes-smoke.mjs section 5 buckets; asserts hips/arms/legs
// all get mapped tracks for every clip.
// Run: node --loader ./tests/perf-bench-loader.mjs work/necro_clip_test.mjs
//      (from ~/workspace/rpg-crawler-game/art-work)
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { retargetClip, canonicalBoneName } from '../client/js/animation/MixamoRig.js';

const ART = '/home/hatch/workspace/rpg-crawler-game/art-work';
const MODELS = resolve(ART, 'client/assets/models');
const GLB = resolve(MODELS, 'hero_necromancer_hd.glb');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

// ---- build the skeleton straight from the packed GLB JSON -------------------
const glb = readFileSync(GLB);
const glbLen = glb.readUInt32LE(12);
const js = JSON.parse(glb.subarray(20, 20 + glbLen).toString('utf8'));
const skin = js.skins[0];
check('packed glb has a skin', !!skin, `joints=${skin.joints.length}`);
check('all 22 Mixamo bones + neutral present',
  ['Hips','Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand',
   'RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase',
   'RightUpLeg','RightLeg','RightFoot','RightToeBase']
   .every((n) => skin.joints.some((j) => js.nodes[j].name === n)),
  `joints=[${skin.joints.map((j) => js.nodes[j].name).join(',')}]`);

function nodeLocal(i) {
  const n = js.nodes[i];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation || [0, 0, 0])),
    new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])),
    new THREE.Vector3(...(n.scale || [1, 1, 1])));
}
const parentOf = {};
js.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parentOf[c] = i; }));

// Build THREE.Bone hierarchy in parent-first order.
const bones = {};
const seen = new Set();
const visit = (j) => {
  if (seen.has(j)) return;
  const p = parentOf[j];
  if (p !== undefined && skin.joints.includes(p)) visit(p);
  const b = new THREE.Bone();
  b.name = js.nodes[j].name;
  const local = nodeLocal(j);
  b.position.setFromMatrixPosition(local);
  b.quaternion.setFromRotationMatrix(local);
  const pb = parentOf[j];
  if (pb !== undefined && bones[pb]) bones[pb].add(b);
  bones[j] = b; seen.add(j);
};
skin.joints.forEach(visit);
const boneList = Object.values(bones);
check('bone graph built', boneList.length === skin.joints.length,
  `bones=${boneList.length}`);

// Hips must be the root (parent-first visited, added to mesh).
const skeleton = new THREE.Skeleton(boneList);
const geo = new THREE.BoxGeometry(0.4, 1.75, 0.25);
geo.translate(0, 0.875, 0);
const nV = geo.attributes.position.count;
const si = new THREE.BufferAttribute(new Uint16Array(nV * 4), 4);
const sw = new THREE.BufferAttribute(new Float32Array(nV * 4), 4);
for (let i = 0; i < nV; i++) { si.setX(i, 0); sw.setX(i, 1); }
geo.setAttribute('skinIndex', si);
geo.setAttribute('skinWeight', sw);
const skinned = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
const target = new THREE.Group();
target.add(skinned);
skinned.add(boneList[0]);
skinned.bind(skeleton);
target.updateMatrixWorld(true);

// ---- retarget the 14 clips --------------------------------------------------
const FILE_STATE = {
  'hero_idle.fbx': 'idle', 'hero_idle_alt03.fbx': 'idle', 'hero_juggernaut_idle.fbx': 'idle',
  'hero_walk.fbx': 'walk', 'hero_run.fbx': 'run',
  'hero_attack.fbx': 'attack', 'hero_rogue_attack.fbx': 'attack',
  'hero_hit.fbx': 'hit', 'hero_death.fbx': 'death', 'hero_death_alt_swordshield.fbx': 'death',
  'hero_cast.fbx': 'cast', 'hero_mage_cast.fbx': 'cast',
  'hero_jump.fbx': 'jump', 'hero_juggernaut_jump.fbx': 'jump'
};
const ARM_CANONS = new Set(['leftshoulder','leftarm','leftforearm','lefthand',
  'rightshoulder','rightarm','rightforearm','righthand']);
const LEG_CANONS = new Set(['leftupleg','leftleg','leftfoot',
  'rightupleg','rightleg','rightfoot']);
const TRACK_RE = /^(.*)\.(position|quaternion|scale)$/;
const loader = new FBXLoader();
let clipCount = 0;

for (const [file, state] of Object.entries(FILE_STATE)) {
  const path = resolve(MODELS, file);
  const buf = readFileSync(path);
  const parsed = loader.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path);
  const clip = (parsed.animations || []).reduce((a, b) => (a.duration >= b.duration ? a : b));
  if (!clip) { check(`${file} [${state}] parses`, false, 'no animations'); continue; }
  const ret = retargetClip(clip, target);
  if (!ret) { check(`${file} [${state}] retargets`, false, 'retargetClip null'); continue; }
  const { mapped, dropped } = ret.userData;
  const buckets = { hips: 0, arms: 0, legs: 0, spine: 0, head: 0, other: 0 };
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
  const okc = mapped > 0 && buckets.hips > 0 && buckets.arms > 0 && buckets.legs > 0;
  clipCount++;
  check(`${file} [${state}] retargeted onto necromancer`, okc,
    `mapped=${mapped} dropped=${dropped} hips=${buckets.hips} arms=${buckets.arms} ` +
    `legs=${buckets.legs} spine=${buckets.spine} head=${buckets.head} other=${buckets.other}`);
}
check('all 14 clips processed', clipCount === 14, `got ${clipCount}`);

console.log(failures === 0 ? '\nNECRO CLIP TEST: ALL CHECKS PASSED' : `\nNECRO CLIP TEST: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
