// cinderImpostor.js - Phase 4 (workstream 6: PERFORMANCE PASS)
//
// Far-tier impostor for the Cinder Thrall elite. The source GLB
// (client/assets/models/cinder_thrall.glb) is ~37k verts with 3 embedded
// textures; at far LOD distance it is replaced by this ~250-tri procedural
// lava-brute silhouette that keeps the same lava-crack glow language.
//
// The impostor is a child of the thrall's cinderRoot, so the procedural
// animation profile keeps posing it; the LODManager toggles
// model.visible / impostor.visible with hysteresis (no popping flicker).
// Geometry + material are module-shared: one allocation per page load,
// not per thrall.

import * as THREE from '/vendor/three.module.js';

let _geo = null;
let _mat = null;

function sharedAssets() {
  if (_geo) return { geo: _geo, mat: _mat };

  // One merged-ish silhouette built from primitives. All parts share a
  // single basalt+lava material so the whole impostor is a handful of
  // draw calls with trivial vertex load.
  _mat = new THREE.MeshStandardMaterial({
    color: 0x2a1a12,
    emissive: 0xff5a1a,
    emissiveIntensity: 0.85,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true
  });

  // Parts are baked as { geometry, position, rotation, scale } and merged
  // into ONE BufferGeometry so the impostor is a single draw call.
  const parts = [];
  const add = (geometry, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    geometry.rotateX(rx); geometry.rotateY(ry); geometry.rotateZ(rz);
    geometry.scale(sx, sy, sz);
    geometry.translate(x, y, z);
    parts.push(geometry);
  };

  // Torso: jagged lava-rock mass
  add(new THREE.DodecahedronGeometry(0.55, 0), 0, 1.05, 0, 0, 0.4, 0, 1.0, 1.35, 0.8);
  // Head: low crag
  add(new THREE.DodecahedronGeometry(0.30, 0), 0, 1.98, 0.05, 0.2, 0, 0.15);
  // Shoulder plates
  add(new THREE.ConeGeometry(0.20, 0.45, 5), -0.62, 1.62, 0, 0, 0, 0.5);
  add(new THREE.ConeGeometry(0.20, 0.45, 5), 0.62, 1.62, 0, 0, 0, -0.5);
  // Arms
  add(new THREE.CylinderGeometry(0.15, 0.20, 1.05, 5), -0.72, 0.95, 0, 0, 0, 0.18);
  add(new THREE.CylinderGeometry(0.15, 0.20, 1.05, 5), 0.72, 0.95, 0, 0, 0, -0.18);
  // Fists
  add(new THREE.DodecahedronGeometry(0.20, 0), -0.82, 0.38, 0);
  add(new THREE.DodecahedronGeometry(0.20, 0), 0.82, 0.38, 0);
  // Legs
  add(new THREE.CylinderGeometry(0.19, 0.24, 0.85, 5), -0.28, 0.42, 0);
  add(new THREE.CylinderGeometry(0.19, 0.24, 0.85, 5), 0.28, 0.42, 0);

  _geo = mergeGeometries(parts);
  return { geo: _geo, mat: _mat };
}

// Minimal non-indexed merge (avoids pulling BufferGeometryUtils as a
// dependency; parts are tiny).
function mergeGeometries(geoms) {
  const norm = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let vCount = 0, nCount = 0, uCount = 0;
  for (const g of norm) {
    vCount += g.attributes.position.count;
    nCount += g.attributes.normal.count;
    uCount += g.attributes.uv ? g.attributes.uv.count : 0;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(nCount * 3);
  const uv = new Float32Array(vCount * 2);
  let vo = 0, no = 0, uo = 0;
  for (const g of norm) {
    pos.set(g.attributes.position.array, vo); vo += g.attributes.position.array.length;
    nor.set(g.attributes.normal.array, no); no += g.attributes.normal.array.length;
    if (g.attributes.uv) { uv.set(g.attributes.uv.array, uo); uo += g.attributes.uv.array.length; }
    else { uo += g.attributes.position.count * 2; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// Build one impostor instance. ~250 tris, 1 draw call.
export function buildCinderImpostor() {
  const { geo, mat } = sharedAssets();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false; // far tier: shadow cost not worth it in fog
  m.receiveShadow = false;
  m.frustumCulled = true;
  m.userData.isCinderImpostor = true;
  return m;
}

// Tri count of the shared impostor geometry (for the benchmark audit).
export function cinderImpostorTris() {
  const { geo } = sharedAssets();
  return Math.round(geo.attributes.position.count / 3);
}
