import bpy
import math
import os

OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "client", "assets", "models"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def make_mat(name, base_color, metallic=0.2, roughness=0.5, emission_color=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emission_color and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission_color, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat

def add_part(prim_fn, loc, scale, rot=(0,0,0), mat=None, **kwargs):
    prim_fn(location=loc, **kwargs)
    obj = bpy.context.active_object
    obj.scale = scale
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if mat:
        obj.data.materials.append(mat)
    return obj

def export_glb(filename):
    path = os.path.join(OUTPUT_DIR, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False)
    print(f"[Blender 5.2] Exported AAA GLB: {path}")

def build_humanoid_base(armor_mat, trim_mat, skin_mat, cape_mat=None, scale_factor=1.0):
    # Boots & Greaves
    for sx in (-0.22, 0.22):
        add_part(bpy.ops.mesh.primitive_cylinder_add, (sx*scale_factor, 0, 0.42*scale_factor), (0.14*scale_factor, 0.14*scale_factor, 0.42*scale_factor), mat=armor_mat, vertices=12)
        add_part(bpy.ops.mesh.primitive_cube_add, (sx*scale_factor, -0.08*scale_factor, 0.12*scale_factor), (0.15*scale_factor, 0.24*scale_factor, 0.12*scale_factor), mat=trim_mat)
    # Torso Cuirass
    add_part(bpy.ops.mesh.primitive_cone_add, (0, 0, 1.18*scale_factor), (0.44*scale_factor, 0.28*scale_factor, 0.48*scale_factor), rot=(math.pi, 0, 0), mat=armor_mat, vertices=14, radius1=1.0, radius2=0.72)
    # Belt & Tassets
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0, 0, 0.82*scale_factor), (0.36*scale_factor, 0.26*scale_factor, 0.08*scale_factor), mat=trim_mat, vertices=14)
    # Pauldrons (Shoulders)
    for sx in (-0.48, 0.48):
        add_part(bpy.ops.mesh.primitive_uv_sphere_add, (sx*scale_factor, 0, 1.48*scale_factor), (0.22*scale_factor, 0.20*scale_factor, 0.18*scale_factor), mat=trim_mat, segments=14, ring_count=10)
        # Arms
        add_part(bpy.ops.mesh.primitive_cylinder_add, (sx*1.05*scale_factor, -0.06*scale_factor, 1.16*scale_factor), (0.11*scale_factor, 0.11*scale_factor, 0.32*scale_factor), rot=(0.25, 0, 0), mat=armor_mat, vertices=10)
    # Head
    add_part(bpy.ops.mesh.primitive_uv_sphere_add, (0, 0, 1.82*scale_factor), (0.22*scale_factor, 0.22*scale_factor, 0.25*scale_factor), mat=skin_mat, segments=16, ring_count=12)
    # Cape
    if cape_mat:
        add_part(bpy.ops.mesh.primitive_cube_add, (0, 0.26*scale_factor, 1.05*scale_factor), (0.42*scale_factor, 0.04*scale_factor, 0.56*scale_factor), rot=(0.14, 0, 0), mat=cape_mat)

def build_heroes():
    # 1. Juggernaut
    clear_scene()
    steel = make_mat("ObsidianSteel", (0.16, 0.19, 0.26), metallic=0.92, roughness=0.25)
    gold = make_mat("TitanGold", (0.90, 0.68, 0.20), metallic=0.95, roughness=0.22, emission_color=(0.3, 0.18, 0.02), emission_strength=0.4)
    visor = make_mat("FireVisor", (1.0, 0.4, 0.05), emission_color=(1.0, 0.45, 0.05), emission_strength=4.5)
    cape = make_mat("RoyalCape", (0.45, 0.08, 0.08), roughness=0.7)
    build_humanoid_base(steel, gold, steel, cape, scale_factor=1.12)
    # Horned Greathelm + Visor
    add_part(bpy.ops.mesh.primitive_cube_add, (0, -0.19, 2.02), (0.16, 0.05, 0.04), mat=visor)
    for sx in (-0.22, 0.22):
        add_part(bpy.ops.mesh.primitive_cone_add, (sx, -0.05, 2.18), (0.07, 0.07, 0.25), rot=(-0.3, sx*0.8, 0), mat=gold, vertices=10)
    # Tower Shield (Left)
    add_part(bpy.ops.mesh.primitive_cube_add, (-0.64, -0.22, 1.15), (0.08, 0.42, 0.62), rot=(0, 0, 0.2), mat=steel)
    add_part(bpy.ops.mesh.primitive_cube_add, (-0.68, -0.22, 1.15), (0.04, 0.28, 0.48), rot=(0, 0, 0.2), mat=gold)
    # Seismic War-Hammer (Right)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0.62, -0.28, 1.25), (0.04, 0.04, 0.72), rot=(0.4, 0, 0), mat=gold, vertices=10)
    add_part(bpy.ops.mesh.primitive_cube_add, (0.62, -0.52, 1.75), (0.28, 0.16, 0.18), rot=(0.4, 0, 0), mat=steel)
    export_glb("hero_juggernaut.glb")

    # 2. Cleric
    clear_scene()
    ivory = make_mat("SeraphIvory", (0.92, 0.90, 0.84), metallic=0.35, roughness=0.3)
    sun_gold = make_mat("SunGold", (1.0, 0.82, 0.25), metallic=0.95, roughness=0.18, emission_color=(0.5, 0.35, 0.05), emission_strength=0.8)
    holy_glow = make_mat("HolyGlow", (1.0, 0.95, 0.55), emission_color=(1.0, 0.92, 0.45), emission_strength=5.5)
    build_humanoid_base(ivory, sun_gold, ivory, sun_gold, scale_factor=1.0)
    # Floating Halo Ring behind head
    add_part(bpy.ops.mesh.primitive_torus_add, (0, 0.12, 2.05), (0.34, 0.34, 0.34), rot=(math.pi/2, 0, 0), mat=holy_glow, major_radius=1.0, minor_radius=0.08)
    # Luminary Sun-Staff
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0.52, -0.22, 1.25), (0.035, 0.035, 0.95), mat=sun_gold, vertices=10)
    add_part(bpy.ops.mesh.primitive_ico_sphere_add, (0.52, -0.22, 2.22), (0.20, 0.20, 0.20), mat=holy_glow, subdivisions=2)
    export_glb("hero_cleric.glb")

    # 3. Rogue
    clear_scene()
    leather = make_mat("NightLeather", (0.10, 0.08, 0.14), metallic=0.3, roughness=0.45)
    crimson = make_mat("BloodTrim", (0.75, 0.08, 0.18), metallic=0.6, roughness=0.3, emission_color=(0.6, 0.02, 0.1), emission_strength=1.2)
    venom = make_mat("VenomBlade", (0.15, 1.0, 0.45), metallic=0.85, roughness=0.15, emission_color=(0.1, 0.95, 0.35), emission_strength=4.2)
    build_humanoid_base(leather, crimson, leather, leather, scale_factor=0.96)
    # Twin Daggers
    for sx in (-0.56, 0.56):
        add_part(bpy.ops.mesh.primitive_cone_add, (sx, -0.42, 1.12), (0.05, 0.12, 0.38), rot=(-1.2, 0, 0), mat=venom, vertices=6)
    export_glb("hero_rogue.glb")

    # 4. Mage
    clear_scene()
    robe = make_mat("ArcaneRobe", (0.12, 0.22, 0.52), metallic=0.4, roughness=0.35)
    fire_gold = make_mat("PyroGold", (1.0, 0.55, 0.12), metallic=0.9, roughness=0.2, emission_color=(1.0, 0.4, 0.05), emission_strength=1.5)
    hellfire = make_mat("HellfireOrb", (1.0, 0.35, 0.02), emission_color=(1.0, 0.38, 0.02), emission_strength=6.0)
    build_humanoid_base(robe, fire_gold, robe, fire_gold, scale_factor=0.98)
    # Floating Hellfire Orb + Staff
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0.54, -0.20, 1.25), (0.035, 0.035, 0.90), mat=fire_gold, vertices=10)
    add_part(bpy.ops.mesh.primitive_ico_sphere_add, (0.54, -0.20, 2.22), (0.22, 0.22, 0.22), mat=hellfire, subdivisions=2)
    add_part(bpy.ops.mesh.primitive_ico_sphere_add, (-0.54, -0.28, 1.48), (0.15, 0.15, 0.15), mat=hellfire, subdivisions=2)
    export_glb("hero_mage.glb")

    # 5. Ranger
    clear_scene()
    emerald = make_mat("RangerEmerald", (0.12, 0.38, 0.22), metallic=0.35, roughness=0.4)
    bronze = make_mat("HunterBronze", (0.78, 0.56, 0.24), metallic=0.85, roughness=0.28)
    arrow_glow = make_mat("WindGlow", (0.35, 1.0, 0.65), emission_color=(0.3, 1.0, 0.6), emission_strength=4.0)
    build_humanoid_base(emerald, bronze, emerald, emerald, scale_factor=0.98)
    # Recurve Longbow + Quiver
    add_part(bpy.ops.mesh.primitive_torus_add, (-0.55, -0.32, 1.28), (0.12, 0.42, 0.55), rot=(0, math.pi/2, 0), mat=bronze, major_radius=1.0, minor_radius=0.08)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0.20, 0.24, 1.45), (0.09, 0.09, 0.36), rot=(0.2, -0.3, 0), mat=bronze, vertices=10)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0.0, -0.45, 1.28), (0.02, 0.02, 0.45), rot=(math.pi/2, 0, 0), mat=arrow_glow, vertices=8)
    export_glb("hero_ranger.glb")

    # 6. Necromancer
    clear_scene()
    lich_plate = make_mat("NecroVestment", (0.14, 0.06, 0.22), metallic=0.5, roughness=0.35)
    bone = make_mat("AncientBone", (0.85, 0.82, 0.72), metallic=0.15, roughness=0.55)
    soul_green = make_mat("NecroticSoul", (0.15, 1.0, 0.58), emission_color=(0.12, 1.0, 0.55), emission_strength=5.5)
    build_humanoid_base(lich_plate, bone, bone, lich_plate, scale_factor=1.02)
    # Soul-Scythe
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0.56, -0.22, 1.32), (0.038, 0.038, 1.05), mat=bone, vertices=10)
    add_part(bpy.ops.mesh.primitive_cone_add, (0.56, -0.62, 2.25), (0.06, 0.48, 0.16), rot=(1.35, 0, 0), mat=soul_green, vertices=8)
    export_glb("hero_necromancer.glb")

def build_enemies_and_boss():
    # 1. Skeleton Warrior
    clear_scene()
    bone = make_mat("SkelBone", (0.82, 0.78, 0.68), metallic=0.1, roughness=0.6)
    iron = make_mat("RustIron", (0.25, 0.26, 0.30), metallic=0.85, roughness=0.4)
    red_eye = make_mat("UndeadEye", (1.0, 0.15, 0.15), emission_color=(1.0, 0.1, 0.1), emission_strength=4.5)
    build_humanoid_base(iron, bone, bone, None, scale_factor=0.95)
    add_part(bpy.ops.mesh.primitive_cube_add, (0, -0.18, 1.76), (0.12, 0.04, 0.04), mat=red_eye)
    add_part(bpy.ops.mesh.primitive_cube_add, (0.54, -0.35, 1.20), (0.04, 0.16, 0.48), rot=(0.5, 0, 0), mat=iron)
    export_glb("enemy_skeleton_warrior.glb")

    # 2. Cultist Archer
    clear_scene()
    cult_robe = make_mat("CultCrimson", (0.48, 0.06, 0.12), metallic=0.25, roughness=0.55)
    dark_gold = make_mat("CultBrass", (0.72, 0.52, 0.18), metallic=0.85, roughness=0.3)
    sigil = make_mat("BloodSigil", (1.0, 0.2, 0.35), emission_color=(1.0, 0.15, 0.3), emission_strength=4.5)
    build_humanoid_base(cult_robe, dark_gold, cult_robe, cult_robe, scale_factor=0.94)
    add_part(bpy.ops.mesh.primitive_torus_add, (0, -0.36, 1.22), (0.26, 0.26, 0.08), mat=sigil, major_radius=1.0, minor_radius=0.1)
    export_glb("enemy_cultist_archer.glb")

    # 3. Void Assassin
    clear_scene()
    void_body = make_mat("VoidArmor", (0.08, 0.04, 0.16), metallic=0.75, roughness=0.2)
    void_glow = make_mat("VoidEdge", (0.72, 0.18, 1.0), emission_color=(0.72, 0.15, 1.0), emission_strength=5.5)
    build_humanoid_base(void_body, void_glow, void_body, void_body, scale_factor=0.98)
    for sx in (-0.58, 0.58):
        add_part(bpy.ops.mesh.primitive_cone_add, (sx, -0.45, 1.18), (0.05, 0.18, 0.45), rot=(-1.2, 0, 0), mat=void_glow, vertices=8)
    export_glb("enemy_void_assassin.glb")

    # 4. Blight Necrolyte
    clear_scene()
    blight_robe = make_mat("BlightRobe", (0.10, 0.26, 0.16), metallic=0.3, roughness=0.5)
    toxic = make_mat("ToxicGlow", (0.20, 1.0, 0.42), emission_color=(0.15, 1.0, 0.38), emission_strength=5.2)
    build_humanoid_base(blight_robe, toxic, blight_robe, blight_robe, scale_factor=0.98)
    add_part(bpy.ops.mesh.primitive_ico_sphere_add, (0.52, -0.32, 1.75), (0.22, 0.22, 0.22), mat=toxic, subdivisions=2)
    export_glb("enemy_blight_necrolyte.glb")

    # 5. Elite Executioner
    clear_scene()
    exec_steel = make_mat("ExecBlackSteel", (0.14, 0.12, 0.15), metallic=0.92, roughness=0.25)
    gore = make_mat("GoreCrimson", (0.95, 0.12, 0.15), emission_color=(0.9, 0.08, 0.1), emission_strength=4.2)
    build_humanoid_base(exec_steel, gore, exec_steel, gore, scale_factor=1.35)
    # Giant Executioner Greataxe
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0.78, -0.28, 1.55), (0.06, 0.06, 1.25), rot=(0.3, 0, 0), mat=exec_steel, vertices=10)
    add_part(bpy.ops.mesh.primitive_cube_add, (0.78, -0.62, 2.35), (0.12, 0.55, 0.45), rot=(0.3, 0, 0), mat=gore)
    export_glb("enemy_elite_executioner.glb")

    # 6. Elite Lich
    clear_scene()
    lich_robe = make_mat("ArchLichRobe", (0.18, 0.06, 0.32), metallic=0.6, roughness=0.25)
    arcane = make_mat("ArcanePurple", (0.65, 0.25, 1.0), emission_color=(0.65, 0.22, 1.0), emission_strength=6.0)
    build_humanoid_base(lich_robe, arcane, lich_robe, arcane, scale_factor=1.25)
    add_part(bpy.ops.mesh.primitive_torus_add, (0, 0, 2.45), (0.45, 0.45, 0.45), rot=(math.pi/2, 0, 0), mat=arcane, major_radius=1.0, minor_radius=0.09)
    export_glb("enemy_elite_lich.glb")

    # 7. Colossal Multi-Winged Boss Sovereign
    clear_scene()
    boss_armor = make_mat("SovereignObsidian", (0.12, 0.08, 0.16), metallic=0.95, roughness=0.20)
    molten = make_mat("MoltenCore", (1.0, 0.35, 0.05), emission_color=(1.0, 0.32, 0.02), emission_strength=6.5)
    gold_crown = make_mat("SovereignCrown", (0.95, 0.75, 0.22), metallic=0.96, roughness=0.18)
    build_humanoid_base(boss_armor, gold_crown, boss_armor, molten, scale_factor=1.65)
    # Colossal Great-Wings
    for sx in (-1.0, 1.0):
        add_part(bpy.ops.mesh.primitive_cone_add, (sx*1.15, 0.35, 2.25), (0.85, 0.12, 1.45), rot=(0.25, sx*0.65, 0), mat=molten, vertices=6)
        add_part(bpy.ops.mesh.primitive_cone_add, (sx*0.42, -0.08, 3.35), (0.14, 0.14, 0.55), rot=(-0.2, sx*0.5, 0), mat=gold_crown, vertices=10)
    # Runed Sovereign Greatsword
    add_part(bpy.ops.mesh.primitive_cube_add, (1.05, -0.55, 1.95), (0.12, 0.28, 1.45), rot=(0.45, 0, 0), mat=molten)
    export_glb("boss_sovereign.glb")

def build_level_design_props():
    # 1. Gothic Pillar Brazier
    clear_scene()
    stone = make_mat("CathedralStone", (0.22, 0.19, 0.28), metallic=0.18, roughness=0.72)
    iron = make_mat("CageIron", (0.18, 0.18, 0.22), metallic=0.88, roughness=0.35)
    ember = make_mat("EmberFire", (1.0, 0.48, 0.05), emission_color=(1.0, 0.45, 0.02), emission_strength=6.0)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0, 0, 0.25), (0.95, 0.95, 0.25), mat=stone, vertices=12)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0, 0, 2.40), (0.65, 0.65, 2.15), mat=stone, vertices=12)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0, 0, 4.65), (0.88, 0.88, 0.22), mat=iron, vertices=12)
    add_part(bpy.ops.mesh.primitive_ico_sphere_add, (0, 0, 5.05), (0.48, 0.48, 0.48), mat=ember, subdivisions=2)
    export_glb("gothic_pillar_brazier.glb")

    # 2. Arcane Portal Gate
    clear_scene()
    arch_stone = make_mat("PortalObsidian", (0.16, 0.14, 0.24), metallic=0.45, roughness=0.45)
    rift = make_mat("DimensionalRift", (0.35, 0.75, 1.0), emission_color=(0.28, 0.72, 1.0), emission_strength=6.5)
    for sx in (-1.35, 1.35):
        add_part(bpy.ops.mesh.primitive_cube_add, (sx, 0, 1.85), (0.32, 0.38, 1.85), mat=arch_stone)
    add_part(bpy.ops.mesh.primitive_torus_add, (0, 0, 2.25), (1.38, 0.35, 1.65), rot=(math.pi/2, 0, 0), mat=arch_stone, major_radius=1.0, minor_radius=0.18)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0, 0, 1.95), (1.15, 1.45, 0.06), rot=(math.pi/2, 0, 0), mat=rift, vertices=24)
    export_glb("arcane_portal_gate.glb")

    # 3. Bone Reliquary Throne
    clear_scene()
    bone_mat = make_mat("ReliquaryBone", (0.78, 0.74, 0.64), metallic=0.15, roughness=0.58)
    blood_mat = make_mat("BloodChalice", (0.95, 0.08, 0.18), emission_color=(0.95, 0.05, 0.15), emission_strength=5.0)
    add_part(bpy.ops.mesh.primitive_cylinder_add, (0, 0, 0.25), (1.35, 1.35, 0.25), mat=bone_mat, vertices=10)
    add_part(bpy.ops.mesh.primitive_cube_add, (0, 0.25, 1.45), (0.85, 0.28, 1.25), mat=bone_mat)
    add_part(bpy.ops.mesh.primitive_ico_sphere_add, (0, -0.25, 1.15), (0.32, 0.32, 0.32), mat=blood_mat, subdivisions=2)
    export_glb("bone_reliquary_throne.glb")

    # 4. Cursed Sarcophagus
    clear_scene()
    sarc_stone = make_mat("SarcophagusStone", (0.20, 0.18, 0.25), metallic=0.35, roughness=0.55)
    rune_chain = make_mat("RuneChain", (0.15, 1.0, 0.68), emission_color=(0.12, 1.0, 0.65), emission_strength=5.2)
    add_part(bpy.ops.mesh.primitive_cube_add, (0, 0, 0.48), (0.75, 1.45, 0.48), mat=sarc_stone)
    add_part(bpy.ops.mesh.primitive_torus_add, (0, 0, 0.55), (0.82, 1.15, 0.25), mat=rune_chain, major_radius=1.0, minor_radius=0.07)
    export_glb("cursed_sarcophagus.glb")

if __name__ == "__main__":
    build_heroes()
    build_enemies_and_boss()
    build_level_design_props()
    print("ALL 17 AAA BLENDER 5.2 GLB MODELS GENERATED SUCCESSFULLY!")
