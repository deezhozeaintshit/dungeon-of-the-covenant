#!/usr/bin/env python3
"""diag_islands.py — list top connected islands of a GLB with bbox + flatness."""
import bpy, sys, bmesh
from mathutils import Vector

argv = sys.argv
path = argv[argv.index("--") + 1]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print(f"[diag] {len(meshes)} mesh objects", flush=True)

# join all for island analysis
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
me = obj.data
bm = bmesh.new()
bm.from_mesh(me)
seen = set()
islands = []
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
    islands.append(comp)
islands.sort(key=len, reverse=True)
print(f"[diag] {len(islands)} islands", flush=True)
for i, comp in enumerate(islands[:8]):
    xs = []; ys = []; zs = []
    for f in comp:
        for v in f.verts:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    bx = (min(xs), max(xs)); by = (min(ys), max(ys)); bz = (min(zs), max(zs))
    flat = min(bx[1]-bx[0], by[1]-by[0], bz[1]-bz[0])
    print(f"[diag] island {i}: faces={len(comp)} "
          f"x=[{bx[0]:.3f},{bx[1]:.3f}] y=[{by[0]:.3f},{by[1]:.3f}] z=[{bz[0]:.3f},{bz[1]:.3f}] "
          f"min_thick={flat:.4f}", flush=True)
bm.free()
