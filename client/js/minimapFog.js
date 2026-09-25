// client/js/minimapFog.js — Pure (DOM-free) fog-of-war + dungeon layout data.
// Shared by the canvas minimap (minimapenhanced.js). No THREE, no DOM, so
// it is importable by headless node tests.
//
// World bounds: x in [-60, 60], z in [-96, 32] (matches the Citadel floorplan).
// DUNGEON_ROOMS is the single client-side source of truth for the 10
// citadel rooms — same coordinates the 3D geometry builder uses.

// [minX, maxX, minZ, maxZ, name, zoneId]
const ROOM_DEFS = [
  [-14, 14, 10, 28, 'COVENANT ATRIUM', 'atrium'],
  [-5, 5, -2, 10, 'NARTHEX PASSAGE', 'narthex'],
  [-18, 18, -26, -2, 'THE GRAND CROSSROADS', 'crossroads'],
  [-30, -18, -18, -10, 'WEST CORRIDOR', 'west_corridor'],
  [-54, -30, -28, 0, 'WEST: BLOOD RELIQUARY', 'blood_reliquary'],
  [18, 30, -18, -10, 'EAST CORRIDOR', 'east_corridor'],
  [30, 54, -28, 0, 'EAST: ALCHEMIST VAULT', 'alchemist_vault'],
  [-6, 6, -44, -24, 'THE ABYSSAL BRIDGE', 'abyssal_bridge'],
  [-16, 16, -56, -42, 'ANTECHAMBER OF CHAINS', 'antechamber'],
  [-24, 24, -92, -56, 'SOUL-FORGE SANCTUM', 'boss_sanctum'],
];

// Fill colors mirror the legacy HUD palette so the minimap looks like the 3D build.
const ROOM_COLORS = [
  '#282138', '#231c30', '#2d243f', '#231c30', '#3a1a28',
  '#231c30', '#182b44', '#2b2024', '#282138', '#3b1c18',
];

export const DUNGEON_ROOMS = ROOM_DEFS.map((d, i) => ({
  minX: d[0], maxX: d[1], minZ: d[2], maxZ: d[3],
  name: d[4], zoneId: d[5], color: ROOM_COLORS[i],
}));

export const WORLD = { minX: -60, maxX: 60, minZ: -96, maxZ: 32 };

// Radius (meters) around each alive party member that counts as "visible".
export const VISIBILITY_RADIUS = 14;

export function zoneNameFor(x, z) {
  let zone = 'THE GRAND CROSSROADS';
  if (z >= 9.5) zone = 'COVENANT ATRIUM';
  else if (z >= -2.5) zone = 'NARTHEX PASSAGE';
  else if (x < -19) zone = 'WEST: BLOOD RELIQUARY';
  else if (x > 19) zone = 'EAST: ALCHEMIST VAULT';
  else if (z <= -56) zone = 'SOUL-FORGE SANCTUM';
  else if (z <= -42) zone = 'ANTECHAMBER OF CHAINS';
  else if (z <= -24) zone = 'THE ABYSSAL BRIDGE';
  return zone;
}

// Fog states for a cell: 0 = unexplored, 1 = explored (dim), 2 = visible (bright).
export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

export class FogOfWar {
  constructor(cellSize = 1) {
    this.cellSize = cellSize;
    this.cols = Math.ceil((WORLD.maxX - WORLD.minX) / cellSize);
    this.rows = Math.ceil((WORLD.maxZ - WORLD.minZ) / cellSize);
    this.state = new Uint8Array(this.cols * this.rows); // 0 = unexplored
    this._exploredCount = 0;
  }

  reset() {
    this.state.fill(FOG_UNEXPLORED);
    this._exploredCount = 0;
  }

  get exploredCount() { return this._exploredCount; }
  get totalCells() { return this.cols * this.rows; }

  _cellIndex(x, z) {
    const c = Math.floor((x - WORLD.minX) / this.cellSize);
    const r = Math.floor((z - WORLD.minZ) / this.cellSize);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  // Start a new frame: previously-visible cells drop back to explored.
  beginFrame() {
    const s = this.state;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === FOG_VISIBLE) s[i] = FOG_EXPLORED;
    }
  }

  // Reveal a disc of world meters; cells become explored AND visible.
  reveal(x, z, radius = VISIBILITY_RADIUS) {
    const cs = this.cellSize;
    const r2 = radius * radius;
    const cMin = Math.max(0, Math.floor((x - radius - WORLD.minX) / cs));
    const cMax = Math.min(this.cols - 1, Math.floor((x + radius - WORLD.minX) / cs));
    const rMin = Math.max(0, Math.floor((z - radius - WORLD.minZ) / cs));
    const rMax = Math.min(this.rows - 1, Math.floor((z + radius - WORLD.minZ) / cs));
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const cx = WORLD.minX + (c + 0.5) * cs;
        const cz = WORLD.minZ + (r + 0.5) * cs;
        const dx = cx - x, dz = cz - z;
        if (dx * dx + dz * dz > r2) continue;
        const i = r * this.cols + c;
        if (this.state[i] === FOG_UNEXPLORED) this._exploredCount++;
        this.state[i] = FOG_VISIBLE;
      }
    }
  }

  // Mark explored without the visible highlight (e.g. restored from save).
  markExplored(x, z, radius = 1) {
    const cs = this.cellSize;
    const r2 = radius * radius;
    const cMin = Math.max(0, Math.floor((x - radius - WORLD.minX) / cs));
    const cMax = Math.min(this.cols - 1, Math.floor((x + radius - WORLD.minX) / cs));
    const rMin = Math.max(0, Math.floor((z - radius - WORLD.minZ) / cs));
    const rMax = Math.min(this.rows - 1, Math.floor((z + radius - WORLD.minZ) / cs));
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const cx = WORLD.minX + (c + 0.5) * cs;
        const cz = WORLD.minZ + (r + 0.5) * cs;
        const dx = cx - x, dz = cz - z;
        if (dx * dx + dz * dz > r2) continue;
        const i = r * this.cols + c;
        if (this.state[i] === FOG_UNEXPLORED) {
          this.state[i] = FOG_EXPLORED;
          this._exploredCount++;
        }
      }
    }
  }

  fogAt(x, z) {
    const i = this._cellIndex(x, z);
    return i < 0 ? FOG_UNEXPLORED : this.state[i];
  }

  isVisible(x, z) { return this.fogAt(x, z) === FOG_VISIBLE; }
  isExplored(x, z) { return this.fogAt(x, z) !== FOG_UNEXPLORED; }

  // Snapshot/restore for mid-session floor transitions (cheap arrays).
  serialize() { return Array.from(this.state); }
  restore(arr) {
    if (!Array.isArray(arr) || arr.length !== this.state.length) return false;
    this.state.set(arr);
    let n = 0;
    for (let i = 0; i < this.state.length; i++) if (this.state[i] !== FOG_UNEXPLORED) n++;
    this._exploredCount = n;
    return true;
  }
}

export default { DUNGEON_ROOMS, WORLD, VISIBILITY_RADIUS, FogOfWar, zoneNameFor };
