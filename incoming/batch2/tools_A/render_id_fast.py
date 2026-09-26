#!/usr/bin/env python3
"""
render_turntable.py — headless Blender turntable renderer for Dungeon of the Covenant.

Renders a 4-view turntable (front / 3-4 / side / back) of a GLB model with
studio 3-point lighting on a dark backdrop.

Usage:
    blender --background --python tools/render_turntable.py -- <glb> <outdir> <name>

Output:
    <outdir>/<name>_front.png
    <outdir>/<name>_threequarter.png
    <outdir>/<name>_side.png
    <outdir>/<name>_back.png

Conventions:
  - Model is normalized to ~1.75 m tall, feet planted at z=0, centered on XY.
  - glTF +Z-forward becomes Blender -Y-forward on import, so the "front"
    camera sits at -Y looking toward the model.
  - Eevee renderer (fast, headless-safe), 1024x1024 PNG.

Blender binary: ~/workspace/tools/blender-4.2.3-linux-x64/blender
"""

import bpy
import math
import mathutils
import os
import sys

TARGET_HEIGHT = 1.75  # meters
RES = 768


def log(msg):
    print(f"[turntable] {msg}", flush=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Purge orphan data so repeated runs in one session stay clean.
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                 bpy.data.images, bpy.data.lights, bpy.data.cameras):
        for x in list(coll):
            coll.remove(x)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    if not imported:
        raise RuntimeError(f"glTF import produced no objects: {path}")
    return imported


def normalize_model(imported):
    """Parent everything under one root, scale to TARGET_HEIGHT, feet at z=0."""
    root = bpy.data.objects.new("TurntableRoot", None)
    bpy.context.collection.objects.link(root)
    for o in imported:
        if o.parent is None:
            o.parent = root
    bpy.context.view_layer.update()

    # World-space bounds of all meshes (root is still identity here).
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    found = False
    for o in imported:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            found = True
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    if not found:
        raise RuntimeError("imported GLB contains no mesh objects")
    height = mx[2] - mn[2]
    if height <= 1e-6:
        raise RuntimeError("model has zero height")
    s = TARGET_HEIGHT / height
    root.scale = (s, s, s)
    # Feet at z=0, XY centered: world = loc + s*local.
    root.location = (
        -s * (mn[0] + mx[0]) / 2.0,
        -s * (mn[1] + mx[1]) / 2.0,
        -s * mn[2],
    )
    bpy.context.view_layer.update()
    log(f"normalized: raw height {height:.2f} m -> {TARGET_HEIGHT} m (scale {s:.3f})")
    return root


def setup_world():
    world = bpy.context.scene.world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.012, 0.012, 0.018, 1.0)
        bg.inputs["Strength"].default_value = 1.0


def add_ground():
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -0.001))
    plane = bpy.context.active_object
    plane.name = "TurntableGround"
    mat = bpy.data.materials.new("GroundDark")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.03, 0.03, 0.04, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    bsdf.inputs["Metallic"].default_value = 0.0
    plane.data.materials.append(mat)
    return plane


def track_to(obj, target):
    con = obj.constraints.new(type="TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    return con


def setup_lights():
    bpy.ops.object.empty_add(location=(0, 0, 0.95))
    focus = bpy.context.active_object
    focus.name = "LightFocus"

    def area(name, location, power, size, color):
        bpy.ops.object.light_add(type="AREA", location=location)
        lamp = bpy.context.active_object
        lamp.name = name
        lamp.data.energy = power
        lamp.data.size = size
        lamp.data.color = color
        track_to(lamp, focus)
        return lamp

    # 3-point studio rig.
    area("KeyLight", (3.2, -4.2, 5.0), 1600, 3.0, (1.0, 0.96, 0.90))   # warm key, front-right-top
    area("FillLight", (-4.0, -2.2, 2.8), 500, 4.0, (0.85, 0.92, 1.0))  # cool fill, front-left
    area("RimLight", (0.5, 4.5, 4.2), 1400, 2.0, (0.75, 0.85, 1.0))    # cool rim, back-top
    log("studio 3-point lighting rigged")


def setup_camera():
    bpy.ops.object.camera_add(location=(0, -4.4, 1.15))
    cam = bpy.context.active_object
    cam.name = "TurntableCam"
    cam.data.type = "PERSP"
    cam.data.lens = 50
    bpy.context.scene.camera = cam
    bpy.ops.object.empty_add(location=(0, 0, 0.95))
    focus = bpy.context.active_object
    focus.name = "CamFocus"
    track_to(cam, focus)
    return cam


def render_views(cam, outdir, name):
    scene = bpy.context.scene
    # Cycles on CPU: robust headless (Eevee needs a GL/EGL context, which
    # headless VMs typically lack). Modest samples + denoising = fast stills.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 12
    scene.cycles.use_denoising = True
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"

    dist, cam_z = 4.4, 1.15
    views = [
        ("front", 0),
        ("threequarter", 45),
        ("side", 90),
        ("back", 180),
    ]
    for view_name, deg in views:
        a = math.radians(deg)
        # Model faces -Y after glTF import; angle 0 = front.
        cam.location = (dist * math.sin(a), -dist * math.cos(a), cam_z + (0.1 if view_name == "threequarter" else 0.0))
        bpy.context.view_layer.update()
        out = os.path.join(outdir, f"{name}_{view_name}.png")
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        log(f"rendered {out}")


def main():
    argv = sys.argv
    if "--" not in argv:
        print("usage: blender --background --python tools/render_turntable.py -- <glb> <outdir> <name>")
        sys.exit(2)
    args = argv[argv.index("--") + 1:]
    if len(args) != 3:
        print("usage: blender --background --python tools/render_turntable.py -- <glb> <outdir> <name>")
        sys.exit(2)
    glb_path, outdir, name = args
    glb_path = os.path.abspath(glb_path)
    outdir = os.path.abspath(outdir)
    if not os.path.isfile(glb_path):
        print(f"[turntable] ERROR: glb not found: {glb_path}")
        sys.exit(1)
    os.makedirs(outdir, exist_ok=True)

    log(f"importing {glb_path}")
    clear_scene()
    imported = import_glb(glb_path)
    normalize_model(imported)
    setup_world()
    add_ground()
    setup_lights()
    cam = setup_camera()
    render_views(cam, outdir, name)
    log("done")


main()
