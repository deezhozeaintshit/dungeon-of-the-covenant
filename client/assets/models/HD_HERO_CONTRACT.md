# HD Hero Model Contract — Dungeon of the Covenant

**Status:** integration path BUILT and proven with a synthetic rig
(`client/js/hdHeroes.js`, flag `HD_HEROES_ENABLED = false`). Flip the flag
only when real `hero_<class>_hd.glb` files land in this directory and pass
the checklist below.

This is the exact spec every HD hero model must satisfy. The game's clip
pipeline (`client/js/animation/MixamoRig.js`) retargets the real Mixamo FBX
clips onto these models by **canonical bone-name matching**, so the skeleton
is the contract — get the bones right and the 14 animation states work for
free.

## File layout

```
client/assets/models/
  hero_juggernaut_hd.glb
  hero_cleric_hd.glb
  hero_rogue_hd.glb
  hero_mage_hd.glb
  hero_ranger_hd.glb
  hero_necromancer_hd.glb
```

Only these 6 base classes get new models. Vault classes reuse base-family
models (see "Vault-class reuse" below).

## Hard requirements

| # | Rule | Why |
|---|------|-----|
| 1 | **GLB** (binary glTF 2.0), embedded (`.glb`, not `.gltf` + sidecars) | single-file deploy, matches every other model in this dir |
| 2 | **+Y up**, origin at the **feet** (sole contact plane at y = 0) | the game plants the model on the dungeon floor and offsets levitate from the root |
| 3 | **Forward = +Z** (face, chest, toes point at +Z) | attack lunges, facing slerp, and camera framing all assume local +Z forward |
| 4 | Height **1.7–1.9 m** at bind pose (juggernaut **~2.0 m**) | class presence scaling (`HD_CLASS_SCALES`) is applied on top by the game |
| 5 | **One `SkinnedMesh`** preferred; one `THREE.Skeleton` in the scene | `detectRig()` takes the SKINNED path only when it finds a real skeleton — no skeleton, no Mixamo clips |
| 6 | **Mixamo bone names** (below), `mixamorig`-prefixed or plain | `canonicalBoneName()` strips the `mixamorig` prefix and namespaces, so `mixamorigLeftArm` and `LeftArm` both match |
| 7 | **≤ 30k triangles** total | perf budget — 8 heroes on screen in co-op |
| 8 | Textures **≤ 1024 px**, **JPEG**, embedded in the GLB | keeps each hero GLB in the low single-digit MB range |
| 9 | **No Draco** compression | the client ships no Draco decoder; Draco GLBs fail to load |
| 10 | **≤ 3 materials** per model | draw-call budget; cosmetic skins retint by material class |

## Required bones

Author the skeleton in **bind pose** (T-pose or relaxed A-pose — either is
fine, the clips carry their own pose). Every bone in this list must exist
with the exact name (case-insensitive match after `mixamorig`-strip):

```
Hips
Spine, Spine1, Spine2
Neck, Head
LeftShoulder,  LeftArm,  LeftForeArm,  LeftHand
RightShoulder, RightArm, RightForeArm, RightHand
LeftUpLeg,  LeftLeg,  LeftFoot
RightUpLeg, RightLeg, RightFoot
```

Optional but recommended: `LeftHandThumb*` / finger chains and `LeftToeBase`
/ `RightToeBase` — finger/toe tracks in the Mixamo clips will use them when
present and are dropped harmlessly when absent. Do NOT invent extra spine/
limb bones with non-Mixamo names; unmapped tracks are dropped, and a renamed
`Hips` breaks every clip (hips carry the root-motion position track).

Parent chain must be a real hierarchy: `Hips → Spine → Spine1 → Spine2 →
Neck → Head`, arms under `Spine2`, legs under `Hips`. All vertices need
`skinIndex`/`skinWeight`; bind the mesh with `bind(skeleton)` after the
bones are in the mesh's graph.

## What the game does with the model (do NOT bake these in)

- **Class scale** — `group.scale` is set per class (juggernaut
  1.45/1.36/1.45, cleric 1.18/1.28/1.18, rogue 1.15/1.12/1.15, mage
  1.22/1.30/1.22, ranger 1.20/1.26/1.20, necromancer 1.26/1.35/1.26).
  Author all six at the SAME base height; presence differences come from the
  scale, not the model.
- **Levitate** — cleric (+0.34) and necromancer (+0.18) hover; the game
  offsets the model root. Author them feet-at-origin like everyone else.
- **Weapons / class props** — bake the signature weapon INTO the model
  (the procedural weapon meshes are not mounted on the HD path). Keep any
  weapon rigid: skin it 100% to the hand bone.
- **Ground ring, nameplate, overhead HP bar, cosmetic auras** — added by the
  game on top of the group. Keep the head-top clear of geometry above ~2.1 m
  (bar sprite sits at y ≈ 3.4 in group space).

## Animation contract

The 14 shipped Mixamo clips (`hero_idle/walk/run/attack/hit/death/cast/jump`,
plus `hero_rogue_attack`, `hero_mage_cast`, `hero_juggernaut_idle`,
`hero_juggernaut_jump`, and the two alternates) are retargeted at load onto
whatever skeleton `detectRig()` finds. Position tracks are made relative to
the first keyframe and auto-scaled by the hips-height ratio, so a model at
1.75 m vs a clip authored at 1.80 m just works. Planar root motion is
stripped (the game moves the group); vertical bob is kept.

Missing states fall back to procedural skinned poses automatically — a model
with a valid skeleton is never unanimated.

## Vault-class reuse mapping (explicit follow-up)

Vault classes do NOT get unique models in this pass. When the HD path is
enabled, map them onto the base-family model:

| Vault class | Reuses HD model of | Notes |
|-------------|--------------------|-------|
| plaguecaller | **necromancer** | same blessing tree family; green/necrotic trim reads correctly |
| gravewarden  | **juggernaut**  | tank family; scale sells the warden fantasy |
| hexblade     | **rogue**       | striker family; lean silhouette fits |

Implementation is a 3-line map in `hdHeroes.js` (`VAULT_HD_MODEL_MAP`) at
flag-flip time — not wired yet because the flag is off.

## Acceptance checklist (run before flipping the flag)

1. `tools/render_turntable.py` renders front / 3-4 / side / back cleanly —
   feet on the ground plane, no clipping, face toward camera in front view.
2. `node --loader ./tests/perf-bench-loader.mjs tests/hd-heroes-smoke.mjs`
   passes with the REAL `hero_<class>_hd.glb` parsed as the mount source
   (swap the synthetic rig for the real file in the test harness).
3. `detectRig()` on the mounted group returns `RIG_SKINNED` for all 6.
4. Tri count, texture size, and material count verified per model
   (`tests/perf-benchmark.mjs` section E audits the budget headless).
5. In-game: local + remote hero, all 14 states play, hit flash + death fade
   work, cosmetic skin retint doesn't throw.
