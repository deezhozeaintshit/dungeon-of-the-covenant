#!/usr/bin/env python3
"""pack_hd.py — JPEG-resize embedded textures + rebuild GLB, then meshopt-pack.

Usage: python3 pack_hd.py <rigged.glb> <identity> <out.glb> [identity...]

- Converts every embedded image (data-URI or bufferView PNG) to JPEG, longest
  side <= 1024, quality 85. Names them <identity>_<role> by material slot
  (basecolor/normal/rm), falling back to <identity>_tex<i>.
- Rebuilds the binary buffer: single buffer, images as bufferViews.
- Then runs gltfpack: meshopt compression + quantization (batch-1 parity).
"""
import base64, io, json, os, struct, subprocess, sys
from PIL import Image

GLTFPACK = os.path.expanduser("~/workspace/tools/gltfpack/gltfpack")
MAX_SIDE = 1024
JPEG_Q = 85

def parse_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    assert data[:4] == b"glTF"
    jlen = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen
    blen = struct.unpack("<I", data[bin_off:bin_off + 4])[0]
    blob = data[bin_off + 8:bin_off + 8 + blen]
    return j, blob

def get_image_bytes(j, blob, im):
    if "bufferView" in im:
        bv = j["bufferViews"][im["bufferView"]]
        off = bv.get("byteOffset", 0)
        return blob[off:off + bv["byteLength"]]
    uri = im.get("uri", "")
    if uri.startswith("data:"):
        return base64.b64decode(uri.split(",", 1)[1])
    raise ValueError("external image URI: " + uri[:60])

def role_of(j, identity, idx):
    # map by material texture slot
    for mat in j.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        if pbr.get("baseColorTexture", {}).get("index") == idx:
            return "basecolor"
        if pbr.get("metallicRoughnessTexture", {}).get("index") == idx:
            return "rm"
        if mat.get("normalTexture", {}).get("index") == idx:
            return "normal"
        if mat.get("occlusionTexture", {}).get("index") == idx:
            return "ao"
        if mat.get("emissiveTexture", {}).get("index") == idx:
            return "emissive"
    return f"tex{idx}"

def main():
    rigged, identity, out_glb = sys.argv[1], sys.argv[2], sys.argv[3]
    j, blob = parse_glb(rigged)
    if "JOINTS_0" not in str(j.get("meshes")):
        print("[pack] WARNING: no skinned prims found", flush=True)

    new_images = []
    bin_parts = []
    img_lens = []
    for i, im in enumerate(j.get("images", [])):
        raw = get_image_bytes(j, blob, im)
        img = Image.open(io.BytesIO(raw))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        w, h = img.size
        s = min(1.0, MAX_SIDE / max(w, h))
        if s < 1.0:
            img = img.resize((int(w * s), int(h * s)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=JPEG_Q, optimize=True)
        data = buf.getvalue()
        bin_parts.append(data)
        img_lens.append(len(data))
        bv_idx = len(j.get("bufferViews", [])) + len(new_images)
        new_images.append({
            "bufferView": bv_idx,
            "mimeType": "image/jpeg",
            "name": f"{identity}_{role_of(j, identity, i)}",
        })
        print(f"[pack] img{i} {w}x{h} -> {img.size[0]}x{img.size[1]} jpeg {len(data)//1024}KB", flush=True)

    # defensive: strip EXT_texture_webp refs — source textures are now JPEG data,
    # stale webp extension pointers would break real loaders (C finding #2).
    j["extensionsUsed"] = [e for e in j.get("extensionsUsed", [])
                           if e != "EXT_texture_webp"]
    j["extensionsRequired"] = [e for e in j.get("extensionsRequired", [])
                               if e != "EXT_texture_webp"]
    for im in new_images:
        im.pop("extensions", None)

    # append new image bufferViews after existing ones
    bvs = j.get("bufferViews", [])
    for k, ni in enumerate(new_images):
        bvs.append({"buffer": 0, "byteOffset": 0, "byteLength": img_lens[k]})

    # rebuild blob: original accessor data + new image bytes appended
    new_blob = bytearray(blob)
    off = len(new_blob)
    new_bvs = j["bufferViews"]
    for k, ni in enumerate(new_images):
        bv_idx = ni["bufferView"]
        pad = (4 - off % 4) % 4
        new_blob += b"\x00" * pad
        off += pad
        new_bvs[bv_idx]["byteOffset"] = off
        part = bin_parts[k]
        new_blob += part
        off += len(part)
    j["images"] = new_images
    j["buffers"] = [{"byteLength": len(new_blob)}]

    # drop orphaned old image bufferViews from data-URI case: none existed
    tmp = rigged + ".staged.glb"
    blob_bytes = bytes(new_blob)
    jbin = json.dumps(j, separators=(",", ":")).encode()
    jpad = (4 - len(jbin) % 4) % 4
    total = 12 + 8 + len(jbin) + jpad + 8 + len(blob_bytes)
    hdr = struct.pack("<III", 0x46546C67, 2, total)  # magic, version, length
    with open(tmp, "wb") as f:
        f.write(hdr)
        f.write(struct.pack("<I", len(jbin) + jpad) + b"JSON" + jbin + b"\x00" * jpad)
        f.write(struct.pack("<I", len(blob_bytes)) + b"BIN\x00" + blob_bytes)
    print(f"[pack] staged {tmp} ({os.path.getsize(tmp)//1024}KB)", flush=True)

    # gltfpack: meshopt + quantization (batch-1 parity)
    cmd = [GLTFPACK, "-i", tmp, "-o", out_glb, "-cc", "-vp", "14", "-vt", "12",
           "-vn", "8", "-kn"]
    print("[pack] " + " ".join(cmd), flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-1500:], flush=True)
    if r.returncode != 0:
        print(r.stderr[-1500:], flush=True)
        sys.exit(1)
    print(f"[pack] DONE {out_glb} ({os.path.getsize(out_glb)//1024}KB)", flush=True)
    os.remove(tmp)

main()
