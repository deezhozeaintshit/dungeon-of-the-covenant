# Phase 2: Create Void Hollow Tutorial Level

## Step 1: Generate Terrain Assets
Using game-asset-mcp for terrain textures and geometry.

### Terrain Prompt
```
AAA quality game terrain - Void Hollow cave floor, dark crystalline ground with purple energy veins, floating stone platforms, ethereal fog on ground. Modular tile set, seamless tiling, 4K textures, PBR materials, game-ready.
```

### Output
- terrain_tile_01.png (Albedo)
- terrain_tile_01_normal.png
- terrain_tile_01_roughness.png
- terrain_tile_02.png (variation)
- terrain_tile_03.png (variation)

---

## Step 2: Generate Crystal Formations
Using game-asset-mcp for environment props.

### Crystal Prompts
```
AAA quality game prop - large purple crystal formation, glowing energy inside, jagged crystalline structure, ethereal particles, dark fantasy style, game-ready, 4K textures, PBR materials.
```

```
AAA quality game prop - floating crystal platform, dark stone base with purple crystal accents, glowing energy core, game-ready asset.
```

---

## Step 3: Generate Architectural Elements
Using game-asset-mcp for modular pieces.

### Archway Prompts
```
AAA quality game architecture - void hollow archway, dark stone structure with purple crystal inlays, ethereal energy flowing through cracks, modular game asset, 4K textures, PBR materials.
```

```
AAA quality game architecture - broken stone pillar with crystal growth, dark fantasy dungeon prop, game-ready.
```

---

## Step 4: Generate Props and Decorations
Using game-asset-mcp for small props.

### Prop Prompts
```
AAA quality game prop - ancient chest with purple crystal locks, dark fantasy dungeon loot container, game-ready, 4K textures, PBR materials.
```

```
AAA quality game prop - floating void orb, ethereal purple energy sphere, dark fantasy lighting prop, game-ready.
```

```
AAA quality game prop - crystal cluster decoration, purple glowing crystals, dark cave environment, game-ready.
```

---

## Step 5: Create Level Layout
Using Summer Engine MCP to build the level.

### Level Design
```
Create a circular arena (20m radius) with:
- Raised platform in center
- 4 crystal pillars at cardinal points
- Energy ring around platform edge
- Spawn points for tutorial enemies
- Tutorial NPC position
- Exit portal location
```

### Tutorial Flow
1. Player spawns at entrance
2. Tutorial guide appears
3. First enemy spawns (Void Minion)
4. Player learns basic combat
5. Boss arena revealed
6. Exit to next area

---

## Execution Plan

### Tools Used:
1. **game-asset-mcp** - Generate terrain, crystals, props
2. **Summer Engine MCP** - Build level, place assets
3. **Blender MCP** - Refine complex geometry

### Workflow
1. Generate all terrain tiles
2. Generate crystal formations (3 sizes)
3. Generate architectural pieces (archways, pillars)
4. Generate props (chests, orbs, decorations)
5. Import all into Summer Engine
6. Build level layout
7. Add lighting and VFX
8. Test in-engine

---

## Success Criteria
- [ ] Terrain tiles generated (seamless tiling)
- [ ] Crystal formations generated (3 sizes)
- [ ] Architectural pieces generated (archways, pillars)
- [ ] Props generated (chests, orbs, decorations)
- [ ] Level built in Summer Engine
- [ ] Tutorial flow implemented
- [ ] Lighting and atmosphere set
- [ ] Performance optimized

---

## Asset Count
- Terrain tiles: 6 variants
- Crystal formations: 9 variants (3 sizes × 3 types)
- Architectural pieces: 12 variants
- Props: 15 variants
- Total: ~42 unique assets

---

## Next Steps After Void Hollow
1. Create Shadow Forest zone
2. Create Crystal Caverns zone
3. Design boss arena
4. Build Necropolis zone
