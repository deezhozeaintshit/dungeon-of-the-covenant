import { readFileSync, writeFileSync } from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Node polyfills for GLTFLoader's texture path (geometry-only use)
globalThis.self = globalThis;
class FakeImage {
  constructor() { setTimeout(() => this.onload && this.onload(), 0); }
  set src(v) { this._src = v; }
  get width() { return 1024; }
  get height() { return 1024; }
}
globalThis.Image = FakeImage;

const [,, inGlb, outPrefix] = process.argv;

function decodeAttr(attr) {
  // per KHR_mesh_quantization int-to-float table
  const arr = attr.array, n = attr.count, sz = attr.itemSize;
  const out = new Float32Array(n * sz);
  const norm = attr.normalized, ct = arr.constructor;
  for (let i = 0; i < n * sz; i++) {
    const c = arr[i];
    let f = c;
    if (norm) {
      if (ct === Int8Array) f = Math.max(c / 127, -1);
      else if (ct === Uint8Array) f = c / 255;
      else if (ct === Int16Array) f = Math.max(c / 32767, -1);
      else if (ct === Uint16Array) f = c / 65535;
    }
    out[i] = f;
  }
  return out;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const buf = readFileSync(inGlb);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await loader.parseAsync(ab, '');

let skinned = null;
gltf.scene.traverse(o => { if (o.isSkinnedMesh && !skinned) skinned = o; });
if (!skinned) { console.error('NO SKINNED MESH'); process.exit(1); }
const g = skinned.geometry;

// bind-pose CPU skinning -> exact meter-space positions (dequant via IBMs)
const skinDef = gltf.parser.json.skins[0];
const ibmData = await gltf.parser.getDependency('accessor', skinDef.inverseBindMatrices);
skinned.skeleton.bones.forEach(b => b.updateWorldMatrix(true, false));
const jointWorld = skinned.skeleton.bones.map(b => b.matrixWorld.clone());
const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
const v = new THREE.Vector3(), out = new THREE.Vector3(), tmp = new THREE.Vector3();
const ibm = new THREE.Matrix4();
const positions = new Float32Array(pos.count * 3);
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i);
  out.set(0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const j = si.getComponent(i, k), w = sw.getComponent(i, k);
    if (w === 0) continue;
    for (let e = 0; e < 16; e++) ibm.elements[e] = ibmData.array[j * 16 + e];
    tmp.copy(v).applyMatrix4(ibm).applyMatrix4(jointWorld[j]).multiplyScalar(w);
    out.add(tmp);
  }
  positions[i * 3] = out.x; positions[i * 3 + 1] = out.y; positions[i * 3 + 2] = out.z;
}

const normals = decodeAttr(g.attributes.normal);
const uvs = decodeAttr(g.attributes.texcoord_0 || g.attributes.uv);
const index = g.index.array;
const indices = Uint32Array.from(index);

writeFileSync(outPrefix + '.pos.bin', Buffer.from(positions.buffer));
writeFileSync(outPrefix + '.nrm.bin', Buffer.from(normals.buffer));
writeFileSync(outPrefix + '.uv.bin', Buffer.from(uvs.buffer));
writeFileSync(outPrefix + '.idx.bin', Buffer.from(indices.buffer));
writeFileSync(outPrefix + '.json', JSON.stringify({
  verts: pos.count, tris: indices.length / 3,
  posMin: [Math.min(...positions.filter((_, i) => i % 3 === 0))],
}));
console.log('dumped', pos.count, 'verts,', indices.length / 3, 'tris');
console.log('pos y range:', Math.min(...Array.from(positions).filter((_, i) => i % 3 === 1)).toFixed(3),
  '..', Math.max(...Array.from(positions).filter((_, i) => i % 3 === 1)).toFixed(3));
