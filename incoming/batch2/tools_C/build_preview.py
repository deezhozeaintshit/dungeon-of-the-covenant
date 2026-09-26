#!/usr/bin/env python3
"""Build a static, Blender-importable preview GLB from dumped bind-pose geometry
+ the packed file's material/JPEG textures. For turntable rendering only."""
import struct, json, sys, os
from io import BytesIO
from PIL import Image
import numpy as np

OUT_C = os.path.expanduser('~/workspace/rpg-crawler-game/art-work/incoming/batch2/out_C')

def load_packed(name):
    path = os.path.join(OUT_C, name + '_packed.glb')
    with open(path, 'rb') as f:
        d = f.read()
    magic, ver, length = struct.unpack('<III', d[:12])
    off = 12; j = None; bindata = b''
    while off < len(d):
        cl, ct = struct.unpack('<II', d[off:off+8]); off += 8
        if ct == 0x4E4F534A: j = json.loads(d[off:off+cl])
        elif ct == 0x004E4942: bindata = d[off:off+cl]
        off += cl
    return j, bindata

def extract_images(j, bindata, workdir, prefix):
    paths = []
    for i, im in enumerate(j.get('images', [])):
        bv = j['bufferViews'][im['bufferView']]
        blob = bindata[bv['byteOffset']:bv['byteOffset'] + bv['byteLength']]
        p = os.path.join(workdir, f'{prefix}_img{i}.jpg')
        # validate + re-save as baseline JPEG
        Image.open(BytesIO(blob)).convert('RGB').save(p, 'JPEG', quality=90)
        paths.append(p)
    return paths

def build_glb(name, workdir):
    j, bindata = load_packed(name)
    prefix = os.path.join(workdir, name + '_prevdump')
    # dump files were written as work/lich_prev.* / work/exec_prev.*
    tag = 'lich_prev' if name == 'elite_lich' else 'exec_prev'
    dp = os.path.join(workdir, tag)
    pos = np.fromfile(dp + '.pos.bin', dtype=np.float32)
    nrm = np.fromfile(dp + '.nrm.bin', dtype=np.float32)
    uv = np.fromfile(dp + '.uv.bin', dtype=np.float32)
    idx = np.fromfile(dp + '.idx.bin', dtype=np.uint32)
    nv = len(pos) // 3
    assert len(nrm) // 3 == nv and len(uv) // 2 == nv

    img_paths = extract_images(j, bindata, workdir, name)
    img_blobs = [open(p, 'rb').read() for p in img_paths]

    # reuse packed material's pbr params
    pmat = j['materials'][0]['pbrMetallicRoughness']
    material = {
        'name': j['materials'][0].get('name', 'mat'),
        'pbrMetallicRoughness': {
            'baseColorTexture': {'index': 0},
            'metallicRoughnessTexture': {'index': 1},
        },
    }
    for k in ('baseColorFactor', 'metallicFactor', 'roughnessFactor'):
        if k in pmat: material['pbrMetallicRoughness'][k] = pmat[k]

    blob = bytearray()
    def add_view(data, target):
        off = len(blob)
        blob.extend(data.tobytes() if isinstance(data, np.ndarray) else data)
        while len(blob) % 4: blob.append(0)
        return {'buffer': 0, 'byteOffset': off, 'byteLength': len(data.tobytes() if isinstance(data, np.ndarray) else data), 'target': target}

    bv_pos = add_view(pos, 34962)
    bv_nrm = add_view(nrm, 34962)
    bv_uv = add_view(uv, 34962)
    bv_idx = add_view(idx, 34963)
    bv_imgs = [add_view(b, None) for b in img_blobs]
    for bvi in bv_imgs: bvi.pop('target')

    def acc(bvi, ct, count, typ, mn=None, mx=None):
        a = {'bufferView': bvi, 'componentType': ct, 'count': count, 'type': typ}
        if mn is not None: a['min'] = mn; a['max'] = mx
        return a

    gj = {
        'asset': {'version': '2.0', 'generator': 'batch2C preview'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'preview_mesh'}],
        'meshes': [{'name': 'preview', 'primitives': [{
            'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2},
            'indices': 3, 'material': 0,
        }]}],
        'materials': [material],
        'textures': [{'source': 0, 'sampler': 0}, {'source': 1, 'sampler': 0}],
        'images': [{'bufferView': 4, 'mimeType': 'image/jpeg', 'name': 'baseColor'},
                   {'bufferView': 5, 'mimeType': 'image/jpeg', 'name': 'metallicRoughness'}],
        'samplers': [{}],
        'accessors': [
            acc(0, 5126, nv, 'VEC3',
                [float(pos[0::3].min()), float(pos[1::3].min()), float(pos[2::3].min())],
                [float(pos[0::3].max()), float(pos[1::3].max()), float(pos[2::3].max())]),
            acc(1, 5126, nv, 'VEC3'),
            acc(2, 5126, nv, 'VEC2'),
            acc(3, 5125, len(idx), 'SCALAR'),
        ],
        'bufferViews': [bv_pos, bv_nrm, bv_uv, bv_idx] + bv_imgs,
        'buffers': [{'byteLength': len(blob)}],
    }
    jraw = json.dumps(gj, separators=(',', ':')).encode()
    jpad = (-len(jraw)) % 4
    out = os.path.join(workdir, name + '_preview.glb')
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jraw) + jpad + 8 + len(blob)))
        f.write(struct.pack('<II', len(jraw) + jpad, 0x4E4F534A))
        f.write(jraw + b' ' * jpad)
        f.write(struct.pack('<II', len(blob), 0x004E4942))
        f.write(blob)
    print('wrote', out, os.path.getsize(out) // 1024, 'KB')

if __name__ == '__main__':
    wd = '/tmp/batch2C/work'
    for name in sys.argv[1:]:
        build_glb(name, wd)
