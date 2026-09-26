# Hero Art Spec — Batch A (art-rebuild)

Approved front-view reference images for the dark-fantasy hero rebuild of
Dungeon of the Covenant (Three.js r160). All images are single-character
front-view A-poses, arms slightly away from torso, feet fully visible,
near-black backgrounds, weapon held at the side (never crossing the torso).
All three approved on first generation — no regenerations needed.

## 1. mage.png — "Astral Archmage"

- File: `mage.png`
- Depicts: tall slender figure, flowing deep-violet robe with starfield
  shimmer, midnight-blue under-robe, ornate silver trim and silver star-circlet,
  faint glowing arcane rune tattoos on neck/arms, ornate staff held vertically
  at his right side topped with a floating violet crystal.
- Palette: violet, midnight blue, silver.
- Art notes for the Meshy operator: keep the robe silhouette slim and floor-length;
  the crystal must float slightly above the staff tip (do not merge it into the
  staff mesh). Glowing runes read as emissive decals, not geometry.
  Staff may need a second pass — acceptable to generate it as a separate prop
  if auto-rig fails on the merged mesh.

## 2. cleric.png — "Seraphic Valkyrie"

- File: `cleric.png`
- Depicts: tall female warrior, radiant ivory-and-gold plate armor over white
  vestments, faint golden halo ring glowing behind her head, golden
  feather-crested war-scepter held vertically at her right side,
  serene battle-ready expression.
- Palette: ivory, gold, warm white glow.
- Art notes for the Meshy operator: the halo is a glow effect — treat it as
  non-geometry (emissive sprite in-engine) so it does not become a solid torus
  in the mesh. Armor plates should read as crisp hard-surface; the scepter
  may be generated separately if the rig merge looks off.

## 3. necromancer.png — "Undead Lich-King"

- File: `necromancer.png`
- Depicts: towering gaunt figure, tattered black robes, bone ornaments and
  skull pauldrons, sickly green soul-glow from eye sockets and a swirling
  chest-cavity rift, gnarled staff held vertically at his left side,
  bare bony feet.
- Palette: black, bone white, spectral green.
- Art notes for the Meshy operator: the chest green swirl is an emissive
  volumetric effect, not a hole — do not cut a literal cavity through the mesh.
  The skull/bone ornaments are fine as surface detail; keep them shallow so
  weight-painting stays sane. Gaunt limbs mean thin geometry — check the rig
  joints, especially elbows/knees.

## Meshy settings (same for all three)

- Workflow: Image to 3D (upload the approved PNG as the sole reference)
- Credits: 20 credits per hero
- Auto-rig: ON (requirement)
- Skeleton: Mixamo-compatible humanoid rig
- Export: GLB
- Target height: ~1.75 m (mage/cleric); necromancer may stand ~1.9 m — keep
  proportions, do not squash to 1.75 if the ref reads taller
- Texture quality: default/textured output; PBR maps expected

## Credit budget note

Meshy free tier allows roughly 5 textured models per month. This batch is
3 heroes; batch B's 3 = 6 total, which EXCEEDS the monthly free allowance.
Flag for the user before running the Meshy batch: expect credits to run out
after ~5 models. Fallbacks: split batches across two calendar months,
or run overflow models through Tripo (300 free credits/mo per ai-3d-generation
skill) or a Hugging Face open model (TRELLIS / TripoSR, free but untextured —
needs a texture pass). Do NOT spend money without explicit user approval.
