#!/usr/bin/env python3
"""clean_slab.py — remove floor plane + black backdrop slab from juggernaut GLB.

1. Joins meshes, computes islands.
2. Deletes floor islands (thin in z, huge in x&y).
3. Finds the tall back plate island (zr>0.9*H, behind model y>0) and removes
   faces whose base-texture brightness is below a threshold (uniform black slab).
4. Exports cleaned GLB.
"""
import bpy, sys, bmesh, os
from PIL import Image

argv = sys.argv
path_in = argv[argv.index("--") + 1]
path_out = argv[argv.index("--") + 2]
DARK_THRESH = 0.10  # avg face brightness below this -> slab


def log(m):
    print(f"[clean] {m}", flush=True)


def islands_of(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen = set()
    out = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]; seen.add(f.index); comp = []
        while stack:
            cur = stack.pop(); comp.append(cur)
            for e in cur.edges:
                for lf in e.link_faces:
                    if lf.index not in seen:
                        seen.add(lf.index); stack.append(lf)
        out.append(comp)
    bm.free()
    return out


def bbox(comp):
    xs = [v.co.x for f in comp for v in f.verts]
    ys = [v.co.y for f in comp for v in f.verts]
    zs = [v.co.z for f in comp for v in f.verts]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path_in)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

# base color texture for darkness test
me = obj.data
img = None
# simpler: grab the first image texture used by any material
for mat in me.materials:
    if not mat or not mat.use_nodes:
        continue
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            img = n.image
            break
    if img:
        break

tex = None
if img:
    # packed image -> PIL via pixels
    w, h = img.size
    px = list(img.pixels)  # RGBA floats
    from PIL import Image as PILImage
    data = bytes(int(max(0, min(1, c)) * 255) for c in px)
    tex = PILImage.frombytes("RGBA", (w, h), data).convert("RGB").transpose(PILImage.FLIP_TOP_BOTTOM)
    log(f"texture {img.name} {w}x{h}")

comps = islands_of(obj)
bm = bmesh.new()
bm.from_mesh(me)
seen = set()
isl_bm = []
for f in bm.faces:
    if f.index in seen:
        continue
    stack = [f]; seen.add(f.index); comp = []
    while stack:
        cur = stack.pop(); comp.append(cur)
        for e in cur.edges:
            for lf in e.link_faces:
                if lf.index not in seen:
                    seen.add(lf.index); stack.append(lf)
    isl_bm.append(comp)

allz = [v.co.z for c in isl_bm for f in c for v in f.verts]
H = max(allz) - min(allz)
log(f"islands={len(isl_bm)} H={H:.3f}")

n_floor = 0
n_slab = 0
n_kept = 0
for comp in isl_bm:
    x0, x1, y0, y1, z0, z1 = bbox(comp)
    xr, yr, zr = x1 - x0, y1 - y0, z1 - z0
    yc = (y0 + y1) / 2
    # floor: horizontal, spans widely
    if zr < 0.05 and xr > 1.0 and yr > 1.0:
        for f in comp:
            bm.faces.remove(f)
        n_floor += len(comp)
        continue
    # back plate: tall, narrow-ish, positioned behind (y>0)
    if zr > 0.75 * H and yr < 0.35 and yc > 0.02 and len(comp) > 300:
        dark = 0
        total = len(comp)
        uv = bm.loops.layers.uv.active
        for f in comp:
            # avg brightness at face UV centroid
            us, vs = [], []
            for lp in f.loops:
                u, v = lp[uv].uv
                us.append(u); vs.append(v)
            if tex and us:
                uc, vc = sum(us) / len(us), sum(vs) / len(vs)
                px = tex.getpixel((int(uc * (tex.width - 1)) % tex.width,
                                   int(vc * (tex.height - 1)) % tex.height))
                b = sum(px[:3]) / (3 * 255)
            else:
                b = 1.0
            if b < DARK_THRESH:
                bm.faces.remove(f)
                dark += 1
            else:
                n_kept += 1
        n_slab += dark
        log(f"plate island faces={total} dark_removed={dark}")
        continue

bm.to_mesh(me)
bm.free()
me.update()
log(f"removed floor={n_floor} slab_dark={n_slab} kept_plate_bright={n_kept}")

bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=path_out, export_format="GLB",
                           use_selection=True, export_yup=True,
                           export_apply=False, export_materials="EXPORT",
                           export_image_format="AUTO")
log(f"exported {path_out} ({os.path.getsize(path_out)} bytes)")
