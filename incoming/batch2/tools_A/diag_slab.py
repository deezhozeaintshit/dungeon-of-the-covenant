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
for i, comp in enumerate(sorted(islands, key=len, reverse=True)):
    if len(comp) < 300: break
    xs=[v.co.x for f in comp for v in f.verts]
    ys=[v.co.y for f in comp for v in f.verts]
    zs=[v.co.z for f in comp for v in f.verts]
    xr=max(xs)-min(xs); yr=max(ys)-min(ys); zr=max(zs)-min(zs)
    thin=min(xr,yr,zr)
    axis='x' if xr==thin else ('y' if yr==thin else 'z')
    print(f"[slab] island {i}: faces={len(comp)} xr={xr:.3f} yr={yr:.3f} zr={zr:.3f} thin={axis}:{thin:.4f} zmin={min(zs):.3f}", flush=True)
bm.free()
