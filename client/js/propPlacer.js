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
    // corner feet
    for (const [fx, fz] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) {
      g.add(mesh('sarcFoot', () => new THREE.BoxGeometry(0.35, 0.25, 0.35), cryptDark(), fx, 0.12, fz));
    }
    return { group: g, radius: 1.8 };
  },

  bone_pile(rng) {
    const g = new THREE.Group();
    const n = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const b = mesh('boneBit', () => new THREE.BoxGeometry(0.7, 0.12, 0.16), rng() < 0.5 ? bone() : boneDark(),
        (rng() - 0.5) * 1.6, 0.08 + rng() * 0.25, (rng() - 0.5) * 1.6);
      b.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.4);
      g.add(b);
    }
    // skull
    const skull = mesh('skull', () => new THREE.SphereGeometry(0.22, 10, 8), bone(), (rng() - 0.5) * 1.2, 0.2, (rng() - 0.5) * 1.2);
    skull.scale.set(1, 0.85, 1.1);
    g.add(skull);
    g.add(mesh('jaw', () => new THREE.BoxGeometry(0.22, 0.1, 0.26), boneDark(), skull.position.x, 0.08, skull.position.z + 0.12));
    return { group: g, radius: 1.0 };
  },

  crypt_pillar(rng) {
    const g = new THREE.Group();
    g.add(mesh('cpBase', () => new THREE.BoxGeometry(1.5, 0.5, 1.5), cryptDark(), 0, 0.25, 0, true));
    g.add(mesh('cpShaft', () => new THREE.CylinderGeometry(0.55, 0.72, 3.8, 8), cryptStone(), 0, 2.4, 0, true));
    // carved band
    const band = mesh('cpBand', () => new THREE.TorusGeometry(0.66, 0.09, 8, 16), cryptDark(), 0, 3.4, 0);
    band.rotation.x = Math.PI / 2;
    g.add(band);
    g.add(mesh('cpCap', () => new THREE.BoxGeometry(1.5, 0.4, 1.5), cryptDark(), 0, 4.5, 0));
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
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const h = 1.4 + rng() * 1.8;
      const r = 0.35 + rng() * 0.4;
      const c = mesh(`stalagmite_${i}`, () => new THREE.ConeGeometry(0.6, 2.2, 7), i % 2 ? cavernRock() : cavernRockDark(),
        (rng() - 0.5) * 1.4, h / 2, (rng() - 0.5) * 1.4);
      c.scale.set(r / 0.6, h / 2.2, r / 0.6);
      g.add(c);
    }
    return { group: g, radius: 1.0 };
  },

  stalactite_cluster(rng) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const len = 1.2 + rng() * 1.6;
      const c = mesh(`stalactite_${i}`, () => new THREE.ConeGeometry(0.45, 2.0, 7), cavernRockDark(),
        (rng() - 0.5) * 1.8, 4.8 - len / 2, (rng() - 0.5) * 1.8);
      c.scale.set(1, len / 2.0, 1);
      c.rotation.x = Math.PI; // apex down
      c.position.y = 4.8 - len / 2;
      g.add(c);
    }
    return { group: g, radius: 1.2 };
  },

  rock_spire(rng) {
    const g = new THREE.Group();
    const main = mesh('spireMain', () => new THREE.ConeGeometry(1.1, 4.4, 7), cavernRock(), 0, 2.2, 0, true);
    g.add(main);
    for (let i = 0; i < 2; i++) {
      const s = mesh(`spireSide_${i}`, () => new THREE.ConeGeometry(0.5, 2.0, 6), cavernRockDark(),
        (rng() - 0.5) * 1.8, 1.0, (rng() - 0.5) * 1.8);
      s.rotation.z = (rng() - 0.5) * 0.5;
      g.add(s);
    }
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
    g.add(mesh('anvilBase', () => new THREE.BoxGeometry(0.95, 0.5, 0.95), darkIron(), 0, 0.25, 0, true));
    g.add(mesh('anvilStump', () => new THREE.BoxGeometry(1.1, 0.35, 1.1), basalt(), 0, 0.62, 0));
    g.add(mesh('anvilWaist', () => new THREE.BoxGeometry(0.5, 0.55, 0.5), darkIron(), 0, 1.05, 0, true));
    const topMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.35, metalness: 0.85, emissive: 0xff3300, emissiveIntensity: 0.22 });
    g.add(mesh('anvilTop', () => new THREE.BoxGeometry(1.7, 0.42, 0.72), topMat, 0, 1.5, 0));
    const horn = mesh('anvilHorn', () => new THREE.ConeGeometry(0.32, 0.9, 10), darkIron(), 1.15, 1.5, 0);
    horn.rotation.z = -Math.PI / 2;
    g.add(horn);
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
    const links = 7 + Math.floor(rng() * 4);
    for (let i = 0; i < links; i++) {
      const link = mesh(`chainLink_${i}`, () => new THREE.TorusGeometry(0.16, 0.045, 6, 10), rustedIron(),
        0, 4.8 - i * 0.27, 0);
      link.rotation.y = (i % 2) * Math.PI / 2;
      g.add(link);
    }
    // hook at the end
    const hook = mesh('chainHook', () => new THREE.TorusGeometry(0.2, 0.05, 6, 10, Math.PI * 1.4), rustedIron(), 0, 4.8 - links * 0.27, 0);
    hook.rotation.z = Math.PI * 0.8;
    g.add(hook);
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
    g.add(mesh('throneSeat', () => new THREE.BoxGeometry(1.7, 0.55, 1.4), darkWood(), 0, 0.62, 0, true));
    // cushion
    g.add(mesh('throneCushion', () => new THREE.BoxGeometry(1.45, 0.18, 1.15),
      mat('crimson', () => std(0x7a1420, 0.7, 0.0)), 0, 0.95, 0));
    // tall back
    g.add(mesh('throneBack', () => new THREE.BoxGeometry(1.7, 2.7, 0.32), darkWood(), 0, 2.2, -0.62, true));
    // gold trim on back
    g.add(mesh('throneTrim', () => new THREE.BoxGeometry(1.78, 0.14, 0.36), gold(), 0, 3.35, -0.62));
    g.add(mesh('throneTrim2', () => new THREE.BoxGeometry(0.14, 2.5, 0.36), gold(), -0.78, 2.2, -0.62));
    g.add(mesh('throneTrim3', () => new THREE.BoxGeometry(0.14, 2.5, 0.36), gold(), 0.78, 2.2, -0.62));
    // crown orb
    g.add(mesh('throneOrb', () => new THREE.SphereGeometry(0.22, 12, 10), gold(), 0, 3.72, -0.62));
    // armrests with posts
    for (const sx of [-0.95, 0.95]) {
      g.add(mesh(`throneArm_${sx < 0 ? 'l' : 'r'}`, () => new THREE.BoxGeometry(0.22, 0.9, 1.3), darkWood(), sx, 1.25, 0));
      g.add(mesh(`thronePost_${sx < 0 ? 'l' : 'r'}`, () => new THREE.SphereGeometry(0.14, 8, 8), gold(), sx, 1.78, -0.55));
    }
    return { group: g, radius: 2.2 };
  },

  grand_pillar(rng) {
    const g = new THREE.Group();
    g.add(mesh('gpBase', () => new THREE.CylinderGeometry(1.0, 1.12, 0.5, 12), marbleDark(), 0, 0.25, 0, true));
    g.add(mesh('gpShaft', () => new THREE.CylinderGeometry(0.62, 0.78, 4.6, 12), marble(), 0, 2.8, 0, true));
    for (const by of [1.6, 4.0]) {
      const band = mesh(`gpBand_${by}`, () => new THREE.TorusGeometry(0.72, 0.07, 8, 18), gold(), 0, by, 0);
      band.rotation.x = Math.PI / 2;
      g.add(band);
    }
    g.add(mesh('gpCap', () => new THREE.BoxGeometry(1.7, 0.42, 1.7), marbleDark(), 0, 5.3, 0));
    return { group: g, radius: 1.2 };
  },

  banner(rng, template) {
    const g = new THREE.Group();
    g.add(mesh('bannerPole', () => new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8), darkIron(), 0, 1.7, 0));
    const bar = mesh('bannerBar', () => new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), darkIron(), 0, 3.25, 0);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
    const clothMat = mat(`bannerCloth_${template.id}`, () =>
      std(template.id === 'throne_room' ? 0x6a1a2a : template.mood.accent, 0.85, 0.0, { side: THREE.DoubleSide }));
    const cloth = new THREE.Mesh(geo('bannerCloth', () => new THREE.PlaneGeometry(1.3, 2.3, 1, 4)), clothMat);
    cloth.position.set(0, 2.0, 0.02);
    cloth.receiveShadow = true;
    g.add(cloth);
    // gold hem
    g.add(mesh('bannerHem', () => new THREE.BoxGeometry(1.32, 0.09, 0.03), gold(), 0, 0.9, 0.02));
    // wall bracket
    g.add(mesh('bannerBracket', () => new THREE.BoxGeometry(0.5, 0.12, 0.12), darkIron(), 0, 2.6, -0.25));
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
    for (const bx of [-0.4, 0.4]) {
      g.add(mesh(`chestBand_${bx}`, () => new THREE.BoxGeometry(0.12, 0.72, 0.86), darkIron(), bx, 0.36, 0));
    }
    g.add(mesh('chestLock', () => new THREE.BoxGeometry(0.2, 0.24, 0.1), gold(), 0, 0.5, 0.43));
    return { group: g, radius: 1.0 };
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

  rubble(rng) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const s = 0.2 + rng() * 0.45;
      const r = mesh(`rubble_${i}`, () => new THREE.BoxGeometry(1, 0.7, 0.8), rubbleMat(),
        (rng() - 0.5) * 1.4, s * 0.3, (rng() - 0.5) * 1.4);
      r.scale.setScalar(s);
      r.rotation.set(0, rng() * Math.PI * 2, 0);
      g.add(r);
    }
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
