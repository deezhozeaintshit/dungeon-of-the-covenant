// characterMaterials.js — PBR material upgrade pass for Dungeon of the Covenant characters.
//
// The hero/enemy meshes are authored procedurally (entities.js) with flat
// MeshStandardMaterials. This module upgrades them in place:
//   1. Procedural micro-detail + cloth-weave normal maps (canvas-generated, tiled)
//      so armor/cloth respond to light with real surface variation.
//   2. Per-material-kind tuning: env reflection strength, roughness floors, and
//      emissive discipline for glow parts.
//   3. A shared PMREM RoomEnvironment map applied ONLY to character materials
//      (never scene.environment, so the dungeon look is untouched).
//
// Usage (wired by EntityManager):
//   upgradeCharacterMaterials(group, envMap)   // after a character group is built
//   buildCharacterEnvMap(renderer)            // once, via EntityManager.setRenderer()
//   applyEnvMapToGroup(group, envMap)          // for groups built before renderer known

import * as THREE from '/vendor/three.module.js';
import { RoomEnvironment } from '/vendor/addons/environments/RoomEnvironment.js';

let _microNormal = null;
let _clothNormal = null;
let _envMap = null;

// --- Procedural normal-map synthesis ---------------------------------------
// Value-noise heightfield -> Sobel -> tangent-space normal map. Cheap (256px),
// generated once and shared by every character in the scene.

function makeValueNoiseCanvas(size, cells) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // coarse random grid, drawn upscaled = smooth blotches
  const g = document.createElement('canvas');
  g.width = g.height = cells;
  const gtx = g.getContext('2d');
  const img = gtx.createImageData(cells, cells);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  gtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(g, 0, 0, size, size);
  // fine grain pass for micro detail
  const img2 = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img2.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img2.data[i] += n; img2.data[i + 1] += n; img2.data[i + 2] += n;
  }
  ctx.putImageData(img2, 0, 0);
  return c;
}

function makeWeaveCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const over = ((x + y) / step) % 2 === 0;
      const grad = ctx.createLinearGradient(x, y, x + step, y + step);
      if (over) { grad.addColorStop(0, '#a8a8a8'); grad.addColorStop(1, '#585858'); }
      else { grad.addColorStop(0, '#585858'); grad.addColorStop(1, '#a8a8a8'); }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, step, step);
    }
  }
  return c;
}

function heightToNormalTexture(heightCanvas, strength) {
  const size = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

export function getCharacterDetailTextures() {
  if (!_microNormal) {
    _microNormal = heightToNormalTexture(makeValueNoiseCanvas(256, 24), 2.2);
    _clothNormal = heightToNormalTexture(makeWeaveCanvas(256), 1.6);
    _clothNormal.repeat.set(4, 4);
  }
  return { microNormal: _microNormal, clothNormal: _clothNormal };
}

// --- Material classification -----------------------------------------------
// Procedural heroes tag materials by authored properties:
//   glow  -> strong emissive (runes, visors, cores)
//   metal -> metallic armor / trim
//   cloth -> rough, non-metal fabrics / leather
//   bone  -> pale matte (skeleton parts)

export function classifyCharacterMaterial(mat) {
  if (!mat || !mat.isMeshStandardMaterial) return null;
  if ((mat.emissiveIntensity || 0) >= 1.6) return 'glow';
  if ((mat.metalness || 0) >= 0.5) return 'metal';
  if ((mat.roughness || 0) >= 0.62) return 'cloth';
  const c = mat.color;
  if (c && c.r > 0.75 && c.g > 0.68 && c.b > 0.58) return 'bone';
  return 'metal';
}

const KIND_TUNING = {
  metal: { envMapIntensity: 1.15, normalScale: 0.35, normalKind: 'micro', minRough: 0.18 },
  cloth: { envMapIntensity: 0.35, normalScale: 0.55, normalKind: 'cloth', minRough: 0.62 },
  bone:  { envMapIntensity: 0.55, normalScale: 0.30, normalKind: 'micro', minRough: 0.45 },
  glow:  { envMapIntensity: 0.25, normalScale: 0.0,  normalKind: null,   minRough: 0.0 }
};

function tuneMaterial(mat, kind, textures, envMap) {
  const t = KIND_TUNING[kind];
  mat.envMapIntensity = t.envMapIntensity;
  if (envMap) mat.envMap = envMap;
  if (kind !== 'glow') {
    mat.roughness = Math.max(mat.roughness, t.minRough);
    const ntex = t.normalKind === 'cloth' ? textures.clothNormal : textures.microNormal;
    if (ntex && !mat.normalMap) {
      mat.normalMap = ntex;
      mat.normalScale = new THREE.Vector2(t.normalScale, t.normalScale);
    }
  } else {
    // Glow parts: keep them hot but stop them blowing out under the env map.
    if (mat.emissiveIntensity > 3.4) mat.emissiveIntensity = 3.4;
  }
  mat.needsUpdate = true;
  return kind;
}

// Traverse a finished character group and upgrade every MeshStandardMaterial.
// Records the upgraded materials on group.userData.pbrMats so a later env map
// (once the renderer is known) can be applied without another traversal.
export function upgradeCharacterMaterials(group, envMap = null) {
  const textures = getCharacterDetailTextures();
  const u = group.userData;
  if (!u.pbrMats) u.pbrMats = [];
  const seen = new Set(u.pbrMats.map(r => r.mat));
  group.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshStandardMaterial) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        const kind = classifyCharacterMaterial(mat) || 'metal';
        tuneMaterial(mat, kind, textures, envMap);
        u.pbrMats.push({ mat, kind });
      }
    }
  });
  return u.pbrMats.length;
}

export function applyEnvMapToGroup(group, envMap) {
  const u = group.userData;
  if (!u.pbrMats) return 0;
  let n = 0;
  for (const rec of u.pbrMats) {
    if (rec.mat.envMap !== envMap) {
      rec.mat.envMap = envMap;
      rec.mat.needsUpdate = true;
      n++;
    }
  }
  return n;
}

// One shared PMREM environment for all character materials. Built lazily from
// the real WebGLRenderer so the coordinator can call it during init.
export function buildCharacterEnvMap(renderer) {
  if (_envMap) return _envMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  _envMap = pmrem.fromScene(envScene, 0.06).texture;
  pmrem.dispose();
  return _envMap;
}

export function getCharacterEnvMap() {
  return _envMap;
}
