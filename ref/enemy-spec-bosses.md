# Boss Art Spec — Boss-Tier Enemies (art-rebuild)

Approved front-view reference images for the boss-tier enemy rebuild of
Dungeon of the Covenant (Three.js r160). All images are single-character
front-view A-poses: standing straight, arms slightly away from torso,
feet fully visible and grounded, weapons held at the side (never crossing
the torso), plain near-black backgrounds. Bosses read MASSIVE and
threatening next to the heroes — heights below are target in-engine scale.
All six approved on first generation — no regenerations needed.

## 1. boss_elite_executioner.png — "Vorgath, Bone-Executioner" (mini-boss)

- File: `boss_elite_executioner.png`
- Depicts: towering crimson executioner in blood-dark plate armor draped
  with bone trophies (ribcage breastplate, skulls on shoulders and belt),
  heavy chains across the chest, horned helm, colossal greataxe lowered at
  his right side, embers drifting off the armor.
- Target height: ~2.3 m, bulky.
- Palette: blood-dark red plate, bone white, black leather, ember orange.
- Art notes for the Meshy operator: keep the bulk — do NOT normalize him
  down to hero scale. The greataxe is held at his side; if auto-rig fuses it
  awkwardly, generate it as a separate prop and parent it to the hand bone
  in-engine. Embers are atmospheric — bake as part of the texture/mood,
  not floating geometry.

## 2. boss_elite_lich.png — "Arch-Lich Malthor" (mini-boss)

- File: `boss_elite_lich.png`
- Depicts: towering frost-lich sovereign, gaunt and regal; tattered ice-blue
  robes over an exposed arcane bone-structure body; great wings of jagged
  ice spread behind him; three small phylactery crystals floating around
  him (separate floating crystals, not attached); frost-covered staff held
  upright at his left side.
- Target height: ~2.2 m, gaunt and regal.
- Palette: arcane bone white, ice blue, frost-covered robe gray-blue.
- Art notes for the Meshy operator: the three phylactery crystals ORBIT
  in-game — if auto-rig fuses them to the body, generate them as separate
  small props and animate the orbit in-engine. Wings read as jagged ice
  sheets; keep them as silhouette geometry, but do NOT rig them as arms —
  they attach at the shoulder blades. Staff may be split out as a separate
  prop if the rig merge looks off.

## 3. boss_veylith.png — "Veylith, the Ossuary Matriarch" (crypt biome boss)

- File: `boss_veylith.png`
- Depicts: colossal skeletal matriarch, tall crown of fused bones and
  antlers, tattered regal burial shroud, elongated clawed fingers, ribs
  formed like a cathedral cage with faint blue soul-fire glowing inside
  the ribcage.
- Target height: ~2.6 m.
- Palette: aged bone, shroud black/gray, soul-fire blue.
- Art notes for the Meshy operator: the soul-fire inside the ribcage is
  an emissive texture detail (with a point light added in-engine), NOT
  geometry — do not model flames inside the chest. Keep fingers elongated
  but articulated; hands need clean finger joints for the claw swipe
  animation. The shroud is draped surface geometry — keep it shallow
  around the torso so the rig stays clean.

## 4. boss_glacius.png — "Glacius, Warden of the Rime" (cavern biome boss)

- File: `boss_glacius.png`
- Depicts: hulking warden of living glacier ice, massive plates of
  blue-white ice over dark stone flesh, enormous frost greatmace held low
  at his right side, blizzard mist curling off the body, ice crown of
  jagged spikes.
- Target height: ~2.6 m, broad.
- Palette: blue-white ice, dark stone gray-black, frost white.
- Art notes for the Meshy operator: the broadest boss after Malakor — keep
  his width; do not narrow the shoulders. The greatmace is held at his
  side; split out as a separate prop if auto-rig fuses it. Mist is
  atmosphere — bake into texture/mood or add in-engine, not geometry.
  Ice plates should read as chunky layered armor, not spikes that collide
  during the swing animation.

## 5. boss_malakor.png — "Malakor, Soul-Forge Warden" (forge biome boss)

- File: `boss_malakor.png`
- Depicts: molten colossus, bronze-obsidian armor plates with glowing
  magma veins between them, crown of forge-horns, gigantic forge hammer
  wreathed in flame held low at his right side.
- Target height: ~2.8 m, the largest boss in the game.
- Palette: bronze, obsidian black, magma orange-red.
- Art notes for the Meshy operator: the magma veins are EMISSIVE TEXTURE
  detail, not geometry — no need to cut gaps between plates. He is the
  single largest model in the rebuild; preserve his scale above all other
  bosses. The flaming hammer should be generated as a separate prop if the
  auto-rig merge looks off, parented to the hand bone in-engine.

## 6. boss_sovereign.png — "The Covenant Sovereign" (throne room final boss)

- File: `boss_sovereign.png`
- Depicts: regal astral entity, ornate gold-and-void robes that dissolve
  into a starfield at the edges, a broken crown FLOATING above his head
  (separate floating piece, not attached), tall rift-staff topped with a
  miniature swirling portal, serene and terrifying expression.
- Target height: ~2.4 m.
- Palette: gold filigree, void black, cosmic purple/blue starfield.
- Art notes for the Meshy operator: the broken crown FLOATS above the head
  in-game — if auto-rig fuses it to the skull, generate it as a separate
  small prop and animate the hover in-engine. The starfield robe edges are
  a dissolve/transparency texture effect — bake as texture detail (with
  emissive sparkle), not wispy geometry that will rig badly. The portal
  atop the staff is a separate VFX element added in-engine (shader/plane),
  not part of the model. Staff may be split out as a separate prop.

## Meshy settings (same for all six)

- Workflow: Image to 3D (upload the approved PNG as the sole reference)
- Credits: 20 credits per boss
- Auto-rig: ON (requirement)
- Skeleton: Mixamo-compatible humanoid rig
- Export: GLB

## Poly / texture budgets (boss-tier)

- Bosses: <=30k triangles per model (they are the largest on-screen
  presence; give them the headroom — do not over-decimate to hero budgets).
- Textures: <=1024px per texture map (albedo/roughness/normal/emissive).
- Emissive-heavy bosses (Malakor magma veins, Veylith soul-fire, Malthor
  ice glow, Sovereign starfield) should keep a dedicated emissive map;
  the glow sells the boss tier more than extra geometry does.

## CREDIT WARNING

This round is now 6 heroes + 11 enemies = 17 models against a Meshy free
tier of roughly 5 textured models per MONTH. Do NOT assume credits exist.
The user must approve a staggered plan before ANY 3D generation runs:

1. Staggered months: ~5 models/month over 4 months (prioritize: Malakor,
   Veylith, Sovereign, then mini-bosses, then the rest).
2. Tripo (300 free credits/month per the ai-3d-generation skill) for
   overflow models.
3. Hugging Face open models (TRELLIS / TripoSR — free, untextured, needs
   a texture pass) for geometry drafts.

Do NOT spend money without explicit user approval. No 3D generation was
run in this task — reference art and spec only.
