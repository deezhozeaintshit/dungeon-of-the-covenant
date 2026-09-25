// server/game/systems/Objectives.js — Procedural mission objectives (Phase 2, workstream 5)
//
// Server-authoritative per-floor objectives. The coordinator (Room.js) owns the
// game loop; this module owns objective state and exposes hooks Room.js must
// call at the exact points documented in PROTOCOL.md (same directory).
//
// Reward XP flows through the Progression interface when present:
//   room.systems.progression.grantXP(room, playerId, amount, reason)
// and falls back to room.awardPartyXP(amount) when the Progression system is
// not installed yet (another agent builds it). Both paths are defensive.
'use strict';

const OBJECTIVE_TYPES = {
  SLAY_WARDEN: 'SLAY_WARDEN',
  DESTROY_SHRINES: 'DESTROY_SHRINES',
  RECOVER_RELIC: 'RECOVER_RELIC',
  SURVIVE_AMBUSH: 'SURVIVE_AMBUSH'
};

// The two named Wing Wardens that Room.initDungeonLayout() always spawns.
const WARDENS = [
  { type: 'elite_executioner', name: 'Vorgath, Bone-Executioner', wing: 'West Wing' },
  { type: 'elite_lich', name: 'Arch-Lich Malthor', wing: 'East Wing' }
];

// Biome flavor keyed by ProceduralLevelGenerator biome id. Fallback: generic.
const BIOME_FLAVOR = {
  ossuary_crypt: {
    shrineName: 'Corrupted Ossuary Shrine', shrinePlural: 'Corrupted Ossuary Shrines',
    relicName: 'Ossuary Covenant Relic', hazardWord: 'grave-rot',
    ambushName: 'Bone-Horde', altarWord: 'Atrium'
  },
  glacial_sanctum: {
    shrineName: 'Rime-Cursed Ice Shrine', shrinePlural: 'Rime-Cursed Ice Shrines',
    relicName: 'Reliquary Frostbrand Relic', hazardWord: 'subzero rime',
    ambushName: 'Rime-Wraith', altarWord: 'Atrium'
  },
  blood_citadel: {
    shrineName: 'Sanguine Altar of Ruin', shrinePlural: 'Sanguine Altars of Ruin',
    relicName: 'Crimson Covenant Relic', hazardWord: 'cursed ichor',
    ambushName: 'Blood-Mad', altarWord: 'Atrium'
  },
  void_nexus: {
    shrineName: 'Void-Tainted Monolith', shrinePlural: 'Void-Tainted Monoliths',
    relicName: 'Astral Covenant Relic', hazardWord: 'dimensional static',
    ambushName: 'Void-Spawn', altarWord: 'Atrium'
  },
  blight_catacombs: {
    shrineName: 'Plague-Weep Totem', shrinePlural: 'Plague-Weep Totems',
    relicName: 'Blightbane Covenant Relic', hazardWord: 'venomous spores',
    ambushName: 'Plague-Brood', altarWord: 'Atrium'
  }
};
const GENERIC_FLAVOR = {
  shrineName: 'Corrupted Shrine', shrinePlural: 'Corrupted Shrines',
  relicName: 'Covenant Relic', hazardWord: 'dark aether',
  ambushName: 'Covenant-Breaker', altarWord: 'Atrium'
};

// Fixed candidate spots for shrine / relic / ambush staging (match citadel zones).
const SHRINE_SPOTS = [
  { x: -40, z: -14 }, { x: 40, z: -14 }, { x: 0, z: -14 },
  { x: 0, z: -49 }, { x: 0, z: 8 }
];
const RELIC_SPOT = { x: 44, z: -14 };   // East Wing vault
const ALTAR_SPOT = { x: 0, z: 16 };     // Atrium (near spawn)
const ALTAR_RADIUS = 3.5;
const AMBUSH_MOB_POOL = ['skeleton_warrior', 'cultist_archer', 'void_assassin', 'blight_necrolyte'];

function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flavorFor(biomeId) {
  return BIOME_FLAVOR[biomeId] || GENERIC_FLAVOR;
}

class Objectives {
  constructor(room) {
    this.room = room;
    this.floor = room.floor || 1;
    this.list = [];
    this.generatedAt = Date.now();
  }

  // ---- lifecycle ---------------------------------------------------------
  // Coordinator entry point. Call ONCE per floor, AFTER Room.initDungeonLayout()
  // (so the Wing Wardens exist) and BEFORE/AFTER the floor broadcast — this
  // method broadcasts objectives_update itself.
  static createForRoom(room) {
    room.systems = room.systems || {};
    const objectives = new Objectives(room);
    room.systems.objectives = objectives;
    objectives.generate();
    objectives.spawnEntities();
    objectives.push();
    return objectives;
  }

  generate() {
    const room = this.room;
    const floor = this.floor;
    const biomeId = room.proceduralConfig && room.proceduralConfig.biome
      ? room.proceduralConfig.biome.id : 'unknown';
    const seed = (room.proceduralConfig && room.proceduralConfig.seed) || Date.now();
    const rng = mulberry32((seed ^ (floor * 2654435761)) >>> 0);
    const flavor = flavorFor(biomeId);
    const warden = WARDENS[(floor - 1) % WARDENS.length];

    // 3 per floor: SLAY_WARDEN is always the PRIMARY, plus 2 of the other 3.
    const secondaries = [
      OBJECTIVE_TYPES.DESTROY_SHRINES,
      OBJECTIVE_TYPES.RECOVER_RELIC,
      OBJECTIVE_TYPES.SURVIVE_AMBUSH
    ].sort(() => rng() - 0.5).slice(0, 2);

    const defs = [OBJECTIVE_TYPES.SLAY_WARDEN, ...secondaries];
    this.list = defs.map((type, idx) => this._buildObjective(type, {
      primary: idx === 0,
      flavor, warden, biomeId, rng, idx
    }));
  }

  _xpFor(primary) {
    return Math.round((120 + this.floor * 40) * (primary ? 1.6 : 1));
  }

  _buildObjective(type, { primary, flavor, warden, biomeId, rng, idx }) {
    const base = {
      id: `obj_f${this.floor}_${type.toLowerCase()}_${idx}`,
      type,
      biome: biomeId,
      primary: Boolean(primary),
      state: 'active', // active | complete | failed
      reward: { xp: this._xpFor(primary), loot: 'gear_drop' },
      data: {}
    };

    if (type === OBJECTIVE_TYPES.SLAY_WARDEN) {
      base.name = `Warden Slayer`;
      base.description =
        `Slay ${warden.name} — the ${warden.wing} Warden — ` +
        `before its corruption spreads through this floor.`;
      base.progress = { current: 0, target: 1 };
      base.data.wardenType = warden.type;
      base.data.wardenName = warden.name;
    } else if (type === OBJECTIVE_TYPES.DESTROY_SHRINES) {
      const target = this.floor >= 3 ? 3 : 2;
      base.name = `Shrinebreaker`;
      base.description =
        `Shatter ${target} ${target === 1 ? flavor.shrineName : flavor.shrinePlural} ` +
        `— they pulse with ${flavor.hazardWord}. Attack them to break them.`;
      base.progress = { current: 0, target };
      base.data.shrineCount = target;
      base.data.flavor = { shrineName: flavor.shrineName };
      base.data.shrines = []; // filled by spawnEntities()
    } else if (type === OBJECTIVE_TYPES.RECOVER_RELIC) {
      base.name = `Relic Recovery`;
      base.description =
        `Recover the ${flavor.relicName} from the East Wing vault and carry it ` +
        `to the Extraction Altar in the ${flavor.altarWord}.`;
      base.progress = { current: 0, target: 1 };
      base.data.relicName = flavor.relicName;
      base.data.relicSpot = { ...RELIC_SPOT };
      base.data.altar = { ...ALTAR_SPOT };
      base.data.carrierId = null;
      base.data.pickedUp = false;
    } else if (type === OBJECTIVE_TYPES.SURVIVE_AMBUSH) {
      const duration = Math.min(60, 40 + this.floor * 5);
      base.name = `Ambush!`;
      base.description =
        `Survive the ${flavor.ambushName} ambush for ${duration}s — ` +
        `waves are closing in. Keep at least one hero standing.`;
      base.progress = { current: 0, target: duration };
      base.data.timeRemaining = duration;
      base.data.duration = duration;
      base.data.waveTimer = 3; // first wave 3s after spawn
      base.data.waveInterval = 10;
      base.data.waveCount = 0;
    }
    return base;
  }

  // ---- entity spawning ----------------------------------------------------
  // Shrines get REAL hp + destroy detection (see damageShrinesAt). The relic
  // is a real floorLoot pickup of type 'objective_relic' — the coordinator's
  // updateFloorLoot() must branch on that type (see PROTOCOL.md).
  spawnEntities() {
    const room = this.room;
    if (!room) return;
    if (typeof room.nextEntityId !== 'number') room.nextEntityId = 100000;
    if (!Array.isArray(room.shrines)) room.shrines = [];

    const scale = (room.proceduralConfig && room.proceduralConfig.floorScale) || 1.0;

    for (const obj of this.list) {
      if (obj.type === OBJECTIVE_TYPES.DESTROY_SHRINES) {
        const spots = [...SHRINE_SPOTS].sort(() => Math.random() - 0.5)
          .slice(0, obj.data.shrineCount);
        for (const s of spots) {
          const hp = Math.round(300 * scale);
          const shrine = {
            id: `shrine_${room.nextEntityId++}`,
            objectiveId: obj.id,
            type: 'corrupted_shrine',
            name: obj.data.flavor.shrineName,
            x: s.x, y: 0, z: s.z,
            hp, maxHp: hp,
            isDead: false
          };
          room.shrines.push(shrine);
          obj.data.shrines.push({
            id: shrine.id, name: shrine.name, x: shrine.x, z: shrine.z,
            hp: shrine.hp, maxHp: shrine.maxHp, isDead: false
          });
        }
      } else if (obj.type === OBJECTIVE_TYPES.RECOVER_RELIC) {
        if (typeof room.spawnFloorLoot === 'function') {
          room.spawnFloorLoot(
            'objective_relic',
            obj.data.relicSpot.x, obj.data.relicSpot.z,
            0, obj.data.relicName, false,
            { objectiveId: obj.id }
          );
        }
      }
    }
  }

  // ---- completion hooks (coordinator calls these) --------------------------
  // Call from Room.handleEntityDeath(entity, killer) — AFTER the existing
  // death logic. entity is the mob/boss object that just died.
  onEnemyKilled(room, entity /* , killer */) {
    if (!entity || entity.isDead === false) {
      // entity.isDead is set true by handleEntityDeath before this hook runs.
    }
    for (const obj of this.list) {
      if (obj.state !== 'active') continue;
      if (obj.type === OBJECTIVE_TYPES.SLAY_WARDEN &&
          entity && entity.type === obj.data.wardenType) {
        obj.progress.current = obj.progress.target;
        this.complete(room, obj, { x: entity.x, z: entity.z });
      }
    }
  }

  // Call from Room.updateFloorLoot() when a human picks up loot of type
  // 'objective_relic'. This method marks the loot pickedUp itself.
  onRelicPickup(room, player, loot) {
    const obj = this.list.find(o =>
      o.type === OBJECTIVE_TYPES.RECOVER_RELIC &&
      o.state === 'active' &&
      loot && loot.itemData && loot.itemData.objectiveId === o.id
    );
    if (!obj || !player) return false;
    loot.pickedUp = true;
    player.carryingObjectiveRelic = obj.id;
    obj.data.carrierId = player.id;
    obj.data.pickedUp = true;
    if (typeof room.broadcast === 'function') {
      room.broadcast({
        type: 'narrator_announcement',
        text: `${player.name} seized the ${obj.data.relicName}! Carry it to the Extraction Altar!`,
        tone: 'hype'
      });
    }
    this.push(room);
    return true;
  }

  // Call when a player disconnects so a carried relic is not lost forever.
  onPlayerLeft(room, playerId) {
    for (const obj of this.list) {
      if (obj.type === OBJECTIVE_TYPES.RECOVER_RELIC &&
          obj.state === 'active' &&
          obj.data.carrierId === playerId) {
        obj.data.carrierId = null;
        obj.data.pickedUp = false;
        // Respawn the relic at its vault spot.
        if (typeof room.spawnFloorLoot === 'function') {
          room.spawnFloorLoot(
            'objective_relic',
            obj.data.relicSpot.x, obj.data.relicSpot.z,
            0, obj.data.relicName, false,
            { objectiveId: obj.id }
          );
        }
        this.push(room);
      }
    }
  }

  // Shrine combat: call from Room.dealAreaDamage() / castBeam() /
  // castLineImpale() / applyProjectileHit() — anywhere an attack resolves at
  // a world position. Returns the shrines hit this call. Destroys at hp<=0
  // and advances DESTROY_SHRINES progress (no mock data: hp is real).
  damageShrinesAt(room, x, z, radius, damage /* , attacker */) {
    const hits = [];
    if (!room || !Array.isArray(room.shrines)) return hits;
    for (const shrine of room.shrines) {
      if (shrine.isDead) continue;
      const dx = shrine.x - x;
      const dz = shrine.z - z;
      if (Math.hypot(dx, dz) <= (radius || 2) + 1.2) {
        shrine.hp = Math.max(0, shrine.hp - Math.max(1, Math.round(damage || 0)));
        hits.push(shrine);
        if (shrine.hp <= 0) {
          shrine.isDead = true;
          this.onShrineDestroyed(room, shrine);
        }
      }
    }
    return hits;
  }

  // Prefer damageShrinesAt(); this is the direct destroy path.
  onShrineDestroyed(room, shrine) {
    const obj = this.list.find(o =>
      o.type === OBJECTIVE_TYPES.DESTROY_SHRINES &&
      o.state === 'active' &&
      o.id === (shrine && shrine.objectiveId)
    );
    if (!obj) return;
    obj.progress.current = Math.min(obj.progress.target, obj.progress.current + 1);
    const snap = obj.data.shrines.find(s => s.id === shrine.id);
    if (snap) { snap.isDead = true; snap.hp = 0; }
    if (typeof room.broadcast === 'function') {
      room.broadcast({
        type: 'floating_text',
        text: `💥 SHRINE SHATTERED! (${obj.progress.current}/${obj.progress.target})`,
        x: shrine.x, z: shrine.z, style: 'combo'
      });
    }
    if (obj.progress.current >= obj.progress.target) {
      this.complete(room, obj, { x: shrine.x, z: shrine.z });
    } else {
      this.push(room);
    }
  }

  // Call from Room.update(dt) every tick while state === 'dungeon'.
  onTick(room, dt) {
    let changed = false;
    for (const obj of this.list) {
      if (obj.state !== 'active') continue;

      if (obj.type === OBJECTIVE_TYPES.SURVIVE_AMBUSH) {
        obj.data.timeRemaining -= dt;
        obj.data.waveTimer -= dt;
        obj.progress.current = Math.min(
          obj.data.duration,
          obj.data.duration - Math.max(0, obj.data.timeRemaining)
        );
        if (obj.data.waveTimer <= 0 && obj.data.timeRemaining > 0) {
          this._spawnAmbushWave(room, obj);
          obj.data.waveTimer = obj.data.waveInterval;
          changed = true;
        }
        if (obj.data.timeRemaining <= 0) {
          const anyAlive = Object.values(room.players || {})
            .some(p => !p.isBot && !p.isDead);
          if (anyAlive) {
            obj.progress.current = obj.progress.target;
            this.complete(room, obj, this._partyCentroid(room));
          } else {
            this.fail(room, obj, 'The party fell during the ambush.');
          }
          changed = true;
        } else if (Math.floor(obj.data.timeRemaining) % 10 === 0) {
          changed = true; // refresh the countdown display periodically
        }
      }

      if (obj.type === OBJECTIVE_TYPES.RECOVER_RELIC && obj.data.carrierId) {
        const carrier = (room.players || {})[obj.data.carrierId];
        if (!carrier) {
          this.onPlayerLeft(room, obj.data.carrierId);
          changed = true;
        } else {
          const d = Math.hypot(carrier.x - obj.data.altar.x, carrier.z - obj.data.altar.z);
          if (d <= ALTAR_RADIUS && !carrier.isDead) {
            obj.progress.current = obj.progress.target;
            this.complete(room, obj, { x: obj.data.altar.x, z: obj.data.altar.z });
            changed = true;
          }
        }
      }
    }
    if (changed) this.push(room);
  }

  _partyCentroid(room) {
    const players = Object.values(room.players || {}).filter(p => !p.isBot && !p.isDead);
    if (players.length === 0) return { x: 0, z: 0 };
    return {
      x: players.reduce((a, p) => a + p.x, 0) / players.length,
      z: players.reduce((a, p) => a + p.z, 0) / players.length
    };
  }

  _spawnAmbushWave(room, obj) {
    if (typeof room.spawnMob !== 'function') return;
    obj.data.waveCount += 1;
    const c = this._partyCentroid(room);
    const size = 2 + Math.min(3, this.floor);
    for (let i = 0; i < size; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 5;
      const type = AMBUSH_MOB_POOL[Math.floor(Math.random() * AMBUSH_MOB_POOL.length)];
      try {
        room.spawnMob(type, c.x + Math.cos(ang) * r, c.z + Math.sin(ang) * r);
      } catch (e) { /* spawning is best-effort */ }
    }
    if (typeof room.broadcast === 'function') {
      room.broadcast({
        type: 'narrator_announcement',
        text: `⚔️ AMBUSH WAVE ${obj.data.waveCount}! Hold the line!`,
        tone: 'danger'
      });
    }
  }

  // ---- completion / failure -------------------------------------------------
  complete(room, obj, at) {
    if (obj.state !== 'active') return;
    obj.state = 'complete';
    const dropAt = at || this._partyCentroid(room);
    this.grantReward(room, obj, dropAt);
    if (typeof room.broadcast === 'function') {
      room.broadcast({
        type: 'objective_complete',
        floor: this.floor,
        objective: this._snap(obj),
        reward: obj.reward
      });
      room.broadcast({
        type: 'narrator_announcement',
        text: `🏆 OBJECTIVE COMPLETE${obj.primary ? ' (PRIMARY)' : ''}: ${obj.name}! +${obj.reward.xp} XP & bounty cache!`,
        tone: 'hype'
      });
      if (this.list.every(o => o.state !== 'active')) {
        room.broadcast({
          type: 'combo_alert',
          comboName: '⚔️ ALL COVENANT OBJECTIVES FULFILLED!'
        });
      }
    }
    this.push(room);
  }

  fail(room, obj, reason) {
    if (obj.state !== 'active') return;
    obj.state = 'failed';
    if (typeof room.broadcast === 'function') {
      room.broadcast({
        type: 'objective_failed',
        floor: this.floor,
        objective: this._snap(obj),
        reason: reason || 'Objective failed.'
      });
      room.broadcast({
        type: 'narrator_announcement',
        text: `💀 OBJECTIVE FAILED: ${obj.name} — ${reason || ''}`,
        tone: 'danger'
      });
    }
    this.push(room);
  }

  grantReward(room, obj, at) {
    if (!room) return;
    const xp = obj.reward && obj.reward.xp ? obj.reward.xp : 0;
    const humans = Object.values(room.players || {}).filter(p => !p.isBot);
    const progression = room.systems && room.systems.progression;
    if (progression && typeof progression.grantXP === 'function') {
      // Phase 2 Progression interface (built by another agent):
      //   grantXP(room, playerId, amount, reason)
      for (const p of humans) {
        try {
          progression.grantXP(room, p.id, xp, `objective:${obj.type.toLowerCase()}`);
        } catch (e) { /* per-player grant is best-effort */ }
      }
    } else if (typeof room.awardPartyXP === 'function' && humans.length > 0) {
      // Fallback until the Progression system lands: party-wide XP via the
      // existing Room level-up path (real XP, real level-ups).
      room.awardPartyXP(xp);
    }
    // Loot bounty: real gear_drop (Room falls back to a generated item when
    // itemData is null — see updateFloorLoot).
    if (typeof room.spawnFloorLoot === 'function' && at) {
      try {
        room.spawnFloorLoot(
          'gear_drop',
          (at.x || 0) + 1.2, (at.z || 0) + 0.8,
          xp, `${obj.name} Bounty Cache`, false, null
        );
      } catch (e) { /* best-effort */ }
    }
  }

  // ---- network --------------------------------------------------------------
  _snap(obj) {
    return {
      id: obj.id,
      type: obj.type,
      biome: obj.biome,
      name: obj.name,
      description: obj.description,
      primary: obj.primary,
      state: obj.state,
      progress: { ...obj.progress },
      reward: { ...obj.reward },
      timeRemaining: obj.data.timeRemaining != null
        ? Math.max(0, Math.ceil(obj.data.timeRemaining)) : null,
      carrierId: obj.data.carrierId || null,
      altar: obj.data.altar ? { ...obj.data.altar } : null,
      shrines: Array.isArray(obj.data.shrines)
        ? obj.data.shrines.map(s => ({ ...s })) : null,
      // Phase 3: minimap objective markers (client/js/minimapenhanced.js).
      relicSpot: obj.data.relicSpot ? { ...obj.data.relicSpot } : null,
      wardenType: obj.data.wardenType || null,
    };
  }

  getSnapshot() {
    return {
      floor: this.floor,
      objectives: this.list.map(o => this._snap(o))
    };
  }

  // Push objectives_update to every client in the room.
  push(room) {
    const r = room || this.room;
    if (r && typeof r.broadcast === 'function') {
      r.broadcast({ type: 'objectives_update', ...this.getSnapshot() });
    }
  }
}

module.exports = { Objectives, OBJECTIVE_TYPES, BIOME_FLAVOR };
