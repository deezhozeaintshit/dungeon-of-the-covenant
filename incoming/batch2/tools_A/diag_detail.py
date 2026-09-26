import bpy, sys, bmesh
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path)
obj=[o for o in bpy.data.objects if o.type=="MESH"][0]
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
for i,comp in enumerate(islands[:30]):
    xs=[v.co.x for f in comp for v in f.verts]; ys=[v.co.y for f in comp for v in f.verts]; zs=[v.co.z for f in comp for v in f.verts]
    cx=(min(xs)+max(xs))/2; cy=(min(ys)+max(ys))/2; cz=(min(zs)+max(zs))/2
    print(f"[det] {i}: n={len(comp)} c=({cx:+.3f},{cy:+.3f},{cz:+.3f}) xr={max(xs)-min(xs):.3f} yr={max(ys)-min(ys):.3f} zr={max(zs)-min(zs):.3f}", flush=True)
bm.free()
