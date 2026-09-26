// propPlacer.js - Seeded 3D prop placement for biome room templates.
//
// Owns every decorative prop the new biome system adds to the citadel:
//   - High-quality procedural PBR geometry (stone, aged wood, rusted iron,
//     bone, emissive lava/ember) built in code. No downloads, no placeholders.
//   - Shared geometry/material caches: props are cheap to spawn by the dozen.
//   - Seeded rejection sampling against KEEP_OUTS (pillars, runes, fountains,
//     doorways, GLB anchors, lava) so props never block gameplay.
//   - Per-zone floor overlay textures so each biome reads differently at a
//     glance, without touching the shared citadel floor material.
//
// Used by DungeonBuilder.applyProceduralFloorConfig(); never touches the
// server, the network, or entity code.

import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from '/vendor/addons/utils/BufferGeometryUtils.js';
// Phase 4 (workstream 6: PERFORMANCE PASS): InstancedMesh batching for static
// props + distance LOD on instanced decor parts. See client/js/perf/.
import { PropInstancer, STATIC_PROP_TYPES } from './perf/propInstancer.js';
// [perf-workstream] within-prop static part merging for dynamic props.
import { batchStaticMeshes, isBatchingEnabled, disposeBatchedMeshes } from './perf/staticBatcher.js';

// ---------------------------------------------------------------- caches
const geoCache = new Map();
const matCache = new Map();

function geo(key, maker) {
  let g = geoCache.get(key);
  if (!g) {
    g = maker();
    geoCache.set(key, g);
  }
  return g;
}

function mat(key, maker) {
  let m = matCache.get(key);
  if (!m) {
    m = maker();
    matCache.set(key, m);
  }
  return m;
}

const std = (color, roughness, metalness = 0.0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

// Shared PBR material languages (one language per biome family)
function cryptStone() { return mat('cryptStone', () => std(0x6a7382, 0.88, 0.06)); }
function cryptDark() { return mat('cryptDark', () => std(0x3d434e, 0.92, 0.05)); }
function cavernRock() { return mat('cavernRock', () => std(0x4a3a2c, 1.0, 0.0, { flatShading: true })); }
function cavernRockDark() { return mat('cavernRockDark', () => std(0x2e2318, 1.0, 0.0, { flatShading: true })); }
function basalt() { return mat('basalt', () => std(0x2a2422, 0.95, 0.08)); }
function marble() { return mat('marble', () => std(0x8a8296, 0.5, 0.12)); }
function marbleDark() { return mat('marbleDark', () => std(0x4a4456, 0.62, 0.1)); }
function bone() { return mat('bone', () => std(0xe3dccb, 0.55, 0.02)); }
function boneDark() { return mat('boneDark', () => std(0xb8ab90, 0.65, 0.02)); }
function rustedIron() { return mat('rustedIron', () => std(0x5a3a26, 0.62, 0.68)); }
function darkIron() { return mat('darkIron', () => std(0x3b3b46, 0.42, 0.8)); }
function agedWood() { return mat('agedWood', () => std(0x5a3d22, 0.82, 0.0)); }
function darkWood() { return mat('darkWood', () => std(0x3a2818, 0.85, 0.0)); }
function gold() { return mat('gold', () => std(0xd4af37, 0.3, 0.9)); }
function rubbleMat() { return mat('rubbleMat', () => std(0x55505a, 0.95, 0.02)); }
// Biome-dressing pass: static emissive languages for the new instanced props.
// Shared (cached) materials — never pulsed, so every instance stays cheap.
function emberCrystalMat() {
  return mat('emberCrystal', () => new THREE.MeshStandardMaterial({
    color: 0x3a1a08, emissive: 0xff6a1a, emissiveIntensity: 1.6,
    roughness: 0.35, metalness: 0.0, flatShading: true
  }));
}
function coldCoalMat() {
  return mat('coldCoals', () => new THREE.MeshStandardMaterial({
    color: 0x2a0d05, emissive: 0xff5a1a, emissiveIntensity: 1.5,
    roughness: 0.6, metalness: 0.0
  }));
}
function glowDiscMat() {
  return mat('glowDisc', () => new THREE.MeshBasicMaterial({
    color: 0xff7a2a, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
}

function lavaMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x531a08, emissive: 0xff4400, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0.0
  });
}
function emberMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x3a1408, emissive: 0xff6622, emissiveIntensity: 1.8, roughness: 0.5, metalness: 0.0
  });
}

function mesh(geoKey, geoMaker, material, x = 0, y = 0, z = 0, castShadow = false) {
  const m = new THREE.Mesh(geo(geoKey, geoMaker), material);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- merged parts
// Biome-dressing pass: same-material sub-parts of a prop are merged into ONE
// geometry (one draw call per material instead of per part). Each entry:
//   { g: base THREE.BufferGeometry, p:[x,y,z], e:[rx,ry,rz], s:[sx,sy,sz]|n }
// The merged result is cached under `key`. Template bakes are
// seed-deterministic per (type, biome), so cache reuse across floors is
// exact. Base geometries are cloned before transform — shared cached
// geometry is never mutated.
const _hm = new THREE.Matrix4();
const _hq = new THREE.Quaternion();
const _he = new THREE.Euler();
const _hv = new THREE.Vector3();
const _hs = new THREE.Vector3();

function mergedGeo(key, parts) {
  let g = geoCache.get(key);
  if (g) return g;
  const list = parts.map((pt) => {
    const bg = pt.g.clone();
    _he.set(pt.e ? pt.e[0] : 0, pt.e ? pt.e[1] : 0, pt.e ? pt.e[2] : 0);
    _hq.setFromEuler(_he);
    _hv.set(pt.p ? pt.p[0] : 0, pt.p ? pt.p[1] : 0, pt.p ? pt.p[2] : 0);
    if (typeof pt.s === 'number') _hs.set(pt.s, pt.s, pt.s);
    else _hs.set(pt.s ? pt.s[0] : 1, pt.s ? pt.s[1] : 1, pt.s ? pt.s[2] : 1);
    _hm.compose(_hv, _hq, _hs);
    bg.applyMatrix4(_hm);
    return bg;
  });
  g = mergeGeometries(list, false);
  for (const x of list) x.dispose();
  geoCache.set(key, g);
  return g;
}

// One merged mesh: `key` must be unique per (prop type, biome template,
// material) because the merged layout is baked from the template seed.
function mmesh(key, parts, material, x = 0, y = 0, z = 0, castShadow = false) {
  const m = new THREE.Mesh(mergedGeo(key, parts), material);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

// Shorthand part spec.
const P = (g, p, e, s) => ({ g, p, e, s });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);

// ---------------------------------------------------------------- builders
// Each builder: (rng, template, atmosphere) => { group, radius }
const BUILDERS = {
  // ---- CRYPT ----
  sarcophagus(rng) {
    const g = new THREE.Group();
    g.add(mesh('sarcBase', () => new THREE.BoxGeometry(2.6, 0.7, 1.3), cryptStone(), 0, 0.35, 0, true));
    g.add(mesh('sarcLid', () => new THREE.BoxGeometry(2.75, 0.28, 1.42), cryptDark(), 0, 0.84, 0));
    // lid ridge
    g.add(mesh('sarcRidge', () => new THREE.BoxGeometry(2.2, 0.12, 0.3), cryptStone(), 0, 1.02, 0));
    // effigy: stylized recumbent figure
    const eff = mesh('sarcEffigy', () => new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), bone(), 0, 1.08, 0);
    eff.rotation.z = Math.PI / 2;
    eff.rotation.y = Math.PI / 2;
    g.add(eff);
    const head = mesh('sarcHead', () => new THREE.SphereGeometry(0.24, 10, 8), bone(), 0.95, 1.12, 0);
    g.add(head);
    // corner feet merged into one part (one draw call)
    g.add(mmesh('mg_sarcFeet', [
      P(box(0.35, 0.25, 0.35), [-1.1, 0.12, -0.5]),
      P(box(0.35, 0.25, 0.35), [1.1, 0.12, -0.5]),
      P(box(0.35, 0.25, 0.35), [-1.1, 0.12, 0.5]),
      P(box(0.35, 0.25, 0.35), [1.1, 0.12, 0.5])
    ], cryptDark()));
    return { group: g, radius: 1.8 };
  },

  bone_pile(rng) {
    const g = new THREE.Group();
    // Bones merged per material: one draw call per material, not per bone.
    const light = [], dark = [];
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const spec = P(box(0.7, 0.12, 0.16),
        [(rng() - 0.5) * 1.6, 0.08 + rng() * 0.25, (rng() - 0.5) * 1.6],
        [0, rng() * Math.PI * 2, (rng() - 0.5) * 0.4]);
      (rng() < 0.5 ? light : dark).push(spec);
    }
    // skull
    const sx = (rng() - 0.5) * 1.2, sz = (rng() - 0.5) * 1.2;
    light.push(P(new THREE.SphereGeometry(0.22, 10, 8), [sx, 0.2, sz], null, [1, 0.85, 1.1]));
    dark.push(P(box(0.22, 0.1, 0.26), [sx, 0.08, sz + 0.12]));
    if (light.length) g.add(mmesh('mg_bonePile_light', light, bone()));
    if (dark.length) g.add(mmesh('mg_bonePile_dark', dark, boneDark()));
    return { group: g, radius: 1.0 };
  },

  crypt_pillar(rng) {
    const g = new THREE.Group();
    g.add(mmesh('mg_cpTrim', [
      P(box(1.5, 0.5, 1.5), [0, 0.25, 0]),
      P(new THREE.TorusGeometry(0.66, 0.09, 8, 16), [0, 3.4, 0], [Math.PI / 2, 0, 0]),
      P(box(1.5, 0.4, 1.5), [0, 4.5, 0])
    ], cryptDark(), 0, 0, 0, true));
    g.add(mesh('cpShaft', () => new THREE.CylinderGeometry(0.55, 0.72, 3.8, 8), cryptStone(), 0, 2.4, 0, true));
    return { group: g, radius: 1.1 };
  },

  altar(rng, template) {
    const g = new THREE.Group();
    g.add(mesh('altarBase', () => new THREE.BoxGeometry(1.6, 0.4, 1.6), cryptDark(), 0, 0.2, 0, true));
    g.add(mesh('altarSlab', () => new THREE.BoxGeometry(2.0, 0.85, 1.2), cryptStone(), 0, 0.82, 0, true));
    // glowing rune inlay on the slab
    const ring = new THREE.Mesh(
      geo('altarRing', () => new THREE.RingGeometry(0.42, 0.55, 24)),
      new THREE.MeshBasicMaterial({ color: template.mood.accent, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 1.26, 0);
    g.add(ring);
    // candles
    for (let i = -1; i <= 1; i++) {
      g.add(mesh('candle', () => new THREE.CylinderGeometry(0.05, 0.06, 0.35, 6), bone(), i * 0.55, 1.42, -0.35));
    }
    return { group: g, radius: 1.6 };
  },

  // ---- CAVERN ----
  stalagmite(rng) {
    const g = new THREE.Group();
    // Cones merged per material: one draw call per material, not per cone.
    const a = [], b = [];
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const h = 1.4 + rng() * 1.8;
      const r = 0.35 + rng() * 0.4;
      ((i % 2 ? b : a)).push(P(new THREE.ConeGeometry(0.6, 2.2, 7),
        [(rng() - 0.5) * 1.4, h / 2, (rng() - 0.5) * 1.4], null, [r / 0.6, h / 2.2, r / 0.6]));
    }
    if (a.length) g.add(mmesh('mg_stalagmite_a', a, cavernRock()));
    if (b.length) g.add(mmesh('mg_stalagmite_b', b, cavernRockDark()));
    return { group: g, radius: 1.0 };
  },

  stalactite_cluster(rng) {
    const g = new THREE.Group();
    const parts = [];
    const n = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const len = 1.2 + rng() * 1.6;
      parts.push(P(new THREE.ConeGeometry(0.45, 2.0, 7),
        [(rng() - 0.5) * 1.8, 4.8 - len / 2, (rng() - 0.5) * 1.8],
        [Math.PI, 0, 0], [1, len / 2.0, 1])); // apex down
    }
    g.add(mmesh('mg_stalactite', parts, cavernRockDark()));
    return { group: g, radius: 1.2 };
  },

  rock_spire(rng) {
    const g = new THREE.Group();
    g.add(mesh('spireMain', () => new THREE.ConeGeometry(1.1, 4.4, 7), cavernRock(), 0, 2.2, 0, true));
    const sides = [];
    for (let i = 0; i < 2; i++) {
      sides.push(P(new THREE.ConeGeometry(0.5, 2.0, 6),
        [(rng() - 0.5) * 1.8, 1.0, (rng() - 0.5) * 1.8], [0, 0, (rng() - 0.5) * 0.5]));
    }
    g.add(mmesh('mg_spireSides', sides, cavernRockDark()));
    return { group: g, radius: 1.3 };
  },

  ember_vent(rng, template, atmosphere) {
    const g = new THREE.Group();
    const mound = mesh('ventMound', () => new THREE.DodecahedronGeometry(0.85, 0), cavernRockDark(), 0, 0.35, 0);
    mound.scale.set(1.2, 0.55, 1.2);
    g.add(mound);
    const em = emberMat(); // per-vent material so pulses desync
    for (let i = 0; i < 3; i++) {
      const crack = mesh(`ventCrack_${i}`, () => new THREE.BoxGeometry(0.9, 0.06, 0.1), em,
        (rng() - 0.5) * 0.5, 0.62 + rng() * 0.1, (rng() - 0.5) * 0.5);
      crack.rotation.y = rng() * Math.PI;
      g.add(crack);
    }
    if (atmosphere) atmosphere.registerPulse(em, 1.8, 0.9, 2.0 + rng() * 1.5);
    return { group: g, radius: 1.1 };
  },

  // ---- FORGE ----
  anvil(rng) {
    const g = new THREE.Group();
    // All dark-iron parts merged into one draw call.
    g.add(mmesh('mg_anvilIron', [
      P(box(0.95, 0.5, 0.95), [0, 0.25, 0]),
      P(box(0.5, 0.55, 0.5), [0, 1.05, 0]),
      P(new THREE.ConeGeometry(0.32, 0.9, 10), [1.15, 1.5, 0], [0, 0, -Math.PI / 2])
    ], darkIron(), 0, 0, 0, true));
    g.add(mesh('anvilStump', () => new THREE.BoxGeometry(1.1, 0.35, 1.1), basalt(), 0, 0.62, 0));
    const topMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.35, metalness: 0.85, emissive: 0xff3300, emissiveIntensity: 0.22 });
    g.add(mesh('anvilTop', () => new THREE.BoxGeometry(1.7, 0.42, 0.72), topMat, 0, 1.5, 0));
    return { group: g, radius: 1.2 };
  },

  lava_channel(rng, template, atmosphere) {
    const g = new THREE.Group();
    const len = 6 + rng() * 3;
    const lm = lavaMat(); // per-channel material for desynced pulse
    const surf = new THREE.Mesh(geo('lavaSurf', () => new THREE.PlaneGeometry(1, 1)), lm);
    surf.scale.set(1.15, len, 1);
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 0.04;
    g.add(surf);
    // dark rock borders
    for (const sx of [-0.85, 0.85]) {
      const border = mesh(`lavaBorder_${sx < 0 ? 'l' : 'r'}`, () => new THREE.BoxGeometry(0.55, 0.22, 1), basalt(), sx, 0.11, 0);
      border.scale.z = len;
      g.add(border);
    }
    if (atmosphere) atmosphere.registerPulse(lm, 2.2, 0.8, 1.8 + rng() * 1.2);
    return { group: g, radius: len / 2 };
  },

  hanging_chain(rng) {
    const g = new THREE.Group();
    // All links + hook merged: one draw call for the whole chain.
    const parts = [];
    const links = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < links; i++) {
      parts.push(P(new THREE.TorusGeometry(0.16, 0.045, 6, 10),
        [0, 4.8 - i * 0.27, 0], [0, (i % 2) * Math.PI / 2, 0]));
    }
    parts.push(P(new THREE.TorusGeometry(0.2, 0.05, 6, 10, Math.PI * 1.4),
      [0, 4.8 - links * 0.27, 0], [0, 0, Math.PI * 0.8]));
    g.add(mmesh('mg_chain', parts, rustedIron()));
    return { group: g, radius: 0.5 };
  },

  crucible(rng, template, atmosphere) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.add(mesh(`crucLeg_${i}`, () => new THREE.CylinderGeometry(0.07, 0.09, 0.8, 6), darkIron(),
        Math.cos(a) * 0.5, 0.4, Math.sin(a) * 0.5));
    }
    g.add(mesh('crucPot', () => new THREE.CylinderGeometry(0.72, 0.5, 0.9, 12), darkIron(), 0, 1.15, 0, true));
    const lm = lavaMat();
    const liquid = new THREE.Mesh(geo('crucLiquid', () => new THREE.CircleGeometry(0.6, 16)), lm);
    liquid.rotation.x = -Math.PI / 2;
    liquid.position.y = 1.52;
    g.add(liquid);
    if (atmosphere) atmosphere.registerPulse(lm, 2.4, 0.9, 2.6);
    return { group: g, radius: 1.2 };
  },

  // ---- THRONE ROOM ----
  throne(rng) {
    const g = new THREE.Group();
    g.add(mesh('throneDais', () => new THREE.BoxGeometry(3.4, 0.35, 2.6), marbleDark(), 0, 0.17, 0, true));
    // All dark-wood parts merged: seat, tall back, armrests.
    g.add(mmesh('mg_throneWood', [
      P(box(1.7, 0.55, 1.4), [0, 0.62, 0]),
      P(box(1.7, 2.7, 0.32), [0, 2.2, -0.62]),
      P(box(0.22, 0.9, 1.3), [-0.95, 1.25, 0]),
      P(box(0.22, 0.9, 1.3), [0.95, 1.25, 0])
    ], darkWood(), 0, 0, 0, true));
    // cushion
    g.add(mesh('throneCushion', () => new THREE.BoxGeometry(1.45, 0.18, 1.15),
      mat('crimson', () => std(0x7a1420, 0.7, 0.0)), 0, 0.95, 0));
    // All gold trim merged: top trim, side trims, crown orb, arm posts.
    g.add(mmesh('mg_throneGold', [
      P(box(1.78, 0.14, 0.36), [0, 3.35, -0.62]),
      P(box(0.14, 2.5, 0.36), [-0.78, 2.2, -0.62]),
      P(box(0.14, 2.5, 0.36), [0.78, 2.2, -0.62]),
      P(new THREE.SphereGeometry(0.22, 12, 10), [0, 3.72, -0.62]),
      P(new THREE.SphereGeometry(0.14, 8, 8), [-0.95, 1.78, -0.55]),
      P(new THREE.SphereGeometry(0.14, 8, 8), [0.95, 1.78, -0.55])
    ], gold()));
    return { group: g, radius: 2.2 };
  },

  grand_pillar(rng) {
    const g = new THREE.Group();
    g.add(mmesh('mg_gpMarbleDark', [
      P(new THREE.CylinderGeometry(1.0, 1.12, 0.5, 12), [0, 0.25, 0]),
      P(box(1.7, 0.42, 1.7), [0, 5.3, 0])
    ], marbleDark(), 0, 0, 0, true));
    g.add(mesh('gpShaft', () => new THREE.CylinderGeometry(0.62, 0.78, 4.6, 12), marble(), 0, 2.8, 0, true));
    g.add(mmesh('mg_gpBands', [
      P(new THREE.TorusGeometry(0.72, 0.07, 8, 18), [0, 1.6, 0], [Math.PI / 2, 0, 0]),
      P(new THREE.TorusGeometry(0.72, 0.07, 8, 18), [0, 4.0, 0], [Math.PI / 2, 0, 0])
    ], gold()));
    return { group: g, radius: 1.2 };
  },

  banner(rng, template) {
    const g = new THREE.Group();
    // pole, crossbar and wall bracket merged: one iron draw call.
    g.add(mmesh('mg_bannerIron', [
      P(cyl(0.07, 0.09, 3.4, 8), [0, 1.7, 0]),
      P(cyl(0.05, 0.05, 1.5, 6), [0, 3.25, 0], [0, 0, Math.PI / 2]),
      P(box(0.5, 0.12, 0.12), [0, 2.6, -0.25])
    ], darkIron()));
    const clothMat = mat(`bannerCloth_${template.id}`, () =>
      std(template.id === 'throne_room' ? 0x6a1a2a : template.mood.accent, 0.85, 0.0, { side: THREE.DoubleSide }));
    const cloth = new THREE.Mesh(geo('bannerCloth', () => new THREE.PlaneGeometry(1.3, 2.3, 1, 4)), clothMat);
    cloth.position.set(0, 2.0, 0.02);
    cloth.receiveShadow = true;
    g.add(cloth);
    // gold hem
    g.add(mesh('bannerHem', () => new THREE.BoxGeometry(1.32, 0.09, 0.03), gold(), 0, 0.9, 0.02));
    return { group: g, radius: 0.6 };
  },

  brazier(rng, template, atmosphere) {
    const g = new THREE.Group();
    g.add(mesh('brazStand', () => new THREE.CylinderGeometry(0.1, 0.2, 1.1, 8), darkIron(), 0, 0.55, 0, true));
    g.add(mesh('brazBowl', () => new THREE.CylinderGeometry(0.55, 0.28, 0.42, 10), darkIron(), 0, 1.28, 0));
    const coals = new THREE.Mesh(geo('brazCoals', () => new THREE.CircleGeometry(0.42, 12)), emberMat());
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = 1.46;
    g.add(coals);
    if (atmosphere) {
      const flame = atmosphere.makeFlameSprite(template.torch.flame, 1.1);
      flame.position.set(0, 1.95, 0);
      g.add(flame);
      const tl = atmosphere.registerTorchLight(0, 2.1, 0, template.torch.light, 1.5, 10);
      if (tl) g.add(tl);
    }
    return { group: g, radius: 0.9 };
  },

  chest(rng) {
    const g = new THREE.Group();
    g.add(mesh('chestBody', () => new THREE.BoxGeometry(1.25, 0.68, 0.82), agedWood(), 0, 0.34, 0, true));
    const lid = mesh('chestLid', () => new THREE.BoxGeometry(1.25, 0.3, 0.82), darkWood(), 0, 0.8, -0.1);
    lid.rotation.x = -0.5; // ajar
    g.add(lid);
    g.add(mmesh('mg_chestBands', [
      P(box(0.12, 0.72, 0.86), [-0.4, 0.36, 0]),
      P(box(0.12, 0.72, 0.86), [0.4, 0.36, 0])
    ], darkIron()));
    g.add(mesh('chestLock', () => new THREE.BoxGeometry(0.2, 0.24, 0.1), gold(), 0, 0.5, 0.43));
    return { group: g, radius: 1.0 };
  },

  // ---- BIOME DRESSING (Phase: level-design enrichment) ----
  // All static: batched into InstancedMeshes via STATIC_PROP_TYPES. No
  // atmosphere registration, no per-instance animation — one draw call per
  // material per biome.

  broken_pillar(rng) {
    const g = new THREE.Group();
    // snapped shaft stump, slightly tilted
    const stump = mmesh('mg_brokenPillar', [
      P(cyl(0.55, 0.72, 1.4, 8), [0, 0.7, 0], [0, 0, 0.08])
    ], cryptStone(), 0, 0, 0, true);
    g.add(stump);
    // fallen capital chunk + chips lying beside it
    g.add(mmesh('mg_brokenPillarFallen', [
      P(box(0.95, 0.6, 0.95), [1.35, 0.3, 0.45], [0, rng() * Math.PI, 0.12]),
      P(box(0.4, 0.25, 0.35), [0.7, 0.12, -0.6], [0, rng() * Math.PI, 0]),
      P(box(0.3, 0.2, 0.28), [1.9, 0.1, -0.2], [0, rng() * Math.PI, 0])
    ], cryptDark()));
    return { group: g, radius: 1.3 };
  },

  tattered_banner(rng, template) {
    const g = new THREE.Group();
    g.add(mesh('tatteredPole', () => new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8), darkIron(), 0, 1.6, 0));
    // torn cloth: plane with a jagged, chewed bottom edge (seeded, baked)
    const clothGeo = new THREE.PlaneGeometry(1.2, 2.1, 1, 4);
    const pos = clothGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < -0.6) {
        pos.setY(i, y + rng() * 0.55);
        pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * 0.12);
      }
    }
    clothGeo.computeVertexNormals();
    const clothMat = mat(`tatteredCloth_${template.id}`, () =>
      std(0x39435a, 0.9, 0.0, { side: THREE.DoubleSide }));
    const cloth = new THREE.Mesh(geo(`tatteredClothGeo|${template.id}`, () => clothGeo), clothMat);
    cloth.position.set(0, 1.95, 0.04);
    cloth.receiveShadow = true;
    g.add(cloth);
    return { group: g, radius: 0.6 };
  },

  // Instanced floor decal: cracks / grime / lava seams per biome language.
  // One 128px canvas texture per style, unlit (MeshBasicMaterial) so lava
  // seams read as glowing in the dark without any light cost.
  floor_decal(rng, template) {
    const g = new THREE.Group();
    const style = { crypt: 'crack', cavern: 'lavacrack', forge: 'ash', throne_room: 'grime' }[template.id] || 'crack';
    const decalMat = mat(`floorDecal_${template.id}`, () => new THREE.MeshBasicMaterial({
      map: paintDecalTexture(style),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    }));
    const decal = new THREE.Mesh(geo('floorDecalPlane', () => new THREE.PlaneGeometry(1.7, 1.7)), decalMat);
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = rng() * Math.PI * 2;
    decal.position.y = 0.035;
    const s = 0.8 + rng() * 0.7;
    decal.scale.set(s, s, 1);
    g.add(decal);
    return { group: g, radius: 0.9 };
  },

  ember_crystal(rng) {
    const g = new THREE.Group();
    // crystal cluster merged into one emissive part
    const parts = [
      P(new THREE.OctahedronGeometry(0.55, 0), [0, 0.75, 0], [0, rng() * 3, 0.1], [1, 1.6, 1])
    ];
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      parts.push(P(new THREE.OctahedronGeometry(0.2 + rng() * 0.12, 0),
        [Math.cos(a) * (0.5 + rng() * 0.3), 0.25 + rng() * 0.2, Math.sin(a) * (0.5 + rng() * 0.3)],
        [(rng() - 0.5) * 0.6, rng() * 3, (rng() - 0.5) * 0.6]));
    }
    g.add(mmesh('mg_emberCrystal', parts, emberCrystalMat(), 0, 0, 0, true));
    return { group: g, radius: 1.1 };
  },

  weapon_rack(rng) {
    const g = new THREE.Group();
    // A-frame rack: posts + crossbar merged (aged wood)
    g.add(mmesh('mg_rackFrame', [
      P(box(0.12, 1.5, 0.12), [-0.9, 0.75, 0], [0, 0, 0.06]),
      P(box(0.12, 1.5, 0.12), [0.9, 0.75, 0], [0, 0, -0.06]),
      P(box(2.0, 0.12, 0.12), [0, 1.32, 0])
    ], agedWood(), 0, 0, 0, true));
    // blades leaning on the crossbar, merged (dark iron)
    const blades = [];
    for (let i = -1; i <= 1; i++) {
      blades.push(P(box(0.09, 1.35, 0.025), [i * 0.55, 0.75, 0.12], [-0.16, 0, i * 0.1]));
      blades.push(P(box(0.2, 0.05, 0.05), [i * 0.55 - i * 0.07, 1.28, 0.02], [0, 0, i * 0.1])); // guard
    }
    g.add(mmesh('mg_rackBlades', blades, darkIron()));
    return { group: g, radius: 1.3 };
  },

  chain_curtain(rng) {
    const g = new THREE.Group();
    // 4 hanging chain strands merged into one part + mount bar
    const parts = [];
    for (let s = 0; s < 4; s++) {
      const x = -1.2 + s * 0.8;
      const links = 6 + Math.floor(rng() * 2);
      for (let i = 0; i < links; i++) {
        parts.push(P(new THREE.TorusGeometry(0.14, 0.04, 6, 10),
          [x, 4.55 - i * 0.24, 0], [0, (i % 2) * Math.PI / 2, 0]));
      }
    }
    g.add(mmesh('mg_chainCurtain', parts, rustedIron()));
    g.add(mesh('curtainBar', () => new THREE.BoxGeometry(3.0, 0.18, 0.18), darkIron(), 0, 4.72, 0));
    return { group: g, radius: 1.5 };
  },

  // Cold brazier: static (instanced) variant of the dynamic brazier — bowl +
  // emissive coals + additive glow disc. Flame glow with zero light cost and
  // zero per-instance animation; pairs with the forge's ember particles.
  brazier_cold(rng) {
    const g = new THREE.Group();
    g.add(mmesh('mg_coldBrazierIron', [
      P(cyl(0.09, 0.14, 1.1, 8), [0, 0.55, 0]),
      P(cyl(0.55, 0.28, 0.42, 10), [0, 1.28, 0]),
      P(cyl(0.05, 0.07, 0.5, 6), [0.3, 0.25, 0.2], [0, 0, 0.25]),
      P(cyl(0.05, 0.07, 0.5, 6), [-0.3, 0.25, 0.2], [0, 0, -0.25]),
      P(cyl(0.05, 0.07, 0.5, 6), [0, 0.25, -0.35], [0.25, 0, 0])
    ], darkIron(), 0, 0, 0, true));
    const coals = new THREE.Mesh(geo('coldCoalsDisc', () => new THREE.CircleGeometry(0.42, 12)), coldCoalMat());
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = 1.46;
    g.add(coals);
    const glow = new THREE.Mesh(geo('coldBrazierGlow', () => new THREE.CircleGeometry(0.95, 16)), glowDiscMat());
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 1.52;
    g.add(glow);
    return { group: g, radius: 0.9 };
  },

  statue(rng) {
    const g = new THREE.Group();
    g.add(mesh('statuePedestal', () => new THREE.BoxGeometry(1.3, 0.9, 1.3), marbleDark(), 0, 0.45, 0, true));
    // covenant knight figure merged into one marble part
    g.add(mmesh('mg_statueFigure', [
      P(box(0.55, 0.95, 0.4), [0, 1.62, 0]),
      P(box(0.8, 0.18, 0.42), [0, 2.02, 0]),
      P(new THREE.SphereGeometry(0.2, 10, 8), [0, 2.32, 0]),
      P(box(0.14, 0.7, 0.14), [-0.42, 1.55, 0.1], [0, 0, 0.15]),
      P(box(0.14, 0.7, 0.14), [0.42, 1.55, 0.1], [0, 0, -0.15]),
      P(box(0.09, 1.15, 0.09), [0.62, 1.35, 0.25], [0.1, 0, -0.2]), // greatsword at rest
      P(box(0.3, 0.06, 0.06), [0.52, 1.85, 0.22], [0, 0, -0.2])   // crossguard
    ], marble(), 0, 0, 0, true));
    return { group: g, radius: 1.2 };
  },

  tall_banner(rng, template) {
    const g = new THREE.Group();
    g.add(mesh('tallBannerPole', () => new THREE.CylinderGeometry(0.08, 0.1, 4.4, 8), darkIron(), 0, 2.2, 0));
    const clothMat = mat(`tallBannerCloth_${template.id}`, () =>
      std(template.id === 'throne_room' ? 0x6a1a2a : template.mood.accent, 0.85, 0.0, { side: THREE.DoubleSide }));
    const cloth = new THREE.Mesh(geo('tallBannerCloth', () => new THREE.PlaneGeometry(1.5, 3.1, 1, 5)), clothMat);
    cloth.position.set(0, 2.55, 0.03);
    cloth.receiveShadow = true;
    g.add(cloth);
    g.add(mesh('tallBannerHem', () => new THREE.BoxGeometry(1.52, 0.1, 0.04), gold(), 0, 1.0, 0.03));
    // finial
    g.add(mesh('tallBannerFinial', () => new THREE.SphereGeometry(0.12, 8, 8), gold(), 0, 4.48, 0));
    return { group: g, radius: 0.6 };
  },

  // ---- SHARED ----
  torch(rng, template, atmosphere) {
    const g = new THREE.Group();
    // wall bracket
    const arm = mesh('torchArm', () => new THREE.BoxGeometry(0.5, 0.09, 0.09), darkIron(), 0, 0, -0.2);
    g.add(arm);
    const stick = mesh('torchStick', () => new THREE.CylinderGeometry(0.055, 0.075, 0.95, 6), agedWood(), 0, 0.45, 0);
    stick.rotation.x = 0.12;
    g.add(stick);
    const wrap = mesh('torchWrap', () => new THREE.CylinderGeometry(0.09, 0.09, 0.22, 6), darkWood(), 0, 0.92, -0.05);
    g.add(wrap);
    if (atmosphere) {
      const flame = atmosphere.makeFlameSprite(template.torch.flame, 0.85);
      flame.position.set(0, 1.25, -0.05);
      g.add(flame);
      const tl = atmosphere.registerTorchLight(0, 1.35, 0, template.torch.light, 1.6, 11);
      if (tl) g.add(tl);
    }
    return { group: g, radius: 0.5 };
  },

  rubble(rng, template) {
    const g = new THREE.Group();
    // All rubble chunks merged: one draw call per rubble prop.
    const parts = [];
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const s = 0.2 + rng() * 0.45;
      parts.push(P(box(1, 0.7, 0.8),
        [(rng() - 0.5) * 1.4, s * 0.3, (rng() - 0.5) * 1.4],
        [0, rng() * Math.PI * 2, 0], s));
    }
    g.add(mmesh(`mg_rubble|${template.id}`, parts, rubbleMat()));
    return { group: g, radius: 0.9 };
  }
};

// ---------------------------------------------------------------- floor overlays
const floorTexCache = new Map();

function paintFloorTexture(style) {
  let tex = floorTexCache.get(style);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  const P = {
    crypt: { base: '#232b38', tile: '#2e3847', grout: '#12161e', vein: '#4d7fb8', speck: '#3a465a' },
    cavern: { base: '#241a12', tile: '#2e2318', grout: '#120c07', vein: '#ff7a2a', speck: '#3a2c1e' },
    forge: { base: '#161110', tile: '#1d1714', grout: '#0a0706', vein: '#ff5500', speck: '#2a201c' },
    throne: { base: '#2b2438', tile: '#352c46', grout: '#14101d', vein: '#d4af37', speck: '#403754' }
  }[style] || { base: '#222', tile: '#2a2a2a', grout: '#111', vein: '#888', speck: '#333' };

  ctx.fillStyle = P.base;
  ctx.fillRect(0, 0, 256, 256);

  // flagstone / tile grid
  const T = 64;
  for (let x = 0; x < 256; x += T) {
    for (let y = 0; y < 256; y += T) {
      const jx = ((x * 7 + y * 13) % 11) - 5;
      ctx.fillStyle = P.tile;
      ctx.fillRect(x + 3, y + 3, T - 6, T - 6);
      ctx.fillStyle = P.speck;
      for (let s = 0; s < 14; s++) {
        const sx = x + 6 + ((s * 37 + jx * 11) % (T - 12));
        const sy = y + 6 + ((s * 53 + jx * 7) % (T - 12));
        ctx.fillRect(sx, sy, 2, 2);
      }
      // accent vein: diagonal inlay on alternating tiles
      if (((x / T + y / T) % 2) === 0) {
        ctx.strokeStyle = P.vein;
        ctx.globalAlpha = style === 'forge' || style === 'cavern' ? 0.85 : 0.5;
        ctx.lineWidth = style === 'forge' ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 10, y + T - 10);
        ctx.lineTo(x + T - 10, y + 10);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = P.grout;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
    }
  }

  tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  floorTexCache.set(style, tex);
  return tex;
}

// ---------------------------------------------------------------- floor decals
// Instanced ground-detail decals: dark cracks, glowing lava seams, ash and
// grime. One 128px canvas texture per style (cached); drawn with a
// style-seeded rng so the texture is identical on every floor.
const decalTexCache = new Map();

function decalRng(style) {
  let h = 2166136261;
  for (let i = 0; i < style.length; i++) { h ^= style.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jaggedLine(ctx, rng, x, y, len, ang, segs, wobble) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  let cx = x, cy = y, a = ang;
  for (let i = 0; i < segs; i++) {
    a += (rng() - 0.5) * wobble;
    const step = len / segs;
    cx += Math.cos(a) * step;
    cy += Math.sin(a) * step;
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
}

function paintDecalTexture(style) {
  let tex = decalTexCache.get(style);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const rng = decalRng(style);

  if (style === 'crack') {
    // dark jagged floor cracks (crypt)
    ctx.strokeStyle = 'rgba(2,4,8,0.75)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.lineWidth = 2.5 + rng() * 2.5;
      jaggedLine(ctx, rng, 20 + rng() * 88, 20 + rng() * 88, 40 + rng() * 50, rng() * Math.PI * 2, 7, 1.1);
    }
    ctx.fillStyle = 'rgba(2,4,8,0.4)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(rng() * 128, rng() * 128, 3 + rng() * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === 'lavacrack') {
    // glowing lava seams (cavern) — unlit material, reads as emissive
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = 24 + rng() * 80, y = 24 + rng() * 80, ang = rng() * Math.PI * 2;
      ctx.strokeStyle = 'rgba(255,90,20,0.85)';
      ctx.lineWidth = 5 + rng() * 3;
      jaggedLine(ctx, rng, x, y, 50 + rng() * 45, ang, 8, 1.0);
      ctx.strokeStyle = 'rgba(255,205,130,0.95)';
      ctx.lineWidth = 1.8;
      jaggedLine(ctx, rng, x, y, 50 + rng() * 45, ang, 8, 1.0);
    }
  } else if (style === 'ash') {
    // scorched ash blotches (forge)
    for (let i = 0; i < 14; i++) {
      const r = 4 + rng() * 12;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(12,8,6,0.55)');
      g.addColorStop(1, 'rgba(12,8,6,0)');
      ctx.save();
      ctx.translate(rng() * 128, rng() * 128);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(10,6,5,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      jaggedLine(ctx, rng, 20 + rng() * 88, 20 + rng() * 88, 35 + rng() * 40, rng() * Math.PI * 2, 6, 1.2);
    }
  } else {
    // grime: worn dark patches (throne room)
    for (let i = 0; i < 10; i++) {
      const r = 6 + rng() * 16;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(5,4,8,0.42)');
      g.addColorStop(1, 'rgba(5,4,8,0)');
      ctx.save();
      ctx.translate(rng() * 128, rng() * 128);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  decalTexCache.set(style, tex);
  return tex;
}

// ---------------------------------------------------------------- placer
export class PropPlacer {
  constructor(scene, atmosphere) {
    this.scene = scene;
    this.atmosphere = atmosphere;
    this.group = null;
    this.keepOuts = [];
    // Phase 4 (workstream 6: PERFORMANCE PASS): InstancedMesh batching for
    // static props. On by default; setInstancing(false) restores the legacy
    // one-mesh-per-part path (used by the perf benchmark baseline).
    this.instancing = true;
    this.instancer = null;
  }

  // Phase 4 perf: toggle InstancedMesh batching. Takes effect on the next
  // decorateZones() call.
  setInstancing(on) {
    this.instancing = !!on;
  }

  // Phase 4 perf: distance LOD for instanced prop decor parts (throttled
  // internally; safe to call every frame).
  updateLOD(camera) {
    if (this.instancer) this.instancer.updateLOD(camera);
  }

  setKeepOuts(list) {
    this.keepOuts = list || [];
  }

  clear() {
    if (this.group) {
      // [perf-workstream] release batcher-owned merged geometry (Phase 4).
      disposeBatchedMeshes(this.group);
      this.scene.remove(this.group);
      this.group = null;
    }
    // Phase 4 perf: drop batched instance data with the group.
    if (this.instancer) this.instancer.reset();
  }

  hitsKeepOut(x, z, rad) {
    for (const k of this.keepOuts) {
      if (k.r !== undefined) {
        if (Math.hypot(x - k.x, z - k.z) < k.r + rad) return true;
      } else {
        const cx = Math.max(k.x1, Math.min(x, k.x2));
        const cz = Math.max(k.z1, Math.min(z, k.z2));
        if (Math.hypot(x - cx, z - cz) < rad) return true;
      }
    }
    return false;
  }

  // Sample a candidate position inside zone bounds for a placement mode.
  samplePosition(zone, mode, rng) {
    const b = zone.bounds;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    let x, z, faceCenter = false;

    switch (mode) {
      case 'corners': {
        const corners = [
          [b.minX, b.minZ], [b.maxX, b.minZ],
          [b.minX, b.maxZ], [b.maxX, b.maxZ]
        ];
        const [qx, qz] = corners[Math.floor(rng() * 4)];
        const inset = 2.2 + rng() * 1.6;
        x = qx + (qx < cx ? inset : -inset);
        z = qz + (qz < cz ? inset : -inset);
        faceCenter = true;
        break;
      }
      case 'perimeter':
      case 'wall': {
        const inset = mode === 'wall' ? 0.9 + rng() * 0.5 : 1.7 + rng() * 1.3;
        const side = Math.floor(rng() * 4);
        if (side === 0) { x = b.minX + inset; z = b.minZ + 1.5 + rng() * (d - 3); }
        else if (side === 1) { x = b.maxX - inset; z = b.minZ + 1.5 + rng() * (d - 3); }
        else if (side === 2) { z = b.minZ + inset; x = b.minX + 1.5 + rng() * (w - 3); }
        else { z = b.maxZ - inset; x = b.minX + 1.5 + rng() * (w - 3); }
        faceCenter = true;
        break;
      }
      case 'center': {
        if (Math.min(w, d) < 9) return null; // too small for a centerpiece
        x = cx + (rng() - 0.5) * 4;
        z = cz + (rng() - 0.5) * 4;
        break;
      }
      case 'aisle': {
        // two files along the zone's long axis (throne room colonnade)
        const alongZ = d >= w;
        const off = 2.6 + rng() * 1.2;
        const t = (rng() - 0.5) * (alongZ ? d - 8 : w - 8);
        if (alongZ) { x = cx + (rng() < 0.5 ? -off : off); z = cz + t; }
        else { x = cx + t; z = cz + (rng() < 0.5 ? -off : off); }
        break;
      }
      case 'far_wall': {
        x = cx + (rng() - 0.5) * Math.min(w - 6, 10);
        z = b.minZ + 2.6 + rng() * 1.2;
        break;
      }
      case 'floor_strip':
      case 'ceiling':
      case 'scatter':
      default: {
        const margin = mode === 'ceiling' ? 2.5 : 2.0;
        x = b.minX + margin + rng() * (w - margin * 2);
        z = b.minZ + margin + rng() * (d - margin * 2);
        break;
      }
    }

    if (x < b.minX + 0.8 || x > b.maxX - 0.8 || z < b.minZ + 0.8 || z > b.maxZ - 0.8) return null;
    return { x, z, faceCenter, cx, cz };
  }

  decorateZones(assignments, rng) {
    this.clear();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    // Phase 4 (workstream 6: PERFORMANCE PASS): (re)create the instancing
    // batcher for this floor. Templates are baked from the same BUILDERS
    // with fixed seeds, so layouts stay seed-stable.
    if (this.instancing) {
      this.instancer = new PropInstancer((type, template, seedRng) =>
        BUILDERS[type](seedRng, template, null));
    } else {
      this.instancer = null;
    }

    for (const { zone, template } of assignments) {
      this.addFloorOverlay(zone, template);
      const placed = []; // {x, z, radius} in this zone

      for (const rule of template.props) {
        const count = rule.min + Math.floor(rng() * (rule.max - rule.min + 1));
        for (let i = 0; i < count; i++) {
          let spot = null;
          let tries = 0;
          while (!spot && tries < 14) {
            tries++;
            const s = this.samplePosition(zone, rule.placement, rng);
            if (!s) continue;
            if (this.hitsKeepOut(s.x, s.z, rule.radius)) continue;
            let clash = false;
            for (const p of placed) {
              if (Math.hypot(s.x - p.x, s.z - p.z) < (rule.radius + p.radius) * 0.9 + 0.7) {
                clash = true;
                break;
              }
            }
            if (clash) continue;
            spot = s;
          }
          if (!spot) continue;

          const builder = BUILDERS[rule.type];
          if (!builder) continue;
          // Phase 4 (workstream 6: PERFORMANCE PASS): static prop types are
          // batched into InstancedMeshes (one draw call per part instead of
          // per prop) with per-instance rotation/scale/tint variation.
          // Dynamic props (pulses, flames, torch lights) keep individual
          // groups. Placement sampling is unchanged, so layouts stay
          // seed-stable.
          if (this.instancing && this.instancer && STATIC_PROP_TYPES.has(rule.type)) {
            const iRotY = spot.faceCenter
              ? Math.atan2(spot.cx - spot.x, spot.cz - spot.z)
              : rng() * Math.PI * 2;
            this.instancer.addPlacement(rule.type, template, spot.x, spot.z, iRotY, placed.length);
            placed.push({ x: spot.x, z: spot.z, radius: rule.radius });
            continue;
          }
          const built = builder(rng, template, this.atmosphere);
          // [perf-workstream] merge this dynamic prop's static parts per
          // material (Phase 4): e.g. crucible legs+pot collapse into one mesh,
          // vent cracks sharing the pulsing material collapse into one. Flame
          // sprites / point lights / pulsing materials are untouched, so
          // per-instance animation is unaffected. Local transforms bake here;
          // the group itself is positioned/rotated below.
          if (isBatchingEnabled()) batchStaticMeshes(built.group);
          built.group.position.set(spot.x, 0, spot.z);
          if (spot.faceCenter) {
            built.group.rotation.y = Math.atan2(spot.cx - spot.x, spot.cz - spot.z);
          } else {
            built.group.rotation.y = rng() * Math.PI * 2;
          }
          // wall-mounted props sit at sconce height
          if (rule.type === 'torch' && rule.placement === 'wall') {
            built.group.position.y = 2.1;
          }
          this.group.add(built.group);
          placed.push({ x: spot.x, z: spot.z, radius: built.radius });
        }
      }
    }
    // Phase 4 perf: flush the instanced batches into the group.
    if (this.instancing && this.instancer) this.instancer.finalize(this.group);
  }

  addFloorOverlay(zone, template) {
    const b = zone.bounds;
    const w = b.maxX - b.minX - 1.0;
    const d = b.maxZ - b.minZ - 1.0;
    if (w <= 1 || d <= 1) return;
    const tex = paintFloorTexture(template.floorStyle);
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        opacity: 0.88,
        roughness: template.id === 'throne_room' ? 0.45 : 0.9,
        metalness: template.id === 'throne_room' ? 0.25 : 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -1
      })
    );
    overlay.material.map = tex.clone();
    overlay.material.map.needsUpdate = true;
    overlay.material.map.repeat.set(Math.max(1, Math.round(w / 7)), Math.max(1, Math.round(d / 7)));
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set((b.minX + b.maxX) / 2, 0.02, (b.minZ + b.maxZ) / 2);
    overlay.receiveShadow = true;
    this.group.add(overlay);
  }
}
