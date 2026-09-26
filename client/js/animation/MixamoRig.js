// MixamoRig.js — Mixamo clip pipeline for Dungeon of the Covenant.
//
// Phase-2 workstream 2 (GAME-WIDE ANIMATION). Builds the pipeline; it does NOT
// download anything (Mixamo needs the user's free Adobe ID — see
// client/assets/models/MIXAMO_README.md for exactly what to fetch).
//
//   const set = await loadClipSet('hero_mage', heroGroup);
//   animator.bindClipSet(set);          // or animator.setClips(...)
//   // ...later, when the user drops the FBX files in:
//   await set.reload(); animator.bindClipSet(set).refresh();
//
// Naming convention (auto-discovery):  <prefix>_<state>.fbx
//   e.g. hero_mage_idle.fbx, hero_mage_walk.fbx, hero_mage_attack.fbx ...
// Dropped into the models dir (default 'assets/models/' relative to client/).
// Missing files are simply skipped — the animator falls back to procedural.
//
// Two extensions (2026-09-25):
//   opts.statePrefixes   = { attack: 'hero_rogue' }  per-state alt prefix
//   opts.fallbackPrefixes = ['hero']                  shared set when the
//        class-specific file is missing (hero_<class>_* -> hero_*.fbx)
//
// Retargeting: Mixamo FBX clips are authored against the Mixamo skeleton
// (mixamorigHips, mixamorigLeftArm, ...). retargetClip() rewrites every track
// to the TARGET rig's bone names via canonical-name matching with fallbacks:
//   1. exact canonical match ("leftarm" -> bone whose canonical name is "leftarm")
//   2. namespace-stripped match ("Rig:mixamorigLeftArm")
//   3. trailing-digit-insensitive match ("spine1" <-> "spine")
// Tracks with no target bone are dropped (counted in the report).
//
// Two target kinds:
//   SKINNED  — Object3D containing a THREE.Skeleton: tracks map bone -> bone.
//   HERO/MOB — the game's procedural pivot rigs (no Skeleton): tracks map onto
//              virtual pivots (rootBone, chestGroup, arms, legs) stamped with
//              'covb_*' names. Shoulder/thigh/spine/hips/head tracks are used;
//              elbow/knee/finger detail is dropped (single-pivot limbs).

import * as THREE from '/vendor/three.module.js';
// Project convention (server.js maps /vendor/addons -> node_modules/three/examples/jsm):
import { FBXLoader } from '/vendor/addons/loaders/FBXLoader.js';
import {
  detectRig, ensureVirtualBoneNames, virtualPivotKeys,
  RIG_HERO, RIG_MOB, VIRTUAL_BONE_PREFIX
} from './ProceduralFallback.js';

export const CLIP_STATES = [
  'idle', 'walk', 'run', 'attack', 'hit', 'death', 'cast', 'jump', 'victory'
];

// Class-specific clip variants (2026-09-25 Mixamo drop). Keys are hero class
// keys; values map state -> alternate file prefix. States not listed fall
// through to the shared `hero_<state>.fbx` set via fallbackPrefixes.
//   rogue attack    <- Stabbing              (fast striker, not a 2H swing)
//   mage cast       <- Standing 2H Cast Spell (signature two-handed channel)
//   juggernaut idle <- Great Sword Idle      (heavy weapon rest pose)
//   juggernaut jump <- Great Sword Jump Attack (leaping slam)
export const HERO_STATE_PREFIX_OVERRIDES = {
  rogue:      { attack: 'hero_rogue' },
  mage:       { cast: 'hero_mage' },
  juggernaut: { idle: 'hero_juggernaut', jump: 'hero_juggernaut' }
};

const _config = {
  basePath: 'assets/models/',   // relative to client/ (served root)
  fileVariants: [
    (prefix, state) => `${prefix}_${state}.fbx`,
    (prefix, state) => `${prefix}_${state}_mixamo.fbx`
  ],
  rootMotion: 'y',              // 'full' | 'y' | 'none'
  positionMode: 'relative',     // 'relative' | 'absolute'
  positionScale: null,          // null = auto from hips height
  targetHipsHeight: null        // null = auto-detect
};

export function configureMixamo(opts = {}) {
  Object.assign(_config, opts);
  return _config;
}

// ---------------------------------------------------------------------------
// Bone-name canonicalization
// ---------------------------------------------------------------------------

// "Rig:mixamorigLeftForeArm" -> "leftforearm"; "LeftArm" -> "leftarm".
export function canonicalBoneName(name) {
  let n = String(name || '');
  const colon = n.lastIndexOf(':');
  if (colon >= 0) n = n.slice(colon + 1);       // strip namespace
  n = n.toLowerCase().replace(/^mixamorig/, ''); // strip Mixamo prefix
  n = n.replace(/[_\-.\s]/g, '');               // strip separators
  return n;
}

// Canonical Mixamo bone -> virtual pivot key (hero/mob rigs).
// Bones NOT listed here (elbows, knees, toes, fingers) are dropped for
// single-pivot rigs — documented limitation, not a bug.
const VIRTUAL_BONE_MAP = {
  hips: 'root',
  spine: 'chest', spine1: 'chest', spine2: 'chest',
  neck: 'head', head: 'head',
  leftshoulder: 'leftArm', leftarm: 'leftArm',
  rightshoulder: 'rightArm', rightarm: 'rightArm',
  leftupleg: 'leftLeg', rightupleg: 'rightLeg'
};

function collectSkinnedBoneMap(target, rig) {
  const map = new Map(); // canonical -> bone.name
  const addBone = (o) => {
    if (!o || !o.isBone) return;
    const canon = canonicalBoneName(o.name);
    if (canon && !map.has(canon)) map.set(canon, o.name);
  };
  target.traverse(addBone);
  // Robustness: some exporters keep bones only in skeleton.bones, detached
  // from the traversed graph — merge those too.
  const skelBones = rig && rig.refs && rig.refs.skeleton && rig.refs.skeleton.bones;
  if (Array.isArray(skelBones)) skelBones.forEach(addBone);
  return map;
}

function findTargetBoneName(canon, boneMap) {
  if (boneMap.has(canon)) return boneMap.get(canon);
  // Fallback: trailing-digit-insensitive ("spine1" <-> "spine").
  const stripped = canon.replace(/\d+$/, '');
  if (stripped !== canon && boneMap.has(stripped)) return boneMap.get(stripped);
  for (const [key, name] of boneMap) {
    if (key.replace(/\d+$/, '') === stripped) return name;
  }
  return null;
}

const TRACK_RE = /^(.*)\.(position|quaternion|scale)$/;

function splitTrackName(trackName) {
  const m = TRACK_RE.exec(trackName);
  if (!m) return null;
  return { nodeName: m[1], property: m[2] };
}

// ---------------------------------------------------------------------------
// Retargeting
// ---------------------------------------------------------------------------

function sourceHipsHeight(clip) {
  for (const track of clip.tracks) {
    const parts = splitTrackName(track.name);
    if (!parts || parts.property !== 'position') continue;
    if (canonicalBoneName(parts.nodeName) === 'hips' && track.values.length >= 3) {
      return Math.abs(track.values[1]) || 0;
    }
  }
  return 0;
}

function detectTargetHipsHeight(target, rig) {
  if (_config.targetHipsHeight) return _config.targetHipsHeight;
  if (rig && (rig.kind === RIG_HERO || rig.kind === RIG_MOB) && rig.refs.root) {
    // Hero hips sit ~0.9 units above the root pivot in model space.
    const s = target.scale ? target.scale.y || 1 : 1;
    return 0.9 * s;
  }
  if (rig && rig.refs && rig.refs.skeleton) {
    const bones = rig.refs.skeleton.bones;
    const hip = bones.find((b) => canonicalBoneName(b.name) === 'hips');
    if (hip) {
      // Parent-space height, NOT world: the hips position track is applied to
      // the bone's LOCAL position and relativized around its local base, so
      // a world-space height inflates posScale by the ancestor scale chain
      // (e.g. 2.1x for elites with modelScale 1.25 x group 1.68) and buries
      // the model on crouch/death. (2026-09-26 batch3 verification.)
      const v = new THREE.Vector3();
      hip.getWorldPosition(v);
      const ps = new THREE.Vector3();
      if (hip.parent) hip.parent.getWorldScale(ps);
      const h = Math.abs(v.y) / (ps.y || 1);
      return h || 0.9;
    }
  }
  return 0.9;
}

function resolvePositionScale(clip, target, rig, opts) {
  if (opts.positionScale != null) return opts.positionScale;
  if (_config.positionScale != null) return _config.positionScale;
  const srcH = sourceHipsHeight(clip);
  if (!srcH) return 1;
  const dstH = detectTargetHipsHeight(target, rig);
  return dstH / srcH;
}

// Make position tracks relative to their first keyframe, re-centered on the
// target node's base-pose local position, so the clip animates AROUND the
// rig's base pose instead of teleporting the node to Mixamo's bind pose —
// or to the parent origin (three.js applies position tracks as absolute
// local positions, so a zero-centered delta drops the hips to the floor).
function relativizePositionTrack(track, base) {
  const n = track.values.length / 3;
  if (n < 1) return track;
  const bx = track.values[0], by = track.values[1], bz = track.values[2];
  const ox = base ? base.x : 0, oy = base ? base.y : 0, oz = base ? base.z : 0;
  const out = track.clone();
  for (let i = 0; i < n; i++) {
    out.values[i * 3] = ox + (out.values[i * 3] - bx);
    out.values[i * 3 + 1] = oy + (out.values[i * 3 + 1] - by);
    out.values[i * 3 + 2] = oz + (out.values[i * 3 + 2] - bz);
  }
  return out;
}

function processPositionTrack(track, scale, rootMotion, isRoot, positionMode, base) {
  let t = track;
  if (scale !== 1) {
    t = t.clone();
    for (let i = 0; i < t.values.length; i++) t.values[i] *= scale;
  }
  if (positionMode === 'relative') t = relativizePositionTrack(t, base);
  if (isRoot && rootMotion !== 'full') {
    t = t.clone();
    const n = t.values.length / 3;
    const ox = base ? base.x : 0, oy = base ? base.y : 0, oz = base ? base.z : 0;
    for (let i = 0; i < n; i++) {
      if (rootMotion === 'none') {
        t.values[i * 3] = ox; t.values[i * 3 + 1] = oy; t.values[i * 3 + 2] = oz;
      } else { // 'y': keep vertical bob around base, kill planar drift (game moves the group)
        t.values[i * 3] = ox; t.values[i * 3 + 2] = oz;
      }
    }
  }
  return t;
}

// Retarget a Mixamo AnimationClip onto `target` (any Object3D).
// Returns a new AnimationClip, or null when nothing could be mapped.
export function retargetClip(clip, target, opts = {}) {
  if (!clip || !target) return null;
  const rig = detectRig(target);
  const isVirtual = rig.kind === RIG_HERO || rig.kind === RIG_MOB;

  let boneMap; // canonical -> target node name
  let rootCanons = new Set(['hips']);
  if (isVirtual) {
    ensureVirtualBoneNames(rig);
    boneMap = new Map();
    for (const [canon, pivotKey] of Object.entries(VIRTUAL_BONE_MAP)) {
      const pivot = rig.refs[pivotKey];
      if (pivot && pivot.name) boneMap.set(canon, pivot.name);
    }
  } else {
    boneMap = collectSkinnedBoneMap(target, rig);
    if (boneMap.size === 0) return null;
  }

  const rootMotion = opts.rootMotion || _config.rootMotion;
  const positionMode = opts.positionMode || _config.positionMode;
  const posScale = resolvePositionScale(clip, target, rig, opts);

  const newTracks = [];
  let dropped = 0;
  let mapped = 0;
  for (const track of clip.tracks) {
    const parts = splitTrackName(track.name);
    if (!parts) { dropped++; continue; }
    const canon = canonicalBoneName(parts.nodeName);

    let targetName;
    if (isVirtual) {
      targetName = boneMap.get(canon) || null; // strict: only mapped pivots
    } else {
      targetName = findTargetBoneName(canon, boneMap);
    }
    if (!targetName) { dropped++; continue; }

    let nt = track;
    if (parts.property === 'position') {
      // Base-pose center: the node's local position at retarget time (bind
      // pose for skinned rigs, pivot rest for virtual rigs). Position tracks
      // are applied as absolute locals, so deltas re-center here.
      const node = target.getObjectByName ? target.getObjectByName(targetName) : null;
      const base = node ? node.position : null;
      nt = processPositionTrack(track, posScale, rootMotion, rootCanons.has(canon), positionMode, base);
    } else {
      nt = track.clone();
    }
    nt.name = `${targetName}.${parts.property}`;
    newTracks.push(nt);
    mapped++;
  }

  if (mapped === 0) return null;
  const out = new THREE.AnimationClip(
    `${clip.name || 'mixamo'}_retargeted`, clip.duration, newTracks
  );
  out.userData = {
    source: 'mixamo', mapped, dropped, posScale, rootMotion, positionMode,
    virtual: isVirtual
  };
  return out;
}

// ---------------------------------------------------------------------------
// ClipSet — auto-discovery + async loading
// ---------------------------------------------------------------------------

export class MixamoClipSet {
  constructor(prefix, target = null, opts = {}) {
    this.prefix = prefix;
    this.target = target; // retarget onto this when set (may be set later)
    this.opts = { ...opts };
    this.clips = new Map();  // state -> retargeted AnimationClip
    this.missing = [];       // states with no file found
    this.loaded = false;
    this._loader = null;
  }

  setTarget(target) {
    this.target = target;
    return this;
  }

  candidateUrls(state) {
    return this.candidateUrlsFor(this.prefix, state);
  }

  candidateUrlsFor(prefix, state) {
    const variants = this.opts.fileVariants || _config.fileVariants;
    const base = this.opts.basePath || _config.basePath;
    return variants.map((fn) => base + fn(prefix, state));
  }

  async _tryLoad(url) {
    if (!this._loader) this._loader = new FBXLoader();
    const group = await this._loader.loadAsync(url);
    // Mixamo FBX: clips live in group.animations.
    if (group && group.animations && group.animations.length) {
      // Longest clip is usually the motion (short ones can be bind poses).
      return group.animations.reduce((a, b) => (a.duration >= b.duration ? a : b));
    }
    return null;
  }

  // Prefix resolution order for a state:
  //   1. opts.statePrefixes[state]  (e.g. { attack: 'hero_rogue' })
  //   2. this.prefix                (e.g. 'hero_mage')
  //   3. opts.fallbackPrefixes[]    (e.g. ['hero'] — the shared hero set)
  // First prefix with a loadable file wins; the rest are skipped silently.
  async loadState(state) {
    const prefixes = [];
    const sp = (this.opts.statePrefixes || {})[state];
    if (sp) prefixes.push(sp);
    prefixes.push(this.prefix);
    for (const fb of (this.opts.fallbackPrefixes || [])) {
      if (!prefixes.includes(fb)) prefixes.push(fb);
    }
    for (const pre of prefixes) {
      for (const url of this.candidateUrlsFor(pre, state)) {
        try {
          const clip = await this._tryLoad(url);
          if (clip) {
            clip.name = `${pre}_${state}`;
            const final = this.target ? (retargetClip(clip, this.target, this.opts) || clip) : clip;
            this.clips.set(state, final);
            return final;
          }
        } catch (e) {
          // 404 / parse error -> try next variant, then next prefix.
        }
      }
    }
    if (!this.missing.includes(state)) this.missing.push(state);
    return null;
  }

  // Load every state in CLIP_STATES. Never throws: missing files are skipped
  // so the procedural fallback covers them (see the animator's clip priority).
  async load(onProgress) {
    this.loaded = false;
    this.clips.clear();
    this.missing = [];
    const states = this.opts.states || CLIP_STATES;
    for (const state of states) {
      const clip = await this.loadState(state);
      if (typeof onProgress === 'function') {
        try { onProgress(state, !!clip, this); } catch (e) { /* ignore */ }
      }
    }
    this.loaded = true;
    return this;
  }

  // Re-run discovery (e.g. after the user drops new FBX files in) and
  // re-retarget onto a (possibly new) target.
  async reload(onProgress) {
    return this.load(onProgress);
  }

  hasClip(state) { return this.clips.has(state); }
  getClip(state) { return this.clips.get(state) || null; }
  states() { return [...this.clips.keys()]; }

  // { state: clip } for animator.setClips().
  toClipMap() {
    const map = {};
    for (const [state, clip] of this.clips) map[state] = clip;
    return map;
  }

  report() {
    return {
      prefix: this.prefix,
      loaded: this.states(),
      missing: [...this.missing],
      detail: [...this.clips.values()].map((c) => ({
        name: c.name, duration: +c.duration.toFixed(2), ...(c.userData || {})
      }))
    };
  }

  dispose() {
    this.clips.clear();
    this._loader = null;
  }
}

// Convenience: build + load in one call.
export async function loadClipSet(prefix, target = null, opts = {}, onProgress) {
  const set = new MixamoClipSet(prefix, target, opts);
  await set.load(onProgress);
  return set;
}
