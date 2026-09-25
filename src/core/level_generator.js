// ============================================================
// VOID WALKER - Random Level Generator (seeded, biome-tagged)
// ============================================================

/**
 * Procedural dungeon generation system.
 * - Seeded RNG (mulberry32): same seed => same dungeon graph.
 * - Every room is tagged with a biome from BIOME_IDS.
 * - Corridors carry explicit door objects (exit/entry per room).
 * - Every room gets a data-only prop plan (type/x/y/rot) for the
 *   client-side prop placer to realize as 3D geometry.
 */

'use strict';

// ---------------------------------------------------------------- seeded RNG
function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- biome ids
// Must match the template ids in client/js/biomes.js exactly.
const BIOME_IDS = ['crypt', 'cavern', 'forge', 'throne_room'];

// Data-only prop vocabularies per biome. The client prop placer turns
// these type strings into real 3D geometry; the generator only plans.
const BIOME_PROP_TABLE = {
  crypt: ['sarcophagus', 'bone_pile', 'crypt_pillar', 'torch', 'altar', 'rubble'],
  cavern: ['stalagmite', 'rock_spire', 'ember_vent', 'torch', 'rubble', 'stalactite'],
  forge: ['anvil', 'lava_channel', 'hanging_chain', 'crucible', 'torch', 'rubble'],
  throne_room: ['throne', 'grand_pillar', 'banner', 'brazier', 'chest', 'torch']
};

class LevelGenerator {
  constructor(seed) {
    this.seed = seed == null ? Date.now() : seed;
    this.rng = mulberry32(hashSeed(this.seed));
    this.rooms = [];
    this.corridors = [];
    this.doors = [];
    this.enemies = [];
    this.loot = [];
    this.exit = null;
  }

  // Seeded helpers (instance)
  rand() { return this.rng(); }
  randRange(min, max) { return Math.floor(this.rng() * (max - min + 1)) + min; }
  randFloat(min, max) { return min + this.rng() * (max - min); }
  pick(array) { return array[Math.floor(this.rng() * array.length)]; }

  // Generate a new level
  generate(width, height, roomCount, biome) {
    this.rooms = [];
    this.corridors = [];
    this.doors = [];
    this.enemies = [];
    this.loot = [];
    this.exit = null;

    // Place rooms
    for (let i = 0; i < roomCount; i++) {
      this.placeRoom(width, height);
    }

    // Tag each room with a biome (spawn = throne_room, exit = forge)
    this.assignBiomes();

    // Connect rooms (also computes doors)
    this.connectRooms();

    // Plan 3D props per room from biome templates
    this.planAllRoomProps();

    // Place enemies
    this.populateEnemies(biome);

    // Place loot
    this.populateLoot();

    // Place exit
    this.placeExit(width, height);

    return {
      seed: this.seed,
      rooms: this.rooms,
      corridors: this.corridors,
      doors: this.doors,
      enemies: this.enemies,
      loot: this.loot,
      exit: this.exit
    };
  }

  // Place a room
  placeRoom(maxWidth, maxHeight) {
    const minSize = 8;
    const maxSize = 20;

    let attempts = 0;
    let room = null;

    while (attempts < 50 && !room) {
      const width = this.randRange(minSize, maxSize);
      const height = this.randRange(minSize, maxSize);
      const x = this.randRange(5, maxWidth - width - 5);
      const y = this.randRange(5, maxHeight - height - 5);

      const newRoom = { x, y, w: width, h: height };

      if (!this.overlaps(newRoom)) {
        room = newRoom;
      }
      attempts++;
    }

    if (room) {
      room.center = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
      this.rooms.push(room);
    }
  }

  // Check if room overlaps with existing rooms
  overlaps(room) {
    for (const existing of this.rooms) {
      if (room.x < existing.x + existing.w + 2 &&
          room.x + room.w + 2 > existing.x &&
          room.y < existing.y + existing.h + 2 &&
          room.y + room.h + 2 > existing.y) {
        return true;
      }
    }
    return false;
  }

  // Assign a biome id to every room. First room (spawn) reads grand,
  // last room (exit/boss) reads infernal; middle rooms vary by seed and
  // never repeat the biome of the previously placed room.
  assignBiomes() {
    const n = this.rooms.length;
    this.rooms.forEach((room, i) => {
      let b;
      if (i === 0) {
        b = 'throne_room';
      } else if (i === n - 1) {
        b = 'forge';
      } else {
        const prev = this.rooms[i - 1].biome;
        let guard = 0;
        do {
          b = this.pick(BIOME_IDS);
          guard++;
        } while (b === prev && guard < 12);
      }
      room.biome = b;
      room.biomeIndex = BIOME_IDS.indexOf(b);
    });
  }

  // Connect rooms with corridors (and compute doors on both ends)
  connectRooms() {
    for (let i = 1; i < this.rooms.length; i++) {
      const prev = this.rooms[i - 1];
      const curr = this.rooms[i];

      const prevCenter = { x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 };
      const currCenter = { x: curr.x + curr.w / 2, y: curr.y + curr.h / 2 };

      // L-shaped corridor: horizontal leg first, then vertical leg
      const corridor = {
        x1: prevCenter.x,
        y1: prevCenter.y,
        x2: currCenter.x,
        y2: currCenter.y,
        roomA: i - 1,
        roomB: i
      };
      const path = [
        { x: prevCenter.x, y: prevCenter.y },
        { x: currCenter.x, y: prevCenter.y },
        { x: currCenter.x, y: currCenter.y }
      ];
      const doorA = this.traceRoomBoundary(prev, path, false);
      const doorB = this.traceRoomBoundary(curr, path, true);
      corridor.doors = [
        { x: doorA.x, y: doorA.y, roomIndex: i - 1, kind: 'exit', corridorIndex: i - 1 },
        { x: doorB.x, y: doorB.y, roomIndex: i, kind: 'entry', corridorIndex: i - 1 }
      ];
      this.corridors.push(corridor);
      this.doors.push(corridor.doors[0], corridor.doors[1]);
    }
  }

  // Walk an L-shaped path and find where it leaves (forward=false) or
  // enters (forward=true, walked in reverse) a room's rectangle.
  traceRoomBoundary(room, path, reversed) {
    const rect = { minX: room.x, minY: room.y, maxX: room.x + room.w, maxY: room.y + room.h };
    const inRect = (p) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
    const pts = reversed ? [path[2], path[1], path[0]] : path;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / 0.5));
      for (let k = 0; k <= steps; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
        if (!inRect(p)) {
          return { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) };
        }
      }
    }
    // Degenerate fallback: room center (should not happen for valid graphs)
    return { x: Number((room.x + room.w / 2).toFixed(2)), y: Number((room.y + room.h / 2).toFixed(2)) };
  }

  // Build a data-only prop plan for every room from its biome template.
  planAllRoomProps() {
    this.rooms.forEach((room, i) => {
      const isSpawn = i === 0;
      const isExit = i === this.rooms.length - 1;
      room.props = this.planRoomProps(room, isSpawn, isExit);
    });
  }

  planRoomProps(room, isSpawn, isExit) {
    const table = BIOME_PROP_TABLE[room.biome] || BIOME_PROP_TABLE.crypt;
    const area = room.w * room.h;
    const count = area < 120 ? this.randRange(3, 4) : area < 240 ? this.randRange(5, 6) : this.randRange(6, 8);
    const props = [];
    const margin = 2.0;
    let guard = 0;
    while (props.length < count && guard < 60) {
      guard++;
      const type = this.pick(table);
      const px = this.randFloat(room.x + margin, room.x + room.w - margin);
      const py = this.randFloat(room.y + margin, room.y + room.h - margin);
      // Keep spawn/exit centers walkable
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      if ((isSpawn || isExit) && Math.hypot(px - cx, py - cy) < 3.0) continue;
      // Keep props apart from each other
      let ok = true;
      for (const q of props) {
        if (Math.hypot(px - q.x, py - q.y) < 2.2) { ok = false; break; }
      }
      if (!ok) continue;
      props.push({
        type,
        x: Number(px.toFixed(2)),
        y: Number(py.toFixed(2)),
        rot: Number(this.randFloat(0, Math.PI * 2).toFixed(2))
      });
    }
    return props;
  }

  // Place enemies based on biome
  populateEnemies(biome) {
    const biomeEnemies = getBiomeEnemies(biome);

    for (const room of this.rooms) {
      // Skip first room (safe zone)
      if (room === this.rooms[0]) continue;

      // Skip last room (exit room)
      if (room === this.rooms[this.rooms.length - 1]) continue;

      // Place 1-3 enemies per room
      const enemyCount = this.randRange(1, 3);
      for (let i = 0; i < enemyCount; i++) {
        const enemyType = this.pick(biomeEnemies);
        this.enemies.push({
          type: enemyType,
          x: room.x + this.randRange(1, room.w - 1),
          y: room.y + this.randRange(1, room.h - 1),
          room: room
        });
      }
    }
  }

  // Place loot in rooms
  populateLoot() {
    for (let i = 1; i < this.rooms.length - 1; i++) {
      if (this.rand() < 0.6) {
        const room = this.rooms[i];
        this.loot.push({
          type: this.pick(['chest', 'ground']),
          x: room.x + this.randRange(1, room.w - 1),
          y: room.y + this.randRange(1, room.h - 1),
          room: room
        });
      }
    }
  }

  // Place exit in last room
  placeExit(width, height) {
    if (this.rooms.length > 0) {
      const lastRoom = this.rooms[this.rooms.length - 1];
      this.exit = {
        x: lastRoom.x + lastRoom.w / 2,
        y: lastRoom.y + lastRoom.h / 2,
        room: lastRoom
      };
    }
  }
}

// Helper functions (legacy, unseeded — kept for backward compatibility)
function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Biome enemy tables
function getBiomeEnemies(biome) {
  const biomes = {
    void_hollow: ['void_minion', 'void_serpent'],
    shadow_forest: ['shadow_wolf', 'corrupted_tree'],
    crystal_caverns: ['crystal_golem', 'void_serpent'],
    necropolis: ['corpse_guard', 'skeleton']
  };
  return biomes[biome] || ['void_minion'];
}

// Dungeon Generator (simplified version)
class DungeonGenerator {
  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    this.options = {
      minRoomSize: 8,
      maxRoomSize: 20,
      roomCount: options.roomCount || 10,
      ...options
    };
    this.grid = [];
    this.rooms = [];
    this.corridors = [];
  }

  generate() {
    // Initialize grid
    this.grid = Array(this.height).fill().map(() => Array(this.width).fill(0));

    // Generate rooms
    for (let i = 0; i < this.options.roomCount; i++) {
      this.generateRoom();
    }

    // Tag rooms with biomes (no adjacent repeats)
    this.rooms.forEach((room, i) => {
      let b;
      let guard = 0;
      do {
        b = randomChoice(BIOME_IDS);
        guard++;
      } while (i > 0 && b === this.rooms[i - 1].biome && guard < 12);
      room.biome = b;
    });

    // Connect rooms
    this.connectRooms();

    return {
      grid: this.grid,
      rooms: this.rooms,
      corridors: this.corridors
    };
  }

  generateRoom() {
    const w = randomRange(this.options.minRoomSize, this.options.maxRoomSize);
    const h = randomRange(this.options.minRoomSize, this.options.maxRoomSize);
    const x = randomRange(1, this.width - w - 1);
    const y = randomRange(1, this.height - h - 1);

    const room = { x, y, w, h, center: { x: x + w / 2, y: y + h / 2 } };

    // Check overlap
    for (const existing of this.rooms) {
      if (this.roomsOverlap(room, existing)) return;
    }

    // Carve room into grid
    for (let ry = y; ry < y + h; ry++) {
      for (let rx = x; rx < x + w; rx++) {
        this.grid[ry][rx] = 1; // Floor
      }
    }

    this.rooms.push(room);
  }

  roomsOverlap(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x ||
             a.y + a.h < b.y || b.y + b.h < a.y);
  }

  connectRooms() {
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1].center;
      const b = this.rooms[i].center;

      // Create corridor
      this.carveCorridor(a, b);
    }
  }

  carveCorridor(from, to) {
    // Round to integer grid cells: fractional room centers would make the
    // x !== to.x loop below never terminate.
    let x = Math.round(from.x);
    let y = Math.round(from.y);
    const tx = Math.round(to.x);
    const ty = Math.round(to.y);

    let guard = 0;
    while (x !== tx && guard++ < 10000) {
      if (this.grid[y] && this.grid[y][x] !== undefined) this.grid[y][x] = 1;
      x += x < tx ? 1 : -1;
    }
    guard = 0;
    while (y !== ty && guard++ < 10000) {
      if (this.grid[y] && this.grid[y][x] !== undefined) this.grid[y][x] = 1;
      y += y < ty ? 1 : -1;
    }
    if (this.grid[y] && this.grid[y][x] !== undefined) this.grid[y][x] = 1;

    this.corridors.push({ from, to });
  }
}

module.exports = { LevelGenerator, DungeonGenerator, BIOME_IDS, BIOME_PROP_TABLE, hashSeed, mulberry32 };

// ---------------------------------------------------------------- self-test
// Run: node src/core/level_generator.js
if (require.main === module) {
  const assert = require('assert');

  const gen = new LevelGenerator(12345);
  const d = gen.generate(60, 60, 10, 'void_hollow');

  // 1. Rooms exist and each carries a valid biome tag
  assert(d.rooms.length > 0, 'expected at least one room');
  for (const r of d.rooms) {
    assert(BIOME_IDS.includes(r.biome), `room missing/invalid biome tag: ${r.biome}`);
    assert(Array.isArray(r.props) && r.props.length > 0, 'room missing prop plan');
    for (const p of r.props) {
      assert(BIOME_PROP_TABLE[r.biome].includes(p.type), `prop type ${p.type} not in ${r.biome} table`);
      assert(p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h, 'prop outside room bounds');
    }
  }

  // 2. Corridors connect the room graph; doors reference valid rooms
  assert.strictEqual(d.corridors.length, d.rooms.length - 1, 'corridor count must be rooms-1');
  assert.strictEqual(d.doors.length, d.corridors.length * 2, 'each corridor must emit 2 doors');
  d.corridors.forEach((c, i) => {
    assert.strictEqual(c.roomA, i, 'corridor roomA index');
    assert.strictEqual(c.roomB, i + 1, 'corridor roomB index');
    assert(Array.isArray(c.doors) && c.doors.length === 2, 'corridor doors');
    for (const door of c.doors) {
      assert(door.roomIndex === c.roomA || door.roomIndex === c.roomB, 'door references corridor room');
      assert(door.kind === 'exit' || door.kind === 'entry', 'door kind');
      assert(Number.isFinite(door.x) && Number.isFinite(door.y), 'door coords finite');
    }
  });

  // 3. Spawn/exit rooms keep their centers clear of props
  const spawn = d.rooms[0];
  const scx = spawn.x + spawn.w / 2, scy = spawn.y + spawn.h / 2;
  for (const p of spawn.props) {
    assert(Math.hypot(p.x - scx, p.y - scy) >= 3.0, 'spawn center must stay clear');
  }
  assert.strictEqual(d.rooms[0].biome, 'throne_room', 'first room is throne_room');
  assert.strictEqual(d.rooms[d.rooms.length - 1].biome, 'forge', 'last room is forge');

  // 4. Determinism: same seed => same biome tags + same prop plans
  const d2 = new LevelGenerator(12345).generate(60, 60, 10, 'void_hollow');
  assert.deepStrictEqual(
    d.rooms.map((r) => [r.biome, r.props]),
    d2.rooms.map((r) => [r.biome, r.props]),
    'same seed must reproduce biome tags and prop plans'
  );

  // 5. DungeonGenerator (grid variant) also tags biomes
  const dg = new DungeonGenerator(60, 60, { roomCount: 6 }).generate();
  assert(dg.rooms.length > 0, 'grid generator rooms');
  for (const r of dg.rooms) assert(BIOME_IDS.includes(r.biome), 'grid room biome tag');

  const biomeCounts = {};
  d.rooms.forEach((r) => { biomeCounts[r.biome] = (biomeCounts[r.biome] || 0) + 1; });
  console.log('level_generator self-test OK');
  console.log(JSON.stringify({
    seed: d.seed,
    rooms: d.rooms.length,
    corridors: d.corridors.length,
    doors: d.doors.length,
    enemies: d.enemies.length,
    loot: d.loot.length,
    biomeCounts
  }));
}
