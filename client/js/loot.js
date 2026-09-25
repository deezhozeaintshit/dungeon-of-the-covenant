// loot.js - 3D Floor Loot, Interactive Shrines, Treasure Chests, Light Beams.
// Phase 3: the need/greed roll modal was removed — drops are decided and
// validated entirely server-side (systems/Gear.js) and land in the player's
// inventory, so contested rolls no longer fit the flow. This module renders
// floor loot visuals only; inventory/equip UI lives in ui/inventory.js.
import * as THREE from '/vendor/three.module.js';

export class LootSystem {
  constructor(scene) {
    this.scene = scene;
    this.lootMeshes = new Map();
    // Phase 3 game feel: fired once per newly-appeared floor drop (drop event).
    this.onLootAdded = null;
  }

  // Sync 3D Floor Loot, Shrines & Chests
  syncFloorLoot(lootData) {
    const activeIds = new Set(lootData.map(l => l.id));

    // Remove collected
    for (const [id, mesh] of this.lootMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.lootMeshes.delete(id);
      }
    }

    for (const l of lootData) {
      let mesh = this.lootMeshes.get(l.id);
      if (!mesh) {
        mesh = this.createLootMesh(l);
        this.lootMeshes.set(l.id, mesh);
        this.scene.add(mesh);
        // Phase 3 game feel: new drop landed — loot beam pillar.
        if (this.onLootAdded) {
          try { this.onLootAdded(l); } catch (e) { /* VFX must never break sync */ }
        }
      }
      mesh.position.set(l.x, 0.25, l.z);
    }
  }

  createLootMesh(l) {
    const group = new THREE.Group();
    group.position.set(l.x, 0.25, l.z);

    if (l.type === 'gold') {
      // Golden Coin Stack
      const coinMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: 0xcc9900,
        emissiveIntensity: 0.9,
        metalness: 0.9,
        roughness: 0.2
      });
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 14), coinMat);
      coin.rotation.x = Math.PI / 4;
      group.add(coin);
      group.userData.rotObject = coin;
    } else if (l.type === 'potion_health') {
      // Glowing Ruby Elixir Flask
      const potMat = new THREE.MeshStandardMaterial({
        color: 0xff2244,
        emissive: 0xcc0022,
        emissiveIntensity: 1.2,
        roughness: 0.2
      });
      const vial = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), potMat);
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 0.25, 8),
        new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8 })
      );
      neck.position.y = 0.28;
      vial.add(neck);
      group.add(vial);
      group.userData.rotObject = vial;
    } else if (l.type === 'gear_drop') {
      const hexColor = l.itemData?.color ? parseInt(l.itemData.color.replace('#', '0x'), 16) : 0xb845ff;
      const coreMat = new THREE.MeshStandardMaterial({
        color: hexColor,
        emissive: hexColor,
        emissiveIntensity: 1.8,
        metalness: 0.9,
        roughness: 0.15
      });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), coreMat);
      crystal.position.y = 0.55;
      group.add(crystal);

      const beamMat = new THREE.MeshBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.45, 5.5, 12, 1, true), beamMat);
      beam.position.y = 2.6;
      group.add(beam);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.78, 24),
        new THREE.MeshBasicMaterial({ color: hexColor, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.18;
      group.add(ring);
      group.userData.rotObject = crystal;
    } else if (l.type === 'treasure_chest') {
      // Ornate Gilded Treasure Chest
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        emissive: 0x886600,
        emissiveIntensity: 0.7,
        metalness: 0.85,
        roughness: 0.25
      });
      const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c3824,
        roughness: 0.6
      });

      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.75), woodMat);
      base.position.y = 0.05;
      group.add(base);

      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.375, 0.375, 1.1, 12, 1, false, 0, Math.PI), goldMat);
      lid.rotation.z = Math.PI / 2;
      lid.position.y = 0.32;
      group.add(lid);

      const glowRing = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.05, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
      );
      glowRing.rotation.x = -Math.PI / 2;
      glowRing.position.y = -0.2;
      group.add(glowRing);

      this.addBillboardLabel(group, '👑 TREASURE CHEST', '#ffd700', 1.6);
    } else if (l.type === 'shrine_blood' || l.type === 'shrine_arcane') {
      const isBlood = (l.type === 'shrine_blood');
      const mainColor = isBlood ? 0xff1133 : 0x22aaff;
      const emissiveColor = isBlood ? 0xcc0022 : 0x0066dd;

      // Pedestal
      const pedMat = new THREE.MeshStandardMaterial({ color: 0x3d334e, roughness: 0.5, metalness: 0.4 });
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 0.7, 8), pedMat);
      ped.position.y = 0.1;
      group.add(ped);

      // Floating Crystal Obelisk
      const crystalMat = new THREE.MeshStandardMaterial({
        color: mainColor,
        emissive: emissiveColor,
        emissiveIntensity: 2.2,
        roughness: 0.15,
        metalness: 0.3
      });
      const obelisk = new THREE.Mesh(new THREE.OctahedronGeometry(0.65), crystalMat);
      obelisk.scale.set(0.8, 2.2, 0.8);
      obelisk.position.y = 1.9;
      group.add(obelisk);
      group.userData.rotObject = obelisk;
      group.userData.baseY = 1.9;

      // Vertical Light Pillar
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.8, 10, 16),
        new THREE.MeshBasicMaterial({ color: mainColor, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
      );
      beam.position.y = 4.8;
      group.add(beam);

      const labelText = isBlood ? '🩸 SHRINE OF BLOOD FURY (+25% DMG)' : '✨ SHRINE OF ASTRAL AEGIS (+30% HP)';
      const labelHex = isBlood ? '#ff4466' : '#44ccff';
      this.addBillboardLabel(group, labelText, labelHex, 3.6);
    } else if (l.type === 'relic_weapon' || l.type === 'relic_talisman') {
      const isWeapon = (l.type === 'relic_weapon');
      const color = isWeapon ? 0xff2244 : 0x22ddff;
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2.0,
        metalness: 0.8,
        roughness: 0.2
      });

      const relicObj = isWeapon
        ? new THREE.Mesh(new THREE.OctahedronGeometry(0.55), mat)
        : new THREE.Mesh(new THREE.TorusKnotGeometry(0.38, 0.12, 32, 8), mat);
      relicObj.position.y = 0.8;
      group.add(relicObj);
      group.userData.rotObject = relicObj;
      group.userData.baseY = 0.8;

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.55, 8, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
      );
      beam.position.y = 4.0;
      group.add(beam);

      const label = isWeapon ? "⚔️ VORGATH'S GREATAXE (+35% DMG)" : "🔮 ASTRAL PHYLACTERY (+30% HASTE)";
      this.addBillboardLabel(group, label, isWeapon ? '#ff4466' : '#33eeff', 2.2);
    } else if (l.type === 'epic_chest') {
      // Epic Relic Chest on Golden Pedestal
      const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.7, 0.4, 12),
        new THREE.MeshStandardMaterial({ color: 0x4c3f63, metalness: 0.5, roughness: 0.4 })
      );
      ped.position.y = -0.05;
      group.add(ped);

      const chestMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: 0xff8800,
        emissiveIntensity: 1.3,
        metalness: 0.85,
        roughness: 0.2
      });
      const chestBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, 0.9), chestMat);
      chestBase.position.y = 0.45;
      group.add(chestBase);

      const chestLid = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.3, 12, 1, false, 0, Math.PI), chestMat);
      chestLid.rotation.z = Math.PI / 2;
      chestLid.position.y = 0.78;
      group.add(chestLid);

      // Vertical Golden Light Beam
      const beamGeo = new THREE.CylinderGeometry(0.35, 0.9, 14, 16);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 7;
      group.add(beam);

      this.addBillboardLabel(group, '🏆 MALAKOR\'S MOLTEN RELIC', '#ffd700', 2.4);
    }

    return group;
  }

  addBillboardLabel(parent, text, colorHex, yOffset) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 56;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(10, 8, 18, 0.85)';
    ctx.fillRect(6, 6, 308, 44);
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(6, 6, 308, 44);

    ctx.font = 'bold 16px Cinzel, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = colorHex;
    ctx.fillText(text, 160, 34);

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set(3.8, 0.68, 1);
    sprite.position.y = yOffset;
    parent.add(sprite);
  }

  update(dt) {
    const time = performance.now() * 0.003;
    for (const [id, mesh] of this.lootMeshes.entries()) {
      if (mesh.userData.rotObject) {
        mesh.userData.rotObject.rotation.y = time * 1.8;
        const baseY = mesh.userData.baseY || 0;
        if (baseY > 0) {
          mesh.userData.rotObject.position.y = baseY + Math.sin(time * 2.5) * 0.15;
        } else {
          mesh.position.y = 0.25 + Math.sin(time * 3) * 0.08;
        }
      }
    }
  }
}
