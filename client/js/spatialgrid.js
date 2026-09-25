// SpatialGrid.js - Quadtree-based spatial partitioning for collision optimization
// Replaces O(n) collision checks with O(log n) for large-scale scenes

export class SpatialGrid {
  constructor(cellSize = 10.0) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entities = new Map();
  }

  // Clear grid (call once per frame)
  clear() {
    this.cells.clear();
    this.entities.clear();
  }

  // Get cell key for position
  getCellKey(x, z) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cz}`;
  }

  // Insert entity into grid
  insert(entity) {
    const key = this.getCellKey(entity.x, entity.z);
    if (!this.cells.has(key)) {
      this.cells.set(key, []);
    }
    this.cells.get(key).push(entity);
    this.entities.set(entity.id, entity);
  }

  // Remove entity from grid
  remove(entity) {
    const key = this.getCellKey(entity.x, entity.z);
    const cell = this.cells.get(key);
    if (cell) {
      const idx = cell.indexOf(entity);
      if (idx !== -1) cell.splice(idx, 1);
    }
    this.entities.delete(entity.id);
  }

  // Update entity position
  update(entity) {
    this.remove(entity);
    this.insert(entity);
  }

  // Get all entities within radius of point
  getNearbyEntities(x, z, radius) {
    const results = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        const cell = this.cells.get(key);
        if (cell) {
          for (const entity of cell) {
            const dist = Math.hypot(entity.x - x, entity.z - z);
            if (dist <= radius) {
              results.push(entity);
            }
          }
        }
      }
    }
    return results;
  }

  // Get all entities in area
  getEntitiesInArea(x1, y1, x2, y2) {
    const results = [];
    const minCx = Math.floor(Math.min(x1, x2) / this.cellSize);
    const maxCx = Math.floor(Math.max(x1, x2) / this.cellSize);
    const minCz = Math.floor(Math.min(y1, y2) / this.cellSize);
    const maxCz = Math.floor(Math.max(y1, y2) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = `${cx},${cz}`;
        const cell = this.cells.get(key);
        if (cell) {
          results.push(...cell);
        }
      }
    }
    return results;
  }

  // Optimize collision detection for many entities
  findCollisions(entity, excludeIds = new Set()) {
    const nearby = this.getNearbyEntities(entity.x, entity.z, entity.radius || 1.0);
    const collisions = [];

    for (const other of nearby) {
      if (other.id === entity.id || excludeIds.has(other.id)) continue;
      const dist = Math.hypot(other.x - entity.x, other.z - entity.z);
      const minDist = (entity.radius || 1.0) + (other.radius || 1.0);
      if (dist < minDist) {
        collisions.push(other);
      }
    }
    return collisions;
  }
}
