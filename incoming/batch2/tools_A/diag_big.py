import bpy, sys, bmesh
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path)
meshes=[o for o in bpy.data.objects if o.type=="MESH"]
obj=meshes[0]
bm=bmesh.new(); bm.from_mesh(obj.data)
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
print(f"[big] total={len(bm.faces)} islands={len(islands)}", flush=True)
for i,comp in enumerate(islands[:12]):
    xs=[v.co.x for f in comp for v in f.verts]; ys=[v.co.y for f in comp for v in f.verts]; zs=[v.co.z for f in comp for v in f.verts]
    print(f"[big] {i}: n={len(comp)} x=[{min(xs):.3f},{max(xs):.3f}] y=[{min(ys):.3f},{max(ys):.3f}] z=[{min(zs):.3f},{max(zs):.3f}]", flush=True)
bm.free()
