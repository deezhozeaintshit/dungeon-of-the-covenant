# Hero Art Spec — Batch B (art-rebuild)

Approved front-view reference images for the dark-fantasy hero rebuild of
Dungeon of the Covenant (Three.js r160). All images are single-character
front-view A-poses, arms slightly away from torso, feet fully visible,
near-black backgrounds, weapons held at the side (never crossing the torso).
All three approved on first generation — no regenerations needed.

## 1. juggernaut.png — "Colossal Dreadnought"

- File: `juggernaut.png`
- Depicts: massive hulking warrior in heavy blackened-steel plate armor,
  glowing ember-orange cracks between the armor plates across the entire
  body, ash-gray war-scarred pauldrons and gauntlets, brutal helm with a
  T-slit visor, enormous greatsword planted point-down at his right side.
- Palette: blackened steel, ember orange, ash gray.
- Art notes for the Meshy operator: juggernaut is the largest and bulkiest
  hero — keep his mass; do NOT normalize him down to 1.7 m. The ember
  cracks read as emissive decals, not geometry — no need to cut real gaps
  between plates. The greatsword is held in the reference; if auto-rig merges
  it awkwardly, generate the sword as a separate prop and parent it to the
  hand bone in-engine.

## 2. ranger.png — "Elven Beastmaster"

- File: `ranger.png`
- Depicts: lithe elven archer, weathered brown leather armor with fur trim
  and carved leaf motifs, hooded green cloak falling behind her shoulders,
  quiver of arrows on her back, longbow held vertically at her right side,
  bone charms and beadwork, keen alert expression, long ears.
- Palette: forest green, brown leather, bone.
- Art notes for the Meshy operator: target height ~1.7 m. The quiver is on
  her back — keep it as surface-attached geometry but shallow so shoulder
  joints rig cleanly. The longbow at her side may be generated separately if
  the rig merge looks off. Fur trim should read as short texture/fur-shell
  detail, not spikes.

## 3. rogue.png — "Phantom Shinobi"

- File: `rogue.png`
- Depicts: agile masked figure in dark form-fitting black leather with
  purple arcane stitching tracing the limbs, hood up with a face wrap
  showing only sharp glowing violet eyes, two curved daggers held low at
  his sides, low ready stance with feet planted.
- Palette: black, deep purple, steel.
- Art notes for the Meshy operator: target height ~1.7 m. The purple
  stitching is an emissive/glow decal pattern, not raised geometry —
  keep the leather silhouette smooth. The daggers are held in the reference;
  if auto-rig struggles, split them out as separate props parented to the
  hand bones. Face wrap keeps the mouth covered — the head mesh should stay
  closed (no open jaw geometry under the wrap).

## Meshy settings (same for all three)

- Workflow: Image to 3D (upload the approved PNG as the sole reference)
- Credits: 20 credits per hero
- Auto-rig: ON (requirement)
- Skeleton: Mixamo-compatible humanoid rig
- Export: GLB
- Target height: juggernaut ~2.0 m (bulky, do not shrink); ranger/rogue ~1.7 m
- Texture quality: default/textured output; PBR maps expected

## Credit budget note

Meshy free tier allows roughly 5 textured models per month. This batch is
3 heroes; batch A's 3 = 6 total, which EXCEEDS the monthly free allowance.
Flag for the user before running the Meshy batch: expect credits to run out
after ~5 models (juggernaut should be prioritized in the first month since
his silhouette is the most likely to need a retry pass). Fallbacks: split
batches across two calendar months, or run overflow models through Tripo
(300 free credits/mo per ai-3d-generation skill) or a Hugging Face open
model (TRELLIS / TripoSR, free but untextured — needs a texture pass).
Do NOT spend money without explicit user approval.
