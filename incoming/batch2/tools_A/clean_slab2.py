#!/usr/bin/env python3
"""clean_slab2.py — purely geometric cleanup for the juggernaut GLB.

1. Join meshes, remove doubles (re-weld).
2. Delete floor islands (thin in z, huge in x&y).
3. Delete slab sheets: tall (zr>0.9), positioned behind body (y_center>0.10),
   large (n>300). Sword is safe (zr~0.79, y_center<0).
4. Delete flat ground debris: n<400, zr<0.06, near global zmin.
5. Export cleaned GLB.
"""
import bpy, sys, bmesh, os

path_in = sys.argv[sys.argv.index("--") + 1]
path_out = sys.argv[sys.argv.index("--") + 2]


def log(m):
    print(f"[clean2] {m}", flush=True)


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

# weld (export shattered nothing yet; this heals the soup for island analysis)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode="OBJECT")

me = obj.data
bm = bmesh.new()
bm.from_mesh(me)
seen = set()
isl = []
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
    isl.append(comp)

zmin_g = min(v.co.z for c in isl for f in c for v in f.verts)
n_floor = n_slab = n_deb = 0
for comp in isl:
    xs = [v.co.x for f in comp for v in f.verts]
    ys = [v.co.y for f in comp for v in f.verts]
    zs = [v.co.z for f in comp for v in f.verts]
    xr, yr, zr = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    yc, zc = (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
    n = len(comp)
    kill = None
    if zr < 0.05 and xr > 1.0 and yr > 1.0:
        kill = "floor"; n_floor += n
    elif zr > 0.9 and yc > 0.10 and n > 300:
        kill = "slab"; n_slab += n
    elif n < 400 and zr < 0.06 and zc < zmin_g + 0.15:
        kill = "debris"; n_deb += n
    if kill:
        for f in comp:
            bm.faces.remove(f)
        log(f"removed {kill} island n={n} c=({(min(xs)+max(xs))/2:+.2f},{yc:+.2f},{zc:+.2f})")

bm.to_mesh(me)
bm.free()
me.update()
log(f"totals: floor={n_floor} slab={n_slab} debris={n_deb}")

bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=path_out, export_format="GLB",
                           use_selection=True, export_yup=True,
                           export_apply=False, export_materials="EXPORT",
                           export_image_format="AUTO")
log(f"exported {path_out} ({os.path.getsize(path_out)} bytes)")
