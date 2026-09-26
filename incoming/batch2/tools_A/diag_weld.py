import bpy, sys, bmesh
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path)
obj=[o for o in bpy.data.objects if o.type=="MESH"][0]
bpy.context.view_layer.objects.active=obj
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
r=bpy.ops.mesh.remove_doubles(threshold=0.0005)
print("[weld] remove_doubles result:", r, flush=True)
bpy.ops.object.mode_set(mode="OBJECT")
print("[weld] verts:", len(obj.data.vertices), "faces:", len(obj.data.polygons), flush=True)
bm=bmesh.new(); bm.from_mesh(obj.data)
seen=set(); isl=[]
for f in bm.faces:
    if f.index in seen: continue
    stack=[f]; seen.add(f.index); comp=[]
    while stack:
        cur=stack.pop(); comp.append(cur)
        for e in cur.edges:
            for lf in e.link_faces:
                if lf.index not in seen: seen.add(lf.index); stack.append(lf)
    isl.append(comp)
isl.sort(key=len, reverse=True)
print(f"[weld] islands={len(isl)}", flush=True)
for i,comp in enumerate(isl[:6]):
    xs=[v.co.x for f in comp for v in f.verts]; ys=[v.co.y for f in comp for v in f.verts]; zs=[v.co.z for f in comp for v in f.verts]
    print(f"[weld] {i}: n={len(comp)} xr={max(xs)-min(xs):.3f} yr={max(ys)-min(ys):.3f} zr={max(zs)-min(zs):.3f}", flush=True)
bm.free()
