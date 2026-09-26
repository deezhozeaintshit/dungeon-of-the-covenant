// build_preview.mjs — build a plain uncompressed preview GLB from a packed (meshopt)
// GLB for Blender turntable rendering. Reuses the packed file's JPEG textures
// and pbr params; geometry is the bind-pose skinned mesh, dequantized by three.
import { readFileSync, writeFileSync } from 'fs';
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

const [,, inGlb, outGlb] = process.argv;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const buf = readFileSync(inGlb);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await loader.parseAsync(ab, '');
const json = gltf.parser.json;

let skinned = null;
gltf.scene.traverse(o => { if (o.isSkinnedMesh && !skinned) skinned = o; });
if (!skinned) { console.error('NO SKINNED MESH'); process.exit(1); }
const g = skinned.geometry;
// NOTE: three keeps meshopt/quantized attrs interleaved — read per-vertex via
// getX/getY/getZ which applies dequantization correctly.
function readAttr(name, size) {
  const a = g.attributes[name];
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) {
    out[i * size] = a.getX(i);
    if (size > 1) out[i * size + 1] = a.getY(i);
    if (size > 2) out[i * size + 2] = a.getZ(i);
  }
  return out;
}
const posA = g.attributes.position, nrmA = g.attributes.normal;
const uvA = g.attributes.texcoord_0 || g.attributes.uv;
const pos = readAttr('position', 3);
const nrm = readAttr('normal', 3);
const uv = readAttr(uvA === g.attributes.texcoord_0 ? 'texcoord_0' : 'uv', 2);
const idxArr = g.index.array;
const idx = idxArr instanceof Uint32Array ? idxArr : Uint16Array.from(idxArr);
const nv = posA.count;

// extract packed JPEG blobs via parser json
const binChunk = Buffer.from(ab).subarray(
  (() => { // find BIN chunk
    let off = 12;
    while (off < ab.byteLength) {
      const dv = new DataView(ab, off, 8);
      const len = dv.getUint32(0, true), type = dv.getUint32(4, true);
      if (type === 0x004E4942) return off + 8;
      off += 8 + len;
    }
    return -1;
  })());
const imgBlobs = json.images.map(im => {
  const bv = json.bufferViews[im.bufferView];
  return binChunk.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
});

const pmat = (json.materials && json.materials[0] && json.materials[0].pbrMetallicRoughness) || {};
// deep-copy texture infos so KHR_texture_transform (UV scale/offset) survives
function texInfo(src) {
  if (!src) return undefined;
  return JSON.parse(JSON.stringify(src));
}
const material = { name: 'preview', pbrMetallicRoughness: {} };
if (pmat.baseColorTexture) material.pbrMetallicRoughness.baseColorTexture = texInfo(pmat.baseColorTexture);
if (pmat.metallicRoughnessTexture) material.pbrMetallicRoughness.metallicRoughnessTexture = texInfo(pmat.metallicRoughnessTexture);
for (const k of ['baseColorFactor', 'metallicFactor', 'roughnessFactor'])
  if (k in pmat) material.pbrMetallicRoughness[k] = pmat[k];
// declare the extension we now reference
var extensionsUsed = ['KHR_texture_transform'];

const parts = [];
const views = [];
function addView(u8, target) {
  const off = parts.reduce((a, p) => a + p.length, 0);
  parts.push(Buffer.from(u8));
  const pad = (4 - (u8.length % 4)) % 4;
  if (pad) parts.push(Buffer.alloc(pad));
  const v = { buffer: 0, byteOffset: off, byteLength: u8.length };
  if (target) v.target = target;
  views.push(v);
  return views.length - 1;
}
const bPos = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
const bNrm = Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength);
const bUv = Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength);
const bIdx = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
const vPos = addView(bPos, 34962), vNrm = addView(bNrm, 34962),
      vUv = addView(bUv, 34962), vIdx = addView(bIdx, 34963);
const vImgs = imgBlobs.map(b => addView(b, null));

let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < nv; i++) {
  for (let k = 0; k < 3; k++) {
    const v = pos[i * 3 + k];
    if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
  }
}
const gj = {
  asset: { version: '2.0', generator: 'batch2A preview' },
  extensionsUsed: extensionsUsed,
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'preview_mesh' }],
  meshes: [{ name: 'preview', primitives: [{
    attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
    indices: 3, material: 0 }] }],
  materials: [material],
  textures: [{ source: 0 }, { source: 1 }],
  images: [
    { bufferView: vImgs[0], mimeType: 'image/jpeg', name: 'baseColor' },
    { bufferView: vImgs[1], mimeType: 'image/jpeg', name: 'metallicRoughness' }],
  accessors: [
    { bufferView: vPos, componentType: 5126, count: nv, type: 'VEC3', min: mn, max: mx },
    { bufferView: vNrm, componentType: 5126, count: nv, type: 'VEC3' },
    { bufferView: vUv, componentType: 5126, count: nv, type: 'VEC2' },
    { bufferView: vIdx, componentType: idx instanceof Uint32Array ? 5125 : 5123,
      count: idx.length, type: 'SCALAR' }],
  bufferViews: views,
  buffers: [{ byteLength: parts.reduce((a, p) => a + p.length, 0) }],
};
const jraw = Buffer.from(JSON.stringify(gj));
const jpad = (4 - (jraw.length % 4)) % 4;
const bbuf = Buffer.concat(parts);
const total = 12 + 8 + jraw.length + jpad + 8 + bbuf.length;
const out = Buffer.alloc(total);
let o = 0;
out.writeUInt32LE(0x46546C67, o); out.writeUInt32LE(2, o + 4); out.writeUInt32LE(total, o + 8); o += 12;
out.writeUInt32LE(jraw.length + jpad, o); out.writeUInt32LE(0x4E4F534A, o + 4); o += 8;
jraw.copy(out, o); o += jraw.length;
out.fill(0x20, o, o + jpad); o += jpad;
out.writeUInt32LE(bbuf.length, o); out.writeUInt32LE(0x004E4942, o + 4); o += 8;
bbuf.copy(out, o);
writeFileSync(outGlb, out);
console.log('wrote', outGlb, out.length, 'bytes, verts', nv, 'tris', idx.length / 3);
