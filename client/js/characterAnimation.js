// characterAnimation.js — Procedural combat animation layer for Dungeon of the Covenant.
//
// The character GLBs ship with ZERO animation clips and ZERO rigs (verified by
// audit), and Mixamo downloads need an Adobe login the agent does not have.
// This module therefore drives combat animation procedurally from entity state:
//
//   triggerHitFlash(group)    - white-hot emissive flash on damage (hp-drop driven)
//   triggerAttackLunge(group)  - root forward lunge synced with the arm swing
//   triggerDeathFade(group)   - tip-over + sink + opacity fade (boss death)
//   resetDeathFade(group)     - restore after fade (boss respawn / new fight)
//   updateCombatAnimation(group, dt) - per-frame driver, called from EntityManager.update()
//
// Walk cycles, idle breathing, jump poses and class flourishes (wings, falcon,
// orbiters) already live in EntityManager.update() and are left untouched.

import * as THREE from '/vendor/three.module.js';

const HIT_FLASH_DURATION = 0.28;
const LUNGE_DURATION = 0.24;
const DEATH_TIP_DURATION = 0.45;
const DEATH_FADE_DURATION = 0.85;

// Optional damage-event hook (integration: main.js wires real floating damage
// numbers here). Called with (group, amount) on every detected hp drop.
let damageListener = null;
export function setDamageListener(fn) { damageListener = typeof fn === 'function' ? fn : null; }

export function ensureCombatAnimState(group) {
  const u = group.userData;
  if (!u.combatAnim) {
    u.combatAnim = {
      hitFlash: 0,
      hitStrength: 1,
      lungeT: 0,
      lungeBaseZ: null,
      deathT: -1,          // -1 = alive
      deathDone: false,
      flashMats: null,     // [{ mat, emissiveHex, intensity }]
      fadeMats: null       // [{ mat, opacity, transparent }]
    };
  }
  return u.combatAnim;
}

function collectFlashMats(group) {
  const out = [];
  const seen = new Set();
  group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m) || !m.isMeshStandardMaterial) continue;
      seen.add(m);
      out.push({ mat: m, emissiveHex: m.emissive.getHex(), intensity: m.emissiveIntensity });
    }
  });
  return out;
}

function collectFadeMats(group) {
  const out = [];
  const seen = new Set();
  group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push({ mat: m, opacity: m.opacity, transparent: m.transparent });
    }
  });
  return out;
}

// --- Triggers ---------------------------------------------------------------

export function triggerHitFlash(group, strength = 1) {
  const st = ensureCombatAnimState(group);
  if (st.deathT >= 0) return; // already dying
  if (!st.flashMats) st.flashMats = collectFlashMats(group);
  st.hitFlash = HIT_FLASH_DURATION;
  st.hitStrength = strength;
}

export function triggerAttackLunge(group) {
  const st = ensureCombatAnimState(group);
  st.lungeT = LUNGE_DURATION;
}

export function triggerDeathFade(group) {
  const st = ensureCombatAnimState(group);
  if (st.deathT >= 0 || st.deathDone) return;
  if (!st.fadeMats) st.fadeMats = collectFadeMats(group);
  for (const r of st.fadeMats) {
    r.mat.transparent = true;
    r.mat.needsUpdate = true;
  }
  st.deathT = 0;
  st.hitFlash = 0;
}

export function resetDeathFade(group) {
  const u = group.userData;
  const st = u.combatAnim;
  if (!st) return;
  if (st.fadeMats) {
    for (const r of st.fadeMats) {
      r.mat.opacity = r.opacity;
      r.mat.transparent = r.transparent;
      r.mat.needsUpdate = true;
    }
  }
  if (st.flashMats) {
    for (const r of st.flashMats) {
      r.mat.emissive.setHex(r.emissiveHex);
      r.mat.emissiveIntensity = r.intensity;
    }
  }
  st.deathT = -1;
  st.deathDone = false;
  st.hitFlash = 0;
  st.lungeT = 0;
  group.visible = true;
  group.rotation.x = 0;
}

// --- Per-frame driver --------------------------------------------------------

function driveHitFlash(st, dt) {
  if (st.hitFlash <= 0 || !st.flashMats) return;
  st.hitFlash = Math.max(0, st.hitFlash - dt);
  const k = st.hitFlash / HIT_FLASH_DURATION; // 1 -> 0
  for (const r of st.flashMats) {
    if (st.hitFlash > 0) {
      r.mat.emissive.setHex(0xffffff);
      r.mat.emissiveIntensity = r.intensity + k * 2.4 * st.hitStrength;
    } else {
      r.mat.emissive.setHex(r.emissiveHex);
      r.mat.emissiveIntensity = r.intensity;
    }
  }
}

function driveLunge(group, st, dt) {
  if (st.lungeT <= 0) return;
  st.lungeT = Math.max(0, st.lungeT - dt);
  // Heroes animate rootBone; mobs animate bodyRoot. Forward is local +Z.
  const u = group.userData;
  const pivot = u.rootBone || u.bodyRoot;
  if (!pivot) return;
  if (st.lungeBaseZ === null) st.lungeBaseZ = pivot.position.z;
  const phase = 1 - st.lungeT / LUNGE_DURATION; // 0 -> 1
  const push = Math.sin(phase * Math.PI) * 0.5;
  pivot.position.z = st.lungeBaseZ + push;
  if (st.lungeT === 0) pivot.position.z = st.lungeBaseZ;
}

function driveDeath(group, st, dt) {
  if (st.deathT < 0 || st.deathDone) return;
  st.deathT += dt;
  const total = DEATH_TIP_DURATION + DEATH_FADE_DURATION;
  // Phase 1: tip over backwards
  const tipK = Math.min(1, st.deathT / DEATH_TIP_DURATION);
  const ease = 1 - Math.pow(1 - tipK, 3);
  group.rotation.x = -ease * Math.PI * 0.52;
  // Phase 2: sink + fade
  if (st.deathT > DEATH_TIP_DURATION && st.fadeMats) {
    const fadeK = Math.min(1, (st.deathT - DEATH_TIP_DURATION) / DEATH_FADE_DURATION);
    const op = 1 - fadeK;
    for (const r of st.fadeMats) r.mat.opacity = r.opacity * op;
    group.position.y -= dt * 0.55 * fadeK;
  }
  if (st.deathT >= total) {
    st.deathDone = true;
    group.visible = false;
  }
}

export function updateCombatAnimation(group, dt) {
  const u = group.userData;
  if (!u || !u.combatAnim) return;
  const st = u.combatAnim;
  driveHitFlash(st, dt);
  driveLunge(group, st, dt);
  driveDeath(group, st, dt);
}

// Convenience: run hit-flash detection against a snapshot hp value.
// Returns true when a flash was triggered.
export function detectDamage(group, hp) {
  const u = group.userData;
  if (hp === undefined || hp === null) return false;
  const last = u.lastHp;
  u.lastHp = hp;
  if (last !== undefined && hp < last - 0.5) {
    triggerHitFlash(group, Math.min(1.6, 1 + (last - hp) / 60));
    if (damageListener) {
      try { damageListener(group, last - hp); } catch (e) { /* listener must never break sync */ }
    }
    return true;
  }
  return false;
}
