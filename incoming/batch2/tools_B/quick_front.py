#!/usr/bin/env python3
"""quick_front.py — single front-view render of a GLB (identification use).
Usage: blender --background --python quick_front.py -- <in.glb> <out.png>
"""
import bpy, math, mathutils, os, sys

def log(m): print(f"[quick] {m}", flush=True)

args = sys.argv[sys.argv.index("--") + 1:]
in_glb, out_png = os.path.abspath(args[0]), os.path.abspath(args[1])

bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=in_glb)
imported = [o for o in bpy.data.objects]
meshes = [o for o in imported if o.type == "MESH"]
for o in imported:
    if o.type != "MESH": bpy.data.objects.remove(o, do_unlink=True)

root = bpy.data.objects.new("Root", None); bpy.context.collection.objects.link(root)
for o in meshes:
    if o.parent is None: o.parent = root
bpy.context.view_layer.update()
mn = [1e9]*3; mx = [-1e9]*3
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
h = mx[2]-mn[2]; s = 1.75/h
root.scale = (s,s,s); root.location.z = -mn[2]*s
bpy.context.view_layer.update()

# camera front (-Y looking at model), fit height
cam_data = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
cx, cy = (mn[0]+mx[0])/2*s, (mn[1]+mx[1])/2*s
dist = 1.75/ (2*math.tan(math.radians(25))) + 0.6
cam.location = (cx, cy - dist, 0.9)
tgt = bpy.data.objects.new("Tgt", None); bpy.context.collection.objects.link(tgt)
tgt.location = (cx, cy, 0.9)
con = cam.constraints.new(type="TRACK_TO"); con.target = tgt
con.track_axis = "TRACK_NEGATIVE_Z"; con.up_axis = "UP_Y"
bpy.context.scene.camera = cam

# 3-point lights
for name, loc, e in [("Key",(2.5,-3,3),800),("Fill",(-2.5,-2,2),300),("Rim",(0,3,2.5),500)]:
    ld = bpy.data.lights.new(name, "POINT"); ld.energy = e
    lo = bpy.data.objects.new(name, ld); lo.location = loc
    bpy.context.collection.objects.link(lo)
bpy.context.scene.world = bpy.data.worlds.new("W")
bpy.context.scene.world.use_nodes = True
bg = bpy.context.scene.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.02,0.02,0.03,1)

sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.render.resolution_x = 768; sc.render.resolution_y = 768
sc.render.film_transparent = False
sc.cycles.samples = 16; sc.cycles.use_denoising = False
sc.render.filepath = out_png
bpy.ops.render.render(write_still=True)
log(f"wrote {out_png}")
