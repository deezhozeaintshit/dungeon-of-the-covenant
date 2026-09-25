// entities.js - High-Fidelity Articulated 3D Characters, Menacing Monsters & Blender 5.2 GLB Rig
import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
// characters track: PBR material pass, procedural combat animation, rim light + blob shadows
import { upgradeCharacterMaterials, buildCharacterEnvMap, applyEnvMapToGroup } from './characterMaterials.js?v=9.0';
import { ensureCombatAnimState, triggerHitFlash, triggerAttackLunge, triggerDeathFade, resetDeathFade, updateCombatAnimation, detectDamage } from './characterAnimation.js?v=9.0';
import { enableCharacterLightLayer, attachBlobShadow, updateCharacterLighting } from './characterLighting.js?v=9.0';
// Phase 2 (workstream 2): game-wide animation state machine (Mixamo clips + procedural fallback).
import { createAnimator } from './animation/AnimationStates.js';
import { loadClipSet, HERO_STATE_PREFIX_OVERRIDES } from './animation/MixamoRig.js';
// Phase 3 (workstream 6): cosmetic shop renderers (skins, weapon glows, emotes).
import { syncPlayerCosmetics, playEmote } from './cosmetics.js?v=9.0';
// HD hero models (client/js/hdHeroes.js): flag-gated integration path for
// real rigged GLB heroes. HD_HEROES_ENABLED=false => zero behavior change.
import { HD_HEROES_ENABLED, mountHdHero, getHdModel } from './hdHeroes.js?v=9.0';
import { HD_ENEMIES_ENABLED, HD_MOB_CLIP_PREFIXES, HD_MOB_CLIP_STATES, HD_BOSS_CLIP_PREFIXES, HD_BOSS_CLIP_STATES, mountHdMob, mountHdBoss, getHdEnemyModel, getHdBossModel } from './hdEnemies.js?v=9.0';
// [perf-workstream] batched mob threat rings (Phase 4).
import { RingBatcher, isRingBatchingEnabled } from './perf/ringBatcher.js';

export class EntityManager {
  constructor(scene) {
    this.scene = scene;
    this.gltfLoader = new GLTFLoader();
    this.glbCache = {};
    // Phase 3 cosmetic shop: id -> public catalog def, set by CosmeticShopUI
    // after /api/stripe/config loads. Used for skin/glow/emote rendering.
    this.cosmeticDefs = new Map();
    this.playerMeshes = new Map();
    this.mobMeshes = new Map();
    this.bossMesh = null;
    // Phase 3 game feel: real-event VFX callbacks wired by the game app.
    // onMobRemoved(id, x, z) fires when a mob leaves the snapshot (died).
    // onBossDied(x, z) fires once on the boss death transition.
    this.onMobRemoved = null;
    this.onBossDied = null;
    this.targetReticle = this.createTargetReticle();
    this.scene.add(this.targetReticle);
    // [perf-workstream] one InstancedMesh for all mob threat rings (Phase 4).
    // Null when ring batching is disabled (perf-benchmark baseline mode).
    this.ringBatcher = isRingBatchingEnabled() ? new RingBatcher(scene) : null;
    // Shared PMREM environment for character PBR materials (set via setRenderer).
    this._charEnvMap = null;
    // Cinder thrall death crumbles: meshes removed from mobMeshes but kept
    // in-scene while the crumble/sink + fade plays (~1.5s).
    this._cinderDeaths = new Map();
    // Phase 4 (workstream 6: PERFORMANCE PASS): distance-LOD manager,
    // injected by the game app via setLodManager().
    this.lodManager = null;
  }

  // Phase 4 perf: inject the LODManager (owned by main.js). Mobs created
  // afterwards register automatically; pre-existing mobs register now.
  setLodManager(lm) {
    this.lodManager = lm || null;
    if (this.lodManager) {
      for (const group of this.mobMeshes.values()) this.lodManager.registerMob(group);
    }
  }

  // characters track: give EntityManager the WebGLRenderer so character PBR
  // materials get a real environment reflection map. Safe to call any time;
  // groups built earlier are upgraded retroactively.
  setRenderer(renderer) {
    if (!renderer || this._charEnvMap) return;
    try {
      this._charEnvMap = buildCharacterEnvMap(renderer);
      for (const group of this.playerMeshes.values()) applyEnvMapToGroup(group, this._charEnvMap);
      for (const group of this.mobMeshes.values()) applyEnvMapToGroup(group, this._charEnvMap);
      if (this.bossMesh) applyEnvMapToGroup(this.bossMesh, this._charEnvMap);
    } catch (e) { /* env map is a visual bonus; never break the game */ }
  }

  // characters track: run once per finished character group — PBR material
  // upgrade, rim-light layer, blob contact shadow, combat-anim state.
  finalizeCharacterGroup(group, shadowRadius = 1.1, shadowOpacity = 0.55) {
    upgradeCharacterMaterials(group, this._charEnvMap);
    enableCharacterLightLayer(group);
    attachBlobShadow(group, shadowRadius, shadowOpacity);
    ensureCombatAnimState(group);
    // Phase 2: attach the game-wide animation state machine. The Mixamo clip
    // set is bound by _bindHeroClipSet (local + remote heroes); until then the
    // animator drives procedural fallback poses.
    group.userData.animator = createAnimator(group);
    return group;
  }

  // Phase 2 (2026-09-25 Mixamo drop): bind the hero clip set to a player
  // group. Class-specific files (hero_rogue_attack.fbx, ...) win per
  // HERO_STATE_PREFIX_OVERRIDES; everything else falls back to the shared
  // hero_<state>.fbx set; missing states stay procedural. Never throws —
  // _clipSetBound=false triggers a retry on the next syncPlayers pass.
  _bindHeroClipSet(group, classKey) {
    const animator = group.userData.animator;
    if (!animator || group.userData._clipSetBound === 'loading' || group.userData._clipSetBound === true) return;
    group.userData._clipSetBound = 'loading';
    (async () => {
      try {
        const set = await loadClipSet(`hero_${classKey || 'mage'}`, group, {
          fallbackPrefixes: ['hero'],
          statePrefixes: HERO_STATE_PREFIX_OVERRIDES[classKey] || {}
        });
        animator.bindClipSet(set);
        animator.refresh();
        group.userData._clipSetBound = true;
      } catch (err) {
        console.warn('[Phase2] hero clip set failed; procedural fallback active:', err);
        group.userData._clipSetBound = false;
      }
    })();
  }

  // HD enemy/boss clip sets (client/js/hdEnemies.js). Mirrors _bindHeroClipSet
  // but the prefix is per mob type / boss key (see HD_MOB_CLIP_PREFIXES) and
  // there is no shared fallback set — missing files stay procedural. The
  // prefix is retargeted bone->bone onto the mounted skinned rig (SKINNED
  // path in detectRig). rot_hound binds nothing: quadruped, no Mixamo clips
  // exist, procedural driver owns it. Never throws — _clipSetBound=false
  // triggers a retry on the next sync pass.
  _bindMobClipSet(group, mobType) {
    const prefix = HD_MOB_CLIP_PREFIXES[mobType];
    const states = HD_MOB_CLIP_STATES[mobType] || [];
    if (!prefix || !states.length) return;
    this._bindClipSetToGroup(group, prefix, states);
  }

  _bindBossClipSet(group, bossKey) {
    const prefix = HD_BOSS_CLIP_PREFIXES[bossKey];
    if (!prefix) return;
    this._bindClipSetToGroup(group, prefix, HD_BOSS_CLIP_STATES);
  }

  _bindClipSetToGroup(group, prefix, states) {
    const animator = group.userData.animator;
    if (!animator || group.userData._clipSetBound === 'loading' || group.userData._clipSetBound === true) return;
    group.userData._clipSetBound = 'loading';
    (async () => {
      try {
        const set = await loadClipSet(prefix, group, { states });
        animator.bindClipSet(set);
        animator.refresh();
        group.userData._clipSetBound = true;
      } catch (err) {
        console.warn(`[Phase2] mob clip set failed for ${prefix}; procedural fallback active:`, err);
        group.userData._clipSetBound = false;
      }
    })();
  }

  attachEntityGLB(targetParent, url, scale = 0.75, offsetY = 0) {
    const mount = (gltfScene) => {
      const clone = gltfScene.clone(true);
      clone.scale.set(scale, scale, scale);
      clone.position.set(0, offsetY, 0);
      clone.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      // characters track: PBR upgrade + rim-light layer for any mounted GLB
      upgradeCharacterMaterials(clone, this._charEnvMap);
      enableCharacterLightLayer(clone);
      targetParent.add(clone);
    };
    if (this.glbCache[url]) {
      mount(this.glbCache[url]);
      return;
    }
    this.gltfLoader.load(
      url,
      (gltf) => {
        this.glbCache[url] = gltf.scene;
        mount(gltf.scene);
      },
      undefined,
      () => {}
    );
  }

  // --- CINDER THRALL (forge elite) -----------------------------------------
  // Mounts the lava-rock brute GLB (unrigged, procedural profile) and wires
  // lava-crack emissive glow + a self-pooled shoulder ember wisp emitter.
  // Death is handled by _beginCinderDeath / _tickCinderDeath (crumble + sink
  // + fade, owned by this._cinderDeaths instead of instant removal).
  _mountCinderThrall(group, cinderRoot, scale) {
    const url = '/assets/models/cinder_thrall.glb';
    const c = group.userData.cinder;
    const mount = (gltfScene) => {
      const clone = gltfScene.clone(true);
      clone.scale.set(scale, scale, scale);
      clone.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        // Per-instance material clones: the emissive pulse and death fade
        // mutate materials, so sharing the cached scene's materials would
        // bleed one thrall's death into another.
        const srcMats = Array.isArray(node.material) ? node.material : [node.material];
        const mats = [];
        for (const src of srcMats) {
          if (!src || !src.isMeshStandardMaterial) { mats.push(src); continue; }
          const mat = src.clone();
          // Lava-crack glow: reuse the albedo as the emissive map — the
          // bright orange cracks glow while the dark basalt stays dark.
          if (mat.map && !mat.emissiveMap) mat.emissiveMap = mat.map;
          mat.emissive = new THREE.Color(0xff5a1a);
          mat.emissiveIntensity = 0.85;
          mats.push(mat);
          c.mats.push(mat);
        }
        node.material = Array.isArray(node.material) ? mats : mats[0];
      });
      // Shoulder anchors for the ember wisp emitter (from the model bbox).
      const bbox = new THREE.Box3().setFromObject(clone);
      const size = bbox.getSize(new THREE.Vector3());
      c.shoulderL = new THREE.Vector3(-size.x * 0.32, size.y * 0.78, 0);
      c.shoulderR = new THREE.Vector3(size.x * 0.32, size.y * 0.78, 0);
      cinderRoot.add(clone);
      c.model = clone;
      c.loaded = true;
      // Phase 4 (workstream 6: PERFORMANCE PASS): far-tier impostor for the
      // 37k-vert GLB — the LODManager swaps model <-> impostor by distance
      // with hysteresis.
      if (this.lodManager) this.lodManager.registerCinder(group);
      this._initCinderWisps(group);
      upgradeCharacterMaterials(clone, this._charEnvMap);
      enableCharacterLightLayer(clone);
    };
    if (this.glbCache[url]) {
      mount(this.glbCache[url]);
      return;
    }
    // Plain GLB, no compression: GLTFLoader handles it directly.
    this.gltfLoader.load(url, (gltf) => {
      this.glbCache[url] = gltf.scene;
      mount(gltf.scene);
    }, undefined, () => {});
  }

  // Ember wisp emitter: one self-pooled THREE.Points per thrall, 26 rising
  // sparks from the shoulders. Local to this module (no particle-system
  // dependency) so it works regardless of other workstreams.
  _initCinderWisps(group) {
    const c = group.userData.cinder;
    if (!c || c.wisps || !c.shoulderL) return;
    const N = 26;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xff7733, size: 0.09, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    }));
    points.frustumCulled = false;
    c.root.add(points);
    c.wisps = points;
    c.wispData = [];
    for (let i = 0; i < N; i++) c.wispData.push(this._resetCinderWisp(c, true));
  }

  _resetCinderWisp(c, randomAge) {
    const side = Math.random() < 0.5 ? c.shoulderL : c.shoulderR;
    const maxLife = 1.2 + Math.random() * 0.8;
    return {
      x: side.x + (Math.random() - 0.5) * 0.25,
      y: side.y + (Math.random() - 0.5) * 0.2,
      z: side.z + (Math.random() - 0.5) * 0.25,
      vx: (Math.random() - 0.5) * 0.2,
      vy: 0.5 + Math.random() * 0.7,
      vz: (Math.random() - 0.5) * 0.2,
      life: randomAge ? Math.random() * maxLife : 0,
      maxLife
    };
  }

  _tickCinderWisps(group, dt) {
    const c = group.userData.cinder;
    if (!c || !c.wisps) return;
    const pos = c.wisps.geometry.getAttribute('position');
    for (let i = 0; i < c.wispData.length; i++) {
      const w = c.wispData[i];
      w.life += dt;
      if (w.life >= w.maxLife) Object.assign(w, this._resetCinderWisp(c, false));
      pos.setXYZ(i, w.x + w.vx * w.life, w.y + w.vy * w.life, w.z + w.vz * w.life);
    }
    pos.needsUpdate = true;
    c.wisps.material.opacity = c.dying ? Math.max(0, 0.9 * (1 - c.deathT / 1.4)) : 0.9;
  }

  // Per-frame update for cinder thrall meshes (called from the mob loop and
  // the death-crumble loop in animate()).
  _updateCinderThrall(group, dt) {
    const c = group.userData.cinder;
    if (!c || !c.loaded) return;
    c.emberT += dt;
    // Lava-crack emissive pulse.
    const pulse = 0.72 + 0.38 * Math.sin(c.emberT * 2.3);
    for (const mat of c.mats) {
      if (mat.emissive) mat.emissiveIntensity = 0.85 * pulse;
    }
    this._tickCinderWisps(group, dt);
    if (c.dying) this._tickCinderDeath(group, dt);
  }

  // Death: crumble/sink pose (sticky, from the CinderThrall profile) plus a
  // local material fade. The mesh is moved from mobMeshes to _cinderDeaths
  // so syncMobs doesn't resurrect it; the fade owns removal after ~1.5s.
  _beginCinderDeath(id, mesh) {
    const c = mesh.userData.cinder;
    if (!c || c.dying) return;
    c.dying = true;
    c.deathT = 0;
    if (mesh.userData.barSprite) mesh.userData.barSprite.visible = false;
    if (mesh.userData.eliteAura) mesh.userData.eliteAura.visible = false;
    if (mesh.userData.stealthVeil) mesh.userData.stealthVeil.visible = false;
    if (mesh.userData.animator) {
      try { mesh.userData.animator.play('death', { sticky: true }); } catch (e) {}
    }
    for (const mat of c.mats) mat.transparent = true;
    mesh.userData.deathId = id;
    this.mobMeshes.delete(id);
    this._cinderDeaths.set(id, mesh);
  }

  _tickCinderDeath(group, dt) {
    const c = group.userData.cinder;
    c.deathT += dt;
    const k = Math.min(1, c.deathT / 1.4);
    for (const mat of c.mats) mat.opacity = 1 - k;
    if (c.deathT >= 1.5) {
      this._cinderDeaths.delete(group.userData.deathId);
      this.scene.remove(group);
      // Phase 4 perf: drop LOD state with the mesh.
      if (this.lodManager) this.lodManager.unregister(group);
      // [perf-workstream] drop the batched threat ring with the mesh.
      if (this.ringBatcher) this.ringBatcher.unregister(group);
      group.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) if (m && m.dispose) m.dispose();
        }
      });
    }
  }

  createTargetReticle() {
    const group = new THREE.Group();
    // Inner pulse ring
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.45, 32),
      new THREE.MeshBasicMaterial({ color: 0xff2200, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    innerRing.rotation.x = -Math.PI / 2;
    group.add(innerRing);

    // 4 Corner brackets
    const bracketMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.12), bracketMat);
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      b.position.set(Math.cos(angle) * 1.5, 0.02, Math.sin(angle) * 1.5);
      b.rotation.y = -angle;
      group.add(b);
    }

    group.position.y = 0.08;
    group.visible = false;
    group.userData = { innerRing, pulse: 0 };
    return group;
  }

  setTargetLock(targetEntity) {
    if (!targetEntity) {
      this.targetReticle.visible = false;
      return;
    }
    this.targetReticle.visible = true;
    this.targetReticle.position.x = targetEntity.x;
    this.targetReticle.position.z = targetEntity.z;
    const r = (targetEntity.radius || 1.3) * 0.95;
    this.targetReticle.scale.set(r, 1, r);
  }

  syncPlayers(playersData, localPlayerId) {
    const activeIds = new Set(playersData.map(p => p.id));

    for (const [id, mesh] of this.playerMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.playerMeshes.delete(id);
        // [perf-workstream] drop player LOD state with the mesh (Phase 4).
        if (this.lodManager) this.lodManager.unregister(mesh);
      }
    }

    for (const p of playersData) {
      let group = this.playerMeshes.get(p.id);
      const isLocal = (p.id === localPlayerId);

      if (!group) {
        group = this.createArticulatedPlayerMesh(p, isLocal);
        this.playerMeshes.set(p.id, group);
        this.scene.add(group);
        // [perf-workstream] distance LOD for players (Phase 4): remote heroes
        // far from the camera shed fine/decor meshes; the local hero stays in
        // the near tier because the follow camera never leaves it.
        if (this.lodManager) this.lodManager.registerMob(group);
        // Phase 2: Mixamo clip set for every hero (local + remote).
        this._bindHeroClipSet(group, p.classKey || 'juggernaut');
      } else if (group.userData._clipSetBound === false) {
        // Earlier bind failed — retry now that we're syncing again.
        this._bindHeroClipSet(group, p.classKey || 'juggernaut');
      }

      // Smooth position lerp (including vertical Jump height p.y!)
      const prevX = group.position.x;
      const prevZ = group.position.z;
      const targetY = p.isDowned ? 0.35 : (p.y || 0);
      group.position.lerp(new THREE.Vector3(p.x, targetY, p.z), 0.42);
      group.userData.jumpHeight = p.y || 0;

      // Keep ground identifier ring planted on the dungeon floor while hero jumps!
      if (group.userData.heroRing) {
        group.userData.heroRing.position.y = Math.max(0.03, -group.position.y + 0.03);
        const shadowScale = Math.max(0.55, 1.0 - (group.position.y * 0.14));
        group.userData.heroRing.scale.set(shadowScale, shadowScale, 1);
      }

      if (p.rotation !== undefined) {
        // Smooth rotation slerp
        const currentY = group.rotation.y;
        let diff = (p.rotation - currentY) % (Math.PI * 2);
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        group.rotation.y = currentY + diff * 0.35;
      }

      // Calculate speed for walk animation
      const moveDist = Math.hypot(group.position.x - prevX, group.position.z - prevZ);
      group.userData.isMoving = moveDist > 0.03;

      // Downed state
      if (p.isDowned) {
        group.rotation.x = Math.PI / 2.3;
        if (!group.userData.reviveGlyph) {
          group.userData.reviveGlyph = this.createReviveGlyph();
          group.add(group.userData.reviveGlyph);
        }
        group.userData.reviveGlyph.visible = true;
      } else {
        group.rotation.x = 0;
        if (group.userData.reviveGlyph) group.userData.reviveGlyph.visible = false;
      }

      // Sync 3D Mythic Cosmetic Aura & Soul Overdrive Ring
      const desiredAura = p.cosmeticAura || null;
      if (group.userData.activeAuraKey !== desiredAura) {
        if (group.userData.cosmeticGroup) {
          group.remove(group.userData.cosmeticGroup);
          group.userData.cosmeticGroup = null;
        }
        group.userData.activeAuraKey = desiredAura;
        if (desiredAura) {
          group.userData.cosmeticGroup = this.createCosmeticAuraGroup(desiredAura);
          group.add(group.userData.cosmeticGroup);
        }
      }

      // Phase 3 cosmetic shop: hero skin + weapon glow (local + remote players).
      // Idempotent — only re-tints when the snapshot's cosmetic ids change.
      syncPlayerCosmetics(group, p.skinId || null, p.weaponGlow || null, this.cosmeticDefs);

      // Toggle Soul Overdrive (4+ Kill Streak) Blazing Floor Ring
      if (p.overdrive) {
        if (!group.userData.overdriveRing) {
          const odGeo = new THREE.RingGeometry(0.95, 1.35, 28);
          const odMat = new THREE.MeshBasicMaterial({
            color: 0xff5500,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
          });
          const odMesh = new THREE.Mesh(odGeo, odMat);
          odMesh.rotation.x = -Math.PI / 2;
          odMesh.position.y = 0.06;
          group.add(odMesh);
          group.userData.overdriveRing = odMesh;
        }
        group.userData.overdriveRing.visible = true;
      } else if (group.userData.overdriveRing) {
        group.userData.overdriveRing.visible = false;
      }

      const displayLabel = p.streakCount >= 3 ? `${p.name} 🔥x${p.streakCount}` : p.name;
      this.updateOverheadBar(group, p.hp, p.maxHp, displayLabel, false, isLocal);
      detectDamage(group, p.hp); // characters track: hit flash on hp drop
    }
  }

  createCosmeticAuraGroup(auraKey) {
    const auraGroup = new THREE.Group();
    const configs = {
      infernal: { color: 0xff4500, accent: 0xffaa00, wings: false },
      void:     { color: 0x9d4edd, accent: 0x00f5d4, wings: false },
      sovereign:{ color: 0xffd700, accent: 0xffffff, wings: true  },
      necro:    { color: 0x10b981, accent: 0xa7f3d0, wings: false }
    };
    const cfg = configs[auraKey] || configs.sovereign;

    // 1. Glowing Runic Floor Halo
    const ringGeo = new THREE.RingGeometry(0.72, 1.02, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const floorRing = new THREE.Mesh(ringGeo, ringMat);
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = 0.04;
    auraGroup.add(floorRing);

    // 2. Floating Crown Halo above Head
    const crownGeo = new THREE.TorusGeometry(0.34, 0.04, 10, 24);
    const crownMat = new THREE.MeshBasicMaterial({ color: cfg.color });
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 2.42;
    auraGroup.add(crown);

    // 3. Orbiting Soul Gems / Crystals
    const orbiters = new THREE.Group();
    orbiters.position.y = 1.25;
    const gemGeo = new THREE.OctahedronGeometry(0.13, 0);
    const gemMat = new THREE.MeshBasicMaterial({ color: cfg.accent });
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI * 2) / 4;
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(Math.cos(angle) * 0.9, (i % 2) * 0.25 - 0.1, Math.sin(angle) * 0.9);
      orbiters.add(gem);
    }
    auraGroup.add(orbiters);

    // 4. Sovereign Seraph Golden Energy Wings (if sovereign aura)
    if (cfg.wings) {
      const wingMat = new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 5), wingMat);
        wing.position.set(side * 0.55, 1.45, -0.28);
        wing.rotation.z = side * -0.65;
        wing.rotation.x = -0.25;
        auraGroup.add(wing);
      }
    }

    auraGroup.userData = { orbiters, crown, floorRing };
    return auraGroup;
  }

  // Trigger attack slash animation on a specific player mesh
  triggerAttackAnimation(playerId) {
    const group = this.playerMeshes.get(playerId);
    if (group && group.userData) {
      // Phase 2: the animator plays a real attack clip (or procedural upper-layer
      // swing); legacy lunge only for non-animator groups.
      if (group.userData.animator) {
        group.userData.animator.play('attack');
      } else {
        group.userData.attackTimer = 0.28;
        triggerAttackLunge(group); // characters track: root forward lunge
      }
    }
  }

  // Phase 3 cosmetic shop: play a purchased emote on any hero (local or
  // remote). The emote def comes from the server's public catalog; unknown
  // ids are ignored so forged messages render nothing.
  triggerEmote(playerId, emoteId) {
    const group = this.playerMeshes.get(playerId);
    if (!group || !group.userData) return;
    const def = this.cosmeticDefs.get(emoteId);
    if (def && def.kind === 'emote') {
      playEmote(group, def);
    }
  }

  // Phase 3 cosmetic shop: force-apply equipped cosmetics to a hero group
  // immediately (used right after an equip; the snapshot re-sync covers the
  // steady state).
  applyCosmeticsNow(playerId, skinId, weaponGlowId) {
    const group = this.playerMeshes.get(playerId);
    if (!group || !group.userData) return;
    delete group.userData._activeSkinId;
    delete group.userData._activeWeaponGlowId;
    syncPlayerCosmetics(group, skinId || null, weaponGlowId || null, this.cosmeticDefs);
  }

  // --- AAA CLASS-UNIQUE ARTICULATED 3D HERO MODELS ---
  createArticulatedPlayerMesh(p, isLocal) {
    const group = new THREE.Group();
    group.position.set(p.x, p.y || 0, p.z);

    const classKey = p.classKey || 'juggernaut';
    const armorColor = this.getClassArmorColor(classKey);
    const trimColor = this.getClassTrimColor(classKey);

    // HD hero path (client/js/hdHeroes.js): when the flag is on and the HD GLB
    // for this class was preloaded, mount the real skinned model instead of
    // the procedural hero. Graceful fallback to procedural otherwise —
    // getHdModel() returns null when disabled or the file is missing.
    if (HD_HEROES_ENABLED) {
      const hdGltf = getHdModel(classKey);
      if (hdGltf && mountHdHero(group, classKey, hdGltf, {
        manager: this, name: p.name, isLocal, trimColor
      })) {
        return group;
      }
    }

    // Class-distinct body scale & stance!
    const classScales = {
      juggernaut: [1.45, 1.36, 1.45], // Colossal Hulking Dreadnought Titan
      cleric:     [1.18, 1.28, 1.18], // Tall Levitating Seraphic Valkyrie
      rogue:      [1.15, 1.12, 1.15], // Agile Low-Crouching Phantom Shinobi
      mage:       [1.22, 1.30, 1.22], // Grand Astral Archmage
      ranger:     [1.20, 1.26, 1.20], // Lithe Elven Beastmaster & Sniper
      necromancer:[1.26, 1.35, 1.26]  // Towering Undead Lich-King
    };
    const [sx, sy, sz] = classScales[classKey] || [1.25, 1.25, 1.25];
    group.scale.set(sx, sy, sz);

    // 1. Ground Identifier & Drop-Shadow Ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: isLocal ? 0x2ecc71 : trimColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92
    });
    const heroRing = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.96, 32), ringMat);
    heroRing.rotation.x = -Math.PI / 2;
    heroRing.position.y = 0.03;
    group.add(heroRing);

    // 2. Root Articulated Bone
    const rootBone = new THREE.Group();
    // Cleric & Mage levitate slightly off the ground!
    const baseLevitateY = classKey === 'cleric' ? 0.34 : (classKey === 'necromancer' ? 0.18 : 0);
    rootBone.position.y = baseLevitateY;
    group.add(rootBone);

    // Shared PBR Materials with distinct metallic & emissive shaders per class
    const armorMat = new THREE.MeshStandardMaterial({
      color: armorColor,
      metalness: classKey === 'juggernaut' ? 0.88 : 0.65,
      roughness: classKey === 'juggernaut' ? 0.25 : 0.38,
      emissive: trimColor,
      emissiveIntensity: 0.22
    });
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x2a2a35, metalness: 0.85, roughness: 0.35 });
    const goldTrimMat = new THREE.MeshStandardMaterial({
      color: classKey === 'necromancer' ? 0xd8d4c5 : (classKey === 'rogue' ? 0xbb44ff : 0xfbbf24),
      metalness: 0.9,
      roughness: 0.22,
      emissive: trimColor,
      emissiveIntensity: 0.45
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: trimColor,
      emissive: trimColor,
      emissiveIntensity: 2.8,
      roughness: 0.15
    });
    const clothMat = new THREE.MeshStandardMaterial({
      color: this.getClassClothColor(classKey),
      roughness: 0.72,
      side: THREE.DoubleSide
    });

    // A. Lower Body: Robed Vestments (Cleric / Mage / Necromancer) vs Articulated Armored Greaves (Juggernaut / Rogue / Ranger)
    const createLeg = (isLeft) => {
      const legPivot = new THREE.Group();
      const xOffset = isLeft ? -0.22 : 0.22;
      legPivot.position.set(xOffset, 0.85, 0);

      const legWidth = classKey === 'juggernaut' ? 1.35 : (classKey === 'rogue' ? 0.85 : 1.0);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * legWidth, 0.12 * legWidth, 0.42, 10), armorMat);
      thigh.position.y = -0.2;
      thigh.castShadow = true;
      legPivot.add(thigh);

      const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.15 * legWidth), goldTrimMat);
      knee.position.set(0, -0.42, 0.09);
      legPivot.add(knee);

      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * legWidth, 0.10 * legWidth, 0.42, 10), chainMat);
      shin.position.y = -0.62;
      shin.castShadow = true;
      legPivot.add(shin);

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22 * legWidth, 0.16, 0.38), goldTrimMat);
      boot.position.set(0, -0.78, 0.08);
      legPivot.add(boot);

      return legPivot;
    };

    const leftLeg = createLeg(true);
    const rightLeg = createLeg(false);
    rootBone.add(leftLeg);
    rootBone.add(rightLeg);

    // Robed Skirt / Battle Tassets for Caster & Valkyrie Classes
    if (classKey === 'cleric' || classKey === 'mage' || classKey === 'necromancer') {
      const robeSkirt = new THREE.Mesh(
        new THREE.ConeGeometry(0.62, 1.05, 12, 1, true),
        clothMat
      );
      robeSkirt.position.set(0, 0.52, 0);
      rootBone.add(robeSkirt);

      const runeHem = new THREE.Mesh(
        new THREE.TorusGeometry(0.60, 0.045, 8, 24),
        glowMat
      );
      runeHem.rotation.x = Math.PI / 2;
      runeHem.position.y = 0.06;
      rootBone.add(runeHem);
    } else {
      const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.28, 10), armorMat);
      pelvis.position.y = 0.92;
      rootBone.add(pelvis);

      const beltBuckle = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), glowMat);
      beltBuckle.position.set(0, 0.92, 0.35);
      rootBone.add(beltBuckle);
    }

    // B. Upper Torso & Class-Distinct Silhouette Architecture
    const chestGroup = new THREE.Group();
    chestGroup.position.set(0, 1.05, 0);
    if (classKey === 'rogue') {
      chestGroup.rotation.x = 0.28; // Predator Ninja Forward Lean!
    }

    let angelWings = null;
    let classOrbiters = null;
    let spiritFalcon = null;
    let scarfTails = null;

    if (classKey === 'juggernaut') {
      // HULKING DREADNOUGHT FORTRESS PLATE + TWIN FURNACE EXHAUST STACKS
      const hulkingTorso = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.78, 0.68), armorMat);
      hulkingTorso.position.y = 0.36;
      hulkingTorso.castShadow = true;
      chestGroup.add(hulkingTorso);

      const magmaCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.24), glowMat);
      magmaCore.position.set(0, 0.42, 0.36);
      chestGroup.add(magmaCore);

      // Twin Burning Furnace Smokestacks on Back
      [-0.34, 0.34].forEach(xOff => {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.75, 8), goldTrimMat);
        pipe.position.set(xOff, 0.72, -0.32);
        pipe.rotation.x = -0.25;
        const ember = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), glowMat);
        ember.position.set(0, 0.42, 0);
        pipe.add(ember);
        chestGroup.add(pipe);
      });
    } else if (classKey === 'cleric') {
      // SERAPHIC VALKYRIE CUIRASS + 4 ARTICULATED GOLDEN ANGEL WINGS
      const valkTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.28, 0.68, 12), armorMat);
      valkTorso.position.y = 0.34;
      chestGroup.add(valkTorso);

      const sunCrest = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 16), glowMat);
      sunCrest.position.set(0, 0.42, 0.32);
      chestGroup.add(sunCrest);

      // 4 Articulated Golden Feathered Seraphim Wings!
      angelWings = new THREE.Group();
      angelWings.position.set(0, 0.52, -0.28);
      const wingMat = new THREE.MeshStandardMaterial({
        color: 0xfff3b0,
        emissive: 0xffcc00,
        emissiveIntensity: 1.4,
        roughness: 0.2,
        side: THREE.DoubleSide
      });
      const buildWing = (side, isUpper) => {
        const wPivot = new THREE.Group();
        const span = isUpper ? 1.45 : 1.05;
        for (let f = 0; f < 5; f++) {
          const feather = new THREE.Mesh(new THREE.ConeGeometry(0.11, span - f * 0.16, 6), wingMat);
          feather.rotation.z = side * (Math.PI / 2.4 + f * 0.14 + (isUpper ? 0 : 0.35));
          feather.position.set(side * (0.45 + f * 0.14), isUpper ? (0.25 - f * 0.08) : (-0.15 - f * 0.08), -f * 0.03);
          wPivot.add(feather);
        }
        return wPivot;
      };
      const wingUL = buildWing(-1, true);
      const wingUR = buildWing(1, true);
      const wingLL = buildWing(-1, false);
      const wingLR = buildWing(1, false);
      angelWings.add(wingUL, wingUR, wingLL, wingLR);
      angelWings.userData = { wingUL, wingUR, wingLL, wingLR };
      chestGroup.add(angelWings);
    } else if (classKey === 'rogue') {
      // PHANTOM SHINOBI STEALTH VEST + FLOWING CYBER SCARF + ORBITING SHURIKENS
      const stealthTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.26, 0.62, 8), clothMat);
      stealthTorso.position.y = 0.32;
      chestGroup.add(stealthTorso);

      // X-Crossed Violet Neon Harness
      const strap1 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.08, 0.42), glowMat);
      strap1.position.y = 0.36;
      strap1.rotation.z = 0.65;
      const strap2 = strap1.clone();
      strap2.rotation.z = -0.65;
      chestGroup.add(strap1, strap2);

      // Twin Trailing Ninja Scarf Ribbons
      scarfTails = new THREE.Group();
      scarfTails.position.set(0, 0.66, -0.22);
      [-0.14, 0.14].forEach(xOff => {
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 1.35), glowMat);
        tail.position.set(xOff, 0, -0.65);
        scarfTails.add(tail);
      });
      chestGroup.add(scarfTails);

      // 3 Orbiting Neon Shadow Shurikens
      classOrbiters = new THREE.Group();
      classOrbiters.position.y = 0.35;
      for (let i = 0; i < 3; i++) {
        const ang = (i * Math.PI * 2) / 3;
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glowMat);
        star.scale.set(1.4, 0.25, 1.4);
        star.position.set(Math.cos(ang) * 0.95, 0, Math.sin(ang) * 0.95);
        classOrbiters.add(star);
      }
      chestGroup.add(classOrbiters);
    } else if (classKey === 'mage') {
      // ASTRAL ARCHMAGE ROBES + 3 ELEMENTAL SPELL ORBS + HIGH COLLAR
      const mageTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.34, 0.66, 10), clothMat);
      mageTorso.position.y = 0.34;
      chestGroup.add(mageTorso);

      // High Arcane Mantle Collar
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.32, 0.38, 10, 1, true, Math.PI * 0.55, Math.PI * 0.9),
        goldTrimMat
      );
      collar.position.set(0, 0.72, -0.06);
      chestGroup.add(collar);

      // 3 Orbiting Elemental Spell Spheres (Fire, Frost, Arcane)
      classOrbiters = new THREE.Group();
      classOrbiters.position.y = 0.48;
      const orbColors = [0xff4400, 0x00ddff, 0xaa44ff];
      orbColors.forEach((col, idx) => {
        const ang = (idx * Math.PI * 2) / 3;
        const orbMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 3.2 });
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), orbMat);
        orb.position.set(Math.cos(ang) * 1.05, Math.sin(ang * 2) * 0.15, Math.sin(ang) * 1.05);
        classOrbiters.add(orb);
      });
      chestGroup.add(classOrbiters);
    } else if (classKey === 'ranger') {
      // ELVEN BEASTMASTER TUNICS + QUIVER OF ARROWS + ORBITING SPIRIT FALCON
      const rangerTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.31, 0.65, 10), armorMat);
      rangerTorso.position.y = 0.34;
      chestGroup.add(rangerTorso);

      // Back Quiver with Glowing Starlight Arrows
      const quiver = new THREE.Group();
      const qTube = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.72, 8), goldTrimMat);
      quiver.add(qTube);
      for (let a = -1; a <= 1; a++) {
        const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6), glowMat);
        arrowShaft.position.set(a * 0.05, 0.42, 0);
        quiver.add(arrowShaft);
      }
      quiver.position.set(0.22, 0.48, -0.34);
      quiver.rotation.z = -0.38;
      chestGroup.add(quiver);

      // 3D Spirit Falcon Companion Orbiting Overhead!
      spiritFalcon = new THREE.Group();
      spiritFalcon.position.set(-0.85, 1.35, 0.2);
      const birdBody = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 8), glowMat);
      birdBody.rotation.x = Math.PI / 2;
      const birdWingL = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.04, 0.24), goldTrimMat);
      birdWingL.position.set(-0.32, 0.04, 0);
      const birdWingR = birdWingL.clone();
      birdWingR.position.set(0.32, 0.04, 0);
      spiritFalcon.add(birdBody, birdWingL, birdWingR);
      spiritFalcon.userData = { birdWingL, birdWingR };
      chestGroup.add(spiritFalcon);
    } else if (classKey === 'necromancer') {
      // EXPOSED SKELETAL RIBCAGE + PULSING EMERALD SOUL-HEART + 3 ORBITING GHOST SKULLS
      const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.72, 8), goldTrimMat);
      spine.position.y = 0.36;
      chestGroup.add(spine);

      // Sculpted Bone Ribs around a Blazing Green Soul-Core
      for (let r = 0; r < 4; r++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.36 - r * 0.03, 0.045, 6, 14, Math.PI * 1.35), goldTrimMat);
        rib.rotation.x = Math.PI / 2;
        rib.rotation.z = -Math.PI * 0.18;
        rib.position.set(0, 0.18 + r * 0.14, 0.04);
        chestGroup.add(rib);
      }
      const soulHeart = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), glowMat);
      soulHeart.position.set(0, 0.38, 0.08);
      chestGroup.add(soulHeart);

      // 3 Orbiting Necrotic Ghost Skulls
      classOrbiters = new THREE.Group();
      classOrbiters.position.y = 0.45;
      for (let s = 0; s < 3; s++) {
        const ang = (s * Math.PI * 2) / 3;
        const gSkull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), glowMat);
        gSkull.position.set(Math.cos(ang) * 1.05, (s - 1) * 0.15, Math.sin(ang) * 1.05);
        classOrbiters.add(gSkull);
      }
      chestGroup.add(classOrbiters);
    }

    // Flowing Cape for non-winged classes
    let cape = null;
    if (classKey !== 'cleric') {
      const capeGeo = new THREE.PlaneGeometry(0.78, 1.28, 4, 6);
      cape = new THREE.Mesh(capeGeo, clothMat);
      cape.position.set(0, 0.42, -0.34);
      cape.rotation.x = 0.14;
      chestGroup.add(cape);
    }

    // D. Head, Helmet & Visor
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.76, 0);

    const headColor = classKey === 'necromancer' ? 0xe8e2d4 : (classKey === 'rogue' ? 0x1a1228 : 0xecd0b5);
    const headBase = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.55 })
    );
    headBase.position.y = 0.15;
    headGroup.add(headBase);

    this.buildClassHeadgear(classKey, headGroup, armorMat, goldTrimMat, glowMat);
    chestGroup.add(headGroup);

    // E. Left & Right Arm Articulations + Offhand / Mainhand Signature Weapons
    const leftArm = this.createArm(true, classKey, armorMat, goldTrimMat, chainMat, glowMat);
    const rightArm = this.createArm(false, classKey, armorMat, goldTrimMat, chainMat, glowMat);
    chestGroup.add(leftArm);
    chestGroup.add(rightArm);

    rootBone.add(chestGroup);

    group.userData = {
      classKey,
      heroRing,
      rootBone,
      baseLevitateY,
      leftLeg,
      rightLeg,
      chestGroup,
      leftArm,
      rightArm,
      // Phase 3 cosmetic shop: mainhand weapon group, for weapon-glow retinting.
      weaponGroup: (rightArm.userData && rightArm.userData.weapon) || null,
      cape,
      angelWings,
      classOrbiters,
      spiritFalcon,
      scarfTails,
      jumpHeight: 0,
      walkPhase: Math.random() * Math.PI * 2,
      idlePhase: Math.random() * Math.PI * 2,
      attackTimer: 0,
      isMoving: false
    };

    this.createOverheadBar(group, p.name, false, isLocal);
    // [perf-workstream] expose the articulated body for distance LOD (Phase 4):
    // remote players far from the camera shed fine/decor meshes like mobs do.
    // Group-level attachments (hero ring, blob shadow, bar sprite, revive /
    // overdrive / ice-cube FX) live outside rootBone and are never touched.
    group.userData.bodyRoot = rootBone;
    // characters track: PBR pass, rim-light layer, blob shadow, combat anim
    this.finalizeCharacterGroup(group, classKey === 'juggernaut' ? 1.35 : 1.05, 0.55);
    return group;
  }

  createArm(isLeft, classKey, armorMat, goldTrimMat, chainMat, glowMat) {
    const armPivot = new THREE.Group();
    const shoulderSpan = classKey === 'juggernaut' ? 0.62 : 0.48;
    const xOffset = isLeft ? -shoulderSpan : shoulderSpan;
    armPivot.position.set(xOffset, 0.58, 0);

    // Distinct Pauldrons per class
    const pSize = classKey === 'juggernaut' ? 0.34 : (classKey === 'rogue' ? 0.18 : 0.24);
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(pSize, 10, 10), armorMat);
    pauldron.position.set(isLeft ? -0.06 : 0.06, 0.06, 0);
    pauldron.scale.set(1.25, 0.9, 1.25);
    armPivot.add(pauldron);

    if (classKey === 'juggernaut' || classKey === 'necromancer') {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 6), glowMat);
      spike.position.set(isLeft ? -0.18 : 0.18, 0.26, 0);
      spike.rotation.z = isLeft ? 0.45 : -0.45;
      armPivot.add(spike);
    }

    const bicep = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.35, 8), chainMat);
    bicep.position.y = -0.2;
    armPivot.add(bicep);

    const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.35, 8), armorMat);
    gauntlet.position.y = -0.45;
    armPivot.add(gauntlet);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), goldTrimMat);
    hand.position.set(0, -0.62, 0.06);
    armPivot.add(hand);

    // Attach Class Offhand & Mainhand Weapons
    if (isLeft) {
      if (classKey === 'juggernaut') {
        // Colossal Fortress Tower Shield with Blazing Covenant Cross
        const shieldGroup = new THREE.Group();
        const shieldMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.65, 1.05), armorMat);
        const shieldRim = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.72, 1.10), goldTrimMat);
        shieldRim.scale.set(0.95, 1.0, 1.0);
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.20, 1.35, 0.18), glowMat);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.20, 0.78), glowMat);
        shieldGroup.add(shieldRim, shieldMesh, crossV, crossH);
        shieldGroup.position.set(-0.18, -0.35, 0.28);
        shieldGroup.rotation.y = 0.32;
        armPivot.add(shieldGroup);
      } else if (classKey === 'rogue') {
        // Offhand Reverse-Grip Plasma Kris Dagger
        const offDagger = this.createDaggerMesh(glowMat);
        offDagger.position.set(0, -0.65, 0.22);
        offDagger.rotation.x = Math.PI;
        armPivot.add(offDagger);
      } else if (classKey === 'cleric' || classKey === 'mage') {
        // Floating Open Spell Tome / Holy Scripture hovering in front of Left Hand
        const tomeGroup = new THREE.Group();
        const cover = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.46), goldTrimMat);
        const pages = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.42), glowMat);
        pages.position.y = 0.03;
        tomeGroup.add(cover, pages);
        tomeGroup.position.set(-0.08, -0.55, 0.45);
        tomeGroup.rotation.x = -0.35;
        armPivot.add(tomeGroup);
      } else if (classKey === 'necromancer') {
        // Offhand Cursed Soul-Lantern
        const lantern = new THREE.Group();
        const cage = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), goldTrimMat);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), glowMat);
        lantern.add(cage, flame);
        lantern.position.set(0, -0.82, 0.28);
        armPivot.add(lantern);
      }
    } else {
      const weapon = this.createClassMainWeapon(classKey, armorMat, goldTrimMat, glowMat);
      weapon.position.set(0, -0.6, 0.18);
      armPivot.add(weapon);
      armPivot.userData.weapon = weapon;
    }

    return armPivot;
  }

  buildClassHeadgear(classKey, headGroup, armorMat, goldTrimMat, glowMat) {
    if (classKey === 'juggernaut') {
      // Horned Dreadnought Greathelm + Blazing Magma Visor
      const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.35, 0.52, 12), armorMat);
      helm.position.y = 0.22;
      headGroup.add(helm);

      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.10, 0.18), glowMat);
      visor.position.set(0, 0.22, 0.28);
      headGroup.add(visor);

      [-0.36, 0.36].forEach(xOff => {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.68, 8), goldTrimMat);
        horn.position.set(xOff, 0.48, 0);
        horn.rotation.z = xOff < 0 ? 0.55 : -0.55;
        headGroup.add(horn);
      });
    } else if (classKey === 'cleric') {
      // Radiant Winged Valkyrie Tiara & Multi-Ring Solar Astrolabe Halo
      const haloOuter = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.05, 8, 28), glowMat);
      haloOuter.position.set(0, 0.42, -0.18);
      const haloInner = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMat);
      haloInner.position.set(0, 0.42, -0.18);
      headGroup.add(haloOuter, haloInner);

      const coronet = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.30, 0.20, 10), goldTrimMat);
      coronet.position.y = 0.34;
      headGroup.add(coronet);
    } else if (classKey === 'rogue') {
      // Cyber-Shinobi Hood & Dual Glowing Neon-Violet Optics
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.58, 10), armorMat);
      hood.position.set(0, 0.34, -0.04);
      headGroup.add(hood);

      const eyeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.12), glowMat);
      eyeGlow.position.set(0, 0.20, 0.28);
      headGroup.add(eyeGlow);
    } else if (classKey === 'mage') {
      // Grand Sorcerer Cowl & Levitating Triple-Ring Arcane Orrery Crown
      const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.78, 10), armorMat);
      cowl.position.set(0, 0.48, -0.06);
      cowl.rotation.x = -0.22;
      headGroup.add(cowl);

      const orrery = new THREE.Mesh(new THREE.TorusKnotGeometry(0.22, 0.035, 32, 6), glowMat);
      orrery.position.set(0, 0.88, 0);
      headGroup.add(orrery);
    } else if (classKey === 'ranger') {
      // Elven Stalker Hood, Glowing Emerald Visor & Twin Gold Plumes
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 10), armorMat);
      hood.position.y = 0.22;
      headGroup.add(hood);

      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.10), glowMat);
      visor.position.set(0, 0.20, 0.28);
      headGroup.add(visor);

      const feather = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.65, 5), glowMat);
      feather.position.set(0.26, 0.48, -0.18);
      feather.rotation.z = -0.55;
      headGroup.add(feather);
    } else if (classKey === 'necromancer') {
      // Sculpted Lich Skull Visage & 7-Spike Crown of Bone
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), glowMat);
      eyeL.position.set(-0.11, 0.22, 0.28);
      const eyeR = eyeL.clone();
      eyeR.position.set(0.11, 0.22, 0.28);
      headGroup.add(eyeL, eyeR);

      for (let i = -2; i <= 2; i++) {
        const crownSpike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.52 - Math.abs(i) * 0.06, 6), goldTrimMat);
        crownSpike.position.set(i * 0.13, 0.52, 0.05);
        crownSpike.rotation.z = -i * 0.18;
        headGroup.add(crownSpike);
      }
    }
  }

  createClassMainWeapon(classKey, armorMat, goldTrimMat, glowMat) {
    const group = new THREE.Group();

    if (classKey === 'juggernaut') {
      // Colossal Two-Handed Molten Earthshaker Warhammer
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.15, 8), goldTrimMat);
      haft.position.y = 0.35;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.52, 0.96), armorMat);
      head.position.y = 1.15;
      const coreBand = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 1.02), glowMat);
      coreBand.position.y = 1.15;
      group.add(haft, head, coreBand);
    } else if (classKey === 'cleric') {
      // Towering Solar Sunburst Grand Scepter
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8), goldTrimMat);
      haft.position.y = 0.35;
      const sunRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 20), goldTrimMat);
      sunRing.position.y = 1.25;
      const sunCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 1), glowMat);
      sunCore.position.y = 1.25;
      group.add(haft, sunRing, sunCore);
    } else if (classKey === 'rogue') {
      const dagger = this.createDaggerMesh(glowMat);
      group.add(dagger);
    } else if (classKey === 'mage') {
      // Dragon-Skull Ignis Grand Staff with Floating Fireball
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.35, 8), goldTrimMat);
      staff.position.y = 0.4;
      const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.055, 8, 18, Math.PI * 1.4), goldTrimMat);
      crescent.position.y = 1.45;
      const flameCore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26), glowMat);
      flameCore.position.y = 1.45;
      group.add(staff, crescent, flameCore);
    } else if (classKey === 'ranger') {
      // Massive Recurve Starlight Greatbow + Energy Bowstring & Nocked Arrow
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.06, 8, 24, Math.PI), goldTrimMat);
      bow.position.set(0, 0.25, 0.28);
      bow.rotation.y = Math.PI / 2;
      const bowString = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.62, 6), glowMat);
      bowString.position.set(0, 0.25, 0.28);
      const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.15, 6), glowMat);
      arrow.rotation.x = Math.PI / 2;
      arrow.position.set(0, 0.25, 0.55);
      group.add(bow, bowString, arrow);
    } else if (classKey === 'necromancer') {
      // Colossal 6-Foot Cursed Reaper Scythe
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 2.65, 8), goldTrimMat);
      staff.position.y = 0.45;
      const blade = new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.085, 6, 16, Math.PI * 0.78),
        glowMat
      );
      blade.position.set(0.46, 1.48, 0);
      blade.rotation.z = Math.PI / 4;
      group.add(staff, blade);
    }

    return group;
  }

  createDaggerMesh(glowMat) {
    const group = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.34), new THREE.MeshStandardMaterial({ color: 0x1a1025 }));
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.10), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9 }));
    guard.position.y = 0.16;
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.88, 4),
      glowMat || new THREE.MeshStandardMaterial({ color: 0xaa44ff, emissive: 0x8811ee, emissiveIntensity: 2.6 })
    );
    blade.position.y = 0.58;
    group.add(handle, guard, blade);
    return group;
  }

  getClassArmorColor(classKey) {
    const colors = {
      juggernaut: 0x9e3816,
      cleric: 0xd6aa24,
      rogue: 0x5a2d8a,
      mage: 0x1d5fb0,
      ranger: 0x2c7e3a,
      necromancer: 0x187046,
      plaguecaller: 0x6d9416,
      gravewarden: 0x4a5a68,
      hexblade: 0x8e1c58
    };
    return colors[classKey] || 0x777777;
  }

  getClassTrimColor(classKey) {
    const colors = {
      juggernaut: 0xff6622,
      cleric: 0xffea00,
      rogue: 0xaa44ff,
      mage: 0x33aaff,
      ranger: 0x44ee66,
      necromancer: 0x00ff88,
      plaguecaller: 0xaaff33,
      gravewarden: 0x9fb4c8,
      hexblade: 0xff4d9d
    };
    return colors[classKey] || 0xffffff;
  }

  getClassClothColor(classKey) {
    const colors = {
      juggernaut: 0x5c150c,
      cleric: 0xf5f0d3,
      rogue: 0x1a0f26,
      mage: 0x0d1f42,
      ranger: 0x1b3614,
      necromancer: 0x0a2417,
      plaguecaller: 0x2a3311,
      gravewarden: 0x1a2027,
      hexblade: 0x2b0f1e
    };
    return colors[classKey] || 0x333333;
  }

  createReviveGlyph() {
    const group = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(1.8, 2.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    return group;
  }

  // --- MONSTERS ---
  syncMobs(mobsData) {
    const activeIds = new Set(mobsData.map(m => m.id));

    for (const [id, mesh] of this.mobMeshes.entries()) {
      if (!activeIds.has(id)) {
        // Phase 3 game feel: mob death = pooled death burst at its position.
        if (this.onMobRemoved && mesh && mesh.position) {
          try { this.onMobRemoved(id, mesh.position.x, mesh.position.z); } catch (e) { /* VFX must never break sync */ }
        }
        // Cinder thrall: crumble/sink death anim instead of instant removal.
        if (mesh.userData && mesh.userData.cinder && !mesh.userData.cinder.dying) {
          this._beginCinderDeath(id, mesh);
          continue;
        }
        this.scene.remove(mesh);
        this.mobMeshes.delete(id);
        // Phase 4 perf: drop LOD state with the mesh.
        if (this.lodManager) this.lodManager.unregister(mesh);
        // [perf-workstream] drop the batched threat ring with the mesh.
        if (this.ringBatcher) this.ringBatcher.unregister(mesh);
      }
    }

    for (const m of mobsData) {
      let group = this.mobMeshes.get(m.id);
      if (!group) {
        group = this.createMobMesh(m);
        this.mobMeshes.set(m.id, group);
        this.scene.add(group);
      }

      group.position.lerp(new THREE.Vector3(m.x, m.y || 0, m.z), 0.35);
      // Phase 2: movement tracking for the animation state machine.
      group.userData.isMoving = Math.hypot(m.x - group.position.x, m.z - group.position.z) > 0.05;
      this.updateOverheadBar(group, m.hp, m.maxHp, m.name, true, false);
      detectDamage(group, m.hp); // characters track: hit flash on hp drop

      if (m.statuses && m.statuses.frozen) {
        if (!group.userData.iceCube) {
          const iceMat = new THREE.MeshStandardMaterial({
            color: 0x66ddff,
            transparent: true,
            opacity: 0.75,
            emissive: 0x33aaee,
            emissiveIntensity: 0.8
          });
          const iceCube = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2.2), iceMat);
          iceCube.position.y = 1.2;
          group.userData.iceCube = iceCube;
          group.add(iceCube);
        }
        group.userData.iceCube.visible = true;
      } else if (group.userData.iceCube) {
        group.userData.iceCube.visible = false;
      }
    }
  }

  createMobMesh(m) {
    const group = new THREE.Group();
    group.position.set(m.x, 0, m.z);
    group.scale.set(1.22, 1.22, 1.22);

    // Hostile Base Ring with Type-Coded Threat Color
    const ringColors = {
      crypt_ghoul: 0x66ff33,
      bone_archer: 0xaaff44,
      cinder_thrall: 0xff5500,
      void_assassin: 0xaa33ff,
      blight_necrolyte: 0x00ff99,
      elite_executioner: 0xff1133,
      elite_lich: 0x00ddff
    };
    // [perf-workstream] threat ring: batched into one InstancedMesh when ring
    // batching is on, otherwise the original per-mob mesh (baseline mode).
    // Color stays per-type either way.
    if (this.ringBatcher) {
      this.ringBatcher.register(group, ringColors[m.type] || 0xff2222);
    } else {
      const threatRing = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.04, 28),
        new THREE.MeshBasicMaterial({
          color: ringColors[m.type] || 0xff2222,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.82
        })
      );
      threatRing.rotation.x = -Math.PI / 2;
      threatRing.position.y = 0.05;
      group.add(threatRing);
    }

    // HD enemy path (client/js/hdEnemies.js): when the flag is on and the HD
    // GLB for this mob type was preloaded, mount the real skinned model
    // instead of the procedural mob. Graceful fallback to procedural below —
    // getHdEnemyModel() returns null when disabled, unknown, or missing.
    // (The threat ring above is shared by both paths.)
    if (HD_ENEMIES_ENABLED) {
      const hdGltf = getHdEnemyModel(m.type);
      if (hdGltf && mountHdMob(group, m.type, hdGltf, {
        manager: this, name: m.name, modelScale: m.modelScale
      })) {
        this._bindMobClipSet(group, m.type);
        return group;
      }
    }

    const bodyRoot = new THREE.Group();
    group.add(bodyRoot);
    let orbitGroup = null;

    if (m.type === 'crypt_ghoul') {
      // 1. FERAL CRYPT GHOUL (Hunched Toxic Flesh-Beast with Dorsal Spines & Huge Rending Claws)
      const ghoulMat = new THREE.MeshStandardMaterial({ color: 0x3b4d2e, roughness: 0.72, emissive: 0x16290b, emissiveIntensity: 0.4 });
      const glowGreen = new THREE.MeshStandardMaterial({ color: 0x66ff22, emissive: 0x55ee11, emissiveIntensity: 2.8 });

      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.32, 1.05, 8), ghoulMat);
      torso.position.set(0, 0.88, 0.18);
      torso.rotation.x = 0.52;
      bodyRoot.add(torso);

      // Glowing Toxic Dorsal Spines
      for (let s = 0; s < 4; s++) {
        const spineSpike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 6), glowGreen);
        spineSpike.position.set(0, 1.15 - s * 0.18, -0.12 - s * 0.06);
        spineSpike.rotation.x = -0.7;
        bodyRoot.add(spineSpike);
      }

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 10), ghoulMat);
      head.position.set(0, 1.38, 0.55);
      bodyRoot.add(head);

      [-0.14, 0.14].forEach(xOff => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), glowGreen);
        eye.position.set(xOff, 1.44, 0.84);
        bodyRoot.add(eye);
      });

      // Oversized Predator Claws
      [-0.52, 0.52].forEach(xOff => {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 1.05, 6), ghoulMat);
        arm.position.set(xOff, 0.68, 0.36);
        arm.rotation.x = -0.35;
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.48, 5), glowGreen);
        claw.position.set(0, -0.58, 0.12);
        claw.rotation.x = Math.PI * 0.75;
        arm.add(claw);
        bodyRoot.add(arm);
      });
    } else if (m.type === 'bone_archer') {
      // 2. HOODED BONE MARKSMAN (Ranger Cloak, Glowing Quiver & Drawn Bone Longbow)
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xe2dac9, roughness: 0.5 });
      const cloakMat = new THREE.MeshStandardMaterial({ color: 0x1e3318, roughness: 0.8 });
      const venomGlow = new THREE.MeshStandardMaterial({ color: 0x88ff22, emissive: 0x66dd00, emissiveIntensity: 2.6 });

      const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.54, 1.38, 8), cloakMat);
      cloak.position.y = 0.85;
      bodyRoot.add(cloak);

      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.56, 8), cloakMat);
      hood.position.set(0, 1.72, -0.04);
      bodyRoot.add(hood);

      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), boneMat);
      skull.position.set(0, 1.56, 0.08);
      bodyRoot.add(skull);

      [-0.09, 0.09].forEach(xOff => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), venomGlow);
        eye.position.set(xOff, 1.58, 0.30);
        bodyRoot.add(eye);
      });

      // Drawn Bone Greatbow in front
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.055, 6, 16, Math.PI), boneMat);
      bow.position.set(0, 1.15, 0.48);
      bow.rotation.y = Math.PI / 2;
      const poisonArrow = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), venomGlow);
      poisonArrow.rotation.x = Math.PI / 2;
      poisonArrow.position.set(0, 1.15, 0.62);
      bodyRoot.add(bow, poisonArrow);
    } else if (m.type === 'cinder_thrall') {
      // 3. CINDER THRALL — forge elite: lava-rock brute GLB (unrigged),
      //    driven by the CinderThrall procedural pose profile
      //    (see animation/ProceduralFallback.js). Lava-crack glow, ember
      //    wisps, and a crumble/sink death are set up by _mountCinderThrall
      //    and ticked by _updateCinderThrall in the per-frame mob loop.
      const cinderRoot = new THREE.Group();
      bodyRoot.add(cinderRoot);
      group.userData.procProfile = 'cinderThrall';
      group.userData.cinder = {
        root: cinderRoot,
        loaded: false,
        dying: false,
        deathT: 0,
        emberT: Math.random() * 10,
        mats: [],
        wisps: null,
        wispData: [],
        shoulderL: null,
        shoulderR: null
      };
      this._mountCinderThrall(group, cinderRoot, m.modelScale || 1.25);
    } else if (m.type === 'void_assassin') {
      // 4. 4-ARMED SHADOW MANTIS WRAITH (Floating Dimensional Reaper with 4 Violet Scythe Blades)
      const voidMat = new THREE.MeshStandardMaterial({ color: 0x160b29, roughness: 0.3, metalness: 0.8 });
      const plasmaMat = new THREE.MeshStandardMaterial({ color: 0xc044ff, emissive: 0x9911ff, emissiveIntensity: 3.0 });

      const wraithBody = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.55, 8), voidMat);
      wraithBody.rotation.x = Math.PI; // Inverted floating phantom taper!
      wraithBody.position.y = 1.15;
      bodyRoot.add(wraithBody);

      const portalHeart = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 8, 20), plasmaMat);
      portalHeart.position.set(0, 1.35, 0.28);
      bodyRoot.add(portalHeart);

      const cowl = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), voidMat);
      cowl.position.set(0, 1.85, 0.08);
      bodyRoot.add(cowl);

      // 4 Articulated Mantis Scythe Arms!
      [-1, 1].forEach(side => {
        [1.48, 1.08].forEach((yPos, idx) => {
          const scythe = new THREE.Mesh(
            new THREE.TorusGeometry(0.55, 0.055, 6, 14, Math.PI * 0.72),
            plasmaMat
          );
          scythe.position.set(side * (0.48 + idx * 0.14), yPos, 0.32);
          scythe.rotation.y = side * 0.45;
          bodyRoot.add(scythe);
        });
      });
    } else if (m.type === 'blight_necrolyte') {
      // 5. LEVITATING PLAGUE HIGH-PRIEST (Emerald Necro Robes, Censer Staff & Orbiting Skulls)
      const robeMat = new THREE.MeshStandardMaterial({ color: 0x0d2b1d, roughness: 0.65 });
      const blightGlow = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00cc66, emissiveIntensity: 2.8 });
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xded9c8, roughness: 0.5 });

      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.55, 10), robeMat);
      robe.position.y = 0.92;
      bodyRoot.add(robe);

      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.07, 8, 18), blightGlow);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 1.55;
      bodyRoot.add(collar);

      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), boneMat);
      skull.position.y = 1.78;
      bodyRoot.add(skull);

      orbitGroup = new THREE.Group();
      orbitGroup.position.y = 1.35;
      for (let s = 0; s < 3; s++) {
        const ang = (s * Math.PI * 2) / 3;
        const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), blightGlow);
        orb.position.set(Math.cos(ang) * 0.85, 0, Math.sin(ang) * 0.85);
        orbitGroup.add(orb);
      }
      bodyRoot.add(orbitGroup);
    } else if (m.type === 'elite_executioner') {
      // 6. VORGATH, BLOOD-EXECUTIONER TITAN (Towering Crimson Juggernaut Mini-Boss)
      group.scale.set(1.68, 1.68, 1.68);
      const bloodArmor = new THREE.MeshStandardMaterial({ color: 0x4a0e17, metalness: 0.85, roughness: 0.28 });
      const crimsonGlow = new THREE.MeshStandardMaterial({ color: 0xff1133, emissive: 0xdd0022, emissiveIntensity: 2.6 });

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.68), bloodArmor);
      torso.position.y = 1.15;
      bodyRoot.add(torso);

      [-0.62, 0.62].forEach(xOff => {
        const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 10), bloodArmor);
        pauldron.position.set(xOff, 1.58, 0);
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 6), crimsonGlow);
        spike.position.set(0, 0.42, 0);
        pauldron.add(spike);
        bodyRoot.add(pauldron);
      });

      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.72, 6), crimsonGlow);
      crown.position.set(0, 2.05, 0);
      bodyRoot.add(crown);

      // Colossal Double-Bladed Guillotine Great-Axe
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 8), bloodArmor);
      haft.position.set(0.68, 1.25, 0.35);
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.12, 16), crimsonGlow);
      blade.rotation.z = Math.PI / 2;
      blade.position.set(0.68, 1.85, 0.45);
      bodyRoot.add(haft, blade);
    } else if (m.type === 'elite_lich') {
      // 7. ARCH-LICH MALTHOR (Towering Frost-Lich Sovereign with Ice Wings & Orbiting Phylacteries)
      group.scale.set(1.64, 1.64, 1.64);
      const frostRobe = new THREE.MeshStandardMaterial({ color: 0x102542, roughness: 0.4, metalness: 0.5 });
      const arcaneGlow = new THREE.MeshStandardMaterial({ color: 0x22ddff, emissive: 0x0099ff, emissiveIntensity: 3.0 });

      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.75, 10), frostRobe);
      robe.position.y = 1.0;
      bodyRoot.add(robe);

      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.065, 8, 24), arcaneGlow);
      halo.position.set(0, 2.05, -0.1);
      bodyRoot.add(halo);

      orbitGroup = new THREE.Group();
      orbitGroup.position.y = 1.45;
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2;
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), arcaneGlow);
        crystal.scale.set(0.7, 1.8, 0.7);
        crystal.position.set(Math.cos(ang) * 1.05, 0, Math.sin(ang) * 1.05);
        orbitGroup.add(crystal);
      }
      bodyRoot.add(orbitGroup);
    } else {
      // 8. ARMORED SKELETON VANGUARD LEGIONNAIRE (Horned Helm, Ribcage, Spiked Tower Shield & Broadsword)
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.52 });
      const ironMat = new THREE.MeshStandardMaterial({ color: 0x4a3b32, metalness: 0.85, roughness: 0.45 });
      const eyeGlow = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 2.5 });

      const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.82, 6), boneMat);
      spine.position.y = 1.02;
      bodyRoot.add(spine);

      for (let r = 0; r < 4; r++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.33 - r * 0.03, 0.045, 6, 12, Math.PI * 1.25), boneMat);
        rib.rotation.x = Math.PI / 2;
        rib.position.set(0, 0.85 + r * 0.14, 0.05);
        bodyRoot.add(rib);
      }

      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), boneMat);
      skull.position.set(0, 1.62, 0);
      bodyRoot.add(skull);

      const helm = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.42, 8), ironMat);
      helm.position.set(0, 1.85, 0);
      bodyRoot.add(helm);

      [-0.1, 0.1].forEach(xOff => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeGlow);
        eye.position.set(xOff, 1.62, 0.24);
        bodyRoot.add(eye);
      });

      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.08, 0.68), ironMat);
      shield.position.set(-0.55, 1.02, 0.28);
      bodyRoot.add(shield);

      const sword = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.38, 0.20), ironMat);
      sword.position.set(0.55, 1.05, 0.28);
      sword.rotation.x = 0.25;
      bodyRoot.add(sword);

      [-0.2, 0.2].forEach(xOff => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.72, 6), boneMat);
        leg.position.set(xOff, 0.36, 0);
        bodyRoot.add(leg);
      });
    }

    group.userData.bodyRoot = bodyRoot;
    group.userData.orbitGroup = orbitGroup;
    group.userData.mobType = m.type;
    group.userData.phase = Math.random() * Math.PI * 2;

    this.createOverheadBar(group, m.name, true, false);
    // characters track: PBR pass, rim-light layer, blob shadow, combat anim
    this.finalizeCharacterGroup(group, 1.0, 0.55);
    // Phase 4 (workstream 6: PERFORMANCE PASS): distance-LOD tiers operate
    // on the bodyRoot subtree (rings, bars, shadows, auras untouched).
    if (this.lodManager) this.lodManager.registerMob(group);
    return group;
  }

  // --- BOSS MALAKOR (Sculpted Molten Colossus & Shatter Death Effect) ---
  syncBoss(bossData) {
    if (!bossData) {
      if (this.bossMesh) {
        this.scene.remove(this.bossMesh);
        this.bossMesh = null;
      }
      return;
    }

    if (!this.bossMesh || this.bossMesh.userData.bossName !== bossData.name) {
      if (this.bossMesh) this.scene.remove(this.bossMesh);
      this.bossMesh = this.createBossMesh(bossData);
      this.bossMesh.userData.bossName = bossData.name;
      this.scene.add(this.bossMesh);
    }

    this.bossMesh.position.lerp(new THREE.Vector3(bossData.x, bossData.y || 0, bossData.z), 0.35);
    // Phase 2: movement tracking for the animation state machine.
    this.bossMesh.userData.isMoving = Math.hypot(bossData.x - this.bossMesh.position.x, bossData.z - this.bossMesh.position.z) > 0.08;
    if (bossData.rotation !== undefined) {
      this.bossMesh.rotation.y = bossData.rotation;
    }

    if (bossData.phase === 2 && this.bossMesh.userData.veinsMat) {
      this.bossMesh.userData.veinsMat.emissiveIntensity = 4.5;
    }

    detectDamage(this.bossMesh, bossData.hp); // characters track: hit flash

    // When Boss dies: tip-over + fade the colossus, leave the Molten Soul-Ring.
    if (bossData.isDead) {
      const bg = this.bossMesh.userData.bodyGroup;
      if (bg) {
        const st = bg.userData.combatAnim;
        if (!st || st.deathT < 0) {
          triggerDeathFade(bg);
          // Phase 3 game feel: boss kill celebration, fired once on transition.
          if (this.onBossDied) {
            try { this.onBossDied(bossData.x, bossData.z); } catch (e) { /* VFX must never break sync */ }
          }
        }
      }
      if (this.bossMesh.userData.deathCrater) {
        this.bossMesh.userData.deathCrater.visible = true;
      }
    } else {
      const bg = this.bossMesh.userData.bodyGroup;
      if (bg) {
        const st = bg.userData.combatAnim;
        if (st && (st.deathT >= 0 || st.deathDone)) resetDeathFade(bg);
        else bg.visible = true;
      }
      if (this.bossMesh.userData.deathCrater) {
        this.bossMesh.userData.deathCrater.visible = false;
      }
    }
  }

  createBossMesh(b) {
    const group = new THREE.Group();
    group.position.set(b.x, 0, b.z);
    group.scale.set(1.35, 1.35, 1.35);

    // HD boss path (client/js/hdEnemies.js): when the flag is on and the HD
    // GLB for this boss key (b.biomeId) was preloaded, mount the real
    // skinned boss instead of the procedural molten colossus. Graceful
    // fallback to procedural below — getHdBossModel() returns null when
    // disabled, unknown, or missing.
    if (HD_ENEMIES_ENABLED) {
      const hdBossGltf = getHdBossModel(b.biomeId);
      if (hdBossGltf && mountHdBoss(group, b.biomeId, hdBossGltf, { manager: this })) {
        this._bindBossClipSet(group, b.biomeId);
        return group;
      }
    }

    const bodyGroup = new THREE.Group();
    group.add(bodyGroup);
    group.userData.bodyGroup = bodyGroup;

    // characters track: the boss_sovereign.glb mount was REMOVED (2026-09-25).
    // GLB audit: the model is an unrigged static primitive assembly centered on
    // its origin (bbox y -1.58..1.43), so at any grounded offset it either sat
    // half-buried under the floor or clipped through the sculpted procedural
    // colossus built below (its x half-width 1.81 exceeds the torso radius).
    // The procedural molten colossus IS the boss visual; the GLB added only
    // clipping artifacts and wasted draw calls. (models/ dir untouched.)

    // Warm Bronze-Obsidian Armor & Glowing Magma Veins (Never pitch-black cubes)
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x4a2e35,
      emissive: 0x331108,
      emissiveIntensity: 0.55,
      metalness: 0.75,
      roughness: 0.3
    });
    const goldPlateMat = new THREE.MeshStandardMaterial({
      color: 0xc8963e,
      emissive: 0x663300,
      emissiveIntensity: 0.5,
      metalness: 0.85,
      roughness: 0.25
    });
    const veinsMat = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff2200,
      emissiveIntensity: 3.2
    });
    group.userData.veinsMat = veinsMat;

    // 1. Armored Greaves / Legs (Cylinders)
    const legGeo = new THREE.CylinderGeometry(0.42, 0.35, 1.8, 12);
    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.set(-0.65, 0.9, 0);
    bodyGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.set(0.65, 0.9, 0);
    bodyGroup.add(rightLeg);

    // 2. Sculpted Tapered Cuirass & Molten Heart
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 0.95, 2.3, 12), armorMat);
    torso.position.y = 2.65;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const chestRing = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.14, 10, 24), goldPlateMat);
    chestRing.rotation.x = Math.PI / 2;
    chestRing.position.y = 2.9;
    bodyGroup.add(chestRing);

    const moltenCore = new THREE.Mesh(new THREE.SphereGeometry(0.78, 16, 16), veinsMat);
    moltenCore.position.set(0, 2.75, 0.68);
    bodyGroup.add(moltenCore);

    // 3. Massive Spiked Pauldrons
    const pauldronGeo = new THREE.SphereGeometry(0.85, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const leftPauldron = new THREE.Mesh(pauldronGeo, goldPlateMat);
    leftPauldron.position.set(-1.55, 3.45, 0);
    leftPauldron.rotation.z = 0.35;
    bodyGroup.add(leftPauldron);

    const rightPauldron = new THREE.Mesh(pauldronGeo, goldPlateMat);
    rightPauldron.position.set(1.55, 3.45, 0);
    rightPauldron.rotation.z = -0.35;
    bodyGroup.add(rightPauldron);

    // 4. Sculpted Crowned Great-Helm & Glowing Horns
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.15, 12), armorMat);
    helm.position.y = 4.25;
    helm.castShadow = true;
    bodyGroup.add(helm);

    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.25, 12, 1, false, -0.8, 1.6), veinsMat);
    visor.position.set(0, 4.3, 0.05);
    bodyGroup.add(visor);

    const hornLeft = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.6, 10), veinsMat);
    hornLeft.rotation.z = Math.PI / 3.4;
    hornLeft.position.set(-0.95, 4.85, 0);
    bodyGroup.add(hornLeft);

    const hornRight = hornLeft.clone();
    hornRight.rotation.z = -Math.PI / 3.4;
    hornRight.position.set(0.95, 4.85, 0);
    bodyGroup.add(hornRight);

    // 5. Sculpted Double-Headed Molten War-Maul (Cylinders & Cones — Zero Cubes)
    const hammerGroup = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 4.4, 10), goldPlateMat);
    const maulHead = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 1.9, 12), armorMat);
    maulHead.rotation.x = Math.PI / 2;
    maulHead.position.y = 2.0;

    const maulGlow = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.1, 8, 20), veinsMat);
    maulGlow.position.y = 2.0;

    hammerGroup.add(handle);
    hammerGroup.add(maulHead);
    hammerGroup.add(maulGlow);
    hammerGroup.position.set(1.85, 2.35, 0.65);
    hammerGroup.rotation.x = -Math.PI / 6;
    bodyGroup.add(hammerGroup);

    // 6. Death Crater Ring (Shown when Malakor is vanquished)
    const deathCrater = new THREE.Group();
    const craterRing = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 3.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xff6600, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
    );
    craterRing.rotation.x = -Math.PI / 2;
    craterRing.position.y = 0.04;
    deathCrater.add(craterRing);
    deathCrater.visible = false;
    group.add(deathCrater);
    group.userData.deathCrater = deathCrater;

    // characters track: PBR pass, rim-light layer, blob shadow, combat anim
    this.finalizeCharacterGroup(group, 2.4, 0.65);
    return group;
  }

  // --- OVERHEAD HEALTH BARS ---
  createOverheadBar(parent, name, isHostile = false, isLocal = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 40;
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.y = isHostile ? 2.8 : 3.4;

    parent.userData.barCanvas = canvas;
    parent.userData.barTexture = texture;
    parent.userData.barSprite = sprite;
    parent.add(sprite);

    this.drawOverheadBar(canvas, texture, 1, 1, name, isHostile, isLocal);
  }

  updateOverheadBar(parent, hp, maxHp, name, isHostile = false, isLocal = false) {
    if (!parent.userData.barCanvas) return;
    this.drawOverheadBar(parent.userData.barCanvas, parent.userData.barTexture, hp, maxHp, name, isHostile, isLocal);
  }

  drawOverheadBar(canvas, texture, hp, maxHp, name, isHostile, isLocal) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 160, 40);

    ctx.font = isLocal ? 'bold 15px sans-serif' : 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    const displayName = isLocal ? `★ ${name} (YOU)` : name;
    ctx.strokeText(displayName, 80, 14);
    ctx.fillStyle = isLocal ? '#2ecc71' : (isHostile ? '#ff6655' : '#ffffff');
    ctx.fillText(displayName, 80, 14);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(10, 20, 140, 12);

    const pct = Math.max(0, Math.min(1, hp / maxHp));
    ctx.fillStyle = isHostile ? '#ff3322' : (isLocal ? '#2ecc71' : '#3ba4ff');
    ctx.fillRect(12, 22, 136 * pct, 8);

    texture.needsUpdate = true;
  }

  // --- PROCEDURAL ANIMATIONS (Walk Cycle, Jump Vault, Angel Wings, Spirit Falcon, Class Orbs & Monster Motion) ---
  update(dt) {
    // [perf-workstream] refresh batched threat-ring instances (Phase 4).
    if (this.ringBatcher) this.ringBatcher.update();
    // 1. Target reticle pulse
    if (this.targetReticle.visible) {
      this.targetReticle.userData.pulse = (this.targetReticle.userData.pulse || 0) + dt * 4;
      const pulseScale = 1.0 + Math.sin(this.targetReticle.userData.pulse) * 0.08;
      this.targetReticle.userData.innerRing.scale.set(pulseScale, pulseScale, pulseScale);
    }

    // 2. Animate Heroes (Walk Cycle, Mid-Air Jump Pose, Class Wings/Companions/Orbs)
    for (const group of this.playerMeshes.values()) {
      const u = group.userData;
      if (!u) continue;

      // Phase 2: the animation state machine owns locomotion + procedural
      // fallback; legacy bone-tweening runs only for animator-less groups.
      // (HD skinned heroes carry no pivot rig — the animator still drives
      // them, so the animator check must come before the pivot guard.)
      if (u.animator) {
        u.animator.setLocomotion({ moving: !!u.isMoving, running: !!u.isRunning });
        u.animator.update(dt);
        // characters track: hit flash, attack lunge, death fade
        updateCombatAnimation(group, dt);
        continue;
      }
      if (!u.leftLeg || !u.rightLeg) continue;

      u.idlePhase += dt * 2.8;
      const baseY = u.baseLevitateY || 0;

      // Mid-Air Jump / Vault Pose!
      if ((u.jumpHeight || 0) > 0.14) {
        u.leftLeg.rotation.x = THREE.MathUtils.lerp(u.leftLeg.rotation.x, -0.75, 0.35);
        u.rightLeg.rotation.x = THREE.MathUtils.lerp(u.rightLeg.rotation.x, 0.55, 0.35);
        u.leftArm.rotation.x = THREE.MathUtils.lerp(u.leftArm.rotation.x, -0.85, 0.35);
        if (u.attackTimer <= 0) {
          u.rightArm.rotation.x = THREE.MathUtils.lerp(u.rightArm.rotation.x, -0.65, 0.35);
        }
        if (u.cape) u.cape.rotation.x = 0.65;
      } else if (u.isMoving) {
        u.walkPhase += dt * 9.5;
        const legSwing = Math.sin(u.walkPhase) * 0.68;
        u.leftLeg.rotation.x = legSwing;
        u.rightLeg.rotation.x = -legSwing;

        u.leftArm.rotation.x = -legSwing * 0.6;
        if (u.attackTimer <= 0) {
          u.rightArm.rotation.x = legSwing * 0.6;
        }

        u.rootBone.position.y = baseY + Math.abs(Math.sin(u.walkPhase)) * 0.09;
        if (u.cape) u.cape.rotation.x = 0.25 + Math.sin(u.walkPhase) * 0.14;
      } else {
        u.leftLeg.rotation.x = THREE.MathUtils.lerp(u.leftLeg.rotation.x, 0, 0.2);
        u.rightLeg.rotation.x = THREE.MathUtils.lerp(u.rightLeg.rotation.x, 0, 0.2);
        u.leftArm.rotation.x = THREE.MathUtils.lerp(u.leftArm.rotation.x, 0, 0.2);

        if (u.attackTimer <= 0) {
          u.rightArm.rotation.x = THREE.MathUtils.lerp(u.rightArm.rotation.x, 0, 0.2);
        }

        const floatAmp = u.classKey === 'cleric' ? 0.08 : 0.025;
        u.rootBone.position.y = baseY + Math.sin(u.idlePhase) * floatAmp;
        if (u.chestGroup) u.chestGroup.position.y = 1.05 + Math.sin(u.idlePhase) * 0.02;
        if (u.cape) u.cape.rotation.x = 0.08 + Math.sin(u.idlePhase * 0.8) * 0.05;
      }

      // Cleric Seraphim 4-Wing Flap Animation
      if (u.angelWings && u.angelWings.userData) {
        const flap = Math.sin(u.idlePhase * 2.2) * 0.28;
        u.angelWings.userData.wingUL.rotation.y = flap;
        u.angelWings.userData.wingUR.rotation.y = -flap;
        u.angelWings.userData.wingLL.rotation.y = flap * 0.75;
        u.angelWings.userData.wingLR.rotation.y = -flap * 0.75;
      }

      // Ranger Spirit Falcon Orbit & Wing Flap
      if (u.spiritFalcon) {
        u.spiritFalcon.position.x = Math.cos(u.idlePhase * 1.1) * 0.95;
        u.spiritFalcon.position.z = Math.sin(u.idlePhase * 1.1) * 0.95;
        u.spiritFalcon.position.y = 1.38 + Math.sin(u.idlePhase * 2.5) * 0.12;
        u.spiritFalcon.rotation.y = -u.idlePhase * 1.1;
        if (u.spiritFalcon.userData) {
          const wFlap = Math.sin(u.idlePhase * 5.5) * 0.45;
          u.spiritFalcon.userData.birdWingL.rotation.z = wFlap;
          u.spiritFalcon.userData.birdWingR.rotation.z = -wFlap;
        }
      }

      // Rogue Ninja Scarf Wave
      if (u.scarfTails) {
        u.scarfTails.rotation.x = 0.18 + Math.sin(u.idlePhase * 3.2) * 0.16;
        u.scarfTails.rotation.y = Math.cos(u.idlePhase * 2.4) * 0.12;
      }

      // Mage Elemental Orbs / Necromancer Ghost Skulls / Rogue Shadow Shurikens
      if (u.classOrbiters) {
        u.classOrbiters.rotation.y += dt * 2.6;
      }

      // Attack Swing Animation
      if (u.attackTimer > 0) {
        u.attackTimer -= dt;
        const progress = 1 - (u.attackTimer / 0.28);
        u.rightArm.rotation.x = -Math.PI * 0.75 + progress * Math.PI * 1.3;
      }

      // Rotate 3D Mythic Cosmetic Aura Orbiters
      if (u.cosmeticGroup && u.cosmeticGroup.userData.orbiters) {
        u.cosmeticGroup.userData.orbiters.rotation.y += dt * 2.2;
      }

      // characters track: hit flash, attack lunge, death fade
      updateCombatAnimation(group, dt);
    }

    // 3. Animate Monster Orbiting Shards / Skulls / Floating Bodies
    for (const mobGroup of this.mobMeshes.values()) {
      const mu = mobGroup.userData;
      if (!mu) continue;
      // Phase 2: the animation state machine owns locomotion; legacy
      // ambient motion only for animator-less groups.
      if (mu.animator) {
        mu.animator.setLocomotion({ moving: !!mu.isMoving, running: false });
        mu.animator.update(dt);
        updateCombatAnimation(mobGroup, dt);
        // Cinder thrall: lava-crack pulse + ember wisps (+ death fade).
        if (mu.cinder) this._updateCinderThrall(mobGroup, dt);
        continue;
      }
      mu.phase = (mu.phase || 0) + dt * 3.0;
      if (mu.orbitGroup) {
        mu.orbitGroup.rotation.y += dt * 2.8;
      }
      if (mu.bodyRoot && (mu.mobType === 'void_assassin' || mu.mobType === 'blight_necrolyte' || mu.mobType === 'elite_lich')) {
        mu.bodyRoot.position.y = Math.sin(mu.phase) * 0.14;
      }
      // characters track: hit flash on damage
      updateCombatAnimation(mobGroup, dt);
    }

    // 3b. Cinder thrall death crumbles: removed from mobMeshes at death but
    // kept in-scene while the crumble/sink + fade plays (~1.5s).
    for (const mesh of this._cinderDeaths.values()) {
      const mu = mesh.userData;
      if (!mu) continue;
      if (mu.animator) {
        mu.animator.update(dt);
        updateCombatAnimation(mesh, dt);
      }
      if (mu.cinder) this._updateCinderThrall(mesh, dt);
    }

    // 4. Boss combat animation (death tip-over + fade) & character lighting rig
    if (this.bossMesh) {
      const bu = this.bossMesh.userData;
      // Phase 2: the animation state machine drives boss locomotion.
      if (bu.animator) {
        bu.animator.setLocomotion({ moving: !!bu.isMoving, running: false });
        bu.animator.update(dt);
      }
      if (bu.bodyGroup) updateCombatAnimation(bu.bodyGroup, dt);
    }
    updateCharacterLighting(dt, performance.now() / 1000);
  }
}
