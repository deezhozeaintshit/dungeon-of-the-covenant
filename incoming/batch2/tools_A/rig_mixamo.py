#!/usr/bin/env python3
"""
rig_mixamo.py — headless Blender auto-rigger for Dungeon of the Covenant HD heroes.

Takes an unrigged Tripo/Meshy GLB and produces a Mixamo-skeleton-compatible
rigged GLB satisfying HD_HERO_CONTRACT.md:
  - Mixamo bone names + Mixamo local rest orientations (extracted from the
    shipped hero_idle.fbx, so the 14 Mixamo clips retarget bone->bone with
    verbatim quaternion tracks)
  - joints placed from mesh-proportion analysis
  - <=30k tris (decimated), feet at y=0, +Y up, forward +Z on export

Usage:
    blender --background --python rig_mixamo.py -- \\
        <in.glb> <out.glb> <mixamo_skeleton.json> [--debug <png>] [--rot180]

--rot180 : rotate model 180 deg about Z first (use when turntable shows the
           model facing away from the front camera).
--debug  : render a front-view PNG with joint spheres to verify placement.
"""

import bpy, json, math, os, sys
from mathutils import Vector, Matrix

TARGET_TRIS = 25000
TARGET_HEIGHT = 1.75

# Bones we author (Mixamo core; fingers/face rigs skipped — clips drop those
# tracks harmlessly, and mitten hands can't take finger joints).
BONES = [
    "Hips",
    "Spine", "Spine1", "Spine2", "Neck", "Head",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
]
PARENT = {
    "Hips": None,
    "Spine": "Hips", "Spine1": "Spine", "Spine2": "Spine1",
    "Neck": "Spine2", "Head": "Neck",
    "LeftShoulder": "Spine2", "LeftArm": "LeftShoulder",
    "LeftForeArm": "LeftArm", "LeftHand": "LeftForeArm",
    "RightShoulder": "Spine2", "RightArm": "RightShoulder",
    "RightForeArm": "RightArm", "RightHand": "RightForeArm",
    "LeftUpLeg": "Hips", "LeftLeg": "LeftUpLeg",
    "LeftFoot": "LeftLeg", "LeftToeBase": "LeftFoot",
    "RightUpLeg": "Hips", "RightLeg": "RightUpLeg",
    "RightFoot": "RightLeg", "RightToeBase": "RightFoot",
}
# Fallback bone lengths (m) for chain ends; mid-chain bones get joint distances.
END_LENGTHS = {"Head": 0.16, "LeftHand": 0.13, "RightHand": 0.13,
               "LeftFoot": 0.13, "RightFoot": 0.13,
               "LeftToeBase": 0.07, "RightToeBase": 0.07,
               "Hips": 0.12}


def log(msg):
    print(f"[rig] {msg}", flush=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                 bpy.data.images, bpy.data.lights, bpy.data.cameras,
                 bpy.data.actions):
        for x in list(coll):
            coll.remove(x)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no meshes imported")
    return imported, meshes


def tri_count(obj):
    mesh = obj.data
    n = 0
    for p in mesh.polygons:
        n += len(p.vertices) - 2
    return n


def clean_mesh(obj):
    """Tripo meshes are non-manifold soups; heat-weighting fails on them.
    Merge doubles + delete loose + drop tiny disconnected debris islands +
    recalc normals first."""
    import bmesh
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="OBJECT")
    # floor peel: AI gens often bake a studio floor plane under the model.
    # Detect a razor-thin vertex-density spike in the bottom 10% of height.
    me0 = obj.data
    zs = [v.co.z for v in me0.vertices]
    zmin, zmax = min(zs), max(zs)
    H0 = zmax - zmin
    nbands = max(10, int(0.10 * H0 / 0.002))
    band_w = 0.10 * H0 / nbands
    counts = [0] * nbands
    for z in zs:
        i = min(nbands - 1, int((z - zmin) / band_w))
        counts[i] += 1
    pk = max(range(nbands), key=lambda i: counts[i])
    if counts[pk] > 100:
        fz = zmin + (pk + 0.5) * band_w
        cut = fz + 0.004
        bm0 = bmesh.new()
        bm0.from_mesh(me0)
        rm = [f for f in bm0.faces if all(v.co.z < cut for v in f.verts)]
        for f in rm:
            bm0.faces.remove(f)
        bm0.to_mesh(me0)
        bm0.free()
        me0.update()
        log(f"floor peel: removed {len(rm)} faces below z={cut:.4f} (spike {counts[pk]} verts)")
    else:
        log(f"no floor detected (bottom peak {counts[pk]} verts)")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.delete_loose()
    bpy.ops.object.mode_set(mode="OBJECT")
    # drop disconnected islands that are small debris (<60 faces or <3% of
    # the largest island's face count, whichever is smaller bound)
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    seen = set()
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        seen.add(f.index)
        comp = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.edges:
                for lf in e.link_faces:
                    if lf.index not in seen:
                        seen.add(lf.index)
                        stack.append(lf)
        islands.append(comp)
    if islands:
        biggest = max(len(c) for c in islands)
        thresh = min(60, max(20, int(biggest * 0.03)))
        n_drop = 0
        for comp in islands:
            if len(comp) < thresh:
                n_drop += len(comp)
                for f in comp:
                    bm.faces.remove(f)
        bm.to_mesh(me)
        log(f"dropped {n_drop} debris faces (islands<{thresh} faces, biggest={biggest})")
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"cleaned: {len(obj.data.vertices)} verts")


def normalize_and_decimate(meshes, rot180):
    # Join into one mesh if needed.
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    clean_mesh(obj)

    if rot180:
        obj.rotation_euler[2] = math.pi
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    # Bounds -> normalize to TARGET_HEIGHT, feet at z=0, centered XY.
    bpy.context.view_layer.update()
    ws = [obj.matrix_world @ v.co for v in obj.data.vertices]
    mn = Vector((min(w.x for w in ws), min(w.y for w in ws), min(w.z for w in ws)))
    mx = Vector((max(w.x for w in ws), max(w.y for w in ws), max(w.z for w in ws)))
    h = mx.z - mn.z
    s = TARGET_HEIGHT / h
    log(f"raw height {h:.3f} m -> {TARGET_HEIGHT} m (scale {s:.4f})")
    for v in obj.data.vertices:
        v.co = ((v.co.x - (mn.x + mx.x) / 2) * s,
                (v.co.y - (mn.y + mx.y) / 2) * s,
                (v.co.z - mn.z) * s)
    obj.data.update()

    # Decimate to budget.
    ntris = tri_count(obj)
    log(f"tris before decimate: {ntris}")
    if ntris > TARGET_TRIS:
        ratio = TARGET_TRIS / ntris
        mod = obj.modifiers.new("DecimateHD", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        log(f"tris after decimate: {tri_count(obj)} (ratio {ratio:.3f})")
    return obj


# ---------------------------------------------------------------------------
# Joint analysis (Blender z-up; model normalized: feet z=0, height H, centered)
# ---------------------------------------------------------------------------

def median(vals):
    v = sorted(vals)
    n = len(v)
    return v[n // 2] if n else 0.0


def analyze_joints(obj):
    ws = [tuple(v.co) for v in obj.data.vertices]
    H = max(w[2] for w in ws)
    log(f"analyzing joints, H={H:.3f}")

    def slice_verts(zc, half=0.02):
        return [w for w in ws if abs(w[2] - zc) < half * H]

    def y_at(xc, zc, xhalf=0.12):
        ys = [w[1] for w in slice_verts(zc) if abs(w[0] - xc) < xhalf * H]
        return median(ys) if ys else 0.0

    # ---- legs: x-histogram peaks at shin height ----
    zl = 0.20 * H
    band = [w[0] for w in slice_verts(zl, 0.03) if abs(w[0]) < 0.35 * H]
    nbins = 24
    lo, hi = min(band), max(band)
    bins = [0] * nbins
    for x in band:
        bins[min(nbins - 1, int((x - lo) / (hi - lo + 1e-9) * nbins))] += 1
    # find up to 2 peaks separated by >= 0.10H
    order = sorted(range(nbins), key=lambda i: -bins[i])
    peaks = []
    for i in order:
        x = lo + (i + 0.5) / nbins * (hi - lo)
        if all(abs(x - p) >= 0.10 * H for p in peaks):
            peaks.append(x)
        if len(peaks) == 2:
            break
    total = sum(bins) or 1
    if len(peaks) == 2 and all(bins[order[k]] / total > 0.04 for k in range(2)):
        # symmetric stance: use mean magnitude (robes drape asymmetrically)
        mag = (abs(peaks[0]) + abs(peaks[1])) / 2
        lx, rx = mag, -mag
        log(f"leg peaks detected -> symmetric x=+-{mag:.3f}")
    else:
        lx, rx = 0.105 * H, -0.105 * H
        log("leg peaks unclear -> anatomical default +-0.105H")
    lx = min(max(lx, 0.04 * H), 0.16 * H)
    rx = -lx

    def leg_joints(lx):
        ya = y_at(lx, 0.08 * H, 0.06)
        yk = y_at(lx, 0.27 * H, 0.06)
        yh = y_at(lx, 0.48 * H, 0.06)
        return {
            "ankle": Vector((lx, ya, 0.075 * H)),
            "knee": Vector((lx, yk, 0.27 * H)),
            "hip": Vector((lx, yh, 0.50 * H)),
        }

    legs = {"L": leg_joints(lx), "R": leg_joints(rx)}

    # ---- torso center line ----
    y_pelvis = y_at(0, 0.53 * H)
    y_sp = y_at(0, 0.60 * H)
    y_sp1 = y_at(0, 0.68 * H)
    y_sp2 = y_at(0, 0.76 * H)
    y_neck = y_at(0, 0.84 * H)
    y_head = y_at(0, 0.90 * H)

    # ---- shoulders / arms ----
    z_sh = 0.80 * H
    x_max = max(abs(w[0]) for w in slice_verts(z_sh, 0.025))
    x_sh = min(max(x_max - 0.045 * H, 0.10 * H), 0.17 * H)
    y_sh = y_at(x_sh, z_sh, 0.05)
    log(f"shoulder x=+-{x_sh:.3f} (surf {x_max:.3f})")

    # staff/polearm detection: tall thin vertical column off-center.
    # Its shaft pollutes arm-vertex gates; exclude it above hand height.
    staff_x = {}
    for sgn, tag in ((1, "L"), (-1, "R")):
        col = [w for w in ws if 0.20 * H < w[0] * sgn < 0.50 * H]
        if len(col) > 200:
            zs = [w[2] for w in col]
            xs = [w[0] for w in col]
            if max(zs) - min(zs) > 0.70 * H and max(xs) - min(xs) < 0.12 * H:
                staff_x[tag] = sum(xs) / len(xs)
                log(f"staff detected on {tag} at x={staff_x[tag]:+.3f}")

    def arm_joints(side):
        sx = x_sh if side == "L" else -x_sh
        sgn = 1 if side == "L" else -1
        sy = y_at(sx * 0.7, z_sh, 0.08) or y_at(0, z_sh, 0.12)
        shoulder = Vector((sx, sy, z_sh))

        def ok(w):
            if not (0.38 * H < w[2] < 0.88 * H):
                return False
            ax = abs(w[0])
            if ax < x_sh * 0.80 or ax > 0.45 * H:
                return False
            if (w[0] * sgn) <= 0:
                return False
            for tag, stx in staff_x.items():
                if tag == side and abs(w[0] - stx) < 0.06 * H and w[2] > 0.55 * H:
                    return False  # staff shaft, not arm
            return True

        armverts = [Vector(w) for w in ws if ok(w)]
        cands = [((v - shoulder).length, v) for v in armverts
                 if (v - shoulder).length < 0.60 * H]
        if len(cands) < 20:
            log(f"WARNING: few arm verts on {side} ({len(cands)}) -> fallback arm")
            wrist = shoulder + Vector((sgn * 0.03 * H, 0, -0.30 * H))
        else:
            wrist = max(cands, key=lambda t: t[0])[1]
        elbow = shoulder + (wrist - shoulder) * 0.45
        return {"shoulder": shoulder, "elbow": elbow, "wrist": wrist}

    arms = {"L": arm_joints("L"), "R": arm_joints("R")}

    # forward = -Y (model faces Blender -Y; --rot180 flips beforehand if needed)
    fwd = Vector((0, -1, 0))
    J = {
        "Hips": Vector((0, y_pelvis, 0.53 * H)),
        "Spine": Vector((0, y_sp, 0.60 * H)),
        "Spine1": Vector((0, y_sp1, 0.68 * H)),
        "Spine2": Vector((0, y_sp2, 0.76 * H)),
        "Neck": Vector((0, y_neck, 0.85 * H)),
        "Head": Vector((0, y_head, 0.925 * H)),
    }
    for side, sgn in (("L", 1), ("R", -1)):
        A = arms[side]
        G = legs[side]
        xsh_in = sgn * x_sh * 0.45
        J[f"{side}Shoulder".replace("L", "Left").replace("R", "Right")] = \
            Vector((xsh_in, y_sh, 0.81 * H))
        pfx = "Left" if side == "L" else "Right"
        J[f"{pfx}Arm"] = A["shoulder"]
        J[f"{pfx}ForeArm"] = A["elbow"]
        J[f"{pfx}Hand"] = A["wrist"]
        J[f"{pfx}UpLeg"] = G["hip"]
        J[f"{pfx}Leg"] = G["knee"]
        J[f"{pfx}Foot"] = G["ankle"]
        J[f"{pfx}ToeBase"] = G["ankle"] + fwd * 0.10 * H + Vector((0, 0, -0.045 * H))
    for k, v in J.items():
        log(f"joint {k:14s} ({v.x:+.3f}, {v.y:+.3f}, {v.z:+.3f})")
    return J, H

# ---------------------------------------------------------------------------
# Armature build — Mixamo local rest orientations + our joint positions
# ---------------------------------------------------------------------------

def load_mixamo_local(skel_json):
    with open(skel_json) as f:
        d = json.load(f)
    out = {}
    for b in d["bones"]:
        name = b["name"].split(":")[-1]
        # canonicalize: LeftArm stays LeftArm
        out[name] = Matrix(b["local"])
    return out


def build_armature(J, mix_local):
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm_obj = bpy.context.view_layer.objects.active
    arm = arm_obj.data
    arm.display_type = "OCTAHEDRAL"
    # remove default bone
    for eb in list(arm.edit_bones):
        arm.edit_bones.remove(eb)

    world = {}  # bone name -> armature-space rest matrix (built so far)
    ebs = {}
    # Build in dependency order (BONES list is already parent-first).
    for name in BONES:
        ml = mix_local.get(name)
        if ml is None:
            # try mixamorig-prefixed variants already stripped; fallback identity rot
            log(f"WARNING: no Mixamo local matrix for {name}; using identity rotation")
            ml = Matrix.Identity(4)
        head = J[name]
        parent = PARENT[name]
        if parent is None:
            rot = ml.to_3x3().to_4x4()
            wmat = Matrix.Translation(head) @ rot
        else:
            pw = world[parent]
            t_local = pw.inverted() @ head
            local = ml.copy()
            local.translation = t_local
            wmat = pw @ local
        eb = arm.edit_bones.new(name)
        eb.head = wmat.translation
        # length: distance to child joint along the bone, else fallback
        children = [c for c in BONES if PARENT[c] == name]
        if children:
            # longest child distance (keeps tail inside the limb)
            dist = max((J[c] - head).length for c in children)
            eb_len = max(dist, 0.02)
        else:
            eb_len = END_LENGTHS.get(name, 0.10)
        eb.matrix = wmat
        eb.length = eb_len
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = False
        world[name] = wmat
        ebs[name] = eb
        log(f"bone {name:14s} head=({head.x:+.3f},{head.y:+.3f},{head.z:+.3f}) len={eb.length:.3f}")
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def skin_mesh(obj, arm_obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.ops.object.select_all(action="DESELECT")
    unweighted = count_unweighted(obj)
    log(f"auto-skin: unweighted verts: {unweighted}/{len(obj.data.vertices)}")
    if unweighted > 0:
        # C-reported silent bug: armature_auto can return FINISHED weighting 0
        # verts. Fall back to envelope weighting.
        log("WARNING: empty auto-skin -> retrying with ARMATURE_ENVELOPE")
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        arm_obj.select_set(True)
        bpy.context.view_layer.objects.active = arm_obj
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        # strip auto-skin vertex groups before envelope pass
        obj.vertex_groups.clear()
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        arm_obj.select_set(True)
        bpy.context.view_layer.objects.active = arm_obj
        bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
        bpy.ops.object.select_all(action="DESELECT")
        unweighted = count_unweighted(obj)
        log(f"envelope-skin: unweighted verts: {unweighted}/{len(obj.data.vertices)}")
    ngroups = len(obj.vertex_groups)
    log(f"vertex groups: {ngroups}")
    return unweighted


def count_unweighted(obj):
    mesh = obj.data
    unweighted = 0
    for v in mesh.vertices:
        tot = 0.0
        for g in v.groups:
            tot += g.weight
        if tot <= 1e-6:
            unweighted += 1
    return unweighted


def export_glb(obj, arm_obj, out_path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    log(f"exported {out_path}")


def debug_render(J, out_png):
    # joint spheres + front camera, Cycles quick render
    for name, pos in J.items():
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.02, location=pos)
        s = bpy.context.view_layer.objects.active
        s.name = f"DBG_{name}"
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.film_transparent = False
    if not scene.world:
        scene.world = bpy.data.worlds.new("W")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.02, 0.02, 0.03, 1.0)
    bpy.ops.object.light_add(type="SUN", location=(2, -3, 4))
    bpy.ops.object.camera_add(location=(0, -4.2, 1.0))
    cam = bpy.context.view_layer.objects.active
    scene.camera = cam
    bpy.ops.object.empty_add(location=(0, 0, 0.9))
    tgt = bpy.context.view_layer.objects.active
    con = cam.constraints.new(type="TRACK_TO")
    con.target = tgt
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    log(f"debug render -> {out_png}")


def main():
    argv = sys.argv
    args = argv[argv.index("--") + 1:]
    in_glb, out_glb, skel_json = args[0], args[1], args[2]
    rot180 = "--rot180" in args
    debug_png = None
    if "--debug" in args:
        debug_png = args[args.index("--debug") + 1]
    global TARGET_TRIS, TARGET_HEIGHT
    if "--tris" in args:
        TARGET_TRIS = int(args[args.index("--tris") + 1])
    if "--height" in args:
        TARGET_HEIGHT = float(args[args.index("--height") + 1])
    log(f"targets: tris={TARGET_TRIS} height={TARGET_HEIGHT}")

    clear_scene()
    imported, meshes = import_glb(os.path.abspath(in_glb))
    # drop non-mesh imports (cameras/lights sometimes hitchhike)
    for o in imported:
        if o.type not in ("MESH",):
            bpy.data.objects.remove(o, do_unlink=True)
    obj = normalize_and_decimate(meshes, rot180)
    J, H = analyze_joints(obj)
    mix_local = load_mixamo_local(os.path.abspath(skel_json))
    arm_obj = build_armature(J, mix_local)
    unweighted = skin_mesh(obj, arm_obj)
    if debug_png:
        debug_render(J, os.path.abspath(debug_png))
    export_glb(obj, arm_obj, os.path.abspath(out_glb))
    log(f"DONE unweighted={unweighted}")


main()
