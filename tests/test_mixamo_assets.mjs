// verify_mixamo.mjs — headless check of the 2026-09-25 Mixamo drop.
// 1. Each wired FBX parses and contains >=1 animation with bone tracks.
// 2. Track bone names canonicalize onto the VIRTUAL_BONE_MAP keys that
//    MixamoRig.retargetClip() uses for the game's pivot rigs.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const MODELS = resolve(__dir, '..', 'client/assets/models');

// Mirror of MixamoRig.js (kept in sync manually for this check).
function canonicalBoneName(name) {
  let n = String(name || '');
  const colon = n.lastIndexOf(':');
  if (colon >= 0) n = n.slice(colon + 1);
  n = n.toLowerCase().replace(/^mixamorig/, '');
  n = n.replace(/[_\-.\s]/g, '');
  return n;
}
const VIRTUAL_BONE_KEYS = new Set([
  'hips', 'spine', 'spine1', 'spine2', 'neck', 'head',
  'leftshoulder', 'leftarm', 'rightshoulder', 'rightarm',
  'leftupleg', 'rightupleg'
]);
const TRACK_RE = /^(.*)\.(position|quaternion|scale)$/;

// file -> expected clip state (wired into the animator)
const WIRED = {
  'hero_idle.fbx': 'idle',
  'hero_walk.fbx': 'walk',
  'hero_run.fbx': 'run',
  'hero_attack.fbx': 'attack',
  'hero_hit.fbx': 'hit',
  'hero_death.fbx': 'death',
  'hero_cast.fbx': 'cast',
  'hero_jump.fbx': 'jump',
  'hero_rogue_attack.fbx': 'attack',
  'hero_mage_cast.fbx': 'cast',
  'hero_juggernaut_idle.fbx': 'idle',
  'hero_juggernaut_jump.fbx': 'jump'
};

const loader = new FBXLoader();
let failures = 0;

for (const [file, state] of Object.entries(WIRED)) {
  const path = resolve(MODELS, file);
  let group;
  try {
    const buf = readFileSync(path);
    group = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path);
  } catch (e) {
    console.log(`FAIL ${file}: parse error: ${e.message}`);
    failures++;
    continue;
  }
  const anims = group.animations || [];
  if (!anims.length) {
    console.log(`FAIL ${file}: no animations`);
    failures++;
    continue;
  }
  const clip = anims.reduce((a, b) => (a.duration >= b.duration ? a : b));
  const bones = new Set();
  let posTracks = 0, quatTracks = 0;
  for (const t of clip.tracks) {
    const m = TRACK_RE.exec(t.name);
    if (!m) continue;
    bones.add(canonicalBoneName(m[1]));
    if (m[2] === 'position') posTracks++;
    if (m[2] === 'quaternion') quatTracks++;
  }
  const mapped = [...bones].filter((b) => VIRTUAL_BONE_KEYS.has(b));
  const dropped = [...bones].filter((b) => !VIRTUAL_BONE_KEYS.has(b));
  const ok = mapped.length >= 6 && quatTracks > 0;
  if (!ok) failures++;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${file} [${state}] dur=${clip.duration.toFixed(2)}s ` +
    `tracks=${clip.tracks.length} (pos=${posTracks} quat=${quatTracks}) ` +
    `bones_mapped=${mapped.length}/${bones.size} [${mapped.slice(0, 8).join(',')}${mapped.length > 8 ? '...' : ''}]` +
    (dropped.length ? ` dropped_detail=${dropped.length} (elbows/knees/fingers expected)` : '')
  );
}

// The two documented alternates should at least parse.
for (const file of ['hero_idle_alt03.fbx', 'hero_death_alt_swordshield.fbx']) {
  try {
    const buf = readFileSync(resolve(MODELS, file));
    const g = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), file);
    console.log(`OK   ${file} [alternate] animations=${(g.animations || []).length}`);
  } catch (e) {
    console.log(`FAIL ${file}: ${e.message}`);
    failures++;
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
