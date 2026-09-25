// ============================================================
// VOID WALKER - Random Level Generator
// ============================================================

/**
 * Procedural dungeon generation system
 * Uses room placement, corridor connection, and biome selection
 */

class LevelGenerator {
  constructor(seed) {
    this.seed = seed || Date.now();
    this.rooms = [];
    this.corridors = [];
    this.enemies = [];
    this.loot = [];
    this.exit = null;
  }

  // Generate a new level
  generate(width, height, roomCount, biome) {
    this.rooms = [];
    this.corridors = [];
    this.enemies = [];
    this.loot = [];

    // Place rooms
    for (let i = 0; i < roomCount; i++) {
      this.placeRoom(width, height);
    }

    // Connect rooms
    this.connectRooms();

    // Place enemies
    this.populateEnemies(biome);

    // Place loot
    this.populateLoot();

    // Place exit
    this.placeExit(width, height);

    return {
      rooms: this.rooms,
      corridors: this.corridors,
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
      const width = randomRange(minSize, maxSize);
      const height = randomRange(minSize, maxSize);
      const x = randomRange(5, maxWidth - width - 5);
      const y = randomRange(5, maxHeight - height - 5);

      const newRoom = { x, y, w: width, h: height };

      if (!this.overlaps(newRoom)) {
        room = newRoom;
      }
      attempts++;
    }

    if (room) {
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

  // Connect rooms with corridors
  connectRooms() {
    for (let i = 1; i < this.rooms.length; i++) {
      const prev = this.rooms[i - 1];
      const curr = this.rooms[i];

      const prevCenter = {
        x: prev.x + prev.w / 2,
        y: prev.y + prev.h / 2
      };
      const currCenter = {
        x: curr.x + curr.w / 2,
        y: curr.y + curr.h / 2
      };

      // Create L-shaped corridor
      this.corridors.push({
        x1: prevCenter.x,
        y1: prevCenter.y,
        x2: currCenter.x,
        y2: currCenter.y
      });
    }
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
      const enemyCount = randomRange(1, 3);
      for (let i = 0; i < enemyCount; i++) {
        const enemyType = biomeEnemies[randomRange(0, biomeEnemies.length - 1)];
        this.enemies.push({
          type: enemyType,
          x: room.x + randomRange(1, room.w - 1),
          y: room.y + randomRange(1, room.h - 1),
          room: room
        });
      }
    }
  }

  // Place loot in rooms
  populateLoot() {
    for (let i = 1; i < this.rooms.length - 1; i++) {
      if (Math.random() < 0.6) {
        const room = this.rooms[i];
        this.loot.push({
          type: randomChoice(['chest', 'ground']),
          x: room.x + randomRange(1, room.w - 1),
          y: room.y + randomRange(1, room.h - 1),
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

// Helper functions
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
    let x = from.x;
    let y = from.y;

    // Horizontal then vertical
    while (x !== to.x) {
      this.grid[y][x] = 1;
      x += x < to.x ? 1 : -1;
    }
    while (y !== to.y) {
      this.grid[y][x] = 1;
      y += y < to.y ? 1 : -1;
    }

    this.corridors.push({ from, to });
  }
}

module.exports = { LevelGenerator, DungeonGenerator };
