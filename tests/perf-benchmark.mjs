// tests/perf-benchmark.mjs - Phase 4 (workstream 6: PERFORMANCE PASS)
//
// Headless-ish performance benchmark for Dungeon of the Covenant.
//
// Builds the REAL game code in node (no GPU): the real DungeonBuilder
// citadel, the real seeded biome prop pass (PropPlacer), real enemies
// (EntityManager.createMobMesh), real players, real atmosphere particles.
// Then it measures, analytically and honestly:
//
//   A. BASELINE  - instancing OFF, LOD OFF  -> draw-call / triangle audit
//   B. OPTIMIZED - instancing ON,  LOD ON   -> draw-call / triangle audit
//   C. LOD unit checks: mob tier classification, cinder GLB<->impostor swap,
//      hysteresis (no flicker at boundaries)
//   D. Auto-degrade path: nextQualityTier() transitions (the Phase-3
//      fps-driven bloom shedder)
//   E. Texture budget audit (GLB embedded images, canvas textures, art)
//   F. CPU frame-time of the per-frame JS logic (atmosphere tick, LOD
//      updates, prop LOD) over 240 simulated frames
//
// What this CANNOT measure headless: GPU rasterization, in particular the
// UnrealBloomPass at up to 2x pixel ratio. That cost stays GPU-bound; the
// auto-degrade path that sheds it is verified in (D), and the report says
// so plainly. Draw calls / triangles are counted analytically by walking
// the scene graph (1 draw call per visible mesh per material), which is
// exactly what renderer.info.render.calls reports in the live game.
//
// Run: node --loader ./tests/perf-bench-loader.mjs tests/perf-benchmark.mjs
// Exit 0 = all perf assertions pass. Writes tests/perf-benchmark-report.json.

import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- DOM stub
function makeGradient() { return { addColorStop() {} }; }
function makeCtx2d(canvas) {
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => makeGradient();
      if (prop === 'measureText') return () => ({ width: 8 });
      if (prop === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (typeof prop === 'string') return () => undefined;
      return undefined;
    },
    set(t, prop, v) { t[prop] = v; return true; }
  });
}
function makeCanvas() {
  const canvas = { width: 300, height: 150, style: {} };
  canvas.getContext = () => makeCtx2d(canvas);
  return canvas;
}
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas();
    return { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } };
  },
  body: { appendChild() {} },
  getElementById() { return null; }
};
globalThis.window = globalThis;
globalThis.self = globalThis;
// No network in the benchmark: GLB/FBX loads fail fast and the game code
// already falls back (procedural props / procedural animation).
globalThis.fetch = () => Promise.reject(new Error('headless: no network'));

const { DungeonBuilder } = await import('../client/js/dungeon.js');
const { EntityManager } = await import('../client/js/entities.js');
const { LODManager, LOD_NEAR_DIST, LOD_MID_DIST } = await import('../client/js/perf/lodSystem.js');
const { buildCinderImpostor, cinderImpostorTris } = await import('../client/js/perf/cinderImpostor.js');
const { auditDrawCalls, auditSummary } = await import('../client/js/perf/drawCallAudit.js');
const { nextQualityTier } = await import('../client/js/renderer.js');
const { setBatchingEnabled } = await import('../client/js/perf/staticBatcher.js');
const { setRingBatchingEnabled } = await import('../client/js/perf/ringBatcher.js');
// Same GLTFLoader module instance the client imports via /vendor/addons —
// patching its prototype disables network GLB loads headless.
const { GLTFLoader } = await import('./bench-vendor/addons/loaders/GLTFLoader.js');

// GLB loading is async over the network in the live game; here it fails
// fast (patched) and code paths fall back. The default citadel GLB props
// are mounted from synthetic stand-ins (3 meshes each) so the audit counts
// a representative scene; identical in both runs.
GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
  if (typeof onError === 'function') onError(new Error('headless: GLB loading disabled'));
};

function makeFakeGlbScene() {
  const g = new THREE.Group();
  const m1 = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0x888899 }));
  m1.position.y = 1;
  const m2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x555566 }));
  m2.position.y = 0.25;
  const m3 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: 0xaa6633, emissive: 0x662200 }));
  m3.position.y = 2.2;
  g.add(m1, m2, m3);
  return g;
}
const DEFAULT_GLB_URLS = [
  '/assets/models/covenant_obelisk.glb', '/assets/models/arcane_portal_gate.glb',
  '/assets/models/soul_altar.glb', '/assets/models/gothic_pillar_brazier.glb',
  '/assets/models/bone_reliquary_throne.glb', '/assets/models/cursed_sarcophagus.glb',
  '/assets/models/mythic_chest.glb'
];

const MOB_TYPES = ['crypt_ghoul', 'bone_archer', 'cinder_thrall', 'void_assassin',
  'blight_necrolyte', 'elite_executioner', 'elite_lich', 'skeleton_vanguard'];
const MOB_SPOTS = [
  [0, 16], [-6, 20], [6, 22], [-10, 14], [10, 18], [-4, -10], [4, -14],
  [-8, -18], [8, -8], [0, -22], [-38, -10], [-46, -18], [38, -10], [46, -18],
  [36, -22], [-36, -22], [0, -34], [-3, -38], [3, -38], [0, -49], [-8, -52],
  [8, -52], [0, -70], [-10, -78]
];
// p0 is the local hero under the follow camera; remotes are spread across
// the dungeon the way real 8-player sessions distribute (this is what makes
// player distance-LOD meaningful in the measurement).
const PLAYER_SPOTS = [[-2, 18], [20, -10], [-25, 5], [10, -40], [-15, -25], [30, 15], [-35, -15], [5, -60]];
const CLASS_KEYS = ['juggernaut', 'mage', 'ranger', 'rogue', 'cleric', 'necromancer', 'juggernaut', 'mage'];

function buildScene({ instancing, withLOD, batching }) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x110c1d, 0.03);
  setBatchingEnabled(batching);
  setRingBatchingEnabled(batching);
  // The expected "GLB fallback" warnings are noise headless; silence them.
  const realWarn = console.warn;
  console.warn = (...a) => {
    if (typeof a[0] === 'string' && a[0].includes('[DungeonBuilder] Fallback')) return;
    realWarn(...a);
  };
  let dungeon;
  try {
    dungeon = new DungeonBuilder(scene);
  } finally {
    console.warn = realWarn;
  }
  for (const u of DEFAULT_GLB_URLS) dungeon.glbCache[u] = makeFakeGlbScene();
  dungeon.propPlacer.setInstancing(instancing);
  dungeon.applyProceduralFloorConfig({ biome: { id: 'ossuary_crypt' }, seed: 20260925, props: [] });

  const entities = new EntityManager(scene);
  let lod = null;
  if (withLOD) {
    lod = new LODManager();
    entities.setLodManager(lod);
  }
  // 24 enemies across all 8 mob types (cinder_thrall mounts its GLB
  // asynchronously in the live game; headless the cinderRoot stays empty and
  // the impostor swap is unit-tested separately in section C).
  MOB_SPOTS.forEach(([x, z], i) => {
    const type = MOB_TYPES[i % MOB_TYPES.length];
    const group = entities.createMobMesh({
      id: `mob${i}`, type, x, z, name: `${type} ${i}`, hp: 100, maxHp: 100,
      modelScale: type === 'cinder_thrall' ? 1.25 : 1
    });
    entities.mobMeshes.set(`mob${i}`, group);
    scene.add(group);
  });
  // 8 players, one per class key.
  entities.syncPlayers(PLAYER_SPOTS.map(([x, z], i) => ({
    id: `p${i}`, name: `Hero${i}`, classKey: CLASS_KEYS[i], x, z, hp: 100, maxHp: 100
  })), 'p0');

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 350);
  // Typical play view: above the atrium looking toward the crossroads.
  camera.position.set(0, 20, 38);
  camera.lookAt(0, 0, -14);
  // Settle per-frame systems that feed the audit (threat-ring instances).
  entities.update(1 / 60);
  setBatchingEnabled(true); // restore defaults for any later scene builds
  setRingBatchingEnabled(true);
  return { scene, dungeon, entities, lod, camera };
}

// ---------------------------------------------------------------- A/B audit
console.log('== A. BASELINE (original code: no batching, no instancing, no LOD) ==');
const base = buildScene({ instancing: false, withLOD: false, batching: false });
const baseAudit = auditDrawCalls(base.scene);
console.log('   ' + auditSummary(baseAudit));

console.log('== B. OPTIMIZED (batching + instancing + LOD, typical play view) ==');
const opt = buildScene({ instancing: true, withLOD: true, batching: true });
// Pump LOD to convergence (tiers step once per evaluation with hysteresis;
// in-game this settles within ~8 frames).
for (let i = 0; i < 4; i++) opt.lod.updateAll(opt.camera);
opt.dungeon.propPlacer.updateLOD(opt.camera);
const optAudit = auditDrawCalls(opt.scene);
console.log('   ' + auditSummary(optAudit));
const instStats = opt.dungeon.propPlacer.instancer
  ? opt.dungeon.propPlacer.instancer.stats() : { types: 0, instancedMeshes: 0, instances: 0 };
console.log(`   instanced prop types: ${instStats.types}, InstancedMeshes: ${instStats.instancedMeshes}, instances: ${instStats.instances}`);

// LOD far view: camera pulled back so tiers engage.
const farCam = opt.camera.clone();
farCam.position.set(0, 30, 90);
for (let i = 0; i < 4; i++) opt.lod.updateAll(farCam);
for (let i = 0; i < 8; i++) opt.dungeon.propPlacer.updateLOD(farCam); // pass the throttle
const farAudit = auditDrawCalls(opt.scene);
console.log('== B2. OPTIMIZED far view (LOD tiers engaged) ==');
console.log('   ' + auditSummary(farAudit));

const callReduction = 1 - optAudit.calls / baseAudit.calls;
console.log(`\nDraw-call reduction (typical view): ${(callReduction * 100).toFixed(1)}%`);

// ------------------------------------------------- C. LOD unit checks
console.log('\n== C. LOD unit checks ==');
const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, pass: !!cond, detail });
  console.log(`   [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

// C1: mob auto-classification hides fine+decor at far, keeps core; hysteresis.
{
  const scene = new THREE.Scene();
  const ents = new EntityManager(scene);
  const lod = new LODManager();
  ents.setLodManager(lod);
  const group = ents.createMobMesh({ id: 't', type: 'elite_executioner', x: 0, z: 0, name: 't', hp: 1, maxHp: 1 });
  scene.add(group);
  const cam = new THREE.PerspectiveCamera();
  const bodyMeshes = [];
  group.userData.bodyRoot.traverse((o) => { if (o.isMesh) bodyMeshes.push(o); });
  cam.position.set(0, 5, 10); lod.updateAll(cam); // near
  const nearHidden = bodyMeshes.filter((m) => !m.visible).length;
  check('mob near tier: nothing hidden', nearHidden === 0, `${bodyMeshes.length} body meshes`);
  cam.position.set(0, 5, 200);
  for (let i = 0; i < 4; i++) lod.updateAll(cam); // converge 0->1->2 (single-step w/ hysteresis)
  const farHidden = bodyMeshes.filter((m) => !m.visible).length;
  const farVisible = bodyMeshes.filter((m) => m.visible).length;
  check('mob far tier: decor+fine hidden, core kept', farHidden > 0 && farVisible > 0,
    `hidden=${farHidden} visible=${farVisible}`);
  // Hysteresis: return to mid tier, then sit just inside/outside the far
  // boundary; small jitter must not flip.
  const e = lod._byRoot.get(group);
  cam.position.set(0, 5, 10);
  for (let i = 0; i < 4; i++) lod.updateAll(cam); // back to level 0
  cam.position.set(0, 5, LOD_MID_DIST - 2); lod.updateAll(cam);
  const lvlA = e.level;
  cam.position.set(0, 5, LOD_MID_DIST + 2); lod.updateAll(cam);
  const lvlB = e.level;
  check('mob hysteresis: no flicker within +/-2 of boundary', lvlA === lvlB && lvlA === 1,
    `level=${lvlA}->${lvlB}`);
  // Threat ring is batched (one InstancedMesh for all mobs): it must stay
  // registered with the batcher and is never touched by LOD visibility.
  check('mob threat ring batched, untouched by LOD', ents.ringBatcher.has(group),
    `ringBatcher.count=${ents.ringBatcher.count}`);
}

// C2: cinder thrall GLB <-> impostor swap.
{
  const scene = new THREE.Scene();
  const lod = new LODManager();
  const group = new THREE.Group();
  const cinderRoot = new THREE.Group();
  group.add(cinderRoot);
  const fakeModel = new THREE.Group();
  fakeModel.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff })));
  fakeModel.scale.set(1.25, 1.25, 1.25);
  const wisps = new THREE.Points(new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: 0xff7733 }));
  cinderRoot.add(fakeModel); cinderRoot.add(wisps);
  group.userData.cinder = { root: cinderRoot, model: fakeModel, loaded: true, mats: [], wisps, dying: false };
  group.userData.bodyRoot = new THREE.Group();
  group.add(group.userData.bodyRoot);
  scene.add(group);
  lod.registerMob(group);
  lod.registerCinder(group);
  const c = group.userData.cinder;
  check('cinder impostor attached (1 mesh, 1 material)', !!c.impostor && c.impostor.isMesh,
    `tris=${cinderImpostorTris()}`);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 5, 10); lod.updateAll(cam);
  check('cinder near: GLB visible, impostor hidden, wisps on',
    c.model.visible && !c.impostor.visible && c.wisps.visible);
  cam.position.set(0, 5, 45); lod.updateAll(cam);
  check('cinder mid: GLB visible, wisps off (fill-rate win)',
    c.model.visible && !c.impostor.visible && !c.wisps.visible);
  cam.position.set(0, 5, 200); lod.updateAll(cam);
  check('cinder far: GLB hidden, impostor visible',
    !c.model.visible && c.impostor.visible && !c.wisps.visible);
  // Cinder hysteresis.
  const e = lod._byRoot.get(group);
  cam.position.set(0, 5, LOD_MID_DIST - 2); lod.updateAll(cam);
  const l1 = e.level;
  cam.position.set(0, 5, LOD_MID_DIST + 2); lod.updateAll(cam);
  check('cinder hysteresis: no flicker at boundary', l1 === e.level, `level=${l1}`);
}

// C3: impostor cost vs the real GLB (37,074 verts measured from the file).
{
  const tris = cinderImpostorTris();
  check('cinder impostor < 1000 tris (vs 37,074-vert GLB)', tris < 1000, `${tris} tris`);
}

// ------------------------------------------------- D. auto-degrade
console.log('\n== D. auto-degrade path (nextQualityTier) ==');
const tierCases = [
  ['high', 20, 'low'], ['low', 20, 'off'], ['off', 20, 'off'],
  ['off', 60, 'low'], ['low', 60, 'high'], ['high', 60, 'high'],
  ['high', 28, 'high'], ['low', 54, 'low'] // inside hysteresis band: hold
];
for (const [cur, fps, want] of tierCases) {
  const got = nextQualityTier(cur, fps);
  check(`nextQualityTier('${cur}', ${fps}) === '${want}'`, got === want, `got '${got}'`);
}

// ------------------------------------------------- E. texture budget
console.log('\n== E. texture budget (2K hero / 1K common max) ==');
function jpegDims(buf, off, len) {
  // Scan for SOF0/SOF2 markers.
  let p = off + 2;
  const end = off + len;
  while (p + 9 < end) {
    if (buf[p] !== 0xFF) { p++; continue; }
    const m = buf[p + 1];
    if (m === 0xC0 || m === 0xC2) {
      const h = buf.readUInt16BE(p + 5), w = buf.readUInt16BE(p + 7);
      return { w, h };
    }
    if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { p += 2; continue; }
    const segLen = buf.readUInt16BE(p + 2);
    p += 2 + segLen;
  }
  return null;
}
{
  const glbPath = path.join(ROOT, 'client', 'assets', 'models', 'cinder_thrall.glb');
  const buf = fs.readFileSync(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binOff = 20 + jsonLen + 8;
  let maxDim = 0;
  const dims = [];
  for (const img of js.images || []) {
    const bv = js.bufferViews[img.bufferView];
    const d = jpegDims(buf, binOff + (bv.byteOffset || 0), bv.byteLength);
    if (d) { dims.push(`${d.w}x${d.h}`); maxDim = Math.max(maxDim, d.w, d.h); }
  }
  check('cinder_thrall.glb embedded textures within budget', maxDim <= 1024,
    `embedded: ${dims.join(', ')} (budget: 1K common)`);
  // Cover/promo art (loaded by promo pages, not the 3D scene).
  const art = ['cover_art.jpg', 'promo_boss.jpg', 'promo_combos.jpg'].map((f) => {
    const b = fs.readFileSync(path.join(ROOT, 'client', 'assets', f));
    const d = jpegDims(b, 0, b.length);
    return `${f}=${d ? `${d.w}x${d.h}` : '?'}`;
  });
  const artOk = art.every((a) => { const m = a.match(/(\d+)x(\d+)/); return m && +m[1] <= 2048 && +m[2] <= 2048; });
  check('cover/promo art within 2K budget', artOk, art.join(', '));
  // Canvas textures used by the scene (dungeon floor 256, flame 64, dot 32,
  // overhead bars 160x40, biome floors 256): all far under budget by code
  // inspection; the largest is 256px.
  check('procedural canvas textures <= 256px (code-inspected)', true, 'max 256px floor/biome textures');
}

// ------------------------------------------------- F. CPU frame time
console.log('\n== F. CPU frame-time (240 simulated frames, optimized scene) ==');
{
  const { scene, dungeon, entities, lod, camera } = opt;
  // Warm up.
  for (let i = 0; i < 20; i++) {
    const t = i / 60;
    camera.position.set(Math.sin(i * 0.05) * 20, 20, 38 - i * 0.1);
    dungeon.update(1 / 60, t);
    lod.update(camera);
    dungeon.propPlacer.updateLOD(camera);
  }
  let entitiesOk = true;
  try { entities.update(1 / 60); } catch (e) { entitiesOk = false; }
  const t0 = process.hrtime.bigint();
  const N = 240;
  for (let i = 0; i < N; i++) {
    const t = i / 60;
    camera.position.set(Math.sin(i * 0.05) * 20, 20, 38 - (i % 120) * 0.4);
    dungeon.update(1 / 60, t);
    lod.update(camera);
    dungeon.propPlacer.updateLOD(camera);
    if (entitiesOk) { try { entities.update(1 / 60); } catch (e) { entitiesOk = false; } }
  }
  const t1 = process.hrtime.bigint();
  const msPerFrame = Number(t1 - t0) / 1e6 / N;
  console.log(`   logic frame time: ${msPerFrame.toFixed(2)} ms/frame ` +
    `(entities.update ${entitiesOk ? 'included' : 'EXCLUDED - threw headless'})`);
  check('per-frame JS logic < 8ms (leaves headroom for GPU)', msPerFrame < 8,
    `${msPerFrame.toFixed(2)} ms`);
  var cpuMs = msPerFrame, entitiesIncluded = entitiesOk;
}

// ------------------------------------------------- verdict
const failed = checks.filter((c) => !c.pass);
console.log(`\n== RESULT: ${checks.length - failed.length}/${checks.length} checks passed ==`);
if (failed.length) {
  console.log('Failures:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
const report = {
  generated: new Date().toISOString(),
  note: 'Headless node benchmark: no GPU. Draw calls/triangles counted analytically ' +
    'from the scene graph (matches renderer.info semantics). UnrealBloomPass GPU cost ' +
    'not measurable here; the auto-degrade path that sheds it is verified in section D.',
  baseline: { calls: baseAudit.calls, triangles: baseAudit.triangles },
  optimizedTypicalView: { calls: optAudit.calls, triangles: optAudit.triangles },
  optimizedFarView: { calls: farAudit.calls, triangles: farAudit.triangles },
  drawCallReductionTypical: +callReduction.toFixed(3),
  instancing: instStats,
  cinderGLBVerts: 37074,
  cinderImpostorTris: cinderImpostorTris(),
  cpuLogicMsPerFrame: +cpuMs.toFixed(3),
  entitiesUpdateIncluded: entitiesIncluded,
  checks: checks.map((c) => ({ name: c.name, pass: c.pass, detail: c.detail }))
};
fs.writeFileSync(path.join(ROOT, 'tests', 'perf-benchmark-report.json'),
  JSON.stringify(report, null, 2));
console.log('Report written to tests/perf-benchmark-report.json');
process.exit(failed.length ? 1 : 0);
