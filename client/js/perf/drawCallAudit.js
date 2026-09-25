// drawCallAudit.js - Phase 4 (workstream 6: PERFORMANCE PASS)
//
// Analytic draw-call audit: walks a live THREE.Scene and predicts the
// renderer's per-frame draw calls + triangle load WITHOUT needing a GPU.
// Each visible Mesh/Points/Sprite/Line counts as (materials) draw calls;
// triangles are summed from geometry (x instance count for InstancedMesh).
//
// Works headless (node) and in the browser console:
//   import { auditDrawCalls } from './perf/drawCallAudit.js';
//   console.table(auditDrawCalls(scene).topOffenders);

export function auditDrawCalls(scene, opts = {}) {
  const maxOffenders = opts.maxOffenders || 12;
  const includeInvisible = !!opts.includeInvisible;

  let calls = 0;
  let triangles = 0;
  let points = 0;
  let meshes = 0;
  const byKind = new Map(); // constructor name -> {calls, tris, count}
  const offenders = [];     // {label, calls, tris}

  // Manual stack so we can skip invisible subtrees (traverse() doesn't).
  const stack = [{ obj: scene, parentVisible: true }];
  while (stack.length) {
    const { obj, parentVisible } = stack.pop();
    const vis = parentVisible && obj.visible !== false;
    for (let i = obj.children.length - 1; i >= 0; i--) {
      stack.push({ obj: obj.children[i], parentVisible: vis });
    }
    if (!vis && !includeInvisible) continue;

    const isMesh = !!obj.isMesh;
    const isPoints = !!obj.isPoints;
    const isSprite = !!obj.isSprite;
    const isLine = !!obj.isLine;
    if (!isMesh && !isPoints && !isSprite && !isLine) continue;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const matCount = mats.filter(Boolean).length || 1;
    calls += matCount;

    let tris = 0;
    if (isMesh && obj.geometry) {
      const g = obj.geometry;
      let base = 0;
      try {
        base = (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
      } catch (e) { base = 0; }
      const inst = obj.isInstancedMesh ? obj.count : 1;
      tris = base * inst;
      triangles += tris;
      meshes++;
    } else if (isPoints && obj.geometry && obj.geometry.attributes.position) {
      points += obj.geometry.attributes.position.count;
    }

    const kind = obj.isInstancedMesh ? 'InstancedMesh'
      : (obj.constructor && obj.constructor.name) || 'Object3D';
    let k = byKind.get(kind);
    if (!k) { k = { calls: 0, tris: 0, count: 0 }; byKind.set(kind, k); }
    k.calls += matCount; k.tris += tris; k.count++;

    offenders.push({
      label: labelFor(obj),
      calls: matCount,
      tris: Math.round(tris),
      kind
    });
  }

  offenders.sort((a, b) => b.calls - a.calls || b.tris - a.tris);

  return {
    calls,
    triangles: Math.round(triangles),
    points,
    meshes,
    byKind: [...byKind.entries()].map(([kind, v]) => ({
      kind, calls: v.calls, tris: Math.round(v.tris), count: v.count
    })).sort((a, b) => b.calls - a.calls),
    topOffenders: offenders.slice(0, maxOffenders)
  };
}

function labelFor(obj) {
  const bits = [];
  if (obj.userData) {
    if (obj.userData.propKey) bits.push(`prop:${obj.userData.propKey}`);
    if (obj.userData.mobType) bits.push(`mob:${obj.userData.mobType}`);
    if (obj.userData.isCinderImpostor) bits.push('cinder-impostor');
  }
  let g = obj.geometry;
  let geoName = g ? (g.name || g.type || '') : '';
  if (obj.isInstancedMesh) geoName += ` x${obj.count}`;
  bits.push(obj.type || '?');
  if (geoName) bits.push(geoName);
  const p = obj.position;
  if (p) bits.push(`@(${p.x.toFixed(0)},${p.z.toFixed(0)})`);
  return bits.join(' ');
}

// One-line summary for logs / benchmark output.
export function auditSummary(a) {
  return `draw calls: ${a.calls}, triangles: ${a.triangles.toLocaleString('en-US')}, ` +
    `meshes: ${a.meshes}, points verts: ${a.points.toLocaleString('en-US')}`;
}
