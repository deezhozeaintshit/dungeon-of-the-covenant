# AAA Quality Environment & Level Assets

## Environment Type 1: Void Hollow (Main Hub)
**Theme:** Dark cosmic dungeon
**Purpose:** Tutorial area, starting zone

### Required Assets

#### Terrain
- **Ground Plane:** 100m x 100m tiles
- **Height Variation:** Rocky terrain with depressions
- **Textures:** Dark stone, crystalline formations, void energy pools

**Prompts:**
```
AAA quality game environment - void hollow terrain, dark crystalline cave system with purple and violet glowing veins in walls, floating dark stones, ethereal fog on ground, cosmic horror atmosphere, game-ready, 4K textures, PBR materials, modular tile set, seamless tiling.
```

#### Structures
- **Archways:** 3 variants (collapsed, intact, energy barriers)
- **Platforms:** Floating platforms at various heights
- **Stairs:** Crystal formation stairs
- **Bridges:** Energy bridges (translucent purple)

**Prompts:**
```
AAA quality game architecture - void hollow archway, dark stone structure with purple crystal inlays, floating particles, ethereal energy flowing through cracks, modular game asset, 4K textures, PBR materials, front view, side view.
```

#### Props
- **Chests:** 3 variants (wooden, stone, crystal)
- **Barrels/Crates:** 5 variants
- **Torch/Light Sources:** Floating void orbs
- **Decorations:** Crystal clusters, bones, ancient runes

#### Interactive Elements
- **Switches:** Rune-activated
- **Doors:** Sliding crystal doors
- **Levers:** Energy levers
- **Buttons:** Pressure plates

---

## Environment Type 2: Shadow Forest (Zone 1)
**Theme:** Corrupted forest
**Purpose:** Early game exploration

### Required Assets

#### Terrain
- **Ground:** Mossy earth, broken roots
- **Vegetation:** Dead trees with purple leaves, glowing mushrooms
- **Water:** Toxic purple puddles

**Prompts:**
```
AAA quality game environment - shadow forest, corrupted woodland with dead twisted trees, purple glowing mushrooms on ground, ethereal fog between trees, toxic purple pools of water, dark fantasy atmosphere, game-ready, 4K textures, PBR materials, modular tile set, seamless tiling.
```

#### Trees
- **Dead Tree:** 3 variants (broken, standing, fallen)
- **Purple Tree:** Glowing leaves, ethereal bark
- **Spooky Bush:** 4 variants

**Prompts:**
```
AAA quality game prop - corrupted tree from shadow forest, twisted black bark with purple glowing veins, sparse purple leaves, ethereal particles around branches, dark fantasy style, game-ready, 4K textures, PBR materials, front view, top-down view.
```

#### Ground Cover
- **Mushrooms:** 5 variants (glowing, regular, poisonous)
- **Grass Patches:** Dead and corrupted variants
- **Rocks:** Mossy and cracked variants
- **Flowers:** Dark purple nightshade flowers

---

## Environment Type 3: Crystal Caverns (Zone 2)
**Theme:** Underground crystal caves
**Purpose:** Mid-game dungeon

### Required Assets

#### Terrain
- **Cave Walls:** Crystal formations, stalactites, stalagmites
- **Floor:** Smooth crystal surfaces, crystal dust
- **Ceiling:** Hanging crystal clusters

**Prompts:**
```
AAA quality game environment - crystal caverns, underground cave with massive purple and blue crystal formations, glowing crystal veins in walls, reflective crystal floor, ethereal light refraction, dark fantasy underground, game-ready, 4K textures, PBR materials, modular tile set, seamless tiling.
```

#### Crystals
- **Large Crystals:** 4 sizes
- **Crystal Clusters:** 3 variants
- **Crystal Beams:** Vertical light pillars
- **Broken Crystals:** Debris pieces

#### Hazards
- **Crystal Spikes:** Sharp formations
- **Energy Pools:** Hazardous purple liquid
- **Falling Crystals:** Dynamic hazards

---

## Environment Type 4: Void Throne Room (Boss Arena)
**Theme:** Epic boss chamber
**Purpose:** Major boss fight

### Required Assets

#### Arena Floor
- **Main Platform:** Circular raised platform
- **Energy Ring:** Rotating purple energy circle
- **Corners:** 4 crystal pillars with light beams

**Prompts:**
```
AAA quality game environment - void throne room boss arena, circular raised platform with glowing purple energy ring, four massive crystal pillars with light beams, dark cosmic background with swirling void, epic boss fight arena, game-ready, 4K textures, PBR materials, top-down view.
```

#### Background
- **Sky:** Swirling void with purple clouds
- **Stars:** Distant cosmic stars
- **Particles:** Floating void energy

#### Environmental Effects
- **Lightning:** Purple energy bolts
- **Particles:** Void energy swirls
- **Fog:** Ground-level ethereal fog

---

## Environment Type 5: Necropolis (Zone 3)
**Theme:** Ancient graveyard/city of dead
**Purpose:** Late-game exploration

### Required Assets

#### Structures
- **Tombstones:** 6 variants (weathered, cracked, intact)
- **Sarcophagi:** 3 variants
- **Ruined Buildings:** Partially collapsed structures
- **Gates:** Ancient entrance gates

**Prompts:**
```
AAA quality game environment - necropolis graveyard, ancient dead city with weathered tombstones, crumbling sarcophagi, ruined gothic buildings, green necrotic fog, bone decorations, dark fantasy undead theme, game-ready, 4K textures, PBR materials, modular tile set, seamless tiling.
```

#### Ground
- **Grave Plots:** 4 variants
- **Cracked Earth:** Dry, dead soil
- **Bone Paths:** Scatter of bones

#### Props
- **Tombstones:** With/without crosses, cracked, toppled
- **Vases/Jars:** Ancient burial items
- **Skeletons:** 3 variants (partial, full, decorative)
- **Candles:** Flickering green flames

---

## Modular Asset System

### Tile Sizes
- **Floor Tiles:** 2m x 2m
- **Wall Sections:** 2m x 3m
- **Corner Pieces:** 2m x 2m (45-degree)
- **Ramp Pieces:** 2m x 2m (slope variants)

### LOD System
- **LOD0:** Full detail (0-50m)
- **LOD1:** Medium detail (50-100m)
- **LOD2:** Low detail (100-200m)
- **LOD3:** Very low (200m+)

### Texture Atlases
- Combine similar materials to reduce draw calls
- **Terrain Atlas:** 2048x2048
- **Building Atlas:** 1024x1024
- **Prop Atlas:** 1024x1024

---

## Asset Generation Checklist

| Environment | Terrain | Structures | Props | Hazards | Status |
|-------------|---------|------------|-------|---------|--------|
| Void Hollow | [ ] | [ ] | [ ] | [ ] | Pending |
| Shadow Forest | [ ] | [ ] | [ ] | [ ] | Pending |
| Crystal Caverns | [ ] | [ ] | [ ] | [ ] | Pending |
| Throne Room | [ ] | [ ] | [ ] | [ ] | Pending |
| Necropolis | [ ] | [ ] | [ ] | [ ] | Pending |

---

## Lighting Requirements

### Global Lighting
- **Ambient:** Low, purple-tinted
- **Main Light:** Moon/void light (blue-purple)
- **Rim Light:** Subtle edge glow on characters

### Point Lights
- Crystal glows (purple, blue)
- Energy pools (purple)
- Torch/orb lights (flickering)

### Volumetric Effects
- Fog layers
- Particle systems
- Light shafts

---

## Performance Targets

### Draw Calls
- < 200 per scene
- < 500 for boss arenas

### Polygon Count
- Terrain: < 500k triangles
- Props: < 10k each
- Characters: < 150k (boss)

### Texture Memory
- < 200MB total
- 4K max for hero assets
- 2K for environment
