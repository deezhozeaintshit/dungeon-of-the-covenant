// verify_skin.mjs — real-loader check of packed GLBs.
// Usage: node verify_skin.mjs <packed.glb> [...]
// For each: parses with three GLTFLoader + MeshoptDecoder, finds SkinnedMesh,
// reports JOINTS_0/WEIGHTS_0 presence, joint count, and zero-weight vert count.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire('/home/hatch/workspace/rpg-crawler-game/art-work/');
const THREE = require('three');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = require('three/examples/jsm/libs/meshopt_decoder.module.js');

globalThis.self = globalThis;
class FakeImage {
  constructor() { setTimeout(() => this.onload && this.onload(), 0); }
  set src(v) { this._src = v; }
  get width() { return 1024; }
  get height() { return 1024; }
}
globalThis.Image = FakeImage;

let fail = 0;
for (const inGlb of process.argv.slice(2)) {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const buf = readFileSync(inGlb);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await loader.parseAsync(ab, '');
    let skinned = null;
    gltf.scene.traverse(o => { if (o.isSkinnedMesh && !skinned) skinned = o; });
    if (!skinned) { console.log(inGlb.split('/').pop(), 'NO SKINNED MESH'); fail = 1; continue; }
    const g = skinned.geometry;
    const hasJ = !!g.attributes.skinIndex, hasW = !!g.attributes.skinWeight;
    let zeroW = 0;
    if (hasJ && hasW) {
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      for (let i = 0; i < si.count; i++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += sw.getComponent(i, k);
        if (s === 0) zeroW++;
      }
    }
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    const joints = gltf.parser.json.skins?.[0]?.joints?.length ?? 0;
    const exts = (gltf.parser.json.extensionsUsed || []).join(',');
    console.log(`${inGlb.split('/').pop()}: tris=${tris} joints=${joints} JOINTS_0=${hasJ} WEIGHTS_0=${hasW} zeroWeightVerts=${zeroW} ext=[${exts}]`);
    if (!hasJ || !hasW || zeroW > 0) fail = 1;
  } catch (e) {
    console.log(inGlb.split('/').pop(), 'LOAD ERROR:', e.message); fail = 1;
  }
}
process.exit(fail);
