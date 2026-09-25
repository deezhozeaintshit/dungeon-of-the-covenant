# HD Enemy/Boss Model Contract — Dungeon of the Covenant

**Status:** integration path BUILT and proven with synthetic rigs
(`client/js/hdEnemies.js`, flag `HD_ENEMIES_ENABLED = false`). Flip the flag
only when real `enemy_<type>_hd.glb` / `boss_<key>_hd.glb` files land in this
directory and pass the checklist below.

This is the exact spec every HD enemy/boss model must satisfy. The game's clip
pipeline (`client/js/animation/MixamoRig.js`) retargets Mixamo FBX clips onto
these models by **canonical bone-name matching** (`canonicalBoneName()` strips
the `mixamorig` prefix, namespaces, and separators — `mixamorigLeftArm` and
`LeftArm` both match), so the skeleton is the contract — get the bones right
and the animation states work for free.

## What the client actually receives (verified 2026-09-25)

`server/game/Room.js spawnMob()` calls `Archetypes.buildMobStats(type, …)`,
which resolves legacy ids through `LEGACY_TYPE_MAP` and stores the
**canonical** id on `mob.type`. The state broadcast sends the mob objects
directly, so `m.type` in `createMobMesh` is ALWAYS one of the canonical ids —
never the legacy names. (`crypt_ghoul` → `rot_hound`, `bone_archer` →
`cultist_archer`; the client's legacy branches are dead code.)

`server/game/enemies/BossPhases.js` broadcasts `boss.biomeId` (always one of
`crypt | cavern | forge | throne_room`) with the name/title from `BOSS_TABLE`.

## m.type → model file mapping (all paths relative to client/assets/models/)

| Client `m.type` | Display name | HD model file | Clip prefix | Notes |
|---|---|---|---|---|
| `skel_warrior` | Skeleton Warrior | `enemy_skel_warrior_hd.glb` | `enemy_skeleton_warrior` | canonical id; clip prefix differs (see below) |
| `cultist_archer` | Cultist Archer | `enemy_cultist_archer_hd.glb` | `enemy_cultist_archer` | |
| `rot_hound` | Rot Hound | `enemy_rot_hound_hd.glb` | — (none) | QUADRUPED — custom simple rig, procedural only |
| `blight_necrolyte` | Blight Necrolyte | `enemy_blight_necrolyte_hd.glb` | `enemy_blight_necrolyte` | caster: also binds `cast` |
| `void_assassin` | Void Assassin | `enemy_void_assassin_hd.glb` | `enemy_void_assassin` | |
| `elite_executioner` | Vorgath, Bone-Executioner | `enemy_elite_executioner_hd.glb` | `enemy_elite_executioner` | mini-boss |
| `elite_lich` | Arch-Lich Malthor | `enemy_elite_lich_hd.glb` | `enemy_elite_lich` | mini-boss, caster: also binds `cast` |
| `cinder_thrall` | Cinder Thrall | — (kept as-is) | — | already mounts real `cinder_thrall.glb`; NOT covered by this contract |

### boss → biome mapping (`bossData.biomeId` → boss file)

| `biomeId` (bossKey) | Boss name | HD model file | Clip prefix |
|---|---|---|---|
| `crypt` | Veylith, the Ossuary Matriarch | `boss_crypt_hd.glb` | `boss_veylith` |
| `cavern` | Glacius, Warden of the Rime | `boss_cavern_hd.glb` | `boss_glacius` |
| `forge` | Malakor, Soul-Forge Warden | `boss_forge_hd.glb` | `boss_malakor` |
| `throne_room` | The Covenant Sovereign | `boss_throne_room_hd.glb` | `boss_sovereign` |

Clip files follow the standard convention: `<prefix>_<state>.fbx`
(e.g. `enemy_skeleton_warrior_attack.fbx`, `boss_sovereign_cast.fbx`), dropped
next to the GLBs. States: `idle walk run attack hit death` (+ `cast` for
blight_necrolyte, elite_lich, and bosses). Missing states stay procedural —
by design.

## Hard requirements (all tiers)

| # | Rule | Why |
|---|------|-----|
| 1 | **GLB** (binary glTF 2.0), embedded (`.glb`, not `.gltf` + sidecars) | single-file deploy, matches every other model in this dir |
| 2 | **+Y up**, origin at the **feet** (sole contact plane at y = 0; quadruped: paw contact plane at y = 0) | the game plants the model on the dungeon floor |
| 3 | **Forward = +Z** (face, chest, toes point at +Z) | facing slerp and attack lunges assume local +Z forward |
| 4 | **One `SkinnedMesh`**, **one `THREE.Skeleton`** in the scene | `detectRig()` takes the SKINNED path only when it finds a real skeleton — no skeleton, no Mixamo clips |
| 5 | **Mixamo bone names** (required list below), `mixamorig`-prefixed or plain | bone→bone retarget by canonical name |
| 6 | Textures **≤ 1024 px**, **JPEG**, embedded in the GLB | keeps each GLB in the low single-digit MB range |
| 7 | **No Draco** compression | the client ships no Draco decoder; Draco GLBs fail to load |
| 8 | **≤ 4 materials** per model | draw-call budget; mobs spawn in packs |

## Tier budgets & heights

The game applies two runtime scales on top of the authored model:
**server `modelScale`** (inner root: 1.0 regulars, 1.25 mini-bosses, 0.72 rot_hound —
comes from `Archetypes.js`, authoritative) and the **group presence scale**
(1.22 regulars, 1.68 executioner, 1.64 lich, 1.35 bosses — identical to the
procedural path). Author at the **bind-pose authored height** below so the
final in-game height lands on the target:

| Tier | Types | Tris | Authored bind-pose height | Final in-game height |
|---|---|---|---|---|
| Regulars | skel_warrior, cultist_archer, void_assassin, blight_necrolyte | ≤ 15k | **1.30–1.50 m** | ~1.6–1.8 m (×1.22) |
| Rot Hound | rot_hound | ≤ 15k | **shoulder 1.20–1.30 m** | ~1.1 m shoulder (×0.72×1.22) |
| Mini-bosses | elite_executioner, elite_lich | ≤ 30k | **1.05–1.12 m** | ~2.2–2.3 m (×1.25×1.68 / ×1.25×1.64) |
| Biome bosses | all four | ≤ 30k | **1.75–2.05 m** | ~2.4–2.8 m (×1.35) |

## Required bones (bipeds — verified against retargetClip)

`retargetClip()` maps **every** clip track by canonical bone name
(`collectSkinnedBoneMap` + `findTargetBoneName` with trailing-digit fallback:
`spine1` ↔ `spine`). Tracks whose bone is absent from the model are dropped
harmlessly — but a missing `Hips` breaks every clip, because hips carry the
root-motion position track. Author the skeleton in **bind pose** (T-pose or
relaxed A-pose; clips carry their own pose). Every bone in this list must
exist (case-insensitive after `mixamorig`-strip):

```
Hips
Spine, Spine1, Spine2
Neck, Head
LeftShoulder,  LeftArm,  LeftForeArm,  LeftHand
RightShoulder, RightArm, RightForeArm, RightHand
LeftUpLeg,  LeftLeg,  LeftFoot
RightUpLeg, RightLeg, RightFoot
```

Optional but recommended: `LeftHandThumb*` / finger chains and `LeftToeBase` /
`RightToeBase` — finger/toe tracks in the Mixamo clips use them when present
and are dropped harmlessly when absent. Do NOT invent extra spine/limb bones
with non-Mixamo names; unmapped tracks are dropped, and a renamed `Hips`
breaks root motion.

Parent chain must be a real hierarchy: `Hips → Spine → Spine1 → Spine2 →
Neck → Head`, arms under `Spine2`, legs under `Hips`. All vertices need
`skinIndex`/`skinWeight`; bind the mesh with `bind(skeleton)` after the bones
are in the mesh's graph.

## Rot Hound — quadruped custom rig (no Mixamo clips)

Mixamo's library is biped-only, so **no FBX clips will ever be delivered for
rot_hound**. Author a custom simple quadruped rig (spine chain, four legs with
upper/lower/foot, neck, head, tail optional) with a real `THREE.Skeleton` —
`detectRig()` still takes the SKINNED path (a skeleton is a skeleton), and the
**procedural driver owns all of its animation** (`_bindMobClipSet` skips
rot_hound entirely). Keep the skeleton shallow (≤ 16 bones) and the mesh
≤ 15k tris; feet/paw contact plane at y = 0.

## What the game does with the model (do NOT bake these in)

- **Threat ring** — the group-level type-colored ground ring (and the batched
  ringBatcher path) is set up by `createMobMesh` BEFORE the HD mount; the
  model must not include its own ring.
- **Nameplate** — `createOverheadBar` attaches the hostile health bar +
  name; bosses use the banner UI instead (no boss overhead bar, same as the
  procedural colossus).
- **Blob shadow / PBR / rim light** — `finalizeCharacterGroup` handles it.
- **Death** — mobs: pooled death burst + removal via `syncMobs`; bosses: the
  death crater ring (`userData.deathCrater`, toggled by `syncBoss`) and the
  tip-over + fade driven through `userData.bodyGroup`.
- **Biome tint** — `BIOME_VARIANTS` tint is a client reskin hint; the HD
  models ship un-tinted (one model serves all four biomes).
- **Weapons / signature props** — bake the signature weapon INTO the model
  (executioner's guillotine axe, archer's bow, necrolyte's censer). There is
  no separate weapon group to attach.
- **Telegraphs** — slam/volley telegraphs anchor at the group origin; keep
  the model's bulk roughly centered on the vertical axis.

## Flag-flip checklist

1. All `enemy_<type>_hd.glb` + `boss_<key>_hd.glb` files in this directory,
   passing rules 1–8 above.
2. `tests/hd-enemies-smoke.mjs` green (retargets the real FBX clips onto a
   synthetic enemy rig and reports mapped/dropped per clip).
3. In-game spot check per type: spawn, walk, attack, hit flash, death —
   no clipping through the floor, no T-pose stuck states.
4. Only then set `HD_ENEMIES_ENABLED = true` in `client/js/hdEnemies.js`.
