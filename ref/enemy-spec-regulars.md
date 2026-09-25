# Enemy Reference Spec — Regulars (Meshy Image-to-3D + Auto-Rig)

Scope: 5 regular enemy types for Dungeon of the Covenant (Three.js r160).
Reference art: front-view 2D PNGs in `~/workspace/rpg-crawler-game/art-work/ref/`.
Pipeline: Meshy Image to 3D (textured) -> auto-rig (Mixamo-compatible skeleton) -> GLB export.
Target heights: humanoid regulars ~1.6-1.8m; hound ~1.1m at shoulder.
Poly budget: ≤15k tris per regular. Texture budget: ≤1024px per regular.

> ## CREDIT WARNING — READ FIRST
> This art round covers 6 heroes + 11 enemies = **17 models** against a Meshy free
> tier of roughly **5 textured models/month** (Image to 3D at ~20 credits each).
> Do NOT assume credits exist when you sit down to generate.
> **The user must approve one of these before any 3D generation runs:**
> 1. Staggered plan — 5 models now, rest drip across multiple months.
> 2. Tripo (300 free credits/mo) for the overflow batch.
> 3. Hugging Face open models (TRELLIS / TripoSR / Hunyuan3D-2.1, MIT) for the overflow.
> Heroes first or enemies first is the user's call. No 3D work starts without his approval.

## Shared Meshy settings (all regulars)
- Mode: Image to 3D (textured), ~20 credits per model
- Auto-rig: **ON**
- Skeleton: Mixamo-compatible (so Mixamo combat/strafe clips apply)
- Export: GLB
- Reference input: the PNG listed per enemy below (front view, near-black bg)

---

### 1. skel_warrior — "Skeleton Warrior"
- PNG: `enemy_skel_warrior.png`
- Ref shows: animated skeleton, rusted plate fragments (pauldrons, chest plate, greaves),
  notched arming sword held point-down in the right hand at the side, cracked round
  shield strapped to the left arm, pale-blue soul-glow in eye sockets and ribcage,
  mid-lunge neutral stance, feet fully visible.
- Meshy notes: Keep the glow emissive — eye sockets and ribcage core read as
  emissive material, not texture. Thin bones (phalanges, ribs) are fragile at 15k
  tris; let the mesher prioritize skull/spine/pelvis. Sword and shield at the sides
  are rig-friendly as long as limbs stay away from the torso.

### 2. cultist_archer — "Cultist Archer"
- PNG: `enemy_cultist_archer.png`
- Ref shows: hooded human cultist, beaked plague mask in deep hood shadow, dark
  crimson-black layered robes, recurve bow held vertically at his side, quiver of
  black-fletched arrows on the back, neutral front stance.
- Meshy notes: Heavy cloth robes need clean skirt separation from the legs or the
  leg bones will pull the robe. Bow held vertically at the side is fine as long as
  Meshy does not fuse it to the torso. The mask/head is one rigid piece — ideal for
  the head bone.

### 3. rot_hound — "Rot Hound" (QUADRUPED)
- PNG: **MISSING — generation failed on the image pipeline for this creature and a
  retry is not possible this round. A 2D reference for the hound must be produced
  separately (by hand, via another generator, or re-attempted in a later session)
  before its 3D run. Target spec: gaunt undead hound, exposed ribs/spine ridges,
  tattered gray flesh, sickly-green glowing eyes, jaws slightly open, neutral
  standing pose, all four paws visible, near-black background.**
- Target height: ~1.1m at the shoulder.
- **RIG CAVEAT:** Meshy auto-rig is humanoid-oriented. The hound will likely need
  a quadruped rig pass or a custom simple rig built by the integration side —
  check with the integration notes before treating the auto-rig output as final.
  Mixamo clip coverage for quadrupeds is effectively nonexistent; expect custom or
  procedural locomotion for this one, not Mixamo clips.

### 4. blight_necrolyte — "Blight Necrolyte"
- PNG: `enemy_blight_necrolyte.png`
- Ref shows: plague-priest in corroded bronze mask, tattered bile-green/black
  vestments, censer-staff held to the side leaking virulent green vapor, pustuled
  gauntlets, neutral front stance, feet visible.
- Meshy notes: Vapor is VFX, not geometry — the 3D pass should generate the staff
  and censer only, with an emissive green core for the vapor source in-engine.
  Pustules add nice normal detail but will melt at ≤1024px; keep them subtle.
  Long tattered vestments: same skirt/leg separation note as the cultist.

### 5. void_assassin — "Void Assassin"
- PNG: `enemy_void_assassin.png`
- Ref shows: lithe shadowy killer, void-black form-fitting garb, glowing violet
  rift-cracks across the body, hood and half-mask, two curved daggers held low at
  the sides, predatory crouch-neutral stance, feet visible.
- Meshy notes: Rift-cracks are the signature — mark them emissive violet in the
  texture pass. The crouch-neutral stance is slightly bent; this is fine for the
  auto-rigger but verify the leg chain before assigning Mixamo clips. Daggers held
  low at the sides are separate prop bones if clean; if fused, flag for the prop pass.
