// EnhancedEntities.js - AAA Quality Character Models with PBR Materials
// Replaces basic geometries with high-detail articulated rigs

import * as THREE from '/vendor/three.module.js';

export class EnhancedEntities {
  constructor(scene) {
    this.scene = scene;
    this.playerMeshes = new Map();
    this.mobMeshes = new Map();
    this.bossMesh = null;
    this.targetReticle = this.createTargetReticle();
    this.scene.add(this.targetReticle);
    
    // PBR Materials cache
    this.materials = {
      armor: new THREE.MeshStandardMaterial({
        color: 0x4a4a5a,
        metalness: 0.8,
        roughness: 0.3,
        envMapIntensity: 1.0
      }),
      gold: new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        metalness: 0.95,
        roughness: 0.15,
        envMapIntensity: 1.5
      }),
      flesh: new THREE.MeshStandardMaterial({
        color: 0xe8c4a0,
        metalness: 0.0,
        roughness: 0.8,
        envMapIntensity: 0.5
      }),
      bone: new THREE.MeshStandardMaterial({
        color: 0xe8e2d4,
        metalness: 0.1,
        roughness: 0.6,
        envMapIntensity: 0.3
      }),
      glow: new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.9
      })
    };
  }

  createTargetReticle() {
    const group = new THREE.Group();
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.45, 32),
      new THREE.MeshBasicMaterial({ color: 0xff2200, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    innerRing.rotation.x = -Math.PI / 2;
    group.add(innerRing);
    group.position.y = 0.08;
    group.visible = false;
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
      }
    }

    for (const p of playersData) {
      let group = this.playerMeshes.get(p.id);
      const isLocal = (p.id === localPlayerId);

      if (!group) {
        group = this.createAAAPlayerMesh(p, isLocal);
        this.playerMeshes.set(p.id, group);
        this.scene.add(group);
      }

      group.position.lerp(new THREE.Vector3(p.x, p.y || 0, p.z), 0.35);
      if (p.rotation !== undefined) {
        const currentY = group.rotation.y;
        let diff = (p.rotation - currentY) % (Math.PI * 2);
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        group.rotation.y = currentY + diff * 0.35;
      }

      const moveDist = Math.hypot(group.position.x - (group.userData.lastX || group.position.x), 
                                   group.position.z - (group.userData.lastZ || group.position.z));
      group.userData.lastX = group.position.x;
      group.userData.lastZ = group.position.z;
      group.userData.isMoving = moveDist > 0.03;

      if (p.isDowned) {
        group.rotation.x = Math.PI / 2.3;
        group.position.y = 0.35;
      } else {
        group.rotation.x = 0;
        group.position.y = 0;
      }

      this.updateOverheadBar(group, p.hp, p.maxHp, p.name, false, isLocal);
    }
  }

  createAAAPlayerMesh(p, isLocal) {
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.scale.set(1.3, 1.3, 1.3);

    const classKey = p.classKey || 'juggernaut';
    const colors = this.getClassColors(classKey);

    // Ground ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: isLocal ? 0x2ecc71 : 0x3ba4ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    const heroRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), ringMat);
    heroRing.rotation.x = -Math.PI / 2;
    heroRing.position.y = 0.03;
    group.add(heroRing);

    // Root bone
    const rootBone = new THREE.Group();
    group.add(rootBone);

    // Enhanced PBR materials per class
    const armorMat = new THREE.MeshStandardMaterial({
      color: colors.armor,
      metalness: 0.75,
      roughness: 0.25,
      emissive: colors.trim,
      emissiveIntensity: 0.3
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: colors.trim,
      metalness: 0.9,
      roughness: 0.2,
      emissive: colors.trim,
      emissiveIntensity: 0.5
    });

    // Pelvis
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.3, 12), armorMat);
    pelvis.position.y = 0.92;
    rootBone.add(pelvis);

    // Legs with enhanced detail
    const createLeg = (isLeft) => {
      const legPivot = new THREE.Group();
      const xOffset = isLeft ? -0.22 : 0.22;
      legPivot.position.set(xOffset, 0.85, 0);

      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.45, 10), armorMat);
      thigh.position.y = -0.22;
      legPivot.add(thigh);

      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), trimMat);
      knee.position.set(0, -0.45, 0.08);
      knee.scale.set(1, 1, 0.8);
      legPivot.add(knee);

      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.42, 10), armorMat);
      shin.position.y = -0.68;
      legPivot.add(shin);

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.38), armorMat);
      boot.position.set(0, -0.85, 0.08);
      legPivot.add(boot);

      return legPivot;
    };

    const leftLeg = createLeg(true);
    const rightLeg = createLeg(false);
    rootBone.add(leftLeg);
    rootBone.add(rightLeg);

    // Torso
    const chestGroup = new THREE.Group();
    chestGroup.position.set(0, 1.05, 0);

    const breastplate = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.36, 0.7, 12), armorMat);
    breastplate.position.y = 0.35;
    chestGroup.add(breastplate);

    // Cape
    const capeGeo = new THREE.PlaneGeometry(0.8, 1.3, 4, 6);
    const capeMat = new THREE.MeshStandardMaterial({ 
      color: colors.cloth, 
      roughness: 0.8,
      side: THREE.DoubleSide
    });
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, 0.4, -0.35);
    cape.rotation.x = 0.15;
    chestGroup.add(cape);

    // Head
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.78, 0);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 14), this.materials.flesh);
    head.position.y = 0.18;
    headGroup.add(head);

    this.buildClassHeadgear(classKey, headGroup, armorMat, trimMat, colors);
    chestGroup.add(headGroup);

    // Arms
    const leftArm = this.createArm(true, classKey, armorMat, trimMat);
    const rightArm = this.createArm(false, classKey, armorMat, trimMat);
    chestGroup.add(leftArm);
    chestGroup.add(rightArm);

    rootBone.add(chestGroup);

    group.userData = {
      rootBone, leftLeg, rightLeg, chestGroup, leftArm, rightArm, cape,
      walkPhase: Math.random() * Math.PI * 2,
      idlePhase: Math.random() * Math.PI * 2,
      attackTimer: 0,
      isMoving: false
    };

    this.createOverheadBar(group, p.name, false, isLocal);
    return group;
  }

  createArm(isLeft, classKey, armorMat, trimMat) {
    const armPivot = new THREE.Group();
    const xOffset = isLeft ? -0.5 : 0.5;
    armPivot.position.set(xOffset, 0.6, 0);

    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), armorMat);
    pauldron.position.set(isLeft ? -0.06 : 0.06, 0.05, 0);
    pauldron.scale.set(1.3, 1.0, 1.3);
    armPivot.add(pauldron);

    const bicep = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.11, 0.38, 10), armorMat);
    bicep.position.y = -0.22;
    armPivot.add(bicep);

    const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.38, 10), armorMat);
    gauntlet.position.y = -0.48;
    armPivot.add(gauntlet);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), trimMat);
    hand.position.set(0, -0.68, 0.08);
    armPivot.add(hand);

    if (isLeft) {
      if (classKey === 'juggernaut') {
        const shield = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.9), trimMat);
        shield.position.set(-0.14, -0.45, 0.28);
        shield.rotation.y = 0.3;
        armPivot.add(shield);
      }
    } else {
      const weapon = this.createClassMainWeapon(classKey, armorMat, trimMat);
      weapon.position.set(0, -0.65, 0.18);
      armPivot.add(weapon);
    }

    return armPivot;
  }

  buildClassHeadgear(classKey, headGroup, armorMat, trimMat, colors) {
    if (classKey === 'juggernaut') {
      const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12), armorMat);
      helm.position.y = 0.25;
      headGroup.add(helm);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.18), this.materials.glow);
      visor.position.set(0, 0.25, 0.28);
      headGroup.add(visor);
    } else if (classKey === 'cleric') {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 10, 28), this.materials.glow);
      halo.position.set(0, 0.4, -0.18);
      headGroup.add(halo);
      const coronet = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.32, 0.2, 10), trimMat);
      coronet.position.y = 0.35;
      headGroup.add(coronet);
    } else if (classKey === 'rogue') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.37, 12, 12), new THREE.MeshStandardMaterial({ color: 0x281838, roughness: 0.9 }));
      hood.position.y = 0.22;
      headGroup.add(hood);
      const eyeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: 0xbb44ff }));
      eyeGlow.position.set(0, 0.22, 0.3);
      headGroup.add(eyeGlow);
    } else if (classKey === 'mage') {
      const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.75, 10), new THREE.MeshStandardMaterial({ color: 0x1b2f5c, roughness: 0.7 }));
      cowl.position.set(0, 0.5, -0.08);
      cowl.rotation.x = -0.2;
      headGroup.add(cowl);
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0x33aaff }));
      rune.position.set(0, 0.85, 0);
      headGroup.add(rune);
    } else if (classKey === 'ranger') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 10), new THREE.MeshStandardMaterial({ color: 0x2c4a22, roughness: 0.85 }));
      cap.position.y = 0.24;
      headGroup.add(cap);
      const feather = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 5), trimMat);
      feather.position.set(0.26, 0.46, -0.18);
      feather.rotation.z = -0.6;
      headGroup.add(feather);
    } else if (classKey === 'necromancer') {
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), this.materials.bone);
      skull.position.set(0, 0.2, 0.1);
      headGroup.add(skull);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat);
      eyeL.position.set(-0.12, 0.24, 0.35);
      const eyeR = eyeL.clone();
      eyeR.position.set(0.12, 0.24, 0.35);
      headGroup.add(eyeL);
      headGroup.add(eyeR);
      const hornMat = new THREE.MeshStandardMaterial({ color: 0x221a18 });
      const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.65, 8), hornMat);
      hornL.position.set(-0.38, 0.42, 0);
      hornL.rotation.z = Math.PI / 3;
      const hornR = hornL.clone();
      hornR.position.set(0.38, 0.42, 0);
      hornR.rotation.z = -Math.PI / 3;
      headGroup.add(hornL);
      headGroup.add(hornR);
    }
  }

  getClassColors(classKey) {
    const colors = {
      juggernaut: { armor: 0x9e3816, trim: 0xff6622, cloth: 0x5c150c },
      cleric: { armor: 0xd6aa24, trim: 0xffea00, cloth: 0xf5f0d3 },
      rogue: { armor: 0x5a2d8a, trim: 0xaa44ff, cloth: 0x1a0f26 },
      mage: { armor: 0x1d5fb0, trim: 0x33aaff, cloth: 0x0d1f42 },
      ranger: { armor: 0x2c7e3a, trim: 0x44ee66, cloth: 0x1b3614 },
      necromancer: { armor: 0x187046, trim: 0x00ff88, cloth: 0x0a2417 }
    };
    return colors[classKey] || colors.juggernaut;
  }

  createOverheadBar(parent, name, isHostile, isLocal) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 40;
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.6, 0.65, 1);
    sprite.position.y = isHostile ? 3.0 : 3.6;
    parent.add(sprite);
    parent.userData.barCanvas = canvas;
    parent.userData.barTexture = texture;
    parent.userData.barSprite = sprite;
    this.drawOverheadBar(canvas, texture, 1, 1, name, isHostile, isLocal);
  }

  updateOverheadBar(parent, hp, maxHp, name, isHostile, isLocal) {
    if (!parent.userData.barCanvas) return;
    this.drawOverheadBar(parent.userData.barCanvas, parent.userData.barTexture, hp, maxHp, name, isHostile, isLocal);
  }

  drawOverheadBar(canvas, texture, hp, maxHp, name, isHostile, isLocal) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 160, 40);
    ctx.font = isLocal ? 'bold 16px sans-serif' : 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    const displayName = isLocal ? `★ ${name} (YOU)` : name;
    ctx.strokeText(displayName, 80, 15);
    ctx.fillStyle = isLocal ? '#2ecc71' : (isHostile ? '#ff6655' : '#ffffff');
    ctx.fillText(displayName, 80, 15);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(10, 22, 140, 13);
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    ctx.fillStyle = isHostile ? '#ff3322' : (isLocal ? '#2ecc71' : '#3ba4ff');
    ctx.fillRect(12, 24, 136 * pct, 9);
    texture.needsUpdate = true;
  }

  update(dt) {
    for (const group of this.playerMeshes.values()) {
      const u = group.userData;
      if (!u || !u.leftLeg || !u.rightLeg) continue;

      if (u.isMoving) {
        u.walkPhase += dt * 9.5;
        const legSwing = Math.sin(u.walkPhase) * 0.65;
        u.leftLeg.rotation.x = legSwing;
        u.rightLeg.rotation.x = -legSwing;
        u.leftArm.rotation.x = -legSwing * 0.6;
        if (u.attackTimer <= 0) u.rightArm.rotation.x = legSwing * 0.6;
        u.rootBone.position.y = Math.abs(Math.sin(u.walkPhase)) * 0.08;
        if (u.cape) u.cape.rotation.x = 0.22 + Math.sin(u.walkPhase) * 0.12;
      } else {
        u.idlePhase += dt * 2.5;
        u.leftLeg.rotation.x = THREE.MathUtils.lerp(u.leftLeg.rotation.x, 0, 0.2);
        u.rightLeg.rotation.x = THREE.MathUtils.lerp(u.rightLeg.rotation.x, 0, 0.2);
        u.leftArm.rotation.x = THREE.MathUtils.lerp(u.leftArm.rotation.x, 0, 0.2);
        if (u.attackTimer <= 0) u.rightArm.rotation.x = THREE.MathUtils.lerp(u.rightArm.rotation.x, 0, 0.2);
        u.rootBone.position.y = Math.sin(u.idlePhase) * 0.02;
        if (u.chestGroup) u.chestGroup.position.y = 1.05 + Math.sin(u.idlePhase) * 0.015;
        if (u.cape) u.cape.rotation.x = 0.08 + Math.sin(u.idlePhase * 0.8) * 0.04;
      }

      if (u.attackTimer > 0) {
        u.attackTimer -= dt;
        const progress = 1 - (u.attackTimer / 0.28);
        u.rightArm.rotation.x = -Math.PI * 0.7 + progress * Math.PI * 1.2;
      }
    }
  }
}
