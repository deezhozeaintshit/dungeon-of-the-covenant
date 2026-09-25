// Collision.js - Union-of-Zones Continuous Physics & Doorway Pathfinding Engine
// Shared architectural layout so level design changes never cause doorway seams.

class CollisionEngine {
  constructor() {
    // Architectural columns (x, z, radius)
    this.pillars = [
      // Zone 1: Covenant Atrium
      { x: -7, z: 19, r: 1.0 }, { x: 7, z: 19, r: 1.0 },
      // Zone 3: Grand Crossroads Rotunda
      { x: -9, z: -8, r: 1.1 }, { x: 9, z: -8, r: 1.1 },
      { x: -9, z: -20, r: 1.1 }, { x: 9, z: -20, r: 1.1 },
      // Zone 4: West Wing (Blood Reliquary)
      { x: -38, z: -7, r: 1.0 }, { x: -38, z: -21, r: 1.0 },
      // Zone 5: East Wing (Alchemist's Vault)
      { x: 38, z: -7, r: 1.0 }, { x: 38, z: -21, r: 1.0 },
      // Zone 6: Antechamber of Chains
      { x: -9, z: -49, r: 1.0 }, { x: 9, z: -49, r: 1.0 },
      // Zone 7: Soul-Forge Boss Sanctum
      { x: -14, z: -64, r: 1.2 }, { x: 14, z: -64, r: 1.2 },
      { x: -14, z: -84, r: 1.2 }, { x: 14, z: -84, r: 1.2 }
    ];

    // Exact Floor Rectangles: [minX, maxX, minZ, maxZ]
    // Adjacent rooms overlap generously at doorways, and Union Sampling checks
    // whether every point on the entity's cylinder lies on ANY walkable floor rect.
    this.floorRects = [
      // 1. Zone 1: Covenant Atrium (x: [-14, 14], z: [10, 28])
      [-13.8, 13.8, 8.5, 27.8],
      // 2. Zone 2: Narthex Passage (widened to [-11.5, 11.5] so low ledges never block movement or loot)
      [-11.5, 11.5, -4.5, 12.5],
      // 3. Zone 3: Grand Crossroads Hub (x: [-18, 18], z: [-26, -2])
      [-17.8, 17.8, -27.0, -1.0],
      // 4. West Wing Corridor (widened to z: [-21, -8] — overlaps Zone 3 & Zone 4)
      [-32.5, -15.5, -21.0, -8.0],
      // 5. Zone 4: West Wing — Blood Reliquary (x: [-54, -30], z: [-28, 0])
      [-53.8, -29.5, -27.8, -0.2],
      // 6. East Wing Corridor (widened to z: [-21, -8] — overlaps Zone 3 & Zone 5)
      [15.5, 32.5, -21.0, -8.0],
      // 7. Zone 5: East Wing — Alchemist's Vault (x: [30, 54], z: [-28, 0])
      [29.5, 53.8, -27.8, -0.2],
      // 8. Zone 6A: The Abyssal Bridge (widened to [-10.5, 10.5] so players can jump across ledges)
      [-10.5, 10.5, -44.5, -23.5],
      // 9. Zone 6B: Antechamber of Chains (x: [-16, 16], z: [-56, -42])
      [-15.8, 15.8, -57.0, -41.0],
      // 10. Boss Gateway Threshold (widened to [-13.5, 13.5] — overlaps Zone 6B & Zone 7)
      [-13.5, 13.5, -59.5, -52.5],
      // 11. Zone 7: The Soul-Forge Boss Sanctum (x: [-24, 24], z: [-92, -56])
      [-23.8, 23.8, -91.8, -55.2]
    ];
  }

  // Returns true if a single 2D point (px, pz) lies inside ANY floor rectangle
  isPointOnFloor(px, pz, isAirborne = false) {
    // While airborne (jumping), allow vaulting over interior cutaway ledges between main halls
    if (isAirborne) {
      if (px >= -17.5 && px <= 17.5 && pz >= -91.0 && pz <= 27.5) {
        return true;
      }
      if (px >= -53.5 && px <= 53.5 && pz >= -27.5 && pz <= -0.5) {
        return true;
      }
    }
    for (let i = 0; i < this.floorRects.length; i++) {
      const [minX, maxX, minZ, maxZ] = this.floorRects[i];
      if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) {
        return true;
      }
    }
    return false;
  }

  // Union-of-Rectangles Cylinder Collision Check:
  // Checks center + 8 perimeter points around radius r against the union of all floorRects.
  // When isAirborne is true (jumping), ignores low obstacles/pillars and interior ledges!
  isWalkable(x, z, r = 0.6, isAirborne = false) {
    if (!isAirborne && this.hitsPillar(x, z, r)) {
      return false;
    }

    if (!this.isPointOnFloor(x, z, isAirborne)) {
      return false;
    }

    const effectiveR = isAirborne ? r * 0.4 : r;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const angle = (i * Math.PI * 2) / steps;
      const sx = x + Math.cos(angle) * effectiveR;
      const sz = z + Math.sin(angle) * effectiveR;
      if (!this.isPointOnFloor(sx, sz, isAirborne)) {
        return false;
      }
    }

    return true;
  }

  hitsPillar(x, z, r = 0.6) {
    for (const p of this.pillars) {
      if (Math.hypot(x - p.x, z - p.z) < (p.r + r)) {
        return true;
      }
    }
    return false;
  }

  // Slide move: attempts full move, then tries sliding along X and Z separately
  moveAndSlide(x, z, vx, vz, speed, dt, radius = 0.6, isAirborne = false) {
    const len = Math.hypot(vx, vz);
    if (len === 0) return { x, z };

    const dx = (vx / len) * speed * dt;
    const dz = (vz / len) * speed * dt;

    // Try full step
    const targetX = x + dx;
    const targetZ = z + dz;
    if (this.isWalkable(targetX, targetZ, radius, isAirborne)) {
      return { x: targetX, z: targetZ };
    }

    // Try slide along X
    if (this.isWalkable(targetX, z, radius, isAirborne)) {
      return { x: targetX, z };
    }

    // Try slide along Z
    if (this.isWalkable(x, targetZ, radius, isAirborne)) {
      return { x, z: targetZ };
    }

    // Blocked completely
    return { x, z };
  }

  // Check if two points have a clear walkable line-of-sight
  hasLineOfSight(x1, z1, x2, z2) {
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(2, Math.ceil(dist / 1.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const pz = z1 + (z2 - z1) * t;
      if (!this.isPointOnFloor(px, pz)) return false;
    }
    return true;
  }

  // Smart Waypoint routing so AI companions smoothly navigate doorways between wings
  getWaypointToward(fromX, fromZ, toX, toZ) {
    if (this.hasLineOfSight(fromX, fromZ, toX, toZ)) {
      return { x: toX, z: toZ };
    }

    // Route out of West Wing into Crossroads
    if (fromX < -18 && toX >= -18) {
      if (Math.abs(fromZ - (-14)) > 2.5) return { x: -33, z: -14 };
      return { x: -14, z: -14 };
    }
    // Route out of East Wing into Crossroads
    if (fromX > 18 && toX <= 18) {
      if (Math.abs(fromZ - (-14)) > 2.5) return { x: 33, z: -14 };
      return { x: 14, z: -14 };
    }
    // Route from Crossroads into West Wing
    if (toX < -20 && fromX >= -20) {
      if (Math.abs(fromZ - (-14)) > 2.5) return { x: -12, z: -14 };
      return { x: -34, z: -14 };
    }
    // Route from Crossroads into East Wing
    if (toX > 20 && fromX <= 20) {
      if (Math.abs(fromZ - (-14)) > 2.5) return { x: 12, z: -14 };
      return { x: 34, z: -14 };
    }
    // North/South routing through central spine (x = 0)
    if (Math.abs(fromX) > 3.5) {
      return { x: 0, z: fromZ };
    }
    return { x: toX, z: toZ };
  }
}

module.exports = new CollisionEngine();
