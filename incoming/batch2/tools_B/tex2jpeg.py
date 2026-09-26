#!/usr/bin/env python3
"""
tex2jpeg.py — pure-Python GLB surgery: convert all embedded images to JPEG
(quality 88), max dimension 1024, rebuild bufferViews/buffer. No deps but PIL.

Usage: python3 tex2jpeg.py <in.glb> <out.glb>
"""
import base64
import json
import struct
import sys
from io import BytesIO

from PIL import Image

MAX_DIM = 1024
JPEG_Q = 88


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB"
    off = 12
    json_data = None
    bin_data = b""
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            json_data = json.loads(chunk)
        elif ctype == 0x004E4942:
            bin_data = chunk
        off += 8 + clen
    return json_data, bin_data


def decode_image(img, bvs, bindata):
    if "bufferView" in img:
        bv = bvs[img["bufferView"]]
        return bindata[bv["byteOffset"]:bv["byteOffset"] + bv["byteLength"]]
    uri = img.get("uri", "")
    if uri.startswith("data:"):
        return base64.b64decode(uri.split(",", 1)[1])
    raise RuntimeError(f"unsupported external image uri: {uri[:60]}")


def convert(raw):
    pil = Image.open(BytesIO(raw))
    if pil.mode in ("RGBA", "LA", "PA"):
        bg = Image.new("RGB", pil.size, (0, 0, 0))
        bg.paste(pil, mask=pil.split()[-1])
        pil = bg
    else:
        pil = pil.convert("RGB")
    if max(pil.size) > MAX_DIM:
        sc = MAX_DIM / max(pil.size)
        pil = pil.resize((int(pil.size[0] * sc), int(pil.size[1] * sc)), Image.LANCZOS)
    buf = BytesIO()
    pil.save(buf, "JPEG", quality=JPEG_Q)
    return buf.getvalue(), pil.size


def main():
    in_path, out_path = sys.argv[1], sys.argv[2]
    js, bindata = read_glb(in_path)
    images = js.get("images", [])
    bvs = js.get("bufferViews", [])

    new_bin = bytearray()
    new_bvs = []
    img_map = {}  # image idx -> new bufferView idx

    def append_bytes(b):
        off = len(new_bin)
        pad = (-len(b)) % 4
        new_bin.extend(b)
        new_bin.extend(b"\x00" * pad)
        return off

    # First pass: convert images, keyed by source ("bv:<idx>" or "uri:<imgidx>").
    new_img_bytes = {}
    img_sources = {}
    for i, img in enumerate(images):
        raw = decode_image(img, bvs, bindata)
        jpeg, size = convert(raw)
        key = f"img{i}"
        new_img_bytes[key] = jpeg
        img_sources[i] = key
        print(f"[tex] image {i} ({img.get('name','')}) -> JPEG {size[0]}x{size[1]} ({len(jpeg)/1e3:.0f} KB)", flush=True)

    # BufferViews referenced by accessors must keep their indices; image-only
    # bufferViews are dropped (their bytes are replaced by the new JPEGs).
    accessor_bvs = set()
    for acc in js.get("accessors", []):
        if "bufferView" in acc:
            accessor_bvs.add(acc["bufferView"])
    for mesh in js.get("meshes", []):
        for prim in mesh.get("primitives", []):
            for tgt in prim.get("targets", []):
                for v in tgt.values():
                    if isinstance(v, int) and v < len(js.get("accessors", [])):
                        bv = js["accessors"][v].get("bufferView")
                        if bv is not None:
                            accessor_bvs.add(bv)
    img_bv_set = {img["bufferView"] for img in images if "bufferView" in img}

    bv_remap = {}
    for idx, bv in enumerate(bvs):
        if idx in img_bv_set and idx not in accessor_bvs:
            bv_remap[idx] = None  # dropped, replaced by JPEG bufferView
            continue
        raw = bindata[bv["byteOffset"]:bv["byteOffset"] + bv["byteLength"]]
        off = append_bytes(raw)
        nbv = dict(bv)
        nbv["byteOffset"] = off
        nbv["byteLength"] = len(raw)
        new_bvs.append(nbv)
        bv_remap[idx] = len(new_bvs) - 1

    # Fix accessor bufferView references (incl. sparse).
    for acc in js.get("accessors", []):
        if "bufferView" in acc:
            acc["bufferView"] = bv_remap[acc["bufferView"]]
        sp = acc.get("sparse")
        if sp:
            for part in ("indices", "values"):
                if part in sp and "bufferView" in sp[part]:
                    sp[part]["bufferView"] = bv_remap[sp[part]["bufferView"]]

    for i, img in enumerate(images):
        jpeg = new_img_bytes[img_sources[i]]
        off = append_bytes(jpeg)
        nbv = {"byteOffset": off, "byteLength": len(jpeg)}
        new_bvs.append(nbv)
        img.pop("uri", None)
        img.pop("bufferView", None)
        img["bufferView"] = len(new_bvs) - 1
        img["mimeType"] = "image/jpeg"

    js["bufferViews"] = new_bvs
    js["buffers"] = [{"byteLength": len(new_bin)}]

    json_bytes = json.dumps(js, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    out += struct.pack("<II", len(new_bin), 0x004E4942) + bytes(new_bin)
    with open(out_path, "wb") as f:
        f.write(out)
    print(f"[tex] wrote {out_path} ({len(out)/1e6:.2f} MB)", flush=True)


main()
