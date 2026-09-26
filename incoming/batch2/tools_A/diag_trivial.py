import bpy, sys
path_in, path_out = sys.argv[sys.argv.index("--")+1], sys.argv[sys.argv.index("--")+2]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path_in)
meshes=[o for o in bpy.data.objects if o.type=="MESH"]
bpy.ops.object.select_all(action="DESELECT")
for m in meshes: m.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
if len(meshes)>1: bpy.ops.object.join()
obj=bpy.context.view_layer.objects.active
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True)
bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=path_out, export_format="GLB", use_selection=True,
  export_yup=True, export_apply=False, export_materials="EXPORT", export_image_format="AUTO")
print("[trivial] exported", path_out, flush=True)
