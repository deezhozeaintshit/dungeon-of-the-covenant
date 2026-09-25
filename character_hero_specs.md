# AAA Quality 3D Character Asset - Hero

## Character Concept
**Name:** Aetherion, the Void Walker
**Role:** Mage/Assassin Hybrid
**Theme:** Cosmic/Necromantic
**Style:** Dark fantasy with ethereal accents

## Required Assets

### 1. 3D Model
- **Format:** GLB/OBJ (with embedded textures)
- **Polygons:** 50,000-100,000 for hero
- **LODs:** 4 levels (High, Medium, Low, Very Low)
- **Tangents:** Yes
- **Bone Count:** 32-48 bones for full rig

### 2. Texture Sets (PBR)
- **Albedo/Diffuse:** 4K resolution
- **Normal Map:** 4K (tangent space)
- **Roughness Map:** 2K
- **Metallic Map:** 2K
- **Ambient Occlusion:** 2K
- **Emission Map:** 2K (for glow effects)
- **Curvature Map:** 1K (optional)

### 3. Animations (Blendshapes + Rig)
**Base Animations (15 total):**
1. Idle (3 variants)
2. Walk (forward, backward, strafe)
3. Run (sprint)
4. Jump (start, apex, land)
5. Fall (crouch on landing)
6. Attack Light (3 hits)
7. Attack Heavy (charged)
8. Magic Cast (3 types)
9. Dash/Dodge (8 directions)
10. Hurt (back, front)
11. Death (3 variants)
12. Victory/Emote
13. Taunt

**Blendshapes (Morph Targets):**
- Facial expressions (5)
- Mouth shapes (speech)
- Body weight shifts

### 4. VFX Elements
- Attack trails
- Magic particles
- Footstep dust
- Death explosion

---

## Asset List to Generate

| Asset | Type | Priority |
|-------|------|----------|
| Hero Body | 3D Model | High |
| Hero Armor Set 1 | 3D Model | High |
| Hero Armor Set 2 | 3D Model | Medium |
| Hero Weapon (Staff) | 3D Model | High |
| Hero Weapon (Dual Daggers) | 3D Model | Medium |
| Hero Head/Face | 3D Model | High |
| All Textures | Texture Set | High |
| All Animations | Animation | High |
| VFX Pack | Particle | Medium |

---

## Generation Prompts

### Hero Body
```
AAA quality 3D character model of a dark fantasy mage with ethereal void powers. Slender humanoid figure with flowing dark robes that transform into cosmic energy at the edges. Glowing violet eyes and arcane symbols on skin. Wearing ornate staff with floating crystal. Subtle particle effects around hands. Dark fantasy art style, highly detailed, 4K textures, PBR materials, studio lighting, game-ready rig, full body shot, front view.
```

### Hero Face
```
Close-up portrait of a dark fantasy character with glowing violet eyes, pale skin with subtle arcane markings, flowing black hair with purple highlights. Ethereal expression, detailed facial features, subsurface scattering on skin, volumetric lighting, 8K portrait, game-ready normal map baking, Unreal Engine 5 style.
```

### Hero Armor Set 1
```
Dark fantasy mage armor set - ornate robes with silver trim, floating geometric patterns, ethereal glow effects. Full body armor with cape, gauntlets, boots. Intricate detail, PBR materials, subsurface scattering on fabric, game-ready LODs, orthographic views (front, back, side).
```

### Hero Weapon - Staff
```
Epic fantasy staff - twisted dark wood core wrapped in silver chains, floating crystal orb at top emitting purple energy, rune carvings along shaft, particle effects around crystal. High detail, PBR materials, front view, side view, top-down view.
```

### Hero Weapon - Dual Daggers
```
Pair of curved daggers - obsidian blades with purple energy edges, dark leather wraps on handles, silver pendants, ethereal glow. Matched pair shown together, high detail, PBR materials, orthographic views.
```

---

## File Organization
```
Assets/
├── Characters/
│   ├── Hero/
│   │   ├── Meshes/
│   │   │   ├── hero_body.glb
│   │   │   ├── hero_body_lod1.glb
│   │   │   ├── hero_body_lod2.glb
│   │   │   └── hero_body_lod3.glb
│   │   ├── Materials/
│   │   │   ├── hero_albedo.png
│   │   │   ├── hero_normal.png
│   │   │   ├── hero_roughness.png
│   │   │   ├── hero_metallic.png
│   │   │   └── hero_emission.png
│   │   └── Animations/
│   │       ├── idle.fbx
│   │       ├── walk.fbx
│   │       └── ...
├── Enemies/
├── Environment/
├── UI/
└── VFX/
```
