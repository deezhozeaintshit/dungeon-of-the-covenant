DUNGEON OF THE COVENANT - ART REBUILD MODEL PACKAGE
====================================================

WHAT'S IN HERE
- 16 reference PNGs: 6 heroes + 10 enemies/bosses (front-view, 1120x2240)
- 4 spec docs with per-model generation settings (hero-spec-a.md, hero-spec-b.md,
  enemy-spec-regulars.md, enemy-spec-bosses.md)

WORKFLOW
1. For each model: image-to-3D on Meshy or Tripo using the matching PNG.
   On Meshy, use the free auto-rig after generation.
2. rot_hound has no PNG (the image pipeline refused it twice). Use text-to-3D
   with the full art description in enemy-spec-regulars.md. It's a quadruped,
   so plan a quadruped rig approach, not a humanoid one.
3. Export everything as GLB and send the files back. Rigging, optimization
   (gltfpack + meshopt, textures to 1K), game mounting, and turntable preview
   renders all happen on my side.

SUGGESTED FIRST BATCH (validate the pipeline before doing all 17)
- juggernaut.png (flagged most likely to need a retry - do him early)
- 1 more hero of your choice
- 1 enemy, e.g. enemy_skel_warrior.png

FREE-TIER NOTES
- Meshy free: ~5 textured models/month. Tripo: 300 credits/month.
- Split however you like across the two. 17 models total.

WHEN YOU SEND MODELS BACK
- GLB files, one per model, named to match the PNG (e.g. juggernaut.glb).
- I'll confirm each one loads, retarget the 14 combat animations, and send
  you turntable renders to approve before anything goes in the game.
