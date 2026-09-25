// EnhancedDungeon.js - AAA Dungeon with Detail Meshes and PBR Materials
// Adds decorative geometry, dynamic lighting, and environmental details

import * as THREE from '/vendor/three.module.js';

export class EnhancedDungeon {
  constructor(scene) {
    this.scene = scene;
    this.detailMeshes = [];
    this.dynamicLights = [];
    
    // PBR Materials
    this.materials = {
      stone: new THREE.MeshStandardMaterial({
        color: 0x3a3a4a,
        metalness: 0.1,
        roughness: 0.9,
        envMapIntensity: 0.5
      }),
      stoneDark: new THREE.MeshStandardMaterial({
        color: 0x2a2a3a,
        metalness: 0.1,
        roughness: 0.95,
        envMapIntensity: 0.3
      }),
      stoneLight: new THREE.MeshStandardMaterial({
        color: 0x4a4a5a,
        metalness: 0.15,
        roughness: 0.85,
        envMapIntensity: 0.6
      }),
      iron: new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        metalness: 0.9,
        roughness: 0.4,
        envMapIntensity: 1.0
      }),
      gold: new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        metalness: 0.95,
        roughness: 0.2,
        envMapIntensity: 1.5
      }),
      lava: new THREE.MeshStandardMaterial({
        color: 0xff4400,
        emissive: 0xff2200,
        emissiveIntensity: 2.0,
        metalness: 0.0,
        roughness: 0.8
      }),
      rune: new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.8
      }),
      bone: new THREE.MeshStandardMaterial({
        color: 0xe8e2d4,
        metalness: 0.05,
        roughness: 0.7
      })
    };
  }

  // Build enhanced dungeon with all zones
  build() {
    this.clear();
    this.buildZone1Atrium();
    this.buildZone2Narthex();
    this.buildZone3Crossroads();
    this.buildZone4WestWing();
    this.buildZone5EastWing();
    this.buildZone6Bridge();
    this.buildZone7BossSanctum();
    this.addAtmosphericEffects();
  }

  clear() {
    for (const mesh of this.detailMeshes) {
      this.scene.remove(mesh);
    }
    for (const light of this.dynamicLights) {
      this.scene.remove(light);
    }
    this.detailMeshes = [];
    this.dynamicLights = [];
  }

  // Zone 1: Covenant Atrium
  buildZone1Atrium() {
    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(28, 18), this.materials.stone);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, 19);
    this.scene.add(floor);
    this.detailMeshes.push(floor);

    // Walls
    this.addWall(-14, 4, 19, 0.5, 8, 18);
    this.addWall(14, 4, 19, 0.5, 8, 18);
    this.addWall(0, 4, 10, 28, 8, 0.5);
    this.addWall(0, 4, 28, 28, 8, 0.5);

    // Pillars
    this.addPillar(-7, 19);
    this.addPillar(7, 19);

    // Spawn Rune Circle
    const runeCircle = new THREE.Mesh(
      new THREE.RingGeometry(2.5, 3.0, 32),
      this.materials.rune
    );
    runeCircle.rotation.x = -Math.PI / 2;
    runeCircle.position.set(0, 0.02, 23);
    this.scene.add(runeCircle);
    this.detailMeshes.push(runeCircle);

    // Healing Fountain
    const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.8, 16), this.materials.stone);
    fountainBase.position.set(0, 0.4, 23);
    this.scene.add(fountainBase);
    this.detailMeshes.push(fountainBase);

    const fountainWater = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.0, 0.1, 16),
      new THREE.MeshStandardMaterial({
        color: 0x44aaff,
        emissive: 0x2266cc,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.7
      })
    );
    fountainWater.position.set(0, 0.85, 23);
    this.scene.add(fountainWater);
    this.detailMeshes.push(fountainWater);

    // Lighting
    const light1 = new THREE.PointLight(0xffaa44, 1.5, 20);
    light1.position.set(-5, 6, 20);
    this.scene.add(light1);
    this.dynamicLights.push(light1);

    const light2 = new THREE.PointLight(0xffaa44, 1.5, 20);
    light2.position.set(5, 6, 20);
    this.scene.add(light2);
    this.dynamicLights.push(light2);
  }

  // Zone 2: Narthex Passage
  buildZone2Narthex() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 12), this.materials.stoneDark);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, 4);
    this.scene.add(floor);
    this.detailMeshes.push(floor);

    // Colonnade
    for (let i = -2; i <= 2; i++) {
      this.addPillar(i * 2.5, 0);
      this.addPillar(i * 2.5, 8);
    }

    // Archway
    const arch = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.4, 8, 16, Math.PI), this.materials.stone);
    arch.position.set(0, 4, 0);
    this.scene.add(arch);
    this.detailMeshes.push(arch);
  }

  // Zone 3: Grand Crossroads
  buildZone3Crossroads() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 24), this.materials.stone);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -14);
    this.scene.add(floor);
    this.detailMeshes.push(floor);

    // Rotunda pillars
    this.addPillar(-9, -8);
    this.addPillar(9, -8);
    this.addPillar(-9, -20);
    this.addPillar(9, -20);

    // Central monument
    const monument = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 3, 8), this.materials.stoneDark);
    monument.position.set(0, 1.5, -14);
    this.scene.add(monument);
    this.detailMeshes.push(monument);

    // Corridors to wings
    this.buildCorridor(-24, -14, -30, -14);
    this.buildCorridor(24, -14, 30, -14);
    this.buildCorridor(0, -14, 0, -42);

    // Lighting
    const light = new THREE.PointLight(0xffcc66, 2.0, 25);
    light.position.set(0, 7, -14);
    this.scene.add(light);
    this.dynamicLights.push(light);
  }

  // Zone 4: West Wing
  buildZone4WestWing() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 28), this.materials.stoneDark);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(-42, -0.01, -14);
    this.scene.add(floor);
    this.detailMeshes.push(floor);

    // Walls
    this.addWall(-54, 4, -14, 0.5, 8, 28);
    this.addWall(-30, 4, -14, 0.5, 8, 28);
    this.addWall(-42, 4, -28, 24, 8, 0.5);
    this.addWall(-42, 4, 0, 24, 8, 0.5);

    // Crypt decorations
    this.addCoffin(-49, -7);
    this.addCoffin(-49, -21);
    this.addCoffin(-35, -7);
    this.addCoffin(-35, -21);

    // Shrine of Blood Fury
    this.addShrine(-49, -14, 0xff1133);

    // Lighting
    const light = new THREE.PointLight(0xff3322, 1.2, 20);
    light.position.set(-42, 6, -14);
    this.scene.add(light);
    this.dynamicLights.push(light);
  }

  // Zone 5: East Wing
  buildZone5EastWing() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 28), this.materials.stone);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(42, -0.01, -14);
    this.scene.add(floor);
    this.detailMeshes.push(floor);

    // Walls
    this.addWall(30, 4, -14, 0.5, 8, 28);
    this.addWall(54, 4, -14, 0.5, 8, 28);
    this.addWall(42, 4, -28, 24, 8, 0.5);
    this.addWall(42, 4, 0, 24, 8, 0.5);

    // Alchemy tables
    this.addAlchemyTable(35, -7);
    this.addAlchemyTable(35, -21);
    this.addAlchemyTable(49, -7);
    this.addAlchemyTable(49, -21);

    // Shrine of Astral Aegis
    this.addShrine(49, -14, 0x22aaff);

    // Lighting
    const light = new THREE.PointLight(0x4488ff, 1.2, 20);
    light.position.set(42, 6, -14);
    this.scene.add(light);
    this.dynamicLights.push(light);
  }

  // Zone 6: Abyssal Bridge
  buildZone6Bridge() {
    // Bridge floor
    const bridgeFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, 18), this.materials.stoneDark);
    bridgeFloor.rotation.x = -Math.PI / 2;
    bridgeFloor.position.set(0, -0.01, -33);
    this.scene.add(bridgeFloor);
    this.detailMeshes.push(bridgeFloor);

    // Bridge rails
    this.addRail(-5, -33);
    this.addRail(5, -33);

    // Lava chasm
    const lava = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 40),
      this.materials.lava
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(0, -2, -33);
    this.scene.add(lava);
    this.detailMeshes.push(lava);

    // Antechamber
    const anteFloor = new THREE.Mesh(new THREE.PlaneGeometry(32, 14), this.materials.stone);
    anteFloor.rotation.x = -Math.PI / 2;
    anteFloor.position.set(0, -0.01, -49);
    this.scene.add(anteFloor);
    this.detailMeshes.push(anteFloor);

    // Walls
    this.addWall(-16, 4, -49, 0.5, 8, 14);
    this.addWall(16, 4, -49, 0.5, 8, 14);
    this.addWall(0, 4, -56, 32, 8, 0.5);

    // Restoration Wells
    this.addWell(-11, -49);
    this.addWell(11, -49);

    // Lighting
    const lavaLight = new THREE.PointLight(0xff4400, 2.0, 25);
    lavaLight.position.set(0, 3, -33);
    this.scene.add(lavaLight);
    this.dynamicLights.push(lavaLight);
  }

  // Zone 7: Boss Sanctum
  buildZone7BossSanctum() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 36), this.materials.stoneDark);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -74);
    this.scene.add(floor);
    this.detailMeshes.push(floor);

    // Walls
    this.addWall(-24, 6, -74, 0.5, 12, 36);
    this.addWall(24, 6, -74, 0.5, 12, 36);
    this.addWall(0, 6, -92, 48, 12, 0.5);
    this.addWall(0, 6, -56, 48, 12, 0.5);

    // Pillars
    this.addPillar(-14, -64);
    this.addPillar(14, -64);
    this.addPillar(-14, -84);
    this.addPillar(14, -84);

    // Summoning circle
    const circle = new THREE.Mesh(
      new THREE.RingGeometry(3, 5, 32),
      new THREE.MeshStandardMaterial({
        color: 0xff4400,
        emissive: 0xff2200,
        emissiveIntensity: 1.0,
        transparent: true,
        opacity: 0.6
      })
    );
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(0, 0.02, -75);
    this.scene.add(circle);
    this.detailMeshes.push(circle);

    // Throne
    const throne = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 2), this.materials.iron);
    throne.position.set(0, 2, -85);
    this.scene.add(throne);
    this.detailMeshes.push(throne);

    // Lighting
    const bossLight = new THREE.PointLight(0xff2200, 3.0, 40);
    bossLight.position.set(0, 8, -75);
    this.scene.add(bossLight);
    this.dynamicLights.push(bossLight);
  }

  // Helper: Add wall
  addWall(x, y, z, width, height, depth) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.materials.stone);
    wall.position.set(x, y, z);
    this.scene.add(wall);
    this.detailMeshes.push(wall);
  }

  // Helper: Add pillar
  addPillar(x, z) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 8, 12), this.materials.stoneDark);
    pillar.position.set(x, 4, z);
    this.scene.add(pillar);
    this.detailMeshes.push(pillar);

    // Capital
    const capital = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 0.5, 12), this.materials.stone);
    capital.position.set(x, 8.25, z);
    this.scene.add(capital);
    this.detailMeshes.push(capital);
  }

  // Helper: Add corridor
  buildCorridor(x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, length), this.materials.stoneDark);
    floor.rotation.x = -Math.PI / 2;
    floor.rotation.z = angle;
    floor.position.set((x1 + x2) / 2, -0.01, (z1 + z2) / 2);
    this.scene.add(floor);
    this.detailMeshes.push(floor);
  }

  // Helper: Add coffin
  addCoffin(x, z) {
    const coffin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 2.2), this.materials.iron);
    coffin.position.set(x, 0.3, z);
    this.scene.add(coffin);
    this.detailMeshes.push(coffin);
  }

  // Helper: Add shrine
  addShrine(x, z, color) {
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 0.8, 8), this.materials.stone);
    ped.position.set(x, 0.4, z);
    this.scene.add(ped);
    this.detailMeshes.push(ped);

    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.9
    }));
    crystal.position.set(x, 1.8, z);
    this.scene.add(crystal);
    this.detailMeshes.push(crystal);

    const light = new THREE.PointLight(color, 1.5, 15);
    light.position.set(x, 2.5, z);
    this.scene.add(light);
    this.dynamicLights.push(light);
  }

  // Helper: Add alchemy table
  addAlchemyTable(x, z) {
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.0), this.materials.iron);
    table.position.set(x, 0.5, z);
    this.scene.add(table);
    this.detailMeshes.push(table);

    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), this.materials.stone);
    pot.position.set(x, 1.15, z);
    this.scene.add(pot);
    this.detailMeshes.push(pot);
  }

  // Helper: Add well
  addWell(x, z) {
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 1.0, 12), this.materials.stone);
    well.position.set(x, 0.5, z);
    this.scene.add(well);
    this.detailMeshes.push(well);

    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.1, 12),
      new THREE.MeshStandardMaterial({
        color: 0x44aaff,
        emissive: 0x2266cc,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.7
      })
    );
    water.position.set(x, 0.95, z);
    this.scene.add(water);
    this.detailMeshes.push(water);
  }

  // Helper: Add rail
  addRail(x, z) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2, 8), this.materials.iron);
    post.position.set(x, 1, z);
    this.scene.add(post);
    this.detailMeshes.push(post);
  }

  // Atmospheric effects
  addAtmosphericEffects() {
    // Floating embers
    const emberGeo = new THREE.BufferGeometry();
    const emberCount = 200;
    const positions = new Float32Array(emberCount * 3);
    
    for (let i = 0; i < emberCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 1] = Math.random() * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }
    
    emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const emberMat = new THREE.PointsMaterial({
      color: 0xff6600,
      size: 0.15,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });
    
    const embers = new THREE.Points(emberGeo, emberMat);
    this.scene.add(embers);
    this.detailMeshes.push(embers);
  }
}
