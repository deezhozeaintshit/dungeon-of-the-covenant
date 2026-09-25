import bpy
import math
import os

out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "client", "assets", "models"))
os.makedirs(out_dir, exist_ok=True)

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def make_pbr_mat(name, base_color, metallic=0.8, roughness=0.25, emission=(0,0,0,1), emission_strength=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emission
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat

# 1. Generate Covenant Obelisk GLB
clear_scene()
stone_mat = make_pbr_mat("ObsidianStone", (0.12, 0.11, 0.16, 1.0), metallic=0.35, roughness=0.55)
rune_mat = make_pbr_mat("GoldRune", (0.95, 0.72, 0.22, 1.0), metallic=0.95, roughness=0.15, emission=(1.0, 0.55, 0.1, 1.0), emission_strength=3.5)

bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.85, radius2=0.45, depth=3.8, location=(0, 0, 1.9))
obelisk = bpy.context.active_object
obelisk.name = "ObeliskBody"
obelisk.data.materials.append(stone_mat)

bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.45, radius2=0.02, depth=0.95, location=(0, 0, 4.275))
tip = bpy.context.active_object
tip.name = "ObeliskApex"
tip.data.materials.append(rune_mat)

bpy.ops.mesh.primitive_torus_add(major_radius=0.95, minor_radius=0.08, location=(0, 0, 2.4))
ring = bpy.context.active_object
ring.name = "FloatingRuneRing"
ring.data.materials.append(rune_mat)

bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "covenant_obelisk.glb"), export_format='GLB')

# 2. Generate Mythic Reliquary Chest GLB
clear_scene()
iron_mat = make_pbr_mat("DarkIron", (0.18, 0.19, 0.22, 1.0), metallic=0.9, roughness=0.3)
gold_mat = make_pbr_mat("SovereignGold", (0.96, 0.78, 0.24, 1.0), metallic=0.98, roughness=0.15, emission=(0.95, 0.65, 0.12, 1.0), emission_strength=1.8)
gem_mat = make_pbr_mat("VoidGem", (0.65, 0.15, 0.98, 1.0), metallic=0.2, roughness=0.1, emission=(0.75, 0.2, 1.0, 1.0), emission_strength=5.0)

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.4))
base = bpy.context.active_object
base.scale = (1.35, 0.85, 0.75)
base.data.materials.append(iron_mat)

bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.425, depth=1.35, location=(0, 0, 0.8), rotation=(0, math.pi/2, 0))
lid = bpy.context.active_object
lid.data.materials.append(gold_mat)

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.22, location=(0, 0.45, 0.65))
gem = bpy.context.active_object
gem.data.materials.append(gem_mat)

bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "mythic_chest.glb"), export_format='GLB')

# 3. Generate Soul Altar GLB
clear_scene()
stone_mat = make_pbr_mat("ObsidianStoneAltar", (0.12, 0.11, 0.16, 1.0), metallic=0.35, roughness=0.55)
blood_mat = make_pbr_mat("CrimsonCore", (0.9, 0.08, 0.18, 1.0), metallic=0.2, roughness=0.15, emission=(1.0, 0.1, 0.25, 1.0), emission_strength=6.0)
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.6, depth=0.45, location=(0, 0, 0.225))
pedestal = bpy.context.active_object
pedestal.data.materials.append(stone_mat)

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.58, location=(0, 0, 1.55))
orb = bpy.context.active_object
orb.data.materials.append(blood_mat)

bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "soul_altar.glb"), export_format='GLB')
print("BLENDER_GLB_EXPORT_COMPLETE:", out_dir)
