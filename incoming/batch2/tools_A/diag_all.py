import bpy, sys, bmesh
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for m in meshes: m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bm = bmesh.new(); bm.from_mesh(obj.data)
print(f"[all] total faces={len(bm.faces)}", flush=True)
seen=set(); islands=[]
for f in bm.faces:
    if f.index in seen: continue
    stack=[f]; seen.add(f.index); comp=[]
    while stack:
        cur=stack.pop(); comp.append(cur)
        for e in cur.edges:
            for lf in e.link_faces:
                if lf.index not in seen: seen.add(lf.index); stack.append(lf)
    islands.append(comp)
islands.sort(key=len, reverse=True)
print(f"[all] islands={len(islands)}", flush=True)
for i, comp in enumerate(islands[:15]):
    xs=[v.co.x for f in comp for v in f.verts]
    ys=[v.co.y for f in comp for v in f.verts]
    zs=[v.co.z for f in comp for v in f.verts]
    print(f"[all] {i}: n={len(comp)} xr={max(xs)-min(xs):.3f} yr={max(ys)-min(ys):.3f} zr={max(zs)-min(zs):.3f} z=[{min(zs):.3f},{max(zs):.3f}]", flush=True)
bm.free()
