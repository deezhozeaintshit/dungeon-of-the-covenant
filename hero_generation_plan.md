# Phase 1: Generate Hero Character (AAA Quality 3D)

## Step 1: Generate Hero Concept Art (2D Reference)
Using game-asset-mcp to create visual reference for the hero.

### Prompt for Hero Concept
```
AAA quality game character concept art - dark fantasy mage named Aetherion, the Void Walker. Slender humanoid figure with flowing dark robes that transform into cosmic energy at the edges. Glowing violet eyes, arcane symbols on pale skin. Holding ornate staff with floating crystal orb. Dark cosmic background with purple and violet energy effects. Ethereal particles surrounding the figure. Front view, full body shot. Professional game art style, highly detailed, 4K resolution, unreal engine 5 style.
```

### Expected Output
- Hero concept image (2D reference)
- Color palette extraction
- Style guide for 3D modeling

---

## Step 2: Generate Hero 3D Model
Using game-asset-mcp for 3D generation.

### Prompt for Hero Body
```
AAA quality 3D game character model - Aetherion the Void Walker, dark fantasy mage. Slender humanoid figure with flowing dark robes, ethereal cosmic energy at edges, glowing violet eyes, arcane symbols on skin. Game-ready rig, 50000 polygons, PBR materials, front view, side view, back view. Include blendshapes for facial expressions.
```

### Output Files
- hero_body.glb
- hero_body_lod1.glb
- hero_body_lod2.glb
- hero_body_lod3.glb
- hero_body.fbx (for Blender import)

---

## Step 3: Generate Hero Textures
Using game-asset-mcp for texture generation.

### Texture Prompts
```
Hero texture set - dark fantasy mage Albedo map, 4K resolution, PBR materials. Purple and black color scheme with ethereal glow effects. Detailed fabric textures, skin subsurface scattering, arcane symbol patterns.
```

```
Hero Normal map - 4K resolution, tangent space, detailed fabric wrinkles and skin details.
```

```
Hero Roughness map - 2K resolution, varying reflectivity for different materials.
```

```
Hero Emission map - 2K resolution, glowing parts (eyes, symbols, energy effects).
```

---

## Step 4: Generate Hero Animations
Using Blender MCP or game-asset-mcp for animation data.

### Animation List
1. **Idle** - 3 variants (breathing, energy pulse)
2. **Walk** - Forward, backward, strafe left, strafe right
3. **Run** - Sprint with energy trail
4. **Jump** - Start, apex, land
5. **Attack Light** - 3-hit combo
6. **Attack Heavy** - Charged strike
7. **Magic Cast** - Fireball, Frost, Lightning variants
8. **Dash** - 8 directions with afterimage
9. **Hurt** - Back, front hit reactions
10. **Death** - Dissipate into void

---

## Execution Plan

### Tool Used: game-asset-mcp
**Tools Available:**
- `generate_2d_asset` - For concept art and textures
- `generate_3d_asset` - For 3D models

### Workflow
1. Generate concept art (2D)
2. Extract color palette
3. Generate 3D model (GLB format)
4. Generate texture maps
5. Create animation rig (FBX)
6. Export to Blender for refinement

---

## Success Criteria
- [ ] Hero concept art generated (2D)
- [ ] Hero 3D model generated (GLB/FBX)
- [ ] Texture sets generated (Albedo, Normal, Roughness, Emission)
- [ ] Basic animations created (Idle, Walk, Attack, Death)
- [ ] All assets exported in game-ready format

---

## Next Steps After Hero
1. Generate enemy assets (Void Minion, Shadow Knight, etc.)
2. Create environment assets (Void Hollow)
3. Generate UI assets
4. Import all into Summer Engine
