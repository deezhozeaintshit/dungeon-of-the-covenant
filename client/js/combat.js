// combat.js - Spell Visual Effects, Telegraph Zones, Projectiles, Beacons & Damage Numbers
import * as THREE from '/vendor/three.module.js';

export class CombatVisuals {
  constructor(scene) {
    this.scene = scene;
    this.projMeshes = new Map();
    this.telegraphMeshes = new Map();
    this.groundEffectMeshes = new Map();
    this.floatingTexts = [];
    this.activeBeams = [];
    this.activePings = [];
    this.activeBoneSpikes = [];
    this.activeExplosions = [];
    this.activeSlashArcs = [];
  }

  // Sync Projectiles from server
  syncProjectiles(projectilesData) {
    const activeIds = new Set(projectilesData.map(p => p.id));

    // Remove dead projectiles
    for (const [id, mesh] of this.projMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.projMeshes.delete(id);
      }
    }

    // Update or Create
    for (const p of projectilesData) {
      let group = this.projMeshes.get(p.id);
      if (!group) {
        group = new THREE.Group();
        const coreMat = new THREE.MeshBasicMaterial({ color: p.color || 0xffaa00 });
        const core = new THREE.Mesh(new THREE.SphereGeometry(p.radius || 0.45, 12, 12), coreMat);
        group.add(core);

        // Glow halo
        const haloMat = new THREE.MeshBasicMaterial({
          color: p.color || 0xffaa00,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending
        });
        const halo = new THREE.Mesh(new THREE.SphereGeometry((p.radius || 0.45) * 1.6, 12, 12), haloMat);
        group.add(halo);

        this.projMeshes.set(p.id, group);
        this.scene.add(group);
      }
      group.position.set(p.x, p.y || 1.0, p.z);
    }
  }

  // Boss & Player Telegraph Decals
  handleTelegraphStart(tel) {
    const group = new THREE.Group();
    group.position.set(tel.x, 0.04, tel.z);

    if (tel.shape === 'cone') {
      const angle = tel.coneAngle || Math.PI * 0.66;
      const radius = tel.radius || 5.0;
      const coneGeo = new THREE.CircleGeometry(radius, 24, -angle / 2, angle);
      const coneMat = new THREE.MeshBasicMaterial({
        color: tel.color || 0xff1122,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(coneGeo, coneMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = (tel.angle || 0) + Math.PI / 2;
      group.add(mesh);
    } else {
      const ringGeo = new THREE.RingGeometry(0.2, tel.radius || 4.5, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: tel.color || 0xff3300,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(ringGeo, ringMat);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
    }

    this.scene.add(group);
    this.telegraphMeshes.set(tel.id, {
      group,
      duration: tel.duration,
      elapsed: 0
    });
  }

  // Ground Effects (Tar slicks, Fire pools, Sanctuary, Smoke)
  syncGroundEffects(effectsData) {
    const activeIds = new Set(effectsData.map(e => e.id));

    for (const [id, mesh] of this.groundEffectMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.groundEffectMeshes.delete(id);
      }
    }

    for (const e of effectsData) {
      let mesh = this.groundEffectMeshes.get(e.id);
      if (!mesh) {
        mesh = this.createGroundEffectMesh(e);
        this.groundEffectMeshes.set(e.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(e.x, 0.05, e.z);
    }
  }

  createGroundEffectMesh(e) {
    const r = e.radius || 4.0;
    const geo = new THREE.CircleGeometry(r, 24);
    let color = 0x221122;
    let opacity = 0.6;

    if (e.type === 'tar_slick') {
      color = 0x110815;
      opacity = 0.85;
    } else if (e.type === 'fire_pool') {
      color = 0xff4400;
      opacity = 0.7;
    } else if (e.type === 'sanctuary') {
      color = 0xffea00;
      opacity = 0.55;
    } else if (e.type === 'smoke_veil') {
      color = 0x555566;
      opacity = 0.6;
    }

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  // 1. Party Ping 3D Beacon (Attack, Regroup, Loot, Help)
  spawnPartyPing(pingType, x, z, playerName) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    let color = 0xff3333; // attack
    let icon = '⚔️ ATTACK';
    if (pingType === 'regroup') {
      color = 0x3ba4ff;
      icon = '🛡️ REGROUP';
    } else if (pingType === 'loot') {
      color = 0xffcc00;
      icon = '💎 LOOT';
    } else if (pingType === 'help') {
      color = 0x2ecc71;
      icon = '❤️ HELP';
    }

    // A. Vertical Light Pillar
    const beamGeo = new THREE.CylinderGeometry(0.35, 0.8, 12, 16);
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 6;
    group.add(beam);

    // B. Ground Ripple Ring
    const rippleGeo = new THREE.RingGeometry(0.5, 2.8, 24);
    const rippleMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    const ripple = new THREE.Mesh(rippleGeo, rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.08;
    group.add(ripple);

    // C. Overhead Billboard Tag
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(8, 8, 240, 54, 8);
    } else {
      ctx.rect(8, 8, 240, 54);
    }
    ctx.fill();
    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = 'bold 22px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillText(`${icon}`, 128, 34);

    ctx.font = '14px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(playerName || 'Hero', 128, 52);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3.6, 1.0, 1);
    sprite.position.y = 4.2;
    group.add(sprite);

    this.scene.add(group);
    this.activePings.push({ group, beam, ripple, life: 3.5, maxLife: 3.5 });
  }

  // 2. Necromancer Bone Spikes (Linear impale eruption from ground)
  spawnBoneSpikes(startX, startZ, dirX, dirZ, length = 10) {
    const group = new THREE.Group();
    const spikeGeo = new THREE.ConeGeometry(0.3, 2.2, 5);
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0xe8e2d2,
      roughness: 0.5,
      metalness: 0.1,
      emissive: 0x225533,
      emissiveIntensity: 0.4
    });

    const spikes = [];
    const count = Math.floor(length / 1.6);
    for (let i = 1; i <= count; i++) {
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      const dist = i * 1.6;
      spike.position.set(
        startX + dirX * dist + (Math.random() - 0.5) * 0.4,
        -1.5, // starts under floor
        startZ + dirZ * dist + (Math.random() - 0.5) * 0.4
      );
      spike.rotation.x = (Math.random() - 0.5) * 0.4;
      spike.rotation.z = (Math.random() - 0.5) * 0.4;
      spike.castShadow = true;
      group.add(spike);
      spikes.push({ mesh: spike, delay: (i - 1) * 0.05, targetY: 1.1, curY: -1.5 });
    }

    this.scene.add(group);
    this.activeBoneSpikes.push({ group, spikes, elapsed: 0, life: 1.6 });
  }

  // 3. Necromancer Soul Drain Tether Beam / Siphon
  spawnSoulDrainBeam(sourceX, sourceZ, targetX, targetZ, color = 0x22ff88) {
    const dx = targetX - sourceX;
    const dz = targetZ - sourceZ;
    const len = Math.hypot(dx, dz);
    const midX = (sourceX + targetX) / 2;
    const midZ = (sourceZ + targetZ) / 2;

    const group = new THREE.Group();
    group.position.set(midX, 1.2, midZ);

    const geo = new THREE.CylinderGeometry(0.12, 0.12, len, 8);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const cylinder = new THREE.Mesh(geo, mat);
    cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz).normalize());
    group.add(cylinder);

    // Orbiting soul particles
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xaaffbb });
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), particleMat);
      group.add(p);
    }

    this.scene.add(group);
    this.activeBeams.push({ group, cylinder, life: 1.2, maxLife: 1.2, sourceX, sourceZ, targetX, targetZ });
  }

  // 4. Necromancer Corpse Explosion (Detonation Shockwave + Flying Bone Shrapnel)
  spawnCorpseExplosion(x, z, radius = 5.0, usedCorpse = true) {
    const group = new THREE.Group();
    group.position.set(x, 0.1, z);

    // Expanding Poison Shockwave Ring
    const ringGeo = new THREE.RingGeometry(0.4, 1.0, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x33ff66,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // Bone fragments
    const shrapnel = [];
    const shrapnelMat = new THREE.MeshStandardMaterial({ color: 0xddddcc, roughness: 0.5 });
    const count = usedCorpse ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.4), shrapnelMat);
      s.position.set(0, 0.4, 0);
      const angle = (i * Math.PI * 2) / count + (Math.random() - 0.5) * 0.4;
      const speed = 4 + Math.random() * 5;
      shrapnel.push({
        mesh: s,
        vx: Math.cos(angle) * speed,
        vy: 3 + Math.random() * 4,
        vz: Math.sin(angle) * speed
      });
      group.add(s);
    }

    this.scene.add(group);
    this.activeExplosions.push({ group, ring, shrapnel, maxRadius: radius, elapsed: 0, life: 1.4 });
  }

  // 5. Hero Slash Arc / Swing FX
  spawnAttackSlash(x, z, rotation, color = 0xffffff) {
    const geo = new THREE.RingGeometry(1.2, 2.4, 16, 1, 0, Math.PI * 0.7);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const slash = new THREE.Mesh(geo, mat);
    slash.rotation.x = -Math.PI / 2;
    slash.rotation.z = rotation + Math.PI / 2 - Math.PI * 0.35;
    slash.position.set(x, 1.1, z);

    this.scene.add(slash);
    this.activeSlashArcs.push({ mesh: slash, life: 0.25, maxLife: 0.25 });
  }

  // 6. Generic Piercing Beam (Cleric Luminary Lance)
  spawnBeam(sourceX, sourceZ, targetX, targetZ, color = 0xffea00) {
    const dx = targetX - sourceX;
    const dz = targetZ - sourceZ;
    const len = Math.hypot(dx, dz);
    const midX = (sourceX + targetX) / 2;
    const midZ = (sourceZ + targetZ) / 2;

    const group = new THREE.Group();
    group.position.set(midX, 1.2, midZ);

    const geo = new THREE.CylinderGeometry(0.25, 0.25, len, 8);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz).normalize());
    group.add(beam);

    this.scene.add(group);
    this.activeBeams.push({ group, cylinder: beam, life: 0.6, maxLife: 0.6 });
  }

  // Floating Combat Text & Combo Announcements
  spawnFloatingText(text, x, z, style = 'normal') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.font = style === 'combo' ? 'bold 22px Cinzel, serif' : 'bold 26px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, 128, 38);

    if (style === 'combo') ctx.fillStyle = '#ffcc00';
    else if (style === 'crit') ctx.fillStyle = '#ff3344';
    else if (style === 'heal') ctx.fillStyle = '#2ecc71';
    else ctx.fillStyle = '#ffffff';

    ctx.fillText(text, 128, 38);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(style === 'combo' ? 3.5 : 2.0, style === 'combo' ? 0.9 : 0.5, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.8, 2.8, z + (Math.random() - 0.5) * 0.8);

    this.scene.add(sprite);
    this.floatingTexts.push({ sprite, life: 1.2, vy: 1.6 });
  }

  // 9. Tactical Dash / Dodge-Roll Afterimage Streak
  spawnDashFX(startX, startZ, endX, endZ) {
    this.spawnSoulBeam(startX, startZ, endX, endZ, 0x5ce1e6);
    this.spawnSlashArc(endX, endZ, Math.atan2(endX - startX, endZ - startZ), 0x5ce1e6, 2.2);
  }

  // 10. Hero Level-Up Golden Ascension Pillar
  spawnLevelUpFX(x, z, level, name) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const beamGeo = new THREE.CylinderGeometry(0.6, 1.3, 11, 20);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 5.5;
    group.add(beam);

    const rippleGeo = new THREE.RingGeometry(0.6, 3.2, 28);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });
    const ripple = new THREE.Mesh(rippleGeo, rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.08;
    group.add(ripple);

    this.scene.add(group);
    this.activePings.push({ group, beam, ripple, life: 2.2, maxLife: 2.2 });
    this.spawnFloatingText(x, z, `⭐ LEVEL ${level}! (${name || 'Hero'})`, 'combo');
  }

  update(dt) {
    // 1. Animate telegraphs
    for (const [id, tel] of this.telegraphMeshes.entries()) {
      tel.elapsed += dt;
      const progress = Math.min(1, tel.elapsed / tel.duration);
      tel.group.scale.set(1 + progress * 0.05, 1 + progress * 0.05, 1);
      if (tel.elapsed >= tel.duration) {
        this.scene.remove(tel.group);
        this.telegraphMeshes.delete(id);
      }
    }

    // 2. Animate Pings
    for (let i = this.activePings.length - 1; i >= 0; i--) {
      const p = this.activePings[i];
      p.life -= dt;
      const progress = 1 - (p.life / p.maxLife);
      const rippleScale = 1 + progress * 2.5;
      p.ripple.scale.set(rippleScale, rippleScale, rippleScale);
      p.ripple.material.opacity = Math.max(0, 1 - progress);
      p.beam.material.opacity = (p.life / p.maxLife) * 0.7;

      if (p.life <= 0) {
        this.scene.remove(p.group);
        this.activePings.splice(i, 1);
      }
    }

    // 3. Animate Bone Spikes
    for (let i = this.activeBoneSpikes.length - 1; i >= 0; i--) {
      const b = this.activeBoneSpikes[i];
      b.elapsed += dt;
      for (const sp of b.spikes) {
        if (b.elapsed >= sp.delay) {
          const rise = Math.min(1, (b.elapsed - sp.delay) * 7);
          sp.mesh.position.y = -1.5 + (sp.targetY - (-1.5)) * rise;
        }
      }
      if (b.elapsed >= b.life) {
        this.scene.remove(b.group);
        this.activeBoneSpikes.splice(i, 1);
      }
    }

    // 4. Animate Soul Drain / Beams
    for (let i = this.activeBeams.length - 1; i >= 0; i--) {
      const bm = this.activeBeams[i];
      bm.life -= dt;
      bm.cylinder.material.opacity = (bm.life / bm.maxLife) * 0.85;
      if (bm.life <= 0) {
        this.scene.remove(bm.group);
        this.activeBeams.splice(i, 1);
      }
    }

    // 5. Animate Corpse Explosions
    for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
      const exp = this.activeExplosions[i];
      exp.elapsed += dt;
      const pct = exp.elapsed / exp.life;
      const r = exp.maxRadius * pct;
      exp.ring.scale.set(r, r, r);
      exp.ring.material.opacity = Math.max(0, 1 - pct);

      for (const s of exp.shrapnel) {
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.vy -= 9.8 * dt; // gravity
        s.mesh.rotation.x += dt * 5;
        s.mesh.rotation.y += dt * 5;
      }

      if (exp.elapsed >= exp.life) {
        this.scene.remove(exp.group);
        this.activeExplosions.splice(i, 1);
      }
    }

    // 6. Animate Slash Arcs
    for (let i = this.activeSlashArcs.length - 1; i >= 0; i--) {
      const sl = this.activeSlashArcs[i];
      sl.life -= dt;
      sl.mesh.material.opacity = (sl.life / sl.maxLife) * 0.75;
      sl.mesh.scale.multiplyScalar(1.04);
      if (sl.life <= 0) {
        this.scene.remove(sl.mesh);
        this.activeSlashArcs.splice(i, 1);
      }
    }

    // 7. Animate floating texts upward
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      ft.sprite.position.y += ft.vy * dt;
      ft.sprite.material.opacity = ft.life / 1.2;

      if (ft.life <= 0) {
        this.scene.remove(ft.sprite);
        this.floatingTexts.splice(i, 1);
      }
    }
  }
}
