// AnimationStates.js — Generic animation state machine for Dungeon of the Covenant.
//
// Phase-2 workstream 2 (GAME-WIDE ANIMATION). One animator drives heroes,
// enemies AND the boss. It picks the best available source per state:
//
//   CLIP MODE      — a real AnimationClip (Mixamo FBX via MixamoRig.js) played
//                    through THREE.AnimationMixer with fade in/out blending.
//   PROCEDURAL     — code-driven poses from ProceduralFallback.js, blended by
//                    lerping sparse offset maps. Always available.
//
// Clip priority: a real clip wins when one is registered for the state,
// otherwise procedural runs. Switching is seamless: both paths crossfade
// (mixer fadeIn/fadeOut for clips, offset-map lerp for procedural, and a
// cross-mode blend when a clip arrives mid-state via refresh()).
//
// States: idle / walk / run / attack / cast / hit / death / jump / downed / victory
// Layers: 'base' (full body) + 'upper' (procedural attack override — arms swing
//         while legs keep walking; works even when base is a Mixamo clip).
//
// API:
//   const animator = createAnimator(object3D, opts);
//   animator.setClips({ idle: clip, walk: clip, ... })   // or animator.bindClipSet(clipSet)
//   animator.play('attack');                             // one-shot, returns to locomotion
//   animator.play('attack', { layer: 'upper' });         // layered override
//   animator.setLocomotion({ moving: true, running: false });
//   animator.play('death', { sticky: true });
//   animator.update(dt);
//   animator.refresh();   // re-pick clip-vs-procedural for the current state
//   animator.reset();     // clear sticky states, restore base pose
//   animator.dispose();
//
// Transition rules (interrupt priority):
//   death/downed are STICKY — nothing interrupts except reset() or a new
//   death/downed. hit interrupts anything non-sticky. attack/cast interrupt
//   locomotion and re-trigger themselves; they never cut hit/death. jump is
//   like attack. idle/walk/run transition freely between each other.

import * as THREE from '/vendor/three.module.js';
import { createProceduralDriver, lerpOffsets, DEFAULT_DUR, LOOP_STATES } from './ProceduralFallback.js';

export const STATES = {
  IDLE: 'idle', WALK: 'walk', RUN: 'run',
  ATTACK: 'attack', CAST: 'cast', HIT: 'hit',
  DEATH: 'death', JUMP: 'jump', DOWNED: 'downed', VICTORY: 'victory'
};

// Pseudo-state: arms-only attack pose for the 'upper' layer.
export const UPPER_ATTACK = 'attackUpper';

// Higher number wins an interrupt contest.
const PRIORITY = {
  downed: 100, death: 90, hit: 70,
  attack: 50, cast: 50, jump: 45, victory: 30,
  run: 20, walk: 10, idle: 0
};

const ONE_SHOT = new Set(['attack', 'cast', 'hit', 'jump']);
const STICKY = new Set(['death', 'downed']);
const LOCOMOTION = new Set(['idle', 'walk', 'run']);

function defaultBlend(state) {
  if (state === 'hit') return 0.08;
  if (state === 'death') return 0.18;
  if (LOCOMOTION.has(state)) return 0.25;
  return 0.22;
}

function durationFor(state, opts) {
  if (opts && opts.duration) return opts.duration;
  return DEFAULT_DUR[state] || 0.5;
}

function loopFor(state, opts) {
  if (opts && opts.loop !== undefined) return !!opts.loop;
  return LOOP_STATES.has(state);
}

function canInterrupt(layer, to) {
  let from = layer.state === UPPER_ATTACK ? 'attack' : layer.state;
  const toNorm = to === UPPER_ATTACK ? 'attack' : to;
  if (from === toNorm) {
    // Re-trigger one-shots; locomotion re-play is a no-op.
    return ONE_SHOT.has(toNorm);
  }
  if (STICKY.has(from)) return false;                 // death/downed lock the layer
  if (STICKY.has(toNorm)) return true;               // death/downed cut everything
  if (toNorm === 'hit') return PRIORITY[from] < 100; // hit cuts anything non-sticky
  if (ONE_SHOT.has(toNorm)) {
    return LOCOMOTION.has(from) || from === 'victory'
      || (ONE_SHOT.has(from) && PRIORITY[toNorm] >= PRIORITY[from]);
  }
  // Locomotion / victory: free among themselves, never cut a one-shot mid-flight.
  return LOCOMOTION.has(from) || from === 'victory' || from === 'idle';
}

export function createAnimator(object3D, opts = {}) {
  const mixer = new THREE.AnimationMixer(object3D);
  const driver = createProceduralDriver(object3D);
  const clips = new Map();   // state -> THREE.AnimationClip
  const actions = new Map(); // state -> THREE.AnimationAction (cached)

  const preference = opts.preference || 'auto'; // 'auto' | 'clips' | 'procedural'
  const globalBlend = opts.blendTime;

  function newLayer(name) {
    return {
      name,
      mode: 'none',          // 'none' | 'clip' | 'procedural'
      state: 'idle',
      t: 0,
      dur: 1,
      loop: true,
      speed: 1,
      action: null,          // active mixer action (clip mode)
      prevState: null,       // procedural crossfade source
      prevT: 0,
      prevOpts: null,
      prevFrozen: null,      // frozen live-pose offsets (clip -> procedural blend)
      blendT: 1,             // 1 = blend finished
      blendDur: 0.25,
      done: false,
      locked: false,         // sticky state active
      onDone: null,
      weight: 1
    };
  }

  const base = newLayer('base');
  const upper = newLayer('upper');
  let desiredLocomotion = 'idle';
  let disposed = false;

  // -- clip plumbing ---------------------------------------------------------

  function getAction(state) {
    const clip = clips.get(state);
    if (!clip) return null;
    let action = actions.get(state);
    if (!action) {
      action = mixer.clipAction(clip);
      actions.set(state, action);
    }
    return action;
  }

  function stopAction(layer, fadeDur) {
    if (layer.action) {
      try {
        if (fadeDur > 0) layer.action.fadeOut(fadeDur);
        else layer.action.stop();
      } catch (e) { /* never break the frame loop */ }
      layer.action = null;
    }
  }

  // Snapshot of the rig's CURRENT visual pose as a sparse offset map
  // (current transform minus captured base). Used for seamless clip->procedural.
  function captureLiveOffsets() {
    const out = {};
    const refs = driver.rig.refs;
    const base = driver.base;
    for (const key of Object.keys(refs)) {
      const o = refs[key];
      const b = base[key];
      if (!o || !b || !o.isObject3D) continue;
      out[key] = {
        r: [o.rotation.x - b.r[0], o.rotation.y - b.r[1], o.rotation.z - b.r[2]],
        p: [o.position.x - b.p[0], o.position.y - b.p[1], o.position.z - b.p[2]]
      };
    }
    return out;
  }

  // -- layer control ---------------------------------------------------------

  function resolveMode(state, layerName, o) {
    if (o && o.mode) return o.mode;
    if (preference === 'clips') return clips.has(state) ? 'clip' : 'procedural';
    if (preference === 'procedural') return 'procedural';
    // 'auto': real clip wins, procedural is the guaranteed fallback.
    if (layerName === 'upper') return 'procedural'; // no clip masking in three r160
    return clips.has(state) ? 'clip' : 'procedural';
  }

  function startLayer(layer, state, o = {}) {
    const blendDur = o.blend !== undefined ? o.blend
      : (globalBlend !== undefined ? globalBlend : defaultBlend(state));
    const mode = resolveMode(state, layer.name, o);
    const wasClip = layer.mode === 'clip';
    const wasProcedural = layer.mode === 'procedural';

    // Stash the outgoing pose as the crossfade source.
    if (wasProcedural && (layer.state !== state || mode !== 'procedural')) {
      layer.prevState = layer.state;
      layer.prevT = layer.t;
      layer.prevOpts = { duration: layer.dur };
      layer.prevFrozen = null;
    } else if (wasClip && mode === 'procedural') {
      // Seamless clip -> procedural: freeze the live pose as the blend source.
      layer.prevFrozen = captureLiveOffsets();
      layer.prevState = null;
    } else {
      layer.prevState = null;
      layer.prevFrozen = null;
    }

    stopAction(layer, wasClip && mode === 'clip' ? blendDur : 0);

    layer.mode = mode;
    layer.state = state;
    layer.t = 0;
    layer.dur = durationFor(state, o);
    layer.loop = loopFor(state, o);
    layer.speed = o.speed || 1;
    layer.blendT = 0;
    layer.blendDur = Math.max(0.001, blendDur);
    layer.done = false;
    layer.locked = STICKY.has(state) || !!o.sticky;
    layer.onDone = typeof o.onDone === 'function' ? o.onDone : null;
    layer.weight = o.weight !== undefined ? o.weight : 1;

    if (mode === 'clip') {
      const action = getAction(state);
      const clip = clips.get(state);
      if (!action || !clip) {
        // Clip vanished between resolve and start — fall back to procedural.
        layer.mode = 'procedural';
      } else {
        // One-shot timing follows the REAL clip length, not the procedural default.
        if (!o.duration && clip.duration > 0) layer.dur = clip.duration;
        action.reset();
        action.setLoop(layer.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.clampWhenFinished = !layer.loop;
        action.enabled = true;
        if (blendDur > 0) action.fadeIn(blendDur);
        action.play(); // required after fadeIn(); harmless when blendDur is 0
        action.setEffectiveWeight(layer.weight);
        layer.action = action;
        layer.prevState = null;
        layer.prevFrozen = null;
      }
    }
    return true;
  }

  function play(state, o = {}) {
    if (disposed || !state) return false;
    const layer = o.layer === 'upper' ? upper : base;
    // Upper layer always runs the arms-only attack pose.
    const effState = (o.layer === 'upper' && state === 'attack') ? UPPER_ATTACK : state;

    if (!canInterrupt(layer, effState)) {
      return false;
    }
    if (o.layer === 'upper' && STICKY.has(base.state)) return false;

    startLayer(layer, effState, o);

    // Remember where one-shots return to (base layer only).
    if (layer === base && LOCOMOTION.has(effState)) desiredLocomotion = effState;
    return true;
  }

  function finishOneShot(layer) {
    layer.done = true;
    const cb = layer.onDone;
    layer.onDone = null;
    if (layer === base) {
      // Fall back to whatever locomotion was desired.
      startLayer(layer, desiredLocomotion, { blend: 0.15 });
    } else {
      layer.mode = 'none';
      layer.state = 'idle';
      stopAction(layer, 0);
    }
    if (cb) { try { cb(); } catch (e) { /* listener must never break sync */ } }
  }

  // -- procedural layer tick ---------------------------------------------------

  function tickProcedural(layer, dt) {
    if (layer.mode !== 'procedural' || layer.done) return;
    layer.t += dt * layer.speed;
    if (!layer.loop && layer.t >= layer.dur) {
      layer.t = layer.dur;
      if (ONE_SHOT.has(layer.state) || layer.state === UPPER_ATTACK) {
        finishOneShot(layer);
        return;
      }
      layer.done = true; // non-looping, non-one-shot (e.g. death): hold final pose
      const cb = layer.onDone;
      layer.onDone = null;
      if (cb) { try { cb(); } catch (e) { /* ignore */ } }
    }
    if (layer.blendT < 1) {
      layer.blendT = Math.min(1, layer.blendT + dt / layer.blendDur);
    }
  }

  function applyProcedural(layer) {
    if (layer.mode !== 'procedural') return;
    const cur = driver.compute(layer.state, layer.t, { duration: layer.dur });
    let offsets = cur;
    const k = layer.blendT < 1 ? layer.blendT : 1;
    if (k < 1) {
      const e = k * k * (3 - 2 * k); // smoothstep
      if (layer.prevFrozen) {
        // Seamless clip -> procedural: blend from the frozen live pose.
        offsets = lerpOffsets(layer.prevFrozen, cur, e);
      } else if (layer.prevState) {
        const prev = driver.compute(layer.prevState, layer.prevT, layer.prevOpts || {});
        offsets = lerpOffsets(prev, cur, e);
      }
    }
    driver.applyOffsets(offsets, layer.weight);
    if (layer.blendT >= 1) { layer.prevState = null; layer.prevFrozen = null; }
  }

  // -- public API --------------------------------------------------------------

  const api = {
    // Exposed for MixamoRig binding, debugging, and advanced use.
    mixer,
    driver,
    object3D,

    play,

    // Convenience: drive locomotion from movement state. Ignored while a
    // one-shot or sticky state owns the base layer.
    setLocomotion({ moving = false, running = false } = {}) {
      const want = running ? 'run' : (moving ? 'walk' : 'idle');
      desiredLocomotion = want;
      if (base.locked || ONE_SHOT.has(base.state) && !base.done) return;
      if (base.state !== want && (LOCOMOTION.has(base.state) || base.state === 'victory')) {
        play(want);
      }
    },

    getState(layerName = 'base') {
      const layer = layerName === 'upper' ? upper : base;
      return { state: layer.state, mode: layer.mode, done: layer.done, locked: layer.locked, t: layer.t };
    },

    hasClip(state) { return clips.has(state); },

    clipStates() { return [...clips.keys()]; },

    // Register real clips: { idle: AnimationClip, walk: AnimationClip, ... }
    // Accepts a plain object or a Map. Replaces previous registrations.
    setClips(map) {
      // Drop cached mixer actions BEFORE clearing (uncache needs the clip ref).
      for (const [state, action] of actions) {
        const oldClip = clips.get(state);
        try { if (oldClip) mixer.uncacheAction(oldClip, object3D); } catch (e) { /* ignore */ }
        try { action.stop(); } catch (e) { /* ignore */ }
      }
      actions.clear();
      clips.clear();
      if (!map) return api;
      const entries = map instanceof Map ? map.entries() : Object.entries(map);
      for (const [state, clip] of entries) {
        if (clip && clip.isAnimationClip) clips.set(state, clip);
      }
      return api;
    },

    // Bind a MixamoRig.js ClipSet directly.
    bindClipSet(clipSet) {
      if (!clipSet) return api;
      const map = {};
      for (const state of clipSet.states()) {
        const clip = clipSet.getClip(state);
        if (clip) map[state] = clip;
      }
      return api.setClips(map);
    },

    // Re-evaluate clip-vs-procedural for the live layers — e.g. after async
    // Mixamo clips finish loading, or after setClips() withdraws clips.
    // Seamless both directions: crossfades into the new source mid-motion.
    refresh() {
      if (preference === 'procedural') return api;
      for (const layer of [base, upper]) {
        if (layer.locked || layer.done || layer.mode === 'none') continue;
        const want = layer.name === 'upper' ? 'procedural'
          : (clips.has(layer.state) ? 'clip' : 'procedural');
        if (want !== layer.mode) {
          const keepT = layer.t;
          startLayer(layer, layer.state, { blend: defaultBlend(layer.state) });
          layer.t = Math.min(keepT, layer.dur); // resume ~where we were
        }
      }
      return api;
    },

    // Clear sticky states and restore the captured base pose.
    reset() {
      stopAction(base, 0);
      stopAction(upper, 0);
      base.mode = 'none'; upper.mode = 'none';
      base.state = 'idle'; upper.state = 'idle';
      base.locked = false; upper.locked = false;
      base.done = false; upper.done = false;
      desiredLocomotion = 'idle';
      try { driver.restore(); } catch (e) { /* ignore */ }
      return api;
    },

    update(dt) {
      if (disposed || dt <= 0) return;
      const cdt = Math.min(dt, 0.1); // clamp tab-switch spikes

      // 1. Advance the mixer (real clips).
      try { mixer.update(cdt); } catch (e) { /* never break the frame loop */ }

      // 2. Base layer: procedural poses write absolute base+offsets.
      tickProcedural(base, cdt);
      if (base.mode === 'procedural') applyProcedural(base);

      // 3. Track clip one-shots by wall time (mixer has no per-action promise).
      for (const layer of [base, upper]) {
        if (layer.mode === 'clip' && !layer.done && !layer.loop) {
          layer.t += cdt * layer.speed;
          if (layer.t >= layer.dur) finishOneShot(layer);
        }
      }

      // 4. Upper layer: procedural additive override on top of base.
      tickProcedural(upper, cdt);
      if (upper.mode === 'procedural' && !upper.done) {
        const cur = driver.compute(upper.state, upper.t, { duration: upper.dur });
        // Upper overrides blend in fast and apply at their own weight.
        const k = upper.blendT < 1 ? upper.blendT : 1;
        const e = k * k * (3 - 2 * k);
        driver.applyOffsets(cur, upper.weight * e);
      }
    },

    dispose() {
      disposed = true;
      try {
        stopAction(base, 0);
        stopAction(upper, 0);
        mixer.stopAllAction();
        mixer.uncacheRoot(object3D);
      } catch (e) { /* ignore */ }
    }
  };

  // Boot in a neutral procedural idle so the rig is never T-posing... err,
  // never frozen: even before any play() call, update() keeps it breathing.
  startLayer(base, 'idle', { blend: 0 });
  base.blendT = 1;

  return api;
}

// Batch helper: build one animator per object3D (heroes, mobs, boss).
export function createAnimators(objects, opts) {
  return objects.map((o) => createAnimator(o, opts));
}
