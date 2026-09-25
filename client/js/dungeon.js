// dungeon.js - Multi-Wing 3D Citadel Geometry (Atrium, Crossroads, West Catacombs, East Vault, Abyssal Bridge & Soul-Forge Sanctum)
import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';

export class DungeonBuilder {
  constructor(scene) {
    this.scene = scene;
    this.gltfLoader = new GLTFLoader();
    this.glbCache = {};
    this.proceduralPropsGroup = new THREE.Group();
    this.scene.add(this.proceduralPropsGroup);
    this.materials = this.initMaterials();
    this.buildDungeon();
    this.loadDefaultBlenderProps();
  }

  initMaterials() {
    // High-visibility Flagstone Tile Texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#3a3447';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#1d1726';
    ctx.lineWidth = 4;
    const tileSize = 64;
    for (let x = 0; x < 256; x += tileSize) {
      for (let y = 0; y < 256; y += tileSize) {
        ctx.fillStyle = ((x / tileSize + y / tileSize) % 2 === 0) ? '#474056' : '#383244';
        ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
        ctx.strokeRect(x, y, tileSize, tileSize);
      }
    }

    const floorTexture = new THREE.CanvasTexture(canvas);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(8, 8);

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.68,
      metalness: 0.12
    });

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2d253b,
      roughness: 0.78,
      metalness: 0.15
    });

    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x433857,
      roughness: 0.6,
      metalness: 0.25
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x6c5a85,
      roughness: 0.5,
      metalness: 0.35
    });

    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff2200,
      emissiveIntensity: 2.0,
      roughness: 0.25,
      metalness: 0.1
    });

    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x3b3b46,
      roughness: 0.4,
      metalness: 0.8
    });

    const bloodTrimMat = new THREE.MeshStandardMaterial({
      color: 0x881122,
      emissive: 0x550011,
      emissiveIntensity: 0.8,
      roughness: 0.4
    });

    const arcaneTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1166cc,
      emissive: 0x0044aa,
      emissiveIntensity: 0.9,
      roughness: 0.35
    });

    return {
      floor: floorMat,
      wall: wallMat,
      pillar: pillarMat,
      trim: trimMat,
      lava: lavaMat,
      iron: ironMat,
      bloodTrim: bloodTrimMat,
      arcaneTrim: arcaneTrimMat
    };
  }

  buildDungeon() {
    const g = new THREE.Group();
    const wallH = 4.8;
    const lowH = 0.8; // Cutaway south walls so camera never gets blocked
    const thick = 1.2;

    // =========================================================================
    // 1. ZONE 1: THE COVENANT ATRIUM (x: [-14, 14], z: [10, 28])
    // =========================================================================
    this.addFloor(g, 0, 19, 28, 18);
    // South cutaway wall (z = 28)
    this.addWallFromTo(g, -14, 28, 14, 28, lowH, thick);
    // West & East walls (z: 10 to 28)
    this.addWallFromTo(g, -14, 10, -14, 28, wallH, thick);
    this.addWallFromTo(g, 14, 10, 14, 28, wallH, thick);
    // North wall split for Narthex doorway (x: [-5, 5]) — cutaway height so it never blocks camera view
    this.addWallFromTo(g, -14, 10, -5, 10, lowH, thick);
    this.addWallFromTo(g, 5, 10, 14, 10, lowH, thick);
    this.addArchway(g, 0, 10, 10, wallH, 0);

    // Atrium Spawn Rune Circle & Healing Font
    this.addFloorRuneCircle(g, 0, 16, 4.2, 0x2ecc71);
    this.addFountain(g, 0, 23.5, 0x2ecc71);

    // =========================================================================
    // 2. ZONE 2: THE NARTHEX PASSAGE (x: [-5, 5], z: [-2, 10])
    // =========================================================================
    this.addFloor(g, 0, 4, 10, 12);
    this.addWallFromTo(g, -5, -2, -5, 10, wallH, thick);
    this.addWallFromTo(g, 5, -2, 5, 10, wallH, thick);
    this.addArchway(g, 0, -2, 10, wallH, 0);

    // =========================================================================
    // 3. ZONE 3: THE GRAND CROSSROADS HUB (x: [-18, 18], z: [-26, -2])
    // =========================================================================
    this.addFloor(g, 0, -14, 36, 24);
    // South wall split for Narthex doorway (x: [-5, 5])
    this.addWallFromTo(g, -18, -2, -5, -2, lowH, thick);
    this.addWallFromTo(g, 5, -2, 18, -2, lowH, thick);
    // North wall split for Abyssal Bridge doorway (x: [-6, 6])
    this.addWallFromTo(g, -18, -26, -6, -26, lowH, thick);
    this.addWallFromTo(g, 6, -26, 18, -26, lowH, thick);
    this.addArchway(g, 0, -26, 12, wallH, 0);
    // West wall split for West Wing corridor (z: [-18, -10])
    this.addWallFromTo(g, -18, -26, -18, -18, wallH, thick);
    this.addWallFromTo(g, -18, -10, -18, -2, wallH, thick);
    this.addArchway(g, -18, -14, 8, wallH, Math.PI / 2);
    // East wall split for East Wing corridor (z: [-18, -10])
    this.addWallFromTo(g, 18, -26, 18, -18, wallH, thick);
    this.addWallFromTo(g, 18, -10, 18, -2, wallH, thick);
    this.addArchway(g, 18, -14, 8, wallH, Math.PI / 2);

    // Central Crossroads Compass Mosaic
    this.addFloorRuneCircle(g, 0, -14, 5.8, 0xd4af37);

    // =========================================================================
    // 4. ZONE 4: WEST WING — THE BLOOD RELIQUARY (x: [-54, -30], z: [-28, 0])
    // =========================================================================
    // Connecting Corridor (x: [-30, -18], z: [-18, -10])
    this.addFloor(g, -24, -14, 12, 8);
    this.addWallFromTo(g, -30, -18, -18, -18, lowH, thick);
    this.addWallFromTo(g, -30, -10, -18, -10, lowH, thick);
    this.addArchway(g, -30, -14, 8, wallH, Math.PI / 2);

    // Main Blood Reliquary Hall (24m x 28m)
    this.addFloor(g, -42, -14, 24, 28);
    // East wall split for doorway (z: [-18, -10])
    this.addWallFromTo(g, -30, -28, -30, -18, wallH, thick);
    this.addWallFromTo(g, -30, -10, -30, 0, wallH, thick);
    // West, North, and cutaway South walls
    this.addWallFromTo(g, -54, -28, -54, 0, wallH, thick);
    this.addWallFromTo(g, -54, -28, -30, -28, wallH, thick);
    this.addWallFromTo(g, -54, 0, -30, 0, lowH, thick);

    // Crimson Carpet & Blood Shrine Dais at (-49, -14)
    const bloodCarpet = new THREE.Mesh(new THREE.PlaneGeometry(20, 4.5), this.materials.bloodTrim);
    bloodCarpet.rotation.x = -Math.PI / 2;
    bloodCarpet.position.set(-40, 0.02, -14);
    g.add(bloodCarpet);
    this.addFloorRuneCircle(g, -49, -14, 3.2, 0xff2244);

    // Stone Sarcophagi along North & South alcoves
    this.addSarcophagus(g, -36, -25.5);
    this.addSarcophagus(g, -44, -25.5);
    this.addSarcophagus(g, -36, -2.5);
    this.addSarcophagus(g, -44, -2.5);

    // =========================================================================
    // 5. ZONE 5: EAST WING — THE ALCHEMIST'S VAULT (x: [30, 54], z: [-28, 0])
    // =========================================================================
    // Connecting Corridor (x: [18, 30], z: [-18, -10])
    this.addFloor(g, 24, -14, 12, 8);
    this.addWallFromTo(g, 18, -18, 30, -18, lowH, thick);
    this.addWallFromTo(g, 18, -10, 30, -10, lowH, thick);
    this.addArchway(g, 30, -14, 8, wallH, Math.PI / 2);

    // Main Alchemist's Vault Hall (24m x 28m)
    this.addFloor(g, 42, -14, 24, 28);
    // West wall split for doorway (z: [-18, -10])
    this.addWallFromTo(g, 30, -28, 30, -18, wallH, thick);
    this.addWallFromTo(g, 30, -10, 30, 0, wallH, thick);
    // East, North, and cutaway South walls
    this.addWallFromTo(g, 54, -28, 54, 0, wallH, thick);
    this.addWallFromTo(g, 30, -28, 54, -28, wallH, thick);
    this.addWallFromTo(g, 30, 0, 54, 0, lowH, thick);

    // Astral Carpet & Arcane Shrine Dais at (49, -14)
    const arcaneCarpet = new THREE.Mesh(new THREE.PlaneGeometry(20, 4.5), this.materials.arcaneTrim);
    arcaneCarpet.rotation.x = -Math.PI / 2;
    arcaneCarpet.position.set(40, 0.02, -14);
    g.add(arcaneCarpet);
    this.addFloorRuneCircle(g, 49, -14, 3.2, 0x22aaff);

    // Arcane Crystal Reliquaries along North & South walls
    this.addArcanePodium(g, 36, -25.5);
    this.addArcanePodium(g, 44, -25.5);
    this.addArcanePodium(g, 36, -2.5);
    this.addArcanePodium(g, 44, -2.5);

    // =========================================================================
    // 6. ZONE 6: THE ABYSSAL BRIDGE & ANTECHAMBER OF CHAINS (z: [-56, -26])
    // =========================================================================
    // A. Abyssal Bridge (x: [-6, 6], z: [-42, -26])
    this.addFloor(g, 0, -34, 12, 16);
    // Low bridge parapets so players see the molten lava chasm on both sides
    this.addWallFromTo(g, -6, -42, -6, -26, 1.1, 0.7);
    this.addWallFromTo(g, 6, -42, 6, -26, 1.1, 0.7);

    // Molten Lava Chasm flanking the bridge
    const leftChasm = new THREE.Mesh(new THREE.PlaneGeometry(18, 15), this.materials.lava);
    leftChasm.rotation.x = -Math.PI / 2;
    leftChasm.position.set(-16, -0.8, -34);
    g.add(leftChasm);

    const rightChasm = new THREE.Mesh(new THREE.PlaneGeometry(18, 15), this.materials.lava);
    rightChasm.rotation.x = -Math.PI / 2;
    rightChasm.position.set(16, -0.8, -34);
    g.add(rightChasm);

    // B. Antechamber of Chains (x: [-16, 16], z: [-56, -42])
    this.addFloor(g, 0, -49, 32, 14);
    // South wall split for bridge (x: [-6, 6])
    this.addWallFromTo(g, -16, -42, -6, -42, lowH, thick);
    this.addWallFromTo(g, 6, -42, 16, -42, lowH, thick);
    // West & East walls
    this.addWallFromTo(g, -16, -56, -16, -42, wallH, thick);
    this.addWallFromTo(g, 16, -56, 16, -42, wallH, thick);
    // North wall split for Grand Boss Gateway (x: [-8, 8])
    this.addWallFromTo(g, -16, -56, -8, -56, lowH, thick);
    this.addWallFromTo(g, 8, -56, 16, -56, lowH, thick);
    this.addArchway(g, 0, -56, 16, wallH + 1.2, 0);

    // Restoration Wells in Antechamber
    this.addFountain(g, -11, -49, 0x3ba4ff);
    this.addFountain(g, 11, -49, 0x3ba4ff);

    // =========================================================================
    // 7. ZONE 7: THE SOUL-FORGE BOSS SANCTUM (x: [-24, 24], z: [-92, -56])
    // =========================================================================
    this.addFloor(g, 0, -74, 48, 36);
    // South wall split for Boss Gateway (x: [-8, 8])
    this.addWallFromTo(g, -24, -56, -8, -56, lowH, thick);
    this.addWallFromTo(g, 8, -56, 24, -56, lowH, thick);
    // West, East, and North Sanctum Walls
    this.addWallFromTo(g, -24, -92, -24, -56, wallH + 1.2, thick);
    this.addWallFromTo(g, 24, -92, 24, -56, wallH + 1.2, thick);
    this.addWallFromTo(g, -24, -92, 24, -92, wallH + 1.2, thick);

    // Perimeter Molten Lava Rivers inside Boss Sanctum
    const northLava = new THREE.Mesh(new THREE.PlaneGeometry(44, 3.0), this.materials.lava);
    northLava.rotation.x = -Math.PI / 2;
    northLava.position.set(0, 0.03, -89.5);
    g.add(northLava);

    const westLava = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 32), this.materials.lava);
    westLava.rotation.x = -Math.PI / 2;
    westLava.position.set(-22, 0.03, -74);
    g.add(westLava);

    const eastLava = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 32), this.materials.lava);
    eastLava.rotation.x = -Math.PI / 2;
    eastLava.position.set(22, 0.03, -74);
    g.add(eastLava);

    // Flat Inlaid Molten Runic Summoning Circle at (0, -75) — Zero black cubes!
    this.addFloorRuneCircle(g, 0, -75, 8.5, 0xff4400);
    this.addFloorRuneCircle(g, 0, -75, 4.5, 0xffaa00);

    // =========================================================================
    // 8. ARCHITECTURAL COLUMNS & WALL TORCHES ACROSS ALL WINGS
    // =========================================================================
    this.placePillars(g);
    this.placeTorches(g);

    this.scene.add(g);
  }

  addFloor(parent, centerX, centerZ, width, depth) {
    const geo = new THREE.PlaneGeometry(width, depth);
    const mesh = new THREE.Mesh(geo, this.materials.floor);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  addWallFromTo(parent, x1, z1, x2, z2, height, thickness) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 0.1) return;

    const midX = (x1 + x2) * 0.5;
    const midZ = (z1 + z2) * 0.5;

    const isHorizontal = Math.abs(dx) >= Math.abs(dz);
    const w = isHorizontal ? length : thickness;
    const d = isHorizontal ? thickness : length;

    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), this.materials.wall);
    wall.position.set(midX, height * 0.5, midZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    parent.add(wall);

    // Stone parapet cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.22, d + 0.2), this.materials.trim);
    cap.position.set(midX, height + 0.1, midZ);
    parent.add(cap);
  }

  addArchway(parent, x, z, spanWidth, height, rotY = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotY;

    // Left & Right Gateway Columns (No horizontal overhead lintel bar blocking top-down view!)
    const colH = 2.6;
    const jambGeo = new THREE.CylinderGeometry(0.48, 0.6, colH, 10);
    const leftJamb = new THREE.Mesh(jambGeo, this.materials.pillar);
    leftJamb.position.set(-spanWidth * 0.5, colH * 0.5, 0);
    group.add(leftJamb);

    const rightJamb = new THREE.Mesh(jambGeo, this.materials.pillar);
    rightJamb.position.set(spanWidth * 0.5, colH * 0.5, 0);
    group.add(rightJamb);

    const flameMat = new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xffaa22, emissiveIntensity: 2.8 });
    const leftFlame = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28), flameMat);
    leftFlame.position.set(-spanWidth * 0.5, colH + 0.25, 0);
    group.add(leftFlame);

    const rightFlame = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28), flameMat);
    rightFlame.position.set(spanWidth * 0.5, colH + 0.25, 0);
    group.add(rightFlame);

    parent.add(group);
  }

  addFloorRuneCircle(parent, x, z, radius, colorHex) {
    const group = new THREE.Group();
    group.position.set(x, 0.03, z);

    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.88, radius, 36),
      new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
    );
    outerRing.rotation.x = -Math.PI / 2;
    group.add(outerRing);

    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.45, radius * 0.52, 24),
      new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    );
    innerRing.rotation.x = -Math.PI / 2;
    group.add(innerRing);

    parent.add(group);
  }

  addFountain(parent, x, z, glowColor) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.65, 12), this.materials.pillar);
    basin.position.y = 0.32;
    group.add(basin);

    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.1, 12),
      new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 1.5, roughness: 0.15 })
    );
    water.position.y = 0.62;
    group.add(water);

    parent.add(group);
  }

  addSarcophagus(parent, x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const base = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 1.3), this.materials.pillar);
    base.position.y = 0.35;
    group.add(base);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.25, 1.4), this.materials.trim);
    lid.position.y = 0.82;
    group.add(lid);

    parent.add(group);
  }

  addArcanePodium(parent, x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 1.2, 8), this.materials.pillar);
    col.position.y = 0.6;
    group.add(col);

    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42),
      new THREE.MeshStandardMaterial({ color: 0x33ccff, emissive: 0x1188ff, emissiveIntensity: 2.0 })
    );
    crystal.position.y = 1.65;
    group.add(crystal);

    parent.add(group);
  }

  placePillars(parent) {
    // Matches server/game/Collision.js pillar coordinates 1-to-1
    const pillarPositions = [
      // Zone 1: Covenant Atrium
      { x: -7, z: 19 }, { x: 7, z: 19 },
      // Zone 3: Grand Crossroads Rotunda
      { x: -9, z: -8 }, { x: 9, z: -8 },
      { x: -9, z: -20 }, { x: 9, z: -20 },
      // Zone 4: West Wing (Blood Reliquary)
      { x: -38, z: -7 }, { x: -38, z: -21 },
      // Zone 5: East Wing (Alchemist's Vault)
      { x: 38, z: -7 }, { x: 38, z: -21 },
      // Zone 6: Antechamber of Chains
      { x: -9, z: -49 }, { x: 9, z: -49 },
      // Zone 7: Soul-Forge Boss Sanctum
      { x: -14, z: -64 }, { x: 14, z: -64 },
      { x: -14, z: -84 }, { x: 14, z: -84 }
    ];

    pillarPositions.forEach(pos => {
      const pillarGroup = new THREE.Group();
      pillarGroup.position.set(pos.x, 0, pos.z);

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 5.0, 10), this.materials.pillar);
      shaft.position.y = 2.5;
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      pillarGroup.add(shaft);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.45, 10), this.materials.trim);
      base.position.y = 0.22;
      pillarGroup.add(base);

      // Glowing Brazier Crown on top of each column
      const brazierFlame = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.32),
        new THREE.MeshStandardMaterial({ color: 0xff7700, emissive: 0xffaa22, emissiveIntensity: 2.5 })
      );
      brazierFlame.position.y = 5.2;
      pillarGroup.add(brazierFlame);

      parent.add(pillarGroup);
    });
  }

  placeTorches(parent) {
    const torchLocations = [
      { x: -13.2, z: 19, rotY: Math.PI / 2 },
      { x: 13.2, z: 19, rotY: -Math.PI / 2 },
      { x: -17.2, z: -14, rotY: Math.PI / 2 },
      { x: 17.2, z: -14, rotY: -Math.PI / 2 },
      { x: -42, z: -27.2, rotY: 0 },
      { x: 42, z: -27.2, rotY: 0 },
      { x: -15.2, z: -49, rotY: Math.PI / 2 },
      { x: 15.2, z: -49, rotY: -Math.PI / 2 },
      { x: -23.2, z: -68, rotY: Math.PI / 2 },
      { x: 23.2, z: -68, rotY: -Math.PI / 2 },
      { x: -23.2, z: -82, rotY: Math.PI / 2 },
      { x: 23.2, z: -82, rotY: -Math.PI / 2 }
    ];

    torchLocations.forEach(pos => {
      const sconce = new THREE.Group();
      sconce.position.set(pos.x, 3.2, pos.z);
      sconce.rotation.y = pos.rotY;

      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.15, 0.35, 6), this.materials.iron);
      sconce.add(bowl);

      const flame = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.28),
        new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xffaa00, emissiveIntensity: 3.2 })
      );
      flame.position.y = 0.3;
      sconce.add(flame);

      parent.add(sconce);
    });
  }

  loadDefaultBlenderProps() {
    const defaultProps = [
      { type: 'covenant_obelisk', modelUrl: '/assets/models/covenant_obelisk.glb', x: -8, y: 0, z: 16, scale: 1.1 },
      { type: 'covenant_obelisk', modelUrl: '/assets/models/covenant_obelisk.glb', x: 8, y: 0, z: 16, scale: 1.1 },
      { type: 'arcane_portal_gate', modelUrl: '/assets/models/arcane_portal_gate.glb', x: 0, y: 0, z: 24, scale: 1.2 },
      { type: 'soul_altar', modelUrl: '/assets/models/soul_altar.glb', x: 0, y: 0, z: -14, scale: 1.25 },
      { type: 'gothic_pillar_brazier', modelUrl: '/assets/models/gothic_pillar_brazier.glb', x: -12, y: 0, z: -8, scale: 1.05 },
      { type: 'gothic_pillar_brazier', modelUrl: '/assets/models/gothic_pillar_brazier.glb', x: 12, y: 0, z: -8, scale: 1.05 },
      { type: 'bone_reliquary_throne', modelUrl: '/assets/models/bone_reliquary_throne.glb', x: -46, y: 0, z: -14, scale: 1.25 },
      { type: 'cursed_sarcophagus', modelUrl: '/assets/models/cursed_sarcophagus.glb', x: -38, y: 0, z: -8, scale: 1.2 },
      { type: 'mythic_chest', modelUrl: '/assets/models/mythic_chest.glb', x: -42, y: 0, z: -25, scale: 1.3 },
      { type: 'mythic_chest', modelUrl: '/assets/models/mythic_chest.glb', x: 42, y: 0, z: -25, scale: 1.3 },
      { type: 'arcane_portal_gate', modelUrl: '/assets/models/arcane_portal_gate.glb', x: 46, y: 0, z: -14, scale: 1.2 },
      { type: 'covenant_obelisk', modelUrl: '/assets/models/covenant_obelisk.glb', x: -12, y: 0, z: -72, scale: 1.35 },
      { type: 'covenant_obelisk', modelUrl: '/assets/models/covenant_obelisk.glb', x: 12, y: 0, z: -72, scale: 1.35 },
      { type: 'soul_altar', modelUrl: '/assets/models/soul_altar.glb', x: 0, y: 0, z: -84, scale: 1.45 }
    ];
    defaultProps.forEach(p => this.spawnGLBProp(p));
  }

  spawnGLBProp(propDef) {
    const url = propDef.modelUrl || `/assets/models/${propDef.type}.glb`;
    const attachModel = (gltfScene) => {
      const instance = gltfScene.clone(true);
      const scale = propDef.scale || 1.0;
      instance.scale.set(scale, scale, scale);
      instance.position.set(propDef.x || 0, propDef.y || 0, propDef.z || 0);
      instance.rotation.y = propDef.rotY || 0;

      instance.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Add a mystical base ring and subtle point light to highlight the Blender 3D asset
      const ringColor = propDef.type === 'mythic_chest' ? 0xffbb22 : (propDef.type === 'soul_altar' ? 0x00ffaa : 0xaa33ff);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.1 * scale, 1.45 * scale, 24),
        new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(propDef.x || 0, 0.04, propDef.z || 0);

      this.proceduralPropsGroup.add(instance);
      this.proceduralPropsGroup.add(ring);
    };

    if (this.glbCache[url]) {
      attachModel(this.glbCache[url]);
      return;
    }

    this.gltfLoader.load(
      url,
      (gltf) => {
        this.glbCache[url] = gltf.scene;
        attachModel(gltf.scene);
      },
      undefined,
      (err) => {
        console.warn('[DungeonBuilder] Fallback procedural mesh for GLB:', url, err);
      }
    );
  }

  generateBiomeFloorTexture(biomeId) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const palettes = {
      ossuary_crypt:   { bg: '#221a17', tileA: '#3b2e28', tileB: '#2d221d', grout: '#ff5500', vein: '#ff9933' },
      glacial_sanctum: { bg: '#0c2238', tileA: '#1b4975', tileB: '#14385c', grout: '#33ddff', vein: '#a8f2ff' },
      blood_citadel:   { bg: '#1f060c', tileA: '#3d0c18', tileB: '#2b0810', grout: '#ff1144', vein: '#fbbf24' },
      void_nexus:      { bg: '#0b051c', tileA: '#1f1042', tileB: '#150a30', grout: '#b833ff', vein: '#00f0ff' },
      blight_catacombs:{ bg: '#0a1c0e', tileA: '#1b3d22', tileB: '#132b18', grout: '#22ff66', vein: '#a3e635' }
    };
    const pal = palettes[biomeId] || palettes.ossuary_crypt;

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, 256, 256);

    const tileSize = 64;
    for (let x = 0; x < 256; x += tileSize) {
      for (let y = 0; y < 256; y += tileSize) {
        const isEven = ((x / tileSize + y / tileSize) % 2 === 0);
        ctx.fillStyle = isEven ? pal.tileA : pal.tileB;
        ctx.fillRect(x + 3, y + 3, tileSize - 6, tileSize - 6);

        // Glowing Biome Grout & Rune Border
        ctx.strokeStyle = pal.grout;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);

        // Inner Geometric Inlay
        ctx.strokeStyle = pal.vein;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 12, y + 12);
        ctx.lineTo(x + tileSize - 12, y + tileSize - 12);
        ctx.stroke();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    tex.needsUpdate = true;
    return tex;
  }

  spawnBiomeArchitecture(biomeId) {
    const spots = [
      { x: -10, z: 22 }, { x: 10, z: 22 }, { x: -10, z: 12 }, { x: 10, z: 12 },
      { x: -14, z: -6 }, { x: 14, z: -6 }, { x: -14, z: -22 }, { x: 14, z: -22 },
      { x: -34, z: -4 }, { x: -48, z: -14 }, { x: 34, z: -4 }, { x: 48, z: -14 },
      { x: -5, z: -32 }, { x: 5, z: -32 }, { x: -5, z: -38 }, { x: 5, z: -38 },
      { x: -12, z: -48 }, { x: 12, z: -48 },
      { x: -18, z: -68 }, { x: 18, z: -68 }, { x: -18, z: -80 }, { x: 18, z: -80 }
    ];

    spots.forEach((pt, idx) => {
      const landmark = new THREE.Group();
      landmark.position.set(pt.x, 0, pt.z);

      if (biomeId === 'glacial_sanctum') {
        // Towering Translucent Crystalline Ice Spires & Floating Frost Shards
        const iceMat = new THREE.MeshStandardMaterial({
          color: 0x66e0ff,
          emissive: 0x0099ff,
          emissiveIntensity: 1.6,
          roughness: 0.12,
          metalness: 0.75,
          transparent: true,
          opacity: 0.88
        });
        const mainSpire = new THREE.Mesh(new THREE.ConeGeometry(0.85, 5.2, 6), iceMat);
        mainSpire.position.y = 2.6;
        const sideSpire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.2, 5), iceMat);
        sideSpire.position.set(0.55, 1.5, 0.25);
        sideSpire.rotation.z = -0.32;
        landmark.add(mainSpire, sideSpire);
      } else if (biomeId === 'blood_citadel') {
        // Sanguine Sacrificial Blood Chalice & Jagged Crimson Obelisk Spikes
        const obsidianMat = new THREE.MeshStandardMaterial({ color: 0x24070d, metalness: 0.8, roughness: 0.3 });
        const bloodGlow = new THREE.MeshStandardMaterial({ color: 0xff1144, emissive: 0xdd0033, emissiveIntensity: 2.6 });
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 2.2, 8), obsidianMat);
        pedestal.position.y = 1.1;
        const bloodPool = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 12), bloodGlow);
        bloodPool.scale.set(1, 0.4, 1);
        bloodPool.position.y = 2.25;
        const floatingBlade = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), bloodGlow);
        floatingBlade.scale.set(0.5, 2.4, 0.5);
        floatingBlade.position.y = 3.85;
        landmark.add(pedestal, bloodPool, floatingBlade);
      } else if (biomeId === 'void_nexus') {
        // Levitating Gravity-Warped Monolith Cube & Dimensional Portal Ring
        const voidMat = new THREE.MeshStandardMaterial({ color: 0x16092e, metalness: 0.9, roughness: 0.2 });
        const portalMat = new THREE.MeshStandardMaterial({ color: 0xc044ff, emissive: 0x9922ff, emissiveIntensity: 3.0 });
        const floatingCube = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), voidMat);
        floatingCube.position.y = 2.95;
        floatingCube.rotation.set(0.65, idx * 0.5, 0.45);
        const portalRing = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.08, 8, 24), portalMat);
        portalRing.position.y = 2.95;
        portalRing.rotation.y = idx * 0.4;
        landmark.add(floatingCube, portalRing);
      } else if (biomeId === 'blight_catacombs') {
        // Giant Bioluminescent Plague Spore Mushroom & Venom Crystal Cluster
        const stalkMat = new THREE.MeshStandardMaterial({ color: 0xc8d6b9, roughness: 0.7 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x00cc44, emissiveIntensity: 2.2, roughness: 0.35 });
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 2.8, 8), stalkMat);
        stalk.position.y = 1.4;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.45, 1.15, 12), capMat);
        cap.position.y = 2.95;
        landmark.add(stalk, cap);
      } else {
        // Sunken Ossuary: Colossal Curved Bone Rib-Pillar & Molten Soul Brazier
        const boneMat = new THREE.MeshStandardMaterial({ color: 0xe3dccb, roughness: 0.5 });
        const fireMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff3300, emissiveIntensity: 3.0 });
        const ribCurve = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.22, 8, 18, Math.PI * 0.65), boneMat);
        ribCurve.position.set(0, 1.8, 0);
        ribCurve.rotation.z = pt.x < 0 ? -0.35 : 0.35;
        const fireOrb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42), fireMat);
        fireOrb.position.set(0, 3.6, 0);
        landmark.add(ribCurve, fireOrb);
      }

      this.proceduralPropsGroup.add(landmark);
    });
  }

  applyProceduralFloorConfig(config) {
    if (!config) return;

    const biomeId = config.biome?.id || 'ossuary_crypt';

    // 1. Dynamically Regenerate Floor Tile Texture & Moat Liquid Shader per Biome!
    if (this.materials.floor) {
      this.materials.floor.map = this.generateBiomeFloorTexture(biomeId);
      this.materials.floor.roughness = biomeId === 'glacial_sanctum' ? 0.18 : 0.58;
      this.materials.floor.metalness = biomeId === 'glacial_sanctum' ? 0.55 : 0.18;
      this.materials.floor.needsUpdate = true;
    }

    if (this.materials.lava) {
      const liquidColors = {
        ossuary_crypt:   { col: 0xff4400, em: 0xff2200 },
        glacial_sanctum: { col: 0x00e5ff, em: 0x0088ff },
        blood_citadel:   { col: 0xff0033, em: 0xaa0018 },
        void_nexus:      { col: 0xa822ff, em: 0x6600cc },
        blight_catacombs:{ col: 0x22ff55, em: 0x00aa22 }
      };
      const liq = liquidColors[biomeId] || liquidColors.ossuary_crypt;
      this.materials.lava.color.setHex(liq.col);
      this.materials.lava.emissive.setHex(liq.em);
      this.materials.lava.needsUpdate = true;
    }

    if (config.biome) {
      if (config.biome.wallTint && this.materials.wall) {
        this.materials.wall.color.setHex(config.biome.wallTint);
      }
      if (config.biome.floorTint && this.materials.pillar) {
        this.materials.pillar.color.setHex(config.biome.floorTint);
      }
      if (config.biome.trimTint && this.materials.trim) {
        this.materials.trim.color.setHex(config.biome.trimTint);
      }
      if (config.biome.fogColor && this.scene.fog) {
        this.scene.fog.color.setHex(config.biome.fogColor);
      }
    }

    // 2. Clear and Respawn Both 3D Biome Architectural Landmarks & Procedural Blender Props
    while (this.proceduralPropsGroup.children.length > 0) {
      const child = this.proceduralPropsGroup.children[0];
      this.proceduralPropsGroup.remove(child);
    }

    this.spawnBiomeArchitecture(biomeId);

    const propList = Array.isArray(config.props) ? config.props : (Array.isArray(config.glbProps) ? config.glbProps : []);
    if (propList.length > 0) {
      propList.forEach(p => this.spawnGLBProp(p));
    } else {
      this.loadDefaultBlenderProps();
    }
  }
}
