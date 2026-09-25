// ProceduralFallback.js — Code-driven character animation for Dungeon of the Covenant.
//
// Phase-2 workstream 2 (GAME-WIDE ANIMATION). This module is the GUARANTEED
// animation path: it needs zero downloads, zero Mixamo files, zero rigged
// GLBs. It drives the game's existing articulated rigs directly:
//
//   HERO rig  (entities.js createArticulatedPlayerMesh):
//     userData.rootBone / .chestGroup / .leftLeg / .rightLeg / .leftArm /
//     .rightArm  (+ headGroup auto-discovered as a child of chestGroup)
//   MOB rig   (entities.js createMobMesh):  userData.bodyRoot
//   SKINNED rig: any Object3D containing a THREE.Skeleton (future rigged GLBs)
//   SIMPLE rig: anything else — whole-group rock/bob so nothing looks dead
//
// Design notes:
//   * Poses are computed as SPARSE OFFSETS from a captured base pose:
//     compute(state, t, opts) -> { pivotKey: { r:[x,y,z], p:[x,y,z], s:[x,y,z] } }
//     Only the components listed are applied; everything else keeps base.
//     This makes crossfading trivial: lerp two offset maps (see AnimationStates.js)
//     and makes the upper-body attack override genuinely layered.
//   * All angles are radians, +Z is forward (matches entities.js).
//   * One-shot durations live in DEFAULT_DUR; loops in LOOP_STATES.
//   * MixamoRig.js reuses detectRig() + VIRTUAL_BONE_PREFIX to retarget real
//     Mixamo clips onto these same pivots when FBX files are present.

import * as THREE from '/vendor/three.module.js';

export const RIG_HERO = 'hero';
export const RIG_MOB = 'mob';
export const RIG_SKINNED = 'skinned';
export const RIG_SIMPLE = 'simple';

// Prefix stamped onto pivot Object3D names so THREE.AnimationMixer can resolve
// retargeted Mixamo tracks (e.g. "covb_leftArm.quaternion"). See MixamoRig.js.
export const VIRTUAL_BONE_PREFIX = 'covb_';

// Canonical state durations (seconds) for one-shot procedural states.
export const DEFAULT_DUR = {
  idle: 1, walk: 1, run: 1,            // loops — dur unused
  attack: 0.45, cast: 0.65, hit: 0.32,
  death: 1.15, jump: 0.55, downed: 1, victory: 1.6
};

export const LOOP_STATES = new Set(['idle', 'walk', 'run', 'downed']);

// ---------------------------------------------------------------------------
// Rig detection
// ---------------------------------------------------------------------------

export function findSkeleton(object3D) {
  let found = null;
  object3D.traverse((o) => {
    if (found) return;
    if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones && o.skeleton.bones.length) {
      found = o.skeleton;
    }
  });
  return found;
}

function findHeadPivot(chestGroup) {
  if (!chestGroup || !chestGroup.children) return null;
  let best = null;
  for (const c of chestGroup.children) {
    if (!c.isGroup || (c.userData && c.userData.weapon)) continue;
    const p = c.position;
    // Head sits centered above the chest: x~0, y~0.76, z~0.
    // (Excludes arm pivots at |x|>0.4, angelWings at z=-0.28, orbiters at y=0.45.)
    if (Math.abs(p.x) < 0.25 && p.y > 0.6 && p.y < 0.95 && Math.abs(p.z) < 0.25) {
      best = c;
      break;
    }
  }
  return best;
}

export function detectRig(object3D) {
  const u = (object3D && object3D.userData) || {};
  if (u.rootBone && u.leftLeg && u.rightLeg && u.leftArm && u.rightArm && u.chestGroup) {
    return {
      kind: RIG_HERO,
      refs: {
        root: u.rootBone,
        chest: u.chestGroup,
        head: findHeadPivot(u.chestGroup),
        leftLeg: u.leftLeg,
        rightLeg: u.rightLeg,
        leftArm: u.leftArm,
        rightArm: u.rightArm
      }
    };
  }
  if (u.bodyRoot) {
    return { kind: RIG_MOB, refs: { root: u.bodyRoot } };
  }
  const skeleton = findSkeleton(object3D);
  if (skeleton) {
    return { kind: RIG_SKINNED, refs: { root: object3D, skeleton, bones: skeleton.bones } };
  }
  return { kind: RIG_SIMPLE, refs: { root: object3D } };
}

// Pivot keys that MixamoRig.js stamps with VIRTUAL_BONE_PREFIX names.
export function virtualPivotKeys() {
  return ['root', 'chest', 'head', 'leftLeg', 'rightLeg', 'leftArm', 'rightArm'];
}

export function ensureVirtualBoneNames(rig) {
  if (!rig || (rig.kind !== RIG_HERO && rig.kind !== RIG_MOB)) return;
  for (const key of virtualPivotKeys()) {
    const pivot = rig.refs[key];
    if (pivot && pivot.isObject3D) {
      if (!pivot.name || !pivot.name.startsWith(VIRTUAL_BONE_PREFIX)) {
        pivot.name = VIRTUAL_BONE_PREFIX + key;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Base-pose capture / offset application
// ---------------------------------------------------------------------------

function captureBase(rig) {
  const base = {};
  for (const key of Object.keys(rig.refs)) {
    const o = rig.refs[key];
    if (o && o.isObject3D) {
      base[key] = {
        p: [o.position.x, o.position.y, o.position.z],
        r: [o.rotation.x, o.rotation.y, o.rotation.z],
        s: [o.scale.x, o.scale.y, o.scale.z]
      };
    }
  }
  return base;
}

// offsets: { key: { r:[x,y,z]|null, p:[x,y,z]|null, s:[x,y,z]|null } }
// Applies base + offsets * weight. Components not listed keep their base value.
export function applyOffsets(rig, base, offsets, weight = 1) {
  if (!offsets) return;
  for (const key of Object.keys(offsets)) {
    const o = rig.refs[key];
    const b = base[key];
    const off = offsets[key];
    if (!o || !b || !off) continue;
    if (off.r) {
      o.rotation.set(b.r[0] + off.r[0] * weight, b.r[1] + off.r[1] * weight, b.r[2] + off.r[2] * weight);
    }
    if (off.p) {
      o.position.set(b.p[0] + off.p[0] * weight, b.p[1] + off.p[1] * weight, b.p[2] + off.p[2] * weight);
    }
    if (off.s) {
      o.scale.set(b.s[0] + off.s[0] * weight, b.s[1] + off.s[1] * weight, b.s[2] + off.s[2] * weight);
    }
  }
}

// Linear blend of two sparse offset maps: a*(1-k) + b*k (missing keys = zero).
export function lerpOffsets(a, b, k) {
  if (!a) return b;
  if (!b) return a;
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const ik = 1 - k;
  for (const key of keys) {
    const oa = a[key] || {};
    const ob = b[key] || {};
    const entry = {};
    for (const comp of ['r', 'p', 's']) {
      const va = oa[comp];
      const vb = ob[comp];
      if (va || vb) {
        entry[comp] = [
          (va ? va[0] : 0) * ik + (vb ? vb[0] : 0) * k,
          (va ? va[1] : 0) * ik + (vb ? vb[1] : 0) * k,
          (va ? va[2] : 0) * ik + (vb ? vb[2] : 0) * k
        ];
      }
    }
    if (entry.r || entry.p || entry.s) out[key] = entry;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Easing helpers
// ---------------------------------------------------------------------------

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInCubic = (x) => Math.pow(clamp01(x), 3);
const easeInOut = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
// Piecewise segment: local 0..1 progress of k inside [a, b].
const seg = (k, a, b) => clamp01((k - a) / (b - a));

// Offset-map builder sugar: O('root', {r:[...]}, 'chest', {p:[...]})
function O(...args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) out[args[i]] = args[i + 1];
  return out;
}
const R = (x = 0, y = 0, z = 0) => ({ r: [x, y, z] });
const P = (x = 0, y = 0, z = 0) => ({ p: [x, y, z] });

// ---------------------------------------------------------------------------
// HERO pose library — the money. These are hand-tuned, not placeholders:
// anticipation + strike + recover phasing, overshoot, counter-rotation.
// ---------------------------------------------------------------------------

function heroIdle(t) {
  const b = Math.sin(t * 1.7);            // breathing
  const b2 = Math.sin(t * 1.7 + 0.7);
  return O(
    'chest', { r: [b * 0.028 - 0.015, 0, Math.sin(t * 0.6) * 0.012], p: [0, b * 0.022, 0] },
    'root',  { r: [0, Math.sin(t * 0.45) * 0.02, 0] },
    'leftArm',  R(b2 * 0.045, 0, 0.06 + b * 0.012),
    'rightArm', R(b2 * 0.045, 0, -0.06 - b * 0.012),
    'head',  { r: [Math.sin(t * 0.9) * 0.03, Math.sin(t * 0.34) * 0.14, 0] }
  );
}

function heroWalk(t) {
  const ph = t * 9.5;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  return O(
    'leftLeg',  R(s * 0.68),
    'rightLeg', R(-s * 0.68),
    'leftArm',  R(-s * 0.55, 0, 0.07),
    'rightArm', R(s * 0.55, 0, -0.07),
    'root',  { r: [0.06, 0, s * 0.03], p: [0, Math.abs(c) * 0.085, 0] },
    'chest', { r: [0.02, -s * 0.07, s * 0.045] },
    'head',  R(-0.06, -s * 0.05, 0)
  );
}

function heroRun(t) {
  const ph = t * 12.5;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  return O(
    'leftLeg',  R(s * 0.95),
    'rightLeg', R(-s * 0.95),
    'leftArm',  R(-s * 0.85, 0, 0.1),
    'rightArm', R(s * 0.85, 0, -0.1),
    'root',  { r: [0.17, 0, s * 0.04], p: [0, Math.abs(c) * 0.13, 0] },
    'chest', { r: [0.05, -s * 0.11, s * 0.06] },
    'head',  R(-0.12, -s * 0.06, 0)
  );
}

// Melee attack: windup (anticipation) -> strike (fast, overshoot) -> recover.
function heroAttack(t, dur) {
  const k = clamp01(t / dur);
  const out = {};
  const set = (key, v) => { out[key] = v; };
  if (k < 0.32) {
    // WINDUP — arm cocks back/up, torso twists away, slight crouch.
    const w = easeOutCubic(seg(k, 0, 0.32));
    set('rightArm', { r: [-0.35 - w * 1.65, 0, -0.15 - w * 0.35] });
    set('leftArm',  { r: [-0.25 - w * 0.35, 0, 0.35 + w * 0.25] });
    set('chest', { r: [-w * 0.1, w * 0.52, 0], p: [0, -w * 0.05, 0] });
    set('root',  { r: [-w * 0.09, 0, 0], p: [0, -w * 0.06, -w * 0.12] });
    set('head',  R(-w * 0.08, w * 0.22, 0));
  } else if (k < 0.58) {
    // STRIKE — arm whips down-forward with overshoot, torso unwinds hard.
    const s = easeInCubic(seg(k, 0.32, 0.58));
    const over = Math.sin(s * Math.PI) * 0.12; // overshoot snap
    set('rightArm', { r: [-2.0 + s * 2.95 + over, 0, -0.5 + s * 0.42] });
    set('leftArm',  { r: [-0.6 + s * 0.75, 0, 0.6 - s * 0.2] });
    set('chest', { r: [-0.1 + s * 0.3, 0.52 - s * 1.12, 0], p: [0, -0.05 + s * 0.02, 0] });
    set('root',  { r: [-0.09 + s * 0.24, 0, 0], p: [0, -0.06 + s * 0.03, -0.12 + s * 0.42] });
    set('head',  R(-0.08 + s * 0.1, 0.22 - s * 0.3, 0));
  } else {
    // RECOVER — everything eases back to base.
    const r = easeInOut(seg(k, 0.58, 1));
    const ik = 1 - r;
    set('rightArm', { r: [0.95 * ik, 0, -0.08 * ik] });
    set('leftArm',  { r: [0.15 * ik, 0, 0.4 * ik] });
    set('chest', { r: [0.2 * ik, -0.6 * ik, 0], p: [0, -0.03 * ik, 0] });
    set('root',  { r: [0.15 * ik, 0, 0], p: [0, -0.03 * ik, 0.3 * ik] });
    set('head',  R(0.02 * ik, -0.08 * ik, 0));
  }
  return out;
}

// Upper-body-only attack overlay: arms + a touch of chest, legs untouched.
// This is what AnimationStates plays on the 'upper' layer over walk/run.
function heroAttackUpper(t, dur) {
  const k = clamp01(t / dur);
  if (k < 0.32) {
    const w = easeOutCubic(seg(k, 0, 0.32));
    return O(
      'rightArm', R(-0.35 - w * 1.65, 0, -0.15 - w * 0.35),
      'leftArm',  R(-0.25 - w * 0.35, 0, 0.35 + w * 0.25),
      'chest', R(-w * 0.08, w * 0.4, 0)
    );
  } else if (k < 0.58) {
    const s = easeInCubic(seg(k, 0.32, 0.58));
    const over = Math.sin(s * Math.PI) * 0.12;
    return O(
      'rightArm', R(-2.0 + s * 2.95 + over, 0, -0.5 + s * 0.42),
      'leftArm',  R(-0.6 + s * 0.75, 0, 0.6 - s * 0.2),
      'chest', R(-0.1 + s * 0.26, 0.4 - s * 0.9, 0)
    );
  }
  const r = easeInOut(seg(k, 0.58, 1));
  const ik = 1 - r;
  return O(
    'rightArm', R(0.95 * ik, 0, -0.08 * ik),
    'leftArm',  R(0.15 * ik, 0, 0.4 * ik),
    'chest', R(0.16 * ik, -0.5 * ik, 0)
  );
}

// Spell cast: both arms rise channeling, body levitates slightly, then release.
function heroCast(t, dur) {
  const k = clamp01(t / dur);
  if (k < 0.45) {
    const w = easeOutCubic(seg(k, 0, 0.45));
    return O(
      'leftArm',  R(-w * 2.1, 0, 0.5 * w),
      'rightArm', R(-w * 2.1, 0, -0.5 * w),
      'chest', { r: [-w * 0.14, 0, 0], p: [0, w * 0.04, 0] },
      'root',  { p: [0, w * 0.22, 0], r: [-w * 0.06, 0, 0] },
      'head',  R(-w * 0.18, 0, 0)
    );
  } else if (k < 0.62) {
    // RELEASE — sharp thrust forward.
    const s = easeInCubic(seg(k, 0.45, 0.62));
    return O(
      'leftArm',  R(-2.1 + s * 0.7, 0, 0.5 - s * 0.35),
      'rightArm', R(-2.1 + s * 0.7, 0, -0.5 + s * 0.35),
      'chest', R(-0.14 + s * 0.3, 0, 0),
      'root',  { p: [0, 0.22 - s * 0.1, s * 0.18] },
      'head',  R(-0.18 + s * 0.14, 0, 0)
    );
  }
  const r = easeInOut(seg(k, 0.62, 1));
  const ik = 1 - r;
  return O(
    'leftArm',  R(-1.4 * ik, 0, 0.15 * ik),
    'rightArm', R(-1.4 * ik, 0, -0.15 * ik),
    'chest', R(0.16 * ik, 0, 0),
    'root',  { p: [0, 0.12 * ik, 0.18 * ik] },
    'head',  R(-0.04 * ik, 0, 0)
  );
}

// Hit recoil: snap back with overshoot, then settle.
function heroHit(t, dur) {
  const k = clamp01(t / dur);
  const recoil = Math.sin(k * Math.PI);            // 0 -> 1 -> 0
  const snap = k < 0.3 ? easeOutCubic(k / 0.3) : 1; // fast in
  const a = recoil * snap;
  return O(
    'chest', { r: [-0.42 * a, 0.12 * a, 0], p: [0, 0.03 * a, -0.06 * a] },
    'head',  R(-0.38 * a, 0.1 * a, 0),
    'leftArm',  R(-0.55 * a, 0, 0.55 * a),
    'rightArm', R(-0.55 * a, 0, -0.55 * a),
    'root',  { p: [0, 0, -0.22 * a], r: [-0.1 * a, 0, 0] },
    'leftLeg',  R(0.12 * a),
    'rightLeg', R(-0.08 * a)
  );
}

// Death collapse: knees buckle -> crumple forward -> settle. Holds final pose.
function heroDeath(t, dur) {
  const k = clamp01(t / dur);
  const out = {};
  const c = easeInCubic(seg(k, 0, 0.45));   // buckle
  const f = easeInCubic(seg(k, 0.4, 1));     // fall
  out['leftLeg'] = R(-1.15 * c);
  out['rightLeg'] = R(-1.05 * c - 0.25 * f);
  out['root'] = {
    p: [0.12 * f, -0.5 * c - 0.28 * f, 0.42 * f],
    r: [0.35 * c + 1.05 * f, 0.15 * f, 0.1 * f]
  };
  out['chest'] = { r: [0.55 * c + 0.25 * f, 0, 0.12 * f], p: [0, -0.1 * c, 0] };
  out['leftArm'] = R(0.35 * c + 0.5 * f, 0, 0.7 * c + 0.4 * f);
  out['rightArm'] = R(0.3 * c + 0.55 * f, 0, -0.7 * c - 0.4 * f);
  out['head'] = R(0.45 * c + 0.2 * f, 0.2 * f, 0.15 * f);
  return out;
}

function heroJump(t, dur) {
  const k = clamp01(t / dur);
  const tuck = Math.sin(k * Math.PI); // up then down
  return O(
    'leftLeg',  R(-0.78 * tuck),
    'rightLeg', R(0.5 * tuck),
    'leftArm',  R(-0.9 * tuck, 0, 0.3 * tuck),
    'rightArm', R(-0.65 * tuck, 0, -0.3 * tuck),
    'chest', R(0.12 * tuck, 0, 0),
    'head',  R(-0.1 * tuck, 0, 0)
  );
}

function heroDowned(t) {
  // entities.js rotates the whole group for downed; this adds the sprawl.
  return O(
    'leftArm',  R(0.4, 0, 1.1),
    'rightArm', R(0.4, 0, -1.1),
    'chest', R(0.15, 0, 0),
    'head',  R(0.3, 0.4, 0),
    'leftLeg',  R(0.15, 0, 0.1),
    'rightLeg', R(-0.1, 0, -0.1)
  );
}

function heroVictory(t) {
  // Weapon raised high, chest out — loops gently at the peak.
  const k = clamp01(t / 0.7);
  const w = easeOutCubic(k);
  const hold = Math.sin(t * 2.2) * 0.05;
  return O(
    'rightArm', R(-2.6 * w + hold, 0, -0.2 * w),
    'leftArm',  R(-0.4 * w, 0, 0.9 * w),
    'chest', R(-0.22 * w, 0, 0),
    'root',  { p: [0, 0.12 * w, 0] },
    'head',  R(-0.25 * w, 0, 0)
  );
}

const HERO_POSES = {
  idle: (t) => heroIdle(t),
  walk: (t) => heroWalk(t),
  run: (t) => heroRun(t),
  attack: (t, o) => heroAttack(t, o.duration || DEFAULT_DUR.attack),
  attackUpper: (t, o) => heroAttackUpper(t, o.duration || DEFAULT_DUR.attack),
  cast: (t, o) => heroCast(t, o.duration || DEFAULT_DUR.cast),
  hit: (t, o) => heroHit(t, o.duration || DEFAULT_DUR.hit),
  death: (t, o) => heroDeath(t, o.duration || DEFAULT_DUR.death),
  jump: (t, o) => heroJump(t, o.duration || DEFAULT_DUR.jump),
  downed: (t) => heroDowned(t),
  victory: (t) => heroVictory(t)
};

// ---------------------------------------------------------------------------
// MOB pose library — bodyRoot-driven: bob, rock, lunge, recoil, tip-over.
// ---------------------------------------------------------------------------

function mobIdle(t) {
  return O('root', {
    p: [0, Math.sin(t * 2.6) * 0.12, 0],
    r: [Math.sin(t * 1.9) * 0.045, Math.sin(t * 0.7) * 0.06, Math.sin(t * 2.2) * 0.03]
  });
}

function mobWalk(t) {
  const ph = t * 8.5;
  const s = Math.sin(ph);
  return O('root', {
    p: [0, Math.abs(Math.cos(ph)) * 0.12, 0],
    r: [0.1 + s * 0.09, 0, s * 0.1]
  });
}

function mobRun(t) {
  const ph = t * 11.5;
  const s = Math.sin(ph);
  return O('root', {
    p: [0, Math.abs(Math.cos(ph)) * 0.17, 0],
    r: [0.2 + s * 0.12, 0, s * 0.13]
  });
}

function mobAttack(t, dur) {
  const k = clamp01(t / dur);
  let lunge, pitch, squash;
  if (k < 0.35) {
    const w = easeOutCubic(seg(k, 0, 0.35)); // rear back
    lunge = -0.28 * w; pitch = -0.3 * w; squash = -0.06 * w;
  } else if (k < 0.6) {
    const s = easeInCubic(seg(k, 0.35, 0.6)); // slam forward
    lunge = -0.28 + s * 0.95; pitch = -0.3 + s * 0.72; squash = -0.06 + s * 0.16;
  } else {
    const r = easeInOut(seg(k, 0.6, 1)); // settle
    lunge = 0.67 * (1 - r); pitch = 0.42 * (1 - r); squash = 0.1 * (1 - r);
  }
  return O('root', {
    p: [0, squash, lunge],
    r: [pitch, 0, 0],
    s: [1 + squash * 0.6, 1 + squash, 1 + squash * 0.6]
  });
}

function mobAttackUpper(t, dur) {
  // Mobs have no separate arms — upper override == full attack, milder.
  return mobAttack(t, dur);
}

function mobCast(t, dur) {
  const k = clamp01(t / dur);
  const lift = Math.sin(k * Math.PI);
  return O('root', {
    p: [0, lift * 0.35, -0.1 * lift],
    r: [-0.25 * lift, 0, Math.sin(t * 9) * 0.05 * lift],
    s: [1 + 0.08 * lift, 1 + 0.08 * lift, 1 + 0.08 * lift]
  });
}

function mobHit(t, dur) {
  const k = clamp01(t / dur);
  const a = Math.sin(k * Math.PI) * (k < 0.3 ? easeOutCubic(k / 0.3) : 1);
  return O('root', { p: [0, 0.05 * a, -0.34 * a], r: [-0.32 * a, 0.15 * a, 0] });
}

function mobDeath(t, dur) {
  const k = clamp01(t / dur);
  const tip = easeInCubic(seg(k, 0, 0.55));
  const settle = easeInOut(seg(k, 0.5, 1));
  return O('root', {
    r: [-tip * 1.45 - settle * 0.1, 0.2 * tip, 0],
    p: [0.15 * tip, -0.32 * tip - 0.1 * settle, -0.25 * tip]
  });
}

function mobJump(t, dur) {
  const k = clamp01(t / dur);
  const a = Math.sin(k * Math.PI);
  return O('root', { p: [0, a * 0.8, 0.2 * a], r: [-0.2 * a, 0, 0] });
}

function mobDowned(t) { return mobDeath(t, 1); }
function mobVictory(t) {
  const w = easeOutCubic(clamp01(t / 0.7));
  return O('root', { p: [0, 0.3 * w, 0], r: [-0.35 * w, 0, 0], s: [1 + 0.12 * w, 1 + 0.12 * w, 1 + 0.12 * w] });
}

const MOB_POSES = {
  idle: (t) => mobIdle(t),
  walk: (t) => mobWalk(t),
  run: (t) => mobRun(t),
  attack: (t, o) => mobAttack(t, o.duration || DEFAULT_DUR.attack),
  attackUpper: (t, o) => mobAttackUpper(t, o.duration || DEFAULT_DUR.attack),
  cast: (t, o) => mobCast(t, o.duration || DEFAULT_DUR.cast),
  hit: (t, o) => mobHit(t, o.duration || DEFAULT_DUR.hit),
  death: (t, o) => mobDeath(t, o.duration || DEFAULT_DUR.death),
  jump: (t, o) => mobJump(t, o.duration || DEFAULT_DUR.jump),
  downed: (t) => mobDowned(t),
  victory: (t) => mobVictory(t)
};

// ---------------------------------------------------------------------------
// SKINNED / SIMPLE pose libraries — generic, conservative.
// ---------------------------------------------------------------------------

function genericSway(t, amp) {
  return O('root', {
    p: [0, Math.sin(t * 2.2) * 0.05 * amp, 0],
    r: [Math.sin(t * 1.8) * 0.02 * amp, Math.sin(t * 0.6) * 0.04 * amp, 0]
  });
}

const SKINNED_POSES = {
  idle: (t) => genericSway(t, 1),
  walk: (t) => { const s = Math.sin(t * 9); return O('root', { p: [0, Math.abs(Math.cos(t * 9)) * 0.06, 0], r: [0.05, 0, s * 0.05] }); },
  run: (t) => { const s = Math.sin(t * 12); return O('root', { p: [0, Math.abs(Math.cos(t * 12)) * 0.09, 0], r: [0.12, 0, s * 0.06] }); },
  attack: (t, o) => { const k = clamp01(t / (o.duration || DEFAULT_DUR.attack)); const a = Math.sin(k * Math.PI); return O('root', { p: [0, 0, a * 0.4], r: [a * 0.25 - 0.12 * Math.sin(k * Math.PI * 2), 0, 0] }); },
  attackUpper: (t, o) => SKINNED_POSES.attack(t, o),
  cast: (t, o) => { const k = clamp01(t / (o.duration || DEFAULT_DUR.cast)); const a = Math.sin(k * Math.PI); return O('root', { p: [0, a * 0.25, 0], r: [-0.2 * a, 0, 0] }); },
  hit: (t, o) => { const k = clamp01(t / (o.duration || DEFAULT_DUR.hit)); const a = Math.sin(k * Math.PI); return O('root', { p: [0, 0, -0.25 * a], r: [-0.25 * a, 0, 0] }); },
  death: (t, o) => { const k = clamp01(t / (o.duration || DEFAULT_DUR.death)); const f = easeInCubic(k); return O('root', { r: [-f * 1.5, 0, 0], p: [0, -f * 0.4, -f * 0.3] }); },
  jump: (t, o) => { const k = clamp01(t / (o.duration || DEFAULT_DUR.jump)); return O('root', { p: [0, Math.sin(k * Math.PI) * 0.6, 0] }); },
  downed: (t) => O('root', { r: [Math.PI / 2.3, 0, 0] }),
  victory: (t) => { const w = easeOutCubic(clamp01(t / 0.7)); return O('root', { p: [0, 0.2 * w, 0], r: [-0.2 * w, 0, 0] }); }
};

const SIMPLE_POSES = {
  idle: (t) => genericSway(t, 1),
  walk: (t) => SKINNED_POSES.walk(t),
  run: (t) => SKINNED_POSES.run(t),
  attack: (t, o) => SKINNED_POSES.attack(t, o),
  attackUpper: (t, o) => SKINNED_POSES.attack(t, o),
  cast: (t, o) => SKINNED_POSES.cast(t, o),
  hit: (t, o) => SKINNED_POSES.hit(t, o),
  death: (t, o) => SKINNED_POSES.death(t, o),
  jump: (t, o) => SKINNED_POSES.jump(t, o),
  downed: (t) => SKINNED_POSES.downed(t),
  victory: (t) => SKINNED_POSES.victory(t)
};

const POSE_LIBS = {
  [RIG_HERO]: HERO_POSES,
  [RIG_MOB]: MOB_POSES,
  [RIG_SKINNED]: SKINNED_POSES,
  [RIG_SIMPLE]: SIMPLE_POSES
};

// ---------------------------------------------------------------------------
// Driver factory
// ---------------------------------------------------------------------------

export function createProceduralDriver(object3D) {
  const rig = detectRig(object3D);
  const lib = POSE_LIBS[rig.kind] || SIMPLE_POSES;
  const base = captureBase(rig);

  return {
    rig,
    kind: rig.kind,
    base,

    supportedStates() {
      return Object.keys(lib);
    },

    supports(state) {
      return !!lib[state];
    },

    // Pure function: sparse offset map for `state` at time `t`.
    compute(state, t, opts = {}) {
      const fn = lib[state];
      if (!fn) return null;
      return fn(t, opts);
    },

    applyOffsets(offsets, weight = 1) {
      applyOffsets(rig, base, offsets, weight);
    },

    // Restore the exact captured base pose.
    restore() {
      for (const key of Object.keys(base)) {
        const o = rig.refs[key];
        const b = base[key];
        if (!o || !b) continue;
        o.position.set(b.p[0], b.p[1], b.p[2]);
        o.rotation.set(b.r[0], b.r[1], b.r[2]);
        o.scale.set(b.s[0], b.s[1], b.s[2]);
      }
    }
  };
}
