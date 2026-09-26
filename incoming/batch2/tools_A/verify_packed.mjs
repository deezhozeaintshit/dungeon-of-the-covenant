// verify_packed.mjs — verify a packed GLB with real three.js GLTFLoader + meshopt.
// Checks: skinned mesh present, JOINTS_0/WEIGHTS_0 attrs, zero-weight vert count,
// joint count, tri count, extensionsUsed (EXT_meshopt_compression, KHR_mesh_quantization).
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

globalThis.self = globalThis;
class FakeImage {
  constructor() { setTimeout(() => this.onload && this.onload(), 0); }
  set src(v) { this._src = v; }
  get width() { return 1024; }
  get height() { return 1024; }
}
globalThis.Image = FakeImage;

const [,, inGlb] = process.argv;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const buf = readFileSync(inGlb);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await loader.parseAsync(ab, '');
const json = gltf.parser.json;

let totalTris = 0, skinned = 0, zeroW = 0, totalV = 0, joints = 0;
gltf.scene.traverse(o => {
  if (o.isSkinnedMesh) {
    skinned++;
    const g = o.geometry;
    if (!g.attributes.skinIndex || !g.attributes.skinWeight) {
      console.error('SKINNED MESH MISSING skinIndex/skinWeight'); process.exit(1);
    }
    const sw = g.attributes.skinWeight;
    for (let i = 0; i < sw.count; i++) {
      if (sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i) <= 1e-9) zeroW++;
    }
    totalV += sw.count;
    totalTris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    joints = Math.max(joints, o.skeleton ? o.skeleton.bones.length : 0);
  }
});

const result = {
  file: inGlb.split('/').pop(),
  bytes: buf.length,
  skinnedMeshes: skinned,
  verts: totalV,
  tris: Math.round(totalTris),
  zeroWeightVerts: zeroW,
  joints,
  extensionsUsed: json.extensionsUsed || [],
  extensionsRequired: json.extensionsRequired || [],
};
console.log(JSON.stringify(result));
const ok = skinned > 0 && zeroW === 0;
process.exit(ok ? 0 : 1);
