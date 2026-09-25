// Room.js - Authoritative Room Simulation, Combat, Loot, Bots & Objectives
const MalakorBoss = require('./Boss');
const ComboEngine = require('./Combos');
const CollisionEngine = require('./Collision');
const ProceduralLevelGenerator = require('./ProceduralLevelGenerator');
const LootGenerator = require('./LootGenerator');

// Phase 2 core systems (workstream 4)
const Health = require('./systems/Health');
const Progression = require('./systems/Progression');
const Abilities = require('./systems/Abilities');
// Phase 3 loot & gear (workstream 2) — server-authoritative inventory/equip
const Gear = require('./systems/Gear');
// Phase 3 meta-progression (workstream 5) — persistent account XP, covenant
// ranks, unlockable classes/boons/stash tabs. Server-authoritative.
const MetaProgression = require('./systems/MetaProgression');
// Phase 2 objectives (workstream 5) — exports { Objectives, ... }
const { Objectives } = require('./systems/Objectives');
// Phase 2 signature features (workstream 6)
const Oaths = require('./systems/Oaths');
// Phase 3 cosmetic shop (workstream 6) — server-side ownership validation for
// skin / weapon-glow equips and emotes. Cosmetics are visual only.
const authService = require('../authService');
const catalog = require('../cosmeticsCatalog');
const LivingDungeon = require('./systems/LivingDungeon');
const Nemesis = require('./systems/Nemesis');
// Phase 2 enemies + logic (workstream 1) — EnemyBrain exports { EnemyBrain, STATES }
const Archetypes = require('./enemies/Archetypes');
const { EnemyBrain } = require('./enemies/EnemyBrain');
const Elites = require('./enemies/Elites');
const BossPhases = require('./enemies/BossPhases');

const SECRET_OBJECTIVES = [
  { id: 'gold_hoarder', title: 'The Covetous', desc: 'Finish the dungeon with at least 50% of all looted gold.' },
  { id: 'boss_slayer', title: 'The Executioner', desc: 'Personally deliver the killing blow to Malakor.' },
  { id: 'clutch_savior', title: 'The Guardian', desc: 'Revive at least 2 fallen allies or trigger Last Stand.' },
  { id: 'iron_shield', title: 'The Iron Bastion', desc: 'Absorb more damage than any other party member without dying.' },
  { id: 'relic_thief', title: 'The Relic Thief', desc: 'Win or take the first epic loot drop from the boss.' }
];

const CLASS_CONFIGS = {
  juggernaut: { name: 'Juggernaut', role: 'Tank', maxHp: 650, speed: 4.8, attackRange: 2.2, color: 0x994422 },
  cleric: { name: 'Radiant Cleric', role: 'Healer', maxHp: 440, speed: 4.6, attackRange: 8.0, color: 0xeecc44 },
  rogue: { name: 'Shadowblade', role: 'Rogue', maxHp: 380, speed: 5.8, attackRange: 2.0, color: 0x663399 },
  mage: { name: 'Pyromancer', role: 'Mage', maxHp: 360, speed: 4.5, attackRange: 10.0, color: 0x3388dd },
  ranger: { name: 'Deadeye', role: 'Ranger', maxHp: 400, speed: 5.2, attackRange: 11.0, color: 0x44aa44 },
  necromancer: { name: 'Dreadweaver', role: 'Necromancer', maxHp: 420, speed: 4.6, attackRange: 8.5, color: 0x228855 }
};
// Phase 3 meta-progression: unlockable hero classes (single source of truth
// for stats lives in systems/MetaProgression.js).
Object.assign(CLASS_CONFIGS, MetaProgression.EXTRA_CLASS_CONFIGS);

class Room {
  constructor(roomCode, hostSocket = null) {
    this.code = roomCode;
    this.state = 'lobby'; // lobby, dungeon, victory, defeat
    this.createdAt = Date.now();
    this.players = {}; // socketId -> player object
    this.projectiles = [];
    this.floorLoot = [];
    this.groundEffects = []; // fire pools, tar slicks, ice zones, sanctuary
    this.mobs = [];
    this.boss = null;
    this.corpses = []; // For Necromancer Corpse Explosion
    this.floor = 1;
    this.proceduralConfig = ProceduralLevelGenerator.generate(1);

    // War Horn state
    this.warHornAvailable = true;
    this.warHornActive = false;
    this.warHornTimeRemaining = 0;
    this.timeScale = 1.0;

    // Last Stand
    this.lastStandActive = false;
    this.lastStandHeroId = null;

    // Need/Greed roll state

    // Stats & Scoring
    this.totalGoldDropped = 0;
    this.startTime = null;
    this.endTime = null;
    this.combosTriggeredCount = 0;
    this.playOfTheGame = null;
    this.potgCandidates = [];

    // Next entity IDs
    this.nextEntityId = 1000;

    // Phase 2 systems registry (coordinator wiring; see systems/PROTOCOL.md)
    this.systems = {
      health: Health,
      progression: Progression,
      abilities: Abilities,
      objectives: null, // set per floor by Objectives.createForRoom
      oaths: Oaths,
      metaProgression: MetaProgression, // Phase 3: persistent account ranks/unlocks
      livingDungeon: LivingDungeon,
      nemesis: Nemesis
    };
    this.systems.livingDungeon.init(this);
    this.systems.nemesis.init(this);
    this.oathShrines = [];
    this.shrines = this.shrines || [];
  }

  addPlayer(socketId, name, chosenClass = 'juggernaut', isBot = false, profile = null, accountToken = null) {
    // Phase 3 meta-progression: resolve the SERVER-SIDE account from the join
    // token. Unlocks (classes, boons) are read from the server record — the
    // client-supplied profile blob is display data only and never trusted.
    let serverProfile = null;
    let accountUsername = null;
    if (!isBot && accountToken) {
      const acc = authService.getAccountByToken(accountToken);
      if (acc) { serverProfile = acc.profile; accountUsername = acc.username; }
    }

    // Locked hero classes (purchased in the Covenant Vault) fall back to
    // Juggernaut when the account has not unlocked them. No exceptions.
    let safeClass = chosenClass;
    let classDenied = false;
    if (!isBot && !MetaProgression.classAllowedFor(serverProfile, chosenClass)) {
      safeClass = 'juggernaut';
      classDenied = !!chosenClass && chosenClass !== 'juggernaut';
    }
    const classInfo = CLASS_CONFIGS[safeClass] || CLASS_CONFIGS.juggernaut;
    const mightRank = profile?.mightRank || 0;
    const vitalityRank = profile?.vitalityRank || 0;
    const hasteRank = profile?.hasteRank || 0;
    const bonusHp = vitalityRank * 150;
    const botAuras = ['sovereign', 'void', 'infernal', 'necro'];
    const defaultBotAura = isBot ? botAuras[Object.keys(this.players).length % botAuras.length] : null;

    const player = {
      id: socketId,
      name: name || `Hero_${Math.floor(100 + Math.random() * 900)}`,
      // Phase 3 meta-progression: server-resolved account link. Bots and
      // guests have none — only linked accounts earn account XP.
      accountUsername,
      title: profile?.title || (isBot ? 'Covenant Vanguard' : 'Soul-Sworn'),
      cosmeticAura: profile?.cosmeticAura || defaultBotAura,
      // Phase 3 cosmetic shop: equipped hero skin + weapon glow (visual only,
      // broadcast to every client so the party sees your cosmetics).
      equippedSkin: profile?.equippedSkin || null,
      equippedWeaponGlow: profile?.equippedWeaponGlow || null,
      emoteCooldownUntil: 0,
      classKey: safeClass,
      role: classInfo.role,
      x: 0 + (Object.keys(this.players).length * 1.5 - 2.5),
      y: 0,
      z: 15,
      rotation: 0,
      vx: 0,
      vz: 0,
      maxHp: classInfo.maxHp + bonusHp,
      hp: classInfo.maxHp + bonusHp,
      speed: classInfo.speed,
      attackRange: classInfo.attackRange,
      isDowned: false,
      downedTimer: 30,
      isDead: false,
      isBot,
      level: 1,
      xp: 0,
      nextLevelXp: 100,
      damageBuff: +(1.0 + mightRank * 0.12).toFixed(2),
      cooldownHaste: +(1.0 + hasteRank * 0.10).toFixed(2),
      lifesteal: 0.0,
      critChance: 0.18,
      streakCount: 0,
      streakTimer: 0,
      overdrive: false,
      invulnerableTimer: 0,
      equipment: {
        weapon: 'Covenant Arms (+0% DMG)',
        armor: 'Initiate Plate (+0 HP)',
        relics: []
      },
      statuses: {},
      cooldowns: {
        attack: 0,
        skill1: 0,
        skill2: 0,
        skill3: 0,
        dash: 0
      },
      stats: {
        damageDealt: 0,
        damageTaken: 0,
        healingDone: 0,
        kills: 0,
        goldCollected: 60, // Starting expedition gold for the Covenant Runeforge
        shardsEarned: 0,
        revivesCount: 0,
        killingBlowBoss: false
      },
      secretObjective: null,
      secretCompleted: false,
      revivingTargetId: null,
      reviveProgress: 0,
      hasTaunted: false,
      takeDamage: (amount, damageType = 'physical', sourceName = 'Enemy') => {
        this.damagePlayer(player, amount, damageType, sourceName);
      }
    };

    // If joining an active match via Quickplay Auto-Matchmaking, replace a companion bot slot if needed
    if (!isBot && this.state === 'dungeon') {
      const botEntry = Object.values(this.players).find(p => p.isBot);
      if (botEntry && Object.keys(this.players).length >= 4) {
        delete this.players[botEntry.id];
      }
      if (!player.secretObjective && SECRET_OBJECTIVES.length > 0) {
        player.secretObjective = SECRET_OBJECTIVES[Math.floor(Math.random() * SECRET_OBJECTIVES.length)];
      }
    }

    this.players[socketId] = player;

    // Restore account / IAP equipped item immediately if present
    if (profile && profile.equippedItem && typeof this.equipProceduralItem === 'function') {
      this.equipProceduralItem(player, profile.equippedItem);
    }

    // Phase 2 core systems: authoritative HP/XP/abilities init
    Health.initPlayer(player);
    Progression.initPlayer(player);
    Abilities.initPlayer(player);
    // Phase 3: server-authoritative loot inventory + equipment init
    Gear.initPlayer(player);
    Gear.sendInventoryUpdate(this, player);

    // Phase 3 meta-progression: apply the account's equipped starting boons
    // (resolved from the server-side account record, never the client blob).
    if (serverProfile) {
      const applied = MetaProgression.applyStartBoons(this, player, serverProfile);
      if (applied.length > 0) {
        this.broadcast({
          type: 'floating_text',
          text: `✨ COVENANT BOONS: ${applied.map(id => MetaProgression.UNLOCKABLES.find(u => u.boonId === id)?.name || id).join(' + ')}`,
          x: player.x, z: player.z, style: 'combo'
        });
      }
    }
    if (classDenied) {
      this.broadcast({
        type: 'class_choice_denied',
        playerId: socketId,
        reason: `The ${CLASS_CONFIGS[chosenClass]?.name || chosenClass} is sealed in the Covenant Vault — claim it there first. You march as a Juggernaut.`
      });
    }

    return player;
  }

  removePlayer(socketId) {
    Abilities.dropPlayer(socketId);
    this.systems?.objectives?.onPlayerLeft(this, socketId);
    delete this.players[socketId];
  }

  startDungeon() {
    this.state = 'dungeon';
    this.startTime = Date.now();
    this.floor = 1;
    // Always generate a brand-new random level (Biome, Boss, Enemies, Props & Loot) on match start!
    this.proceduralConfig = ProceduralLevelGenerator.generate(this.floor);

    // Fill empty slots with companion bots if fewer than 4 players
    const availableClasses = ['cleric', 'juggernaut', 'mage', 'rogue', 'ranger', 'necromancer'];
    const takenClasses = Object.values(this.players).map(p => p.classKey);
    const classesToAdd = availableClasses.filter(c => !takenClasses.includes(c));

    let botIndex = 1;
    while (Object.keys(this.players).length < 4 && classesToAdd.length > 0) {
      const botClass = classesToAdd.shift();
      const botId = `bot_${botIndex}_${Date.now()}`;
      const botNames = ['Sir Gallant', 'Aria Sunfire', 'Kaelen Frost', 'Vex the Whisper', 'Lyra Windwalker'];
      const botName = botNames[botIndex - 1] || `Companion ${botIndex}`;
      this.addPlayer(botId, botName, botClass, true);
      botIndex++;
    }

    // Assign Secret Objectives to human players
    const objectivesPool = [...SECRET_OBJECTIVES];
    for (const player of Object.values(this.players)) {
      if (!player.isBot) {
        const obj = objectivesPool.splice(Math.floor(Math.random() * objectivesPool.length), 1)[0] || SECRET_OBJECTIVES[0];
        player.secretObjective = obj;
      }
    }

    // Initialize Dungeon Mobs, Props, Boss & Loot
    this.initDungeonLayout();

    this.broadcast({
      type: 'procedural_floor_generated',
      config: this.proceduralConfig,
      proceduralConfig: this.proceduralConfig
    });

    this.broadcast({
      type: 'narrator_announcement',
      text: `PROCEDURAL FLOOR ${this.floor} [${this.proceduralConfig.biome.name}] — Anomaly: ${this.proceduralConfig.hexAnomaly.name}! Boss: ${this.proceduralConfig.bossVariant.name}!`,
      tone: 'intro'
    });

    // Phase 2 floor systems: objectives + oath shrines + living dungeon + nemesis
    Objectives.createForRoom(this);
    this.systems?.oaths?.onFloorStart(this);
    this.systems?.livingDungeon?.onFloorStart(this);
    this.systems?.nemesis?.onFloorStart(this);
  }

  generateProceduralDungeonFloor(nextFloor = null, customSeed = null) {
    this.floor = nextFloor ? Number(nextFloor) : (this.floor + 1);
    this.proceduralConfig = ProceduralLevelGenerator.generate(this.floor, customSeed);
    this.state = 'dungeon';
    this.mobs = [];
    this.floorLoot = [];
    this.projectiles = [];
    this.groundEffects = [];
    this.corpses = [];
    this.warHornAvailable = true;

    let idx = 0;
    for (const p of Object.values(this.players)) {
      p.isDead = false;
      p.isDowned = false;
      p.hp = p.maxHp;
      p.x = (idx * 1.5) - 2.2;
      p.z = 16;
      idx++;
    }

    this.initDungeonLayout();

    this.broadcast({
      type: 'procedural_floor_generated',
      config: this.proceduralConfig,
      proceduralConfig: this.proceduralConfig
    });
    this.broadcast({
      type: 'narrator_announcement',
      text: `FLOOR ${this.floor} GENERATED [Seed #${this.proceduralConfig.seed}]: ${this.proceduralConfig.biome.name} — Hex Anomaly: ${this.proceduralConfig.anomaly.name}!`,
      tone: 'hype'
    });

    // Phase 2 floor systems: objectives + oath shrines + living dungeon + nemesis
    Objectives.createForRoom(this);
    this.systems?.oaths?.onFloorStart(this);
    this.systems?.livingDungeon?.onFloorStart(this);
    this.systems?.nemesis?.onFloorStart(this);
  }

  initDungeonLayout() {
    if (!this.proceduralConfig) {
      this.proceduralConfig = ProceduralLevelGenerator.generate(this.floor || 1);
    }
    const cfg = this.proceduralConfig;

    // Apply RPG-Generator Hex Anomaly bonuses to all active heroes
    if (cfg.hexAnomaly) {
      for (const p of Object.values(this.players)) {
        if (cfg.hexAnomaly.playerDamageBonus) p.damageBuff = +(p.damageBuff + cfg.hexAnomaly.playerDamageBonus).toFixed(2);
        if (cfg.hexAnomaly.playerHasteBonus) p.cooldownHaste = +(p.cooldownHaste + cfg.hexAnomaly.playerHasteBonus).toFixed(2);
        if (cfg.hexAnomaly.playerLifestealBonus) p.lifesteal = +(p.lifesteal + cfg.hexAnomaly.playerLifestealBonus).toFixed(2);
        if (cfg.hexAnomaly.playerCritBonus) p.critChance = +((p.critChance || 0.18) + cfg.hexAnomaly.playerCritBonus).toFixed(2);
        if (cfg.hexAnomaly.playerHpBonus) {
          const addHp = Math.round(p.maxHp * cfg.hexAnomaly.playerHpBonus);
          Health.setMaxHp(this, p.id, p.maxHp + addHp);
        }
      }
    }

    // Spawn procedural mob packs across all 7 zones
    for (const mSpec of cfg.mobs) {
      this.spawnMob(mSpec.type, mSpec.x, mSpec.z);
    }

    // Zone 7: The Soul-Forge Boss Sanctum
    // Phase 2 (workstream 1): biome-tied multi-phase PhaseBoss replaces the
    // legacy MalakorBoss (MalakorBoss class kept untouched as fallback).
    this.sanctumSealsRemaining = 2;
    const bossBiomeId = (cfg.biome && cfg.biome.id) ? cfg.biome.id : 'ossuary_crypt';
    this.boss = BossPhases.createBoss(bossBiomeId, 0, -75, Object.keys(this.players).length);
    // Preserve the legacy floor-scale difficulty bump.
    this.boss.maxHp = Math.round(this.boss.maxHp * (cfg.floorScale || 1.0));
    this.boss.hp = this.boss.maxHp;
    // handleEntityDeath boss detection + soul-seal ward hook.
    this.boss.isBoss = true;
    this.boss.sealsRemaining = this.sanctumSealsRemaining;
    this.broadcast({
      type: 'boss_spawn',
      boss: {
        id: this.boss.id,
        name: this.boss.name,
        title: this.boss.title,
        biomeId: this.boss.biomeId,
        model: this.boss.model,
        reskinTint: this.boss.reskinTint,
        x: this.boss.x,
        z: this.boss.z,
        hp: this.boss.hp,
        maxHp: this.boss.maxHp,
        phase: this.boss.phase,
        phaseName: this.boss.phaseName
      }
    });

    // Timed Environmental Dungeon Hazards
    this.hazards = cfg.hazards;

    // Interactive Shrines, Treasure Chests, Dynamic Gear Drops & Floor Loot across all 7 zones
    this.spawnFloorLoot('gold', -3, 14, Math.round(35 * cfg.floorScale), 'Atrium Gold', false);
    this.spawnFloorLoot('gold', 3, 14, Math.round(35 * cfg.floorScale), 'Atrium Gold', false);
    this.spawnFloorLoot('potion_health', 0, 23, 1, 'Atrium Healing Font', false);

    // Spawn starter + initial Procedural Gear Drops across the floor
    const starterGear = LootGenerator.generateItem(this.floor, 'chest');
    this.spawnFloorLoot('gear_drop', 0, 11.5, starterGear.gearScore, starterGear.name, false, starterGear);
    if (Array.isArray(cfg.initialGearDrops)) {
      for (const gd of cfg.initialGearDrops) {
        if (gd.item) {
          this.spawnFloorLoot('gear_drop', gd.x, gd.z, gd.item.gearScore, gd.item.name, false, gd.item);
        }
      }
    }

    // Crossroads cache
    this.spawnFloorLoot('potion_health', 0, -14, 1, 'Crossroads Elixir', false);

    // West Wing: Shrine of Blood Fury & Catacomb Chests
    this.spawnFloorLoot('shrine_blood', -49, -14, 25, 'Shrine of Blood Fury (+25% DMG)', false);
    this.spawnFloorLoot('treasure_chest', -48, -5, Math.round(120 * cfg.floorScale), 'Reliquary War-Chest', false);
    this.spawnFloorLoot('treasure_chest', -48, -23, Math.round(120 * cfg.floorScale), 'Sarcophagus Hoard', false);

    // East Wing: Shrine of Astral Aegis & Alchemist Treasury Chests
    this.spawnFloorLoot('shrine_arcane', 49, -14, 30, 'Shrine of Astral Aegis (+30% HP & Horn)', false);
    this.spawnFloorLoot('treasure_chest', 48, -5, Math.round(140 * cfg.floorScale), 'Alchemist Gilded Vault', false);
    this.spawnFloorLoot('treasure_chest', 48, -23, Math.round(140 * cfg.floorScale), 'Arcane Relic Coffer', false);

    // Antechamber of Chains: Pre-Boss Supply Cache & Restoration Wells
    this.spawnFloorLoot('treasure_chest', 0, -46, Math.round(150 * cfg.floorScale), 'Forge-Guard Supply Chest', false);
    this.spawnFloorLoot('potion_health', -11, -49, 1, 'West Restoration Elixir', false);
    this.spawnFloorLoot('potion_health', 11, -49, 1, 'East Restoration Elixir', false);
  }

  // Phase 2 (workstream 1): archetype-driven mob factory. Legacy type names are
  // resolved via Archetypes.LEGACY_TYPE_MAP; stats come from
  // Archetypes.buildMobStats(type, biomeId, floor) (biome reskin + floor
  // scaling). The mob keeps the legacy fields rendering/clients rely on
  // (hp/maxHp/speed/damage/statuses/attackTimer) plus the new role/model/
  // biomeTint fields, a W1 EnemyBrain, and elite affixes where applicable.
  spawnMob(type, x, z) {
    const self = this;
    const id = `mob_${this.nextEntityId++}`;
    const biomeId = (this.proceduralConfig && this.proceduralConfig.biome && this.proceduralConfig.biome.id)
      ? this.proceduralConfig.biome.id
      : 'ossuary_crypt';

    const stats = Archetypes.buildMobStats(type, biomeId, this.floor);

    const mob = {
      id,
      type: stats.type,        // canonical archetype id (legacy name resolved)
      legacyType: type,        // originally requested type (fallback compat)
      role: stats.role,
      name: stats.name,
      biome: stats.biome,
      biomePrefix: stats.biomePrefix,
      biomeTint: stats.biomeTint,
      model: stats.model,
      modelScale: stats.modelScale,
      x,
      y: 0,
      z,
      hp: stats.hp,
      maxHp: stats.maxHp,
      speed: stats.speed,
      damage: stats.damage,
      damageType: stats.damageType,
      aggroRange: stats.aggroRange,
      attackRange: stats.attackRange,
      desiredRange: stats.desiredRange,
      attackCooldown: stats.attackCooldown,
      attackTimer: 1.5,
      telegraphMs: stats.telegraphMs,
      targetPolicy: stats.targetPolicy,
      stealth: !!stats.stealth,
      stealthed: !!stats.stealth,
      projectile: stats.projectile,
      volley: stats.volley,
      slamAttack: stats.slamAttack,
      healAmount: stats.healAmount,
      healRange: stats.healRange,
      healCooldown: stats.healCooldown,
      pounce: stats.pounce,
      canFlee: stats.canFlee,
      statuses: {},
      isDead: false,
      // Phase 2 server-side mob damage intake: elite shield absorb, living
      // dungeon damage-taken mult, then the legacy wrapper application.
      takeDamage: (amount, damageType = 'physical', attacker = null) => {
        if (mob.isDead) return { damageDealt: 0, combo: null, isDead: true, killer: attacker };
        let amt = Math.max(0, Math.round(amount));
        amt = Elites.absorbDamage(mob, amt);
        amt = Math.round(amt * (self.systems?.livingDungeon?.getDamageTakenMult(mob, damageType) ?? 1));
        const buffMult = (attacker && attacker.damageBuff) ? attacker.damageBuff : 1.0;
        const scaledAmount = Math.round(amt * buffMult);
        const combo = ComboEngine.processHit(attacker, mob, damageType, scaledAmount);
        const totalDmg = scaledAmount + (combo ? combo.bonusDamage : 0);
        mob.hp = Math.max(0, mob.hp - totalDmg);
        // Phase 2 post-hit hooks: threat, nemesis grudge, living-dungeon
        // memory, oath damage log.
        if (attacker && attacker.id) {
          if (mob._brain) mob._brain.registerThreat(attacker.id, totalDmg);
          self.systems?.nemesis?.onMobDamaged(self, mob, attacker, totalDmg);
          self.systems?.livingDungeon?.recordDamage(self, attacker, totalDmg, damageType);
          self.systems?.oaths?.recordDamageDealt(self, attacker.id, totalDmg);
        }
        return { damageDealt: totalDmg, combo, isDead: mob.hp <= 0, killer: attacker };
      }
    };

    // Wing Wardens: roll W1 elite affixes (brutal/swift/shielded/vampiric...).
    if (mob.type === 'elite_executioner' || mob.type === 'elite_lich') {
      mob.isElite = true;
      Elites.applyAffixes(mob, Elites.rollAffixes(this.floor));
    }

    // Phase 2 AI brain — server-authoritative state machine (workstream 1).
    mob._brain = new EnemyBrain(mob);

    this.mobs.push(mob);

    // Client preload + elite aura hook (enemies/PROTOCOL.md §2 enemy_spawn).
    this.broadcast({
      type: 'enemy_spawn',
      enemy: {
        id: mob.id,
        type: mob.type,
        role: mob.role,
        name: mob.name,
        biome: mob.biome,
        biomeTint: mob.biomeTint,
        model: mob.model,
        modelScale: mob.modelScale,
        x: mob.x,
        z: mob.z,
        hp: mob.hp,
        maxHp: mob.maxHp,
        affixes: mob.affixes || [],
        auraColor: mob.auraColor,
        stealthed: !!mob.stealthed
      }
    });

    return mob;
  }

  // Phase 2 (workstream 1): shared context handed to EnemyBrain instances and
  // Elites.tick each tick. All player-damage routes through this.damagePlayer
  // so Health/oath/nemesis hooks stay coherent.
  _mobCtx() {
    const self = this;
    return {
      players: this.players,
      mobs: this.mobs,
      broadcast: (msg) => self.broadcast(msg),
      damagePlayer: (p, amt, type, src, attacker = null) => self.damagePlayer(p, amt, type, src, attacker),
      spawnProjectile: (opts) => self._pushProjectile(opts),
      moveEntity: (mob, dirX, dirZ, speed, dt) => {
        const np = CollisionEngine.moveAndSlide(mob.x, mob.z, dirX, dirZ, speed, dt, 0.5);
        mob.x = np.x;
        mob.z = np.z;
        return np;
      },
      hasLineOfSight: (x1, z1, x2, z2) => CollisionEngine.hasLineOfSight(x1, z1, x2, z2),
      nextTelegraphId: () => `etel_${this.nextEntityId++}`
    };
  }

  // Phase 2: server-authoritative projectile push (mob/boss brains use this;
  // id assignment lives here so brains don't need room internals).
  _pushProjectile(opts = {}) {
    const p = Object.assign({
      id: `proj_${this.nextEntityId++}`,
      life: 2.2,
      radius: 0.4,
      damageType: 'physical',
      damage: 20
    }, opts);
    this.projectiles.push(p);
    return p;
  }

  spawnFloorLoot(type, x, z, value = 10, name = 'Loot', jitter = true, itemData = null) {
    const loot = {
      id: `loot_${this.nextEntityId++}`,
      type, // 'gold', 'potion_health', 'treasure_chest', 'shrine_blood', 'shrine_arcane', 'epic_chest', 'gear_drop'
      x: jitter ? x + (Math.random() - 0.5) * 1.5 : x,
      y: 0.3,
      z: jitter ? z + (Math.random() - 0.5) * 1.5 : z,
      value,
      name: type === 'gold' ? `${value} Gold` : (type === 'potion_health' ? 'Elixir of Healing' : name),
      itemData: itemData || null,
      pickedUp: false
    };
    if (type === 'gold') {
      this.totalGoldDropped += value;
    }
    this.floorLoot.push(loot);
  }

  // Handle player inputs (movement, abilities, actions)
  handleInput(socketId, inputData) {
    const player = this.players[socketId];
    if (!player || player.isDead) return;

    // Movement vector
    if (inputData.movement && !player.isDowned) {
      player.vx = inputData.movement.x || 0;
      player.vz = inputData.movement.z || 0;
    }

    // Rotation / aim
    if (inputData.rotation !== undefined) {
      player.rotation = inputData.rotation;
    }

    // Ability Casts
    if (inputData.action) {
      this.handlePlayerAction(player, inputData.action, inputData.targetPos);
    }

    // Ping
    if (inputData.ping) {
      const pingType = inputData.ping.type;
      const px = inputData.ping.x || player.x;
      const pz = inputData.ping.z || player.z;

      this.broadcast({
        type: 'party_ping',
        pingType,
        x: px,
        z: pz,
        playerName: player.name,
        classKey: player.classKey
      });

      // Companion bots actively react to player command pings!
      if (!player.isBot) {
        for (const bot of Object.values(this.players)) {
          if (bot.isBot && !bot.isDead && !bot.isDowned) {
            if (pingType === 'regroup' || pingType === 'help') {
              const dx = player.x - bot.x;
              const dz = player.z - bot.z;
              const d = Math.hypot(dx, dz);
              if (d > 0.1) {
                bot.vx = dx / d;
                bot.vz = dz / d;
              }
            } else if (pingType === 'attack') {
              const dx = px - bot.x;
              const dz = pz - bot.z;
              const d = Math.hypot(dx, dz);
              if (d > 0.1) {
                bot.vx = dx / d;
                bot.vz = dz / d;
                bot.rotation = Math.atan2(dx, dz);
              }
            }
          }
        }
      }
    }

    // Revive Channeling
    if (inputData.reviveTargetId) {
      player.revivingTargetId = inputData.reviveTargetId;
    } else if (inputData.stopReviving) {
      player.revivingTargetId = null;
      player.reviveProgress = 0;
    }

    // Covenant Gold Forge Upgrades (Spend collected gold mid-run)
    if (inputData.forgeUpgrade) {
      this.handleForgeUpgrade(player, inputData.forgeUpgrade);
    }

    // Live Cosmetic Aura & Title Equip from Covenant Emporium
    if (inputData.equipCosmetic) {
      const ec = inputData.equipCosmetic;
      // Phase 3 cosmetic shop equips are validated against the account's
      // persisted entitlements — the client cannot equip what it has not bought.
      const entitlements = authService.getEntitlements(inputData.accountToken);
      if (ec.aura !== undefined) {
        player.cosmeticAura = ec.aura || null;
      }
      if (ec.skin !== undefined) {
        if (ec.skin === null || (entitlements && entitlements.ownedSkins.includes(ec.skin))) {
          player.equippedSkin = ec.skin;
        }
      }
      if (ec.weaponGlow !== undefined) {
        if (ec.weaponGlow === null || (entitlements && entitlements.ownedWeaponGlows.includes(ec.weaponGlow))) {
          player.equippedWeaponGlow = ec.weaponGlow;
        }
      }
      if (inputData.equipCosmetic.title) player.title = inputData.equipCosmetic.title;
      this.broadcast({
        type: 'floating_text',
        text: `👑 EQUIPPED: ${(inputData.equipCosmetic.name || 'MYTHIC AURA').toUpperCase()}!`,
        x: player.x,
        z: player.z,
        style: 'combo'
      });
    }

    // Phase 3 cosmetic shop: emotes. Ownership-validated, rate-limited, and
    // rebroadcast so every party member sees the emote animation.
    if (inputData.emote) {
      const emoteId = String(inputData.emote);
      const entitlements = authService.getEntitlements(inputData.accountToken);
      const owned = entitlements && entitlements.ownedEmotes.includes(emoteId);
      const now = Date.now();
      if (owned && now >= (player.emoteCooldownUntil || 0)) {
        player.emoteCooldownUntil = now + 3000; // 3s anti-spam cooldown
        this.broadcast({ type: 'player_emote', playerId: player.id, emote: emoteId });
      }
    }

    // Live Permanent Soul-Tree Blessing Upgrade from Covenant Emporium
    if (inputData.applyBlessing) {
      const bType = inputData.applyBlessing;
      if (bType === 'might') {
        player.damageBuff = +(player.damageBuff + 0.12).toFixed(2);
      } else if (bType === 'vitality') {
        Health.setMaxHp(this, player.id, player.maxHp + 150);
      } else if (bType === 'haste') {
        player.cooldownHaste = +(player.cooldownHaste + 0.10).toFixed(2);
      }
      this.broadcast({
        type: 'floating_text',
        text: `✨ SOUL BLESSING AWAKENED (${bType.toUpperCase()})!`,
        x: player.x,
        z: player.z,
        style: 'combo'
      });
    }

    // NOTE: the old client-driven `equipIAPItem` purchase path was removed:
    // the shop is cosmetics-only and stat items are never granted. Any
    // equipIAPItem input is ignored.
  }

  handleForgeUpgrade(player, upgradeType) {
    const costs = { weapon: 80, armor: 80, elixir: 60 };
    const cost = costs[upgradeType] || 80;
    if (player.stats.goldCollected < cost) {
      this.broadcast({
        type: 'floating_text',
        text: `NEED ${cost} GOLD!`,
        x: player.x,
        z: player.z,
        style: 'crit'
      });
      return;
    }

    player.stats.goldCollected -= cost;

    if (upgradeType === 'weapon') {
      player.damageBuff = +(player.damageBuff + 0.25).toFixed(2);
      const pct = Math.round((player.damageBuff - 1) * 100);
      player.equipment.weaponLevel = (player.equipment.weaponLevel || 0) + 1;
      player.equipment.weapon = `Runeforged Arms (+${pct}% DMG)`;
      this.broadcast({
        type: 'floating_text',
        text: `⚒️ WEAPON FORGED! (+${pct}% DMG)`,
        x: player.x,
        z: player.z,
        style: 'combo'
      });
    } else if (upgradeType === 'armor') {
      Health.setMaxHp(this, player.id, player.maxHp + 180);
      player.equipment.armorLevel = (player.equipment.armorLevel || 0) + 1;
      player.equipment.armor = `Soul-Tempered Plate (${player.maxHp} Max HP)`;
      this.broadcast({
        type: 'floating_text',
        text: `🛡️ ARMOR FORGED! (+180 MAX HP)`,
        x: player.x,
        z: player.z,
        style: 'combo'
      });
    } else if (upgradeType === 'elixir') {
      for (const ally of Object.values(this.players)) {
        if (ally.isDead) continue;
        ally.isDowned = false;
        const rawElixir = Math.round(ally.maxHp * 0.65);
        const elixirAmt = this.systems?.oaths?.onHeal(this, player, ally, rawElixir) ?? rawElixir;
        Health.healPlayer(this, ally.id, elixirAmt, 'Forge Elixir');
        ally.cooldowns.skill1 = 0;
        ally.cooldowns.skill2 = 0;
        ally.cooldowns.skill3 = 0;
        ally.cooldowns.dash = 0;
      }
      this.broadcast({
        type: 'floating_text',
        text: `✨ COVENANT SURGE! PARTY HEALED & CDS RESET`,
        x: player.x,
        z: player.z,
        style: 'heal'
      });
    }
  }

  executeTacticalCommand(socketId, command, targetPos = null) {
    const player = this.players[socketId];
    if (!player || player.isDead) return;

    const cmd = (command || '').toLowerCase();

    if (cmd === 'attack' || cmd === 'attack_command') {
      const nearest = this.findNearestFoe(player.x, player.z, 22.0);
      const tx = targetPos?.x ?? (nearest ? nearest.x : player.x + Math.sin(player.rotation) * 8);
      const tz = targetPos?.z ?? (nearest ? nearest.z : player.z + Math.cos(player.rotation) * 8);
      this.executeBasicAttack(player, { x: tx, z: tz });
      for (const p of Object.values(this.players)) {
        if (!p.isDead) {
          p.overdrive = true;
          p.streakTimer = Math.max(p.streakTimer || 0, 6.0);
          if (p.isBot && nearest) {
            const dx = nearest.x - p.x;
            const dz = nearest.z - p.z;
            const d = Math.hypot(dx, dz) || 1;
            p.vx = dx / d;
            p.vz = dz / d;
            p.rotation = Math.atan2(dx, dz);
          }
        }
      }
      this.broadcast({
        type: 'floating_text',
        text: `⚔️ TACTICAL ASSAULT! PARTY OVERDRIVE (6s)`,
        x: player.x,
        z: player.z,
        style: 'combo'
      });
    } else if (cmd === 'regroup') {
      let idx = 0;
      for (const p of Object.values(this.players)) {
        if (p.isDead) continue;
        ComboEngine.applyStatus(p, 'shielded', 6.0, 1, player.id);
        if (p.isBot) {
          const angle = (idx * Math.PI * 0.65);
          p.x = player.x + Math.cos(angle) * 2.2;
          p.z = player.z + Math.sin(angle) * 2.2;
          p.isDowned = false;
          Health.healPlayer(this, p.id, Math.round(p.maxHp * 0.25), 'Regroup');
          idx++;
        }
      }
      this.broadcast({
        type: 'ground_fx',
        fxType: 'frost_nova',
        x: player.x,
        z: player.z,
        radius: 4.5
      });
      this.broadcast({
        type: 'floating_text',
        text: `🛡️ PARTY REGROUPED! PHALANX SHIELD (+6s)`,
        x: player.x,
        z: player.z,
        style: 'combo'
      });
    } else if (cmd === 'loot') {
      let collectedCount = 0;
      for (const loot of this.floorLoot) {
        if (loot.pickedUp || loot.type === 'epic_chest') continue;
        if (Math.hypot(loot.x - player.x, loot.z - player.z) <= 24.0) {
          loot.x = player.x;
          loot.z = player.z;
          collectedCount++;
        }
      }
      this.updateFloorLoot();
      this.broadcast({
        type: 'floating_text',
        text: collectedCount > 0 ? `🧲 VACUUM LOOT! (${collectedCount} ITEMS)` : `🧲 AREA SCANNED — NO LOOT NEARBY`,
        x: player.x,
        z: player.z,
        style: 'combo'
      });
    } else if (cmd === 'heal') {
      if ((player.cooldowns.tacticalHeal || 0) > 0) {
        this.broadcast({
          type: 'floating_text',
          text: `⏳ HEAL CD (${player.cooldowns.tacticalHeal.toFixed(1)}s)`,
          x: player.x,
          z: player.z,
          style: 'heal'
        });
        return;
      }
      player.cooldowns.tacticalHeal = 8.0;
      for (const ally of Object.values(this.players)) {
        if (ally.isDead) continue;
        ally.isDowned = false;
        const rawTactical = Math.round(ally.maxHp * 0.45);
        const healAmt = this.systems?.oaths?.onHeal(this, player, ally, rawTactical) ?? rawTactical;
        const healed = Health.healPlayer(this, ally.id, healAmt, 'Tactical Heal');
        player.stats.healingDone += healed;
      }
      this.groundEffects.push({
        id: `eff_${this.nextEntityId++}`,
        type: 'sanctuary',
        x: player.x,
        z: player.z,
        radius: 5.5,
        duration: 5.0,
        healPerSec: 35,
        sourcePlayerId: player.id
      });
      this.broadcast({
        type: 'floating_text',
        text: `✨ COVENANT RENEWAL! +45% PARTY HP`,
        x: player.x,
        z: player.z,
        style: 'heal'
      });
    } else if (cmd === 'bone_spikes') {
      this.castLineImpale(player, 11.0, 75);
    } else if (cmd === 'soul_drain') {
      const drainTarget = this.findNearestFoe(player.x, player.z, 12.0);
      if (drainTarget) {
        this.dealDirectDamage(player, drainTarget, 85, 'dark');
        Health.healPlayer(this, player.id, 65, 'Soul Drain');
        this.broadcast({
          type: 'beam_fx',
          beamType: 'soul_drain',
          sourceX: player.x,
          sourceZ: player.z,
          targetX: drainTarget.x,
          targetZ: drainTarget.z,
          color: 0x22ff88
        });
      }
    } else if (cmd === 'corpse_explosion') {
      const prevClass = player.classKey;
      player.classKey = 'necromancer';
      this.executeSkill3(player, targetPos);
      player.classKey = prevClass;
    }
  }

  handlePlayerAction(player, action, targetPos) {
    // Phase 2: respawn requests route to Health.requestRespawn even while
    // downed/dead (before the early-return below).
    if (action === 'respawn') {
      Health.requestRespawn(this, player.id);
      return;
    }
    if (player.isDowned || player.isDead) return;

    // Support tactical commands passed via action
    if (['regroup', 'loot', 'heal', 'attack_command', 'bone_spikes', 'soul_drain', 'corpse_explosion'].includes(action)) {
      this.executeTacticalCommand(player.id, action, targetPos);
      return;
    }

    // Direct aim at targetPos if supplied, or auto-aim toward nearest foe within 14m
    if (targetPos && typeof targetPos.x === 'number' && typeof targetPos.z === 'number') {
      const dx = targetPos.x - player.x;
      const dz = targetPos.z - player.z;
      if (Math.hypot(dx, dz) > 0.2) {
        player.rotation = Math.atan2(dx, dz);
      }
    } else {
      const autoFoe = this.findNearestFoe(player.x, player.z, 14.0);
      if (autoFoe) {
        player.rotation = Math.atan2(autoFoe.x - player.x, autoFoe.z - player.z);
        targetPos = { x: autoFoe.x, z: autoFoe.z };
      }
    }

    const haste = player.cooldownHaste || 1.0;

    // TACTICAL JUMP / LEDGE VAULT (Spacebar / Gamepad A / HUD Jump)
    if (action === 'jump' && (player.cooldowns.jump || 0) <= 0 && (player.y || 0) <= 0.1) {
      player.cooldowns.jump = 0.65;
      player.vy = 10.4; // Smooth parabolic jump up to ~2.5m height
      player.y = 0.28;
      player.invulnerableTimer = Math.max(player.invulnerableTimer || 0, 0.38);

      // Vault forward over any low ledge in the movement/facing direction
      let jx = player.vx;
      let jz = player.vz;
      if (Math.hypot(jx, jz) < 0.05) {
        jx = Math.sin(player.rotation);
        jz = Math.cos(player.rotation);
      }
      for (let step = 0; step < 4; step++) {
        const next = CollisionEngine.moveAndSlide(player.x, player.z, jx, jz, 1.0, 0.75, 0.5, true);
        player.x = next.x;
        player.z = next.z;
      }

      // Magnetically pull any loot within 18m across ledges toward the jumping player!
      for (const loot of this.floorLoot) {
        if (loot.pickedUp || loot.type === 'epic_chest') continue;
        if (Math.hypot(loot.x - player.x, loot.z - player.z) <= 18.0) {
          loot.x = player.x + (loot.x - player.x) * 0.2;
          loot.z = player.z + (loot.z - player.z) * 0.2;
        }
      }

      return;
    }

    // TACTICAL DASH / DODGE-ROLL (With Invulnerability i-frames & Ledge Vault!)
    if (action === 'dash' && (player.cooldowns.dash || 0) <= 0) {
      player.cooldowns.dash = +(3.0 / haste).toFixed(2);
      player.invulnerableTimer = 0.45; // 450ms of damage immunity!

      const startX = player.x;
      const startZ = player.z;
      let dx = player.vx;
      let dz = player.vz;
      if (Math.hypot(dx, dz) < 0.05) {
        dx = Math.sin(player.rotation);
        dz = Math.cos(player.rotation);
      }

      for (let step = 0; step < 6; step++) {
        const next = CollisionEngine.moveAndSlide(player.x, player.z, dx, dz, 1.0, 0.85, 0.5, true);
        player.x = next.x;
        player.z = next.z;
      }

      this.broadcast({
        type: 'dash_fx',
        playerId: player.id,
        startX,
        startZ,
        endX: player.x,
        endZ: player.z
      });
      // Phase 2: Iron Vigil breaks on retreat (dash with a foe within 6m).
      this.systems?.oaths?.onDash(this, player);
      return;
    }

    const isEchoAnomaly = this.proceduralConfig?.anomaly?.id === 'dimensional_echoes';

    // BASIC ATTACK
    if (action === 'attack' && player.cooldowns.attack <= 0) {
      player.cooldowns.attack = +(0.52 / haste).toFixed(2);
      this.executeBasicAttack(player, targetPos);
    }

    // SKILL 1 (Also fires Bone Spikes impale wave for visceral 3D feedback!)
    else if (action === 'skill1' && player.cooldowns.skill1 <= 0) {
      this.executeSkill1(player, targetPos);
      if (player.classKey !== 'necromancer') {
        this.castLineImpale(player, 9.5, 45);
      }
      player.cooldowns.skill1 = +(player.cooldowns.skill1 / haste).toFixed(2);
      if (isEchoAnomaly && Math.random() < 0.35) {
        setTimeout(() => {
          if (!player.isDead) {
            this.castLineImpale(player, 10.5, 55);
            this.broadcast({ type: 'floating_text', text: '👥 DIMENSIONAL ECHO!', x: player.x, z: player.z, style: 'combo' });
          }
        }, 420);
      }
    }

    // SKILL 2 (Also fires Soul Drain tether if an enemy is in range!)
    else if (action === 'skill2' && player.cooldowns.skill2 <= 0) {
      this.executeSkill2(player, targetPos);
      if (player.classKey !== 'necromancer') {
        const drainFoe = this.findNearestFoe(player.x, player.z, 11.0);
        if (drainFoe) {
          this.dealDirectDamage(player, drainFoe, 55, 'dark');
          Health.healPlayer(this, player.id, 45, 'Soul Drain');
          this.broadcast({
            type: 'beam_fx',
            beamType: 'soul_drain',
            sourceX: player.x,
            sourceZ: player.z,
            targetX: drainFoe.x,
            targetZ: drainFoe.z,
            color: 0x22ff88
          });
        }
      }
      player.cooldowns.skill2 = +(player.cooldowns.skill2 / haste).toFixed(2);
    }

    // SKILL 3 (Also triggers Corpse / Necrotic Pyre Explosion shockwave!)
    else if (action === 'skill3' && player.cooldowns.skill3 <= 0) {
      this.executeSkill3(player, targetPos);
      if (player.classKey !== 'necromancer') {
        const bx = targetPos ? targetPos.x : player.x + Math.sin(player.rotation) * 5;
        const bz = targetPos ? targetPos.z : player.z + Math.cos(player.rotation) * 5;
        this.dealAreaDamage(player, bx, bz, 4.5, 85, 'toxic');
        this.broadcast({
          type: 'ground_fx',
          fxType: 'corpse_explosion',
          x: bx,
          z: bz,
          radius: 4.5,
          usedCorpse: true
        });
      }
      player.cooldowns.skill3 = +(player.cooldowns.skill3 / haste).toFixed(2);
    }
  }

  executeBasicAttack(player, targetPos) {
    // Projectile or melee hit
    let forwardX = Math.sin(player.rotation);
    let forwardZ = Math.cos(player.rotation);

    if (targetPos && typeof targetPos.x === 'number' && typeof targetPos.z === 'number') {
      const dx = targetPos.x - player.x;
      const dz = targetPos.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.2) {
        forwardX = dx / dist;
        forwardZ = dz / dist;
        player.rotation = Math.atan2(dx, dz);
      }
    }

    if (player.classKey === 'ranger' || player.classKey === 'mage' || player.classKey === 'cleric' || player.classKey === 'necromancer') {
      // Spawn projectile
      this.projectiles.push({
        id: `proj_${this.nextEntityId++}`,
        sourcePlayerId: player.id,
        x: player.x,
        y: 1.0,
        z: player.z,
        vx: forwardX * 18,
        vz: forwardZ * 18,
        damage: player.classKey === 'mage' ? 36 : (player.classKey === 'ranger' ? 32 : 28),
        damageType: player.classKey === 'mage' ? 'fire' : (player.classKey === 'cleric' ? 'radiant' : (player.classKey === 'necromancer' ? 'dark' : 'projectile')),
        radius: 0.6,
        life: 1.5,
        color: CLASS_CONFIGS[player.classKey].color
      });
    } else {
      // Melee Swing
      const hitRadius = 2.4;
      const hitX = player.x + forwardX * 1.5;
      const hitZ = player.z + forwardZ * 1.5;
      this.dealAreaDamage(player, hitX, hitZ, hitRadius, 45, 'physical');
    }

    this.broadcast({
      type: 'player_attack_fx',
      playerId: player.id,
      action: 'attack',
      targetX: targetPos ? targetPos.x : player.x + forwardX * 10,
      targetZ: targetPos ? targetPos.z : player.z + forwardZ * 10
    });
  }

  executeSkill1(player, targetPos) {
    // Skill 1 per class
    switch (player.classKey) {
      case 'juggernaut': // Shield Slam (Stun + Heavy Blunt)
        player.cooldowns.skill1 = 4.0;
        const slamX = player.x + Math.sin(player.rotation) * 2.0;
        const slamZ = player.z + Math.cos(player.rotation) * 2.0;
        this.dealAreaDamage(player, slamX, slamZ, 2.5, 75, 'shatter', { stun: 1.5 });
        this.broadcast({ type: 'screen_shake', magnitude: 0.35, duration: 0.2 });
        break;

      case 'cleric': // Luminary Lance (Piercing Radiant Beam)
        player.cooldowns.skill1 = 4.5;
        this.castBeam(player, 14.0, 1.6, 65, 'radiant', 50); // heals allies 50, damages foes 65
        break;

      case 'rogue': // Shadowstep (Blink behind nearest foe + bleed)
        player.cooldowns.skill1 = 5.0;
        const foe = this.findNearestFoe(player.x, player.z, 10.0);
        if (foe) {
          player.x = foe.x - Math.sin(foe.rotation || 0) * 1.5;
          player.z = foe.z - Math.cos(foe.rotation || 0) * 1.5;
          this.dealDirectDamage(player, foe, 90, 'physical');
          ComboEngine.applyStatus(foe, 'bleeding', 6, 2, player.id);
        }
        break;

      case 'mage': // Frost Nova (Freeze nearby enemies solid)
        player.cooldowns.skill1 = 6.0;
        this.applyAreaStatus(player, player.x, player.z, 5.5, 'frozen', 3.5);
        this.dealAreaDamage(player, player.x, player.z, 5.5, 40, 'frost');
        this.broadcast({
          type: 'ground_fx',
          fxType: 'frost_nova',
          x: player.x,
          z: player.z,
          radius: 5.5
        });
        break;

      case 'ranger': // Rapid Volley (Fan of 7 arrows)
        player.cooldowns.skill1 = 5.0;
        for (let i = -3; i <= 3; i++) {
          const angle = player.rotation + (i * 0.12);
          this.projectiles.push({
            id: `proj_${this.nextEntityId++}`,
            sourcePlayerId: player.id,
            x: player.x,
            y: 1.0,
            z: player.z,
            vx: Math.sin(angle) * 22,
            vz: Math.cos(angle) * 22,
            damage: 24,
            damageType: 'projectile',
            radius: 0.5,
            life: 1.2,
            color: 0x88ee44
          });
        }
        break;

      case 'necromancer': // Bone Spikes (Linear line impale + bleed)
        player.cooldowns.skill1 = 4.5;
        this.castLineImpale(player, 10.0, 60);
        break;
    }

    this.broadcast({ type: 'player_skill_used', playerId: player.id, skillNum: 1 });
  }

  executeSkill2(player, targetPos) {
    switch (player.classKey) {
      case 'juggernaut': // Iron Bastion (Taunt + Group Armor Shield)
        player.cooldowns.skill2 = 8.0;
        player.hasTaunted = true;
        setTimeout(() => { player.hasTaunted = false; }, 5000);
        for (const p of Object.values(this.players)) {
          if (Math.hypot(p.x - player.x, p.z - player.z) < 10) {
            ComboEngine.applyStatus(p, 'shielded', 6, 1, player.id);
          }
        }
        this.broadcast({ type: 'narrator_announcement', text: `${player.name} raises the Iron Bastion! Aggro drawn!`, tone: 'info' });
        break;

      case 'cleric': // Sanctuary Ward (AoE Healing Circle)
        player.cooldowns.skill2 = 9.0;
        this.groundEffects.push({
          id: `eff_${this.nextEntityId++}`,
          type: 'sanctuary',
          x: player.x,
          z: player.z,
          radius: 5.0,
          duration: 6.0,
          healPerSec: 35,
          sourcePlayerId: player.id
        });
        break;

      case 'rogue': // Tar Bomb (Flings flammable oil slick that slows)
        player.cooldowns.skill2 = 7.0;
        const tarX = targetPos ? targetPos.x : player.x + Math.sin(player.rotation) * 6;
        const tarZ = targetPos ? targetPos.z : player.z + Math.cos(player.rotation) * 6;
        this.groundEffects.push({
          id: `eff_${this.nextEntityId++}`,
          type: 'tar_slick',
          x: tarX,
          z: tarZ,
          radius: 4.5,
          duration: 10.0,
          sourcePlayerId: player.id
        });
        this.applyAreaStatus(player, tarX, tarZ, 4.5, 'tar', 10.0);
        break;

      case 'mage': // Fireball (Ignites tar into Conflagration)
        player.cooldowns.skill2 = 4.0;
        const fbTargetX = targetPos ? targetPos.x : player.x + Math.sin(player.rotation) * 12;
        const fbTargetZ = targetPos ? targetPos.z : player.z + Math.cos(player.rotation) * 12;
        const dirX = fbTargetX - player.x;
        const dirZ = fbTargetZ - player.z;
        const d = Math.hypot(dirX, dirZ) || 1;
        this.projectiles.push({
          id: `proj_${this.nextEntityId++}`,
          sourcePlayerId: player.id,
          x: player.x,
          y: 1.0,
          z: player.z,
          vx: (dirX / d) * 16,
          vz: (dirZ / d) * 16,
          damage: 85,
          damageType: 'fire',
          radius: 1.2,
          life: 2.0,
          isExplosive: true,
          explosionRadius: 4.0,
          color: 0xff4400
        });
        break;

      case 'ranger': // Pinning Trap (Roots & shreds armor)
        player.cooldowns.skill2 = 6.0;
        this.groundEffects.push({
          id: `eff_${this.nextEntityId++}`,
          type: 'trap',
          x: player.x,
          z: player.z,
          radius: 2.5,
          duration: 15.0,
          sourcePlayerId: player.id
        });
        break;

      case 'necromancer': // Soul Drain (Life siphon redistributed)
        player.cooldowns.skill2 = 5.0;
        const drainTarget = targetPos
          ? this.findNearestFoe(targetPos.x, targetPos.z, 6.0) || this.findNearestFoe(player.x, player.z, 10.0)
          : this.findNearestFoe(player.x, player.z, 10.0);
        if (drainTarget) {
          const res = drainTarget.takeDamage(75, 'dark', player);
          this._resolveMobLethal(drainTarget, player);
          Health.healPlayer(this, player.id, 60, 'Soul Drain');
          for (const ally of Object.values(this.players)) {
            if (!ally.isDowned && !ally.isDead) {
              const rawShare = 30;
              const shareAmt = this.systems?.oaths?.onHeal(this, player, ally, rawShare) ?? rawShare;
              Health.healPlayer(this, ally.id, shareAmt, 'Soul Drain Share');
            }
          }
          this.broadcast({
            type: 'beam_fx',
            beamType: 'soul_drain',
            sourceX: player.x,
            sourceZ: player.z,
            targetX: drainTarget.x,
            targetZ: drainTarget.z,
            color: 0x22ff88
          });
        }
        break;
    }

    this.broadcast({ type: 'player_skill_used', playerId: player.id, skillNum: 2 });
  }

  executeSkill3(player, targetPos) {
    switch (player.classKey) {
      case 'juggernaut': // Seismic Vortex (Pulls all nearby enemies into cluster)
        player.cooldowns.skill3 = 12.0;
        const vortexX = player.x + Math.sin(player.rotation) * 4.0;
        const vortexZ = player.z + Math.cos(player.rotation) * 4.0;
        this.pullEnemiesToPoint(vortexX, vortexZ, 8.0);
        this.dealAreaDamage(player, vortexX, vortexZ, 4.0, 90, 'physical');
        this.broadcast({
          type: 'ground_fx',
          fxType: 'seismic_vortex',
          x: vortexX,
          z: vortexZ,
          radius: 6.0
        });
        break;

      case 'cleric': // Judgement Brand (Marks enemy - all attacks trigger holy splash)
        player.cooldowns.skill3 = 10.0;
        const brandTarget = this.boss && Math.hypot(this.boss.x - player.x, this.boss.z - player.z) < 12 ? this.boss : this.findNearestFoe(player.x, player.z, 10.0);
        if (brandTarget) {
          ComboEngine.applyStatus(brandTarget, 'branded', 10.0, 1, player.id);
          this.broadcast({
            type: 'narrator_announcement',
            text: `${brandTarget.name} has been BRANDED with holy judgement! Focus attacks!`,
            tone: 'info'
          });
        }
        break;

      case 'rogue': // Eviscerate (Massive execute on CC or burning foes)
        player.cooldowns.skill3 = 8.0;
        const eviscTarget = this.findNearestFoe(player.x, player.z, 3.0);
        if (eviscTarget) {
          const res = eviscTarget.takeDamage(120, 'execute', player);
          this._resolveMobLethal(eviscTarget, player);
          if (res.combo && res.combo.comboTriggered) {
            this.combosTriggeredCount++;
            this.broadcast({
              type: 'narrator_announcement',
              text: res.combo.announcement || 'CRITICAL EXECUTION!',
              tone: 'combo'
            });
          }
        }
        break;

      case 'mage': // Chaos Meteor (Massive delayed aerial strike with knockback)
        player.cooldowns.skill3 = 12.0;
        const metX = targetPos ? targetPos.x : (this.boss ? this.boss.x : player.x);
        const metZ = targetPos ? targetPos.z : (this.boss ? this.boss.z : player.z - 8);
        this.broadcast({
          type: 'telegraph_start',
          telegraph: {
            id: `meteor_${Date.now()}`,
            shape: 'circle',
            x: metX,
            z: metZ,
            radius: 5.5,
            duration: 2.2,
            color: 0xee5500
          }
        });
        setTimeout(() => {
          this.dealAreaDamage(player, metX, metZ, 5.5, 220, 'fire');
          this.broadcast({ type: 'screen_shake', magnitude: 0.8, duration: 0.5 });
        }, 2200);
        break;

      case 'ranger': // Smoke Veil (Stealth & 100% evasion for safe revives)
        player.cooldowns.skill3 = 14.0;
        this.groundEffects.push({
          id: `eff_${this.nextEntityId++}`,
          type: 'smoke_veil',
          x: player.x,
          z: player.z,
          radius: 5.0,
          duration: 7.0,
          sourcePlayerId: player.id
        });
        break;

      case 'necromancer': // Corpse Explosion (Detonates fallen mobs or explodes necrotic bone trap)
        player.cooldowns.skill3 = 4.5;
        let detonateX = player.x + Math.sin(player.rotation) * 4.5;
        let detonateZ = player.z + Math.cos(player.rotation) * 4.5;
        let usedCorpse = false;

        if (this.corpses.length > 0) {
          let bestIdx = 0;
          let bestDist = Infinity;
          const refX = targetPos ? targetPos.x : player.x;
          const refZ = targetPos ? targetPos.z : player.z;
          for (let i = 0; i < this.corpses.length; i++) {
            const c = this.corpses[i];
            const d = Math.hypot(c.x - refX, c.z - refZ);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          if (bestDist < 12.0) {
            const c = this.corpses.splice(bestIdx, 1)[0];
            detonateX = c.x;
            detonateZ = c.z;
            usedCorpse = true;
          }
        } else if (targetPos && typeof targetPos.x === 'number') {
          detonateX = targetPos.x;
          detonateZ = targetPos.z;
        }

        const blastDmg = usedCorpse ? 180 : 110;
        const blastRadius = usedCorpse ? 5.5 : 4.2;
        this.dealAreaDamage(player, detonateX, detonateZ, blastRadius, blastDmg, 'toxic');
        this.applyAreaStatus(player, detonateX, detonateZ, blastRadius, 'poisoned', 6.0);
        this.broadcast({
          type: 'ground_fx',
          fxType: 'corpse_explosion',
          x: detonateX,
          z: detonateZ,
          radius: blastRadius,
          usedCorpse
        });
        this.broadcast({ type: 'screen_shake', magnitude: 0.55, duration: 0.3 });
        break;
    }

    this.broadcast({ type: 'player_skill_used', playerId: player.id, skillNum: 3 });
  }

  // Trigger War Horn (Matrix Slow-Mo)
  useWarHorn(playerId) {
    if (!this.warHornAvailable) return;
    this.warHornAvailable = false;
    this.warHornActive = true;
    this.warHornTimeRemaining = 10.0;
    this.timeScale = 0.15; // Slow down time!

    const user = this.players[playerId];
    this.broadcast({
      type: 'war_horn_triggered',
      triggeredBy: user ? user.name : 'The Party',
      duration: 10.0
    });
    this.broadcast({
      type: 'narrator_announcement',
      text: 'THE WAR HORN SOUNDS! Time bends as the covenant coordinates their strike!',
      tone: 'hype'
    });
  }

  // Authoritative Tick Update (20 Hz)
  update(dt) {
    if (this.state !== 'dungeon') return;

    // Apply War Horn time scale
    if (this.warHornActive) {
      this.warHornTimeRemaining -= dt;
      if (this.warHornTimeRemaining <= 0) {
        this.warHornActive = false;
        this.timeScale = 1.0;
        this.broadcast({ type: 'war_horn_ended' });
      }
    }

    const simDt = dt * this.timeScale;

    // 1. Update Players
    this.updatePlayers(simDt);

    // 1b. Phase 2 system ticks (health downed timers live in Health.tick now).
    Health.tick(this, simDt);
    this.systems?.objectives?.onTick(this, simDt);
    this.systems?.oaths?.onTick(this, simDt);
    this.systems?.oaths?.checkShrineProximity(this);
    this.systems?.livingDungeon?.onRoomTick(this);
    this.systems?.nemesis?.onRoomTick(this);

    // 2. Update AI Companion Bots
    this.updateBots(simDt);

    // 3. Update Projectiles
    this.updateProjectiles(simDt);

    // 4. Update Mobs
    this.updateMobs(simDt);

    // 5. Update Boss — Phase 2 PhaseBoss (workstream 1) via coordinator ctx.
    // bossCtx: { players, broadcast, damagePlayer, spawnAdds, spawnProjectile, nextTelegraphId }.
    if (this.boss && !this.boss.isDead) {
      this.boss.update(simDt, {
        players: this.players,
        broadcast: (msg) => this.broadcast(msg),
        damagePlayer: (p, amt, type, src, attacker = null) =>
          this.damagePlayer(p, amt, type, src, attacker || this.boss),
        spawnAdds: (type, x, z, count) => {
          for (let i = 0; i < count; i++) {
            this.spawnMob(type, x + (i - 1) * 2.5, z + 3);
          }
        },
        spawnProjectile: (opts) => this._pushProjectile(opts),
        nextTelegraphId: () => `btel_${this.nextEntityId++}`
      });
    }

    // 6. Update Ground Effects & Environmental Dungeon Traps
    this.updateGroundEffects(simDt);
    this.updateHazards(simDt);

    // 7. Check Floor Loot Pickup
    this.updateFloorLoot();


    // 9. Check Victory or Defeat
    this.checkEndConditions();
  }

  updateHazards(dt) {
    if (!this.hazards || this.state !== 'dungeon') return;

    for (const h of this.hazards) {
      // Only cycle traps when at least one living hero is within 24m
      const anyNear = Object.values(this.players).some(
        p => !p.isDead && !p.isDowned && Math.hypot(p.x - h.x, p.z - h.z) <= 24.0
      );
      if (!anyNear) continue;

      h.timer += dt;

      // 1.2s before eruption: broadcast ground telegraph warning circle
      if (!h.warningSent && h.timer >= h.cycle - 1.2) {
        h.warningSent = true;
        this.broadcast({
          type: 'telegraph_start',
          telegraph: {
            id: `haz_${h.id}_${Date.now()}`,
            shape: 'circle',
            x: h.x,
            z: h.z,
            radius: h.radius,
            duration: 1.2,
            color: h.type === 'arcane_pylon' ? 0x00e5ff : 0xff4400
          }
        });
      }

      // Eruption impact!
      if (h.timer >= h.cycle) {
        h.timer = 0;
        h.warningSent = false;

        this.broadcast({
          type: 'ground_fx',
          fxType: 'corpse_explosion',
          x: h.x,
          z: h.z,
          radius: h.radius,
          usedCorpse: false
        });

        // Damage any enemy mobs caught in the trap (players can lure mobs into traps!)
        for (const m of this.mobs) {
          if (m.isDead) continue;
          if (Math.hypot(m.x - h.x, m.z - h.z) <= h.radius + 0.8) {
            m.hp = Math.max(0, m.hp - 65);
            this.broadcast({
              type: 'floating_text',
              text: `🔥 TRAP HIT! -65`,
              x: m.x,
              z: m.z,
              style: 'crit'
            });
            if (m.hp <= 0) this.handleEntityDeath(m, null);
          }
        }

        // Check players in hazard radius (Dash i-frames dodge the trap!)
        for (const p of Object.values(this.players)) {
          if (p.isDead || p.isDowned) continue;
          if (Math.hypot(p.x - h.x, p.z - h.z) <= h.radius) {
            if (p.invulnerableTimer > 0) {
              this.broadcast({
                type: 'floating_text',
                text: `⚡ TRAP DODGED!`,
                x: p.x,
                z: p.z,
                style: 'combo'
              });
            } else if (!p.isBot) {
              this.damagePlayer(p, 35, h.name);
            }
          }
        }
      }
    }
  }

  updatePlayers(dt) {
    let aliveCount = 0;
    let downedCount = 0;
    let soleSurvivor = null;

    for (const p of Object.values(this.players)) {
      // Cooldowns & Dash Invulnerability i-frames
      for (const k of Object.keys(p.cooldowns)) {
        p.cooldowns[k] = Math.max(0, p.cooldowns[k] - dt);
      }
      if (p.invulnerableTimer > 0) {
        p.invulnerableTimer = Math.max(0, p.invulnerableTimer - dt);
      }
      if (p.streakTimer > 0) {
        p.streakTimer = Math.max(0, p.streakTimer - dt);
        if (p.streakTimer <= 0) {
          p.streakCount = 0;
          p.overdrive = false;
        }
      }
      ComboEngine.tickStatuses(p, dt);

      if (p.isDead) continue;

      if (p.isDowned) {
        // Phase 2: downed->dead expiry owned by Health.tick (Ashen Martyr
        // halves the timer inside Health).
        downedCount++;
      } else {
        aliveCount++;
        soleSurvivor = p;

        // Vertical Jump Physics & Parabolic Arc
        if ((p.y || 0) > 0 || (p.vy || 0) !== 0) {
          p.y = (p.y || 0) + (p.vy || 0) * dt;
          p.vy = (p.vy || 0) - 22.5 * dt;
          if (p.y <= 0) {
            p.y = 0;
            p.vy = 0;
            // Landing Jump-Slam shockwave damages nearby foes within 3.2m!
            const nearbyFoes = this.mobs.filter(m => !m.isDead && Math.hypot(m.x - p.x, m.z - p.z) <= 3.2);
            if (nearbyFoes.length > 0) {
              for (const foe of nearbyFoes) {
                this.dealDirectDamage(p, foe, 38, 'physical');
              }
              this.broadcast({
                type: 'ground_fx',
                fxType: 'frost_nova',
                x: p.x,
                z: p.z,
                radius: 2.8
              });
            }
          }
        }

        const isAirborne = (p.y || 0) > 0.22;

        // Apply movement velocity with continuous collision sliding & airborne ledge-vaulting
        if (p.vx !== 0 || p.vz !== 0) {
          const moveLen = Math.hypot(p.vx, p.vz);
          if (moveLen > 0) {
            const overdriveBoost = p.overdrive ? 1.22 : 1.0;
            const airBoost = isAirborne ? 1.32 : 1.0;
            // Phase 2: oath speed multipliers (Ashen Martyr ally-boost / Hollow Saint penalty).
            const oathSpeed = this.systems?.oaths?.getSpeedMult(p) ?? 1;
            const speed = p.speed * overdriveBoost * airBoost * (ComboEngine.hasStatus(p, 'tar') && !isAirborne ? 0.4 : 1.0) * oathSpeed;
            const newPos = CollisionEngine.moveAndSlide(p.x, p.z, p.vx, p.vz, speed, dt, 0.6, isAirborne);
            p.x = newPos.x;
            p.z = newPos.z;
            p.rotation = Math.atan2(p.vx, p.vz);
          }
        }

        // Reviving Target Channel
        if (p.revivingTargetId) {
          const target = this.players[p.revivingTargetId];
          if (target && target.isDowned) {
            const dist = Math.hypot(target.x - p.x, target.z - p.z);
            if (dist <= 3.2) {
              p.reviveProgress += dt;
              if (p.reviveProgress >= 3.5) {
                // Successfully revived!
                target.isDowned = false;
                target.hp = Math.round(target.maxHp * 0.45);
                p.revivingTargetId = null;
                p.reviveProgress = 0;
                p.stats.revivesCount++;
                this.broadcast({
                  type: 'narrator_announcement',
                  text: `${p.name} pulled ${target.name} back from the gates of death!`,
                  tone: 'hype'
                });
                this.recordPotgCandidate('clutch_revive', p, `${p.name} pulled off a clutch revive under fire!`);
              }
            } else {
              p.reviveProgress = 0;
            }
          } else {
            p.revivingTargetId = null;
            p.reviveProgress = 0;
          }
        }
      }
    }

    // Check Last Stand condition
    if (aliveCount === 1 && downedCount > 0 && !this.lastStandActive) {
      this.lastStandActive = true;
      this.lastStandHeroId = soleSurvivor.id;
      soleSurvivor.speed *= 1.45;
      this.broadcast({
        type: 'last_stand_activated',
        heroId: soleSurvivor.id,
        heroName: soleSurvivor.name
      });
      this.broadcast({
        type: 'narrator_announcement',
        text: `ALL FALLEN EXCEPT ${soleSurvivor.name.toUpperCase()}! BEHOLD THE LAST STAND!`,
        tone: 'hype'
      });
      this.recordPotgCandidate('last_stand_activation', soleSurvivor, `${soleSurvivor.name} initiated the desperate Last Stand!`);
    } else if (aliveCount > 1 && this.lastStandActive) {
      this.lastStandActive = false;
      const hero = this.players[this.lastStandHeroId];
      if (hero) hero.speed = CLASS_CONFIGS[hero.classKey].speed;
    }
  }

  updateBots(dt) {
    for (const bot of Object.values(this.players)) {
      if (!bot.isBot || bot.isDead || bot.isDowned) continue;

      // Priority 1: Revive nearest downed human player
      const downedHuman = Object.values(this.players).find(p => !p.isBot && p.isDowned);
      if (downedHuman) {
        const dx = downedHuman.x - bot.x;
        const dz = downedHuman.z - bot.z;
        const d = Math.hypot(dx, dz);
        if (d > 2.2) {
          bot.vx = dx / d;
          bot.vz = dz / d;
          const newPos = CollisionEngine.moveAndSlide(bot.x, bot.z, bot.vx, bot.vz, bot.speed, dt);
          bot.x = newPos.x;
          bot.z = newPos.z;
          bot.rotation = Math.atan2(dx, dz);
        } else {
          bot.vx = 0;
          bot.vz = 0;
          bot.revivingTargetId = downedHuman.id;
        }
        continue;
      }

      // Priority 2: Combat target (Boss only if awake and in room; otherwise nearest living mob within 16m)
      let target = null;
      if (this.boss && this.boss.isAwake && !this.boss.isDead && Math.hypot(this.boss.x - bot.x, this.boss.z - bot.z) <= 18.0) {
        target = this.boss;
      } else {
        target = this.findNearestFoe(bot.x, bot.z, 16.0);
      }

      if (target) {
        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const d = Math.hypot(dx, dz);

        const desiredDist = bot.role === 'Tank' ? 2.0 : (bot.role === 'Healer' ? 6.5 : 5.5);

        if (d > desiredDist + 0.6) {
          bot.vx = dx / d;
          bot.vz = dz / d;
        } else if (d < desiredDist - 0.6) {
          bot.vx = -dx / d;
          bot.vz = -dz / d;
        } else {
          bot.vx = 0;
          bot.vz = 0;
        }

        const newPos = CollisionEngine.moveAndSlide(bot.x, bot.z, bot.vx, bot.vz, bot.speed, dt);
        bot.x = newPos.x;
        bot.z = newPos.z;
        bot.rotation = Math.atan2(dx, dz);

        // Cast abilities towards target
        if (bot.cooldowns.attack <= 0 && d <= bot.attackRange) {
          this.executeBasicAttack(bot, { x: target.x, z: target.z });
        }
        if (bot.cooldowns.skill1 <= 0 && Math.random() < 0.3) {
          this.executeSkill1(bot, { x: target.x, z: target.z });
        }
        if (bot.cooldowns.skill2 <= 0 && Math.random() < 0.2) {
          this.executeSkill2(bot, { x: target.x, z: target.z });
        }
      } else {
        // Priority 3: No nearby enemy - navigate doorways to stay close to human party leader
        const human = Object.values(this.players).find(p => !p.isBot && !p.isDead);
        if (human) {
          const distToHuman = Math.hypot(human.x - bot.x, human.z - bot.z);

          // If companion is very far behind (> 23m), shadow-step through the doorway to stay with the party
          if (distToHuman > 23.0) {
            const angle = Math.random() * Math.PI * 2;
            const snapX = human.x + Math.cos(angle) * 2.5;
            const snapZ = human.z + Math.sin(angle) * 2.5;
            if (CollisionEngine.isWalkable(snapX, snapZ, 0.6)) {
              bot.x = snapX;
              bot.z = snapZ;
            }
          } else if (distToHuman > 4.2) {
            const wp = CollisionEngine.getWaypointToward(bot.x, bot.z, human.x, human.z);
            const dx = wp.x - bot.x;
            const dz = wp.z - bot.z;
            const d = Math.hypot(dx, dz) || 1;
            bot.vx = dx / d;
            bot.vz = dz / d;
            const newPos = CollisionEngine.moveAndSlide(bot.x, bot.z, bot.vx, bot.vz, bot.speed * 0.98, dt);
            bot.x = newPos.x;
            bot.z = newPos.z;
            bot.rotation = Math.atan2(dx, dz);
          } else {
            bot.vx = 0;
            bot.vz = 0;
          }
        }
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.life -= dt;

      // Destroy projectile if it hits a dungeon wall
      if (!CollisionEngine.isPointOnFloor(p.x, p.z)) {
        this.projectiles.splice(i, 1);
        continue;
      }

      let hit = false;

      if (p.isEnemy) {
        // Hostile projectile fired by a mob. Resolve the firing mob as the
        // attacker so oath thorns / nemesis grudge hooks fire.
        const mob = p.sourceId ? this.mobs.find(mm => mm.id === p.sourceId) : null;
        for (const pl of Object.values(this.players)) {
          if (!pl.isDead && !pl.isDowned && Math.hypot(pl.x - p.x, pl.z - p.z) <= (0.85 + p.radius)) {
            this.damagePlayer(pl, p.damage, p.damageType || 'physical', p.sourceName || 'Enemy', mob);
            hit = true;
            break;
          }
        }
      } else {
        const attacker = this.players[p.sourcePlayerId];

        // Check hit against boss
        if (this.boss && !this.boss.isDead) {
          if (Math.hypot(this.boss.x - p.x, this.boss.z - p.z) <= (this.boss.radius + p.radius)) {
            this.applyProjectileHit(attacker, this.boss, p);
            hit = true;
          }
        }

        // Check hit against mobs
        if (!hit) {
          for (const m of this.mobs) {
            if (!m.isDead && Math.hypot(m.x - p.x, m.z - p.z) <= (1.2 + p.radius)) {
              this.applyProjectileHit(attacker, m, p);
              hit = true;
              break;
            }
          }
        }
      }

      if (hit || p.life <= 0) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  applyProjectileHit(attacker, target, proj) {
    if (!target) return;
    // Phase 2: boss soul-seal ward + living dungeon resist on projectile hits.
    let projDmg = proj.damage;
    if (target === this.boss) {
      const seals = this.boss.sealsRemaining ?? 2;
      const wardMult = seals === 2 ? 0.50 : (seals === 1 ? 0.75 : 1.20);
      projDmg = Math.round(projDmg * wardMult * (this.systems?.livingDungeon?.getDamageTakenMult(this.boss, proj.damageType) ?? 1));
    }
    const res = typeof target.takeDamage === 'function'
      ? target.takeDamage(projDmg, proj.damageType, attacker)
      : { damageDealt: projDmg, isDead: false };
    if (attacker && res.damageDealt) {
      attacker.stats.damageDealt += res.damageDealt;
      if (attacker.lifesteal > 0 && !attacker.isDead && attacker.id) {
        Health.healPlayer(this, attacker.id, Math.round(res.damageDealt * attacker.lifesteal), 'Lifesteal');
      }
    }

    if (res.combo && res.combo.comboTriggered) {
      this.combosTriggeredCount++;
      this.broadcast({
        type: 'combo_alert',
        comboName: res.combo.comboName,
        x: target.x,
        z: target.z
      });
      if (res.combo.announcement) {
        this.broadcast({
          type: 'narrator_announcement',
          text: res.combo.announcement,
          tone: 'combo'
        });
      }
    }

    this._resolveMobLethal(target, attacker);

    // Phase 2: objective shrines take real damage from projectile hits.
    this.systems?.objectives?.damageShrinesAt(this, proj.x, proj.z, 1.5, proj.damage, proj.damageType);
  }

  updateMobs(dt) {
    const ctx = this._mobCtx();
    for (const m of this.mobs) {
      if (m.isDead) continue;
      ComboEngine.tickStatuses(m, dt);

      if (ComboEngine.hasStatus(m, 'frozen')) continue;

      // Phase 2: brained mobs run the EnemyBrain state machine. The legacy
      // per-type block below is kept only for brainless mobs.
      if (m._brain) {
        // huntTargetId (Living Dungeon blood-hunt packs, HUNTED players) and
        // grudgeTargetId (Nemesis returns) override brain target selection.
        const huntId = m.huntTargetId || m.grudgeTargetId;
        if (huntId) {
          const hunt = this.players[huntId];
          if (hunt && !hunt.isDead && !hunt.isDowned) {
            m._brain.ai.targetId = huntId;
          }
        }
        m._brain.update(dt, ctx);
        continue;
      }

      // Resolve active mini-boss telegraph if any
      if (m.activeTelegraph) {
        m.activeTelegraph.elapsed += dt;
        if (m.activeTelegraph.elapsed >= m.activeTelegraph.duration) {
          const tel = m.activeTelegraph;
          m.activeTelegraph = null;
          for (const pl of Object.values(this.players)) {
            if (pl.isDowned || pl.isDead) continue;
            const d = Math.hypot(pl.x - tel.x, pl.z - tel.z);
            if (d <= tel.radius) {
              this.damagePlayer(pl, tel.damage, tel.damageType || 'physical', m.name, m);
            }
          }
        }
        continue;
      }

      // Find closest alive player within local room aggro range (17.5m + line-of-sight)
      let target = null;
      let closestDist = 17.5;
      for (const p of Object.values(this.players)) {
        if (p.isDowned || p.isDead) continue;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d < closestDist && CollisionEngine.hasLineOfSight(m.x, m.z, p.x, p.z)) {
          closestDist = d;
          target = p;
        }
      }

      if (!target) continue;

      const dx = target.x - m.x;
      const dz = target.z - m.z;
      const dist = Math.hypot(dx, dz) || 1;
      const isRangedKiter = (m.type === 'bone_archer' || m.type === 'blight_necrolyte' || m.type === 'elite_lich');
      const desiredRange = (m.type === 'bone_archer') ? 9.0 : (m.type === 'blight_necrolyte' ? 8.5 : (m.type === 'elite_lich' ? 10.0 : 1.9));

      // Intelligent Void Assassin: Shadow Blink Ambush behind target every 4.8s
      if (m.type === 'void_assassin') {
        m.specialTimer = (m.specialTimer || 0) - dt;
        if (m.specialTimer <= 0 && dist > 2.5 && dist < 13.0) {
          m.specialTimer = 4.8;
          const behindX = target.x - Math.sin(target.rotation || 0) * 1.4;
          const behindZ = target.z - Math.cos(target.rotation || 0) * 1.4;
          m.x = behindX;
          m.z = behindZ;
          this.broadcast({
            type: 'floating_text',
            text: '🗡️ SHADOW AMBUSH!',
            x: m.x,
            z: m.z,
            style: 'crit'
          });
        }
      }

      // Intelligent Blight Necrolyte: Tactical Kiting away from close melee heroes + Ally Healing Ward
      if (m.type === 'blight_necrolyte') {
        m.specialTimer = (m.specialTimer || 0) - dt;
        if (m.specialTimer <= 0) {
          m.specialTimer = 5.2;
          const woundedAlly = this.mobs.find(ally => !ally.isDead && ally.id !== m.id && ally.hp < ally.maxHp * 0.85 && Math.hypot(ally.x - m.x, ally.z - m.z) <= 12.0);
          if (woundedAlly) {
            woundedAlly.hp = Math.min(woundedAlly.maxHp, woundedAlly.hp + 55);
            this.broadcast({
              type: 'beam_fx',
              sourceX: m.x,
              sourceZ: m.z,
              targetX: woundedAlly.x,
              targetZ: woundedAlly.z,
              color: 0x22ff88
            });
            this.broadcast({
              type: 'floating_text',
              text: '+55 DARK MEND',
              x: woundedAlly.x,
              z: woundedAlly.z,
              style: 'heal'
            });
          }
        }
        if (dist < 4.5) {
          // Kite backwards away from player
          const kitePos = CollisionEngine.moveAndSlide(m.x, m.z, -dx / dist, -dz / dist, m.speed * 0.9, dt, 0.5);
          m.x = kitePos.x;
          m.z = kitePos.z;
        }
      }

      if (dist > desiredRange) {
        const speed = m.speed * (ComboEngine.hasStatus(m, 'tar') ? 0.4 : 1.0);
        const vx = dx / dist;
        const vz = dz / dist;
        const newPos = CollisionEngine.moveAndSlide(m.x, m.z, vx, vz, speed, dt, 0.5);
        m.x = newPos.x;
        m.z = newPos.z;
      } else {
        m.attackTimer -= dt;
        if (m.attackTimer <= 0) {
          if (m.type === 'bone_archer' || m.type === 'blight_necrolyte') {
            m.attackTimer = m.type === 'blight_necrolyte' ? 2.0 : 2.2;
            const dirX = dx / dist;
            const dirZ = dz / dist;
            this.projectiles.push({
              id: `eproj_${this.nextEntityId++}`,
              isEnemy: true,
              sourceName: m.name,
              x: m.x + dirX * 0.8,
              y: 1.1,
              z: m.z + dirZ * 0.8,
              vx: dirX * 11.5,
              vz: dirZ * 11.5,
              radius: 0.38,
              damage: m.damage,
              damageType: m.type === 'blight_necrolyte' ? 'dark' : 'toxic',
              color: m.type === 'blight_necrolyte' ? 0xb845ff : 0x44ff66,
              life: 2.0
            });
          } else if (m.type === 'elite_lich') {
            m.attackTimer = 2.6;
            const baseAngle = Math.atan2(dx, dz);
            // 3-way Arcane Soul-Bolt Volley
            for (const offset of [-0.24, 0, 0.24]) {
              const ang = baseAngle + offset;
              this.projectiles.push({
                id: `eproj_${this.nextEntityId++}`,
                isEnemy: true,
                sourceName: m.name,
                x: m.x + Math.sin(ang) * 0.9,
                y: 1.2,
                z: m.z + Math.cos(ang) * 0.9,
                vx: Math.sin(ang) * 10.5,
                vz: Math.cos(ang) * 10.5,
                radius: 0.42,
                damage: m.damage,
                damageType: 'cold',
                color: 0x00ddff,
                life: 2.2
              });
            }
          } else if (m.type === 'elite_executioner' && Math.random() < 0.45) {
            m.attackTimer = 2.4;
            m.activeTelegraph = {
              elapsed: 0,
              duration: 1.4,
              x: target.x,
              z: target.z,
              radius: 3.8,
              damage: 52,
              damageType: 'physical'
            };
            this.broadcast({
              type: 'telegraph_start',
              telegraph: {
                id: `tel_${Date.now()}_${m.id}`,
                shape: 'circle',
                x: target.x,
                z: target.z,
                radius: 3.8,
                duration: 1.4,
                color: 0xff1133
              }
            });
          } else {
            // Standard melee hit
            m.attackTimer = m.attackCooldown;
            this.damagePlayer(target, m.damage, 'physical', m.name, m);
          }
        }
      }
    }
    // Phase 2: elite aura/ward tick (shielded affix ward reform).
    Elites.tick(dt, ctx);
  }

  // Phase 2: composed damage choke point — Health.damagePlayer owns armor,
  // resists, i-frames, thorns reflection, and downed/death broadcasts.
  // The legacy inline implementation was replaced; Health.tick (called from
  // update()) owns the downed->dead timer now.
  damagePlayer(player, amount, damageType, sourceName, attacker = null) {
    if (!player || player.isDead || player.isDowned) return { dealt: 0, ignored: true };

    // Iron Vigil: -30% damage taken (oath multiplier, rounded once).
    amount = Math.round(amount * (this.systems?.oaths?.getDamageTakenMult(player) ?? 1));
    // Nemesis grudge: +30% vs the nemesis's grudge target.
    if (attacker) amount = this.systems?.nemesis?.modifyDamageToPlayer(attacker, player, amount) ?? amount;

    const res = Health.damagePlayer(this, player.id, amount, {
      type: damageType,
      sourceName,
      attackerId: attacker?.id || null
    });

    if (res && (res.downed || res.killed)) {
      this.systems?.livingDungeon?.recordDeath(this, player);
      this.systems?.oaths?.onPlayerDowned(this, player);
    }

    // Oath thorns (Iron Vigil +15) reflect flat damage onto the attacking mob.
    // Health.damagePlayer already handles player.thorns % reflect; this is the
    // separate oath-granted flat reflect.
    const oathThorns = this.systems?.oaths?.getThorns(player) ?? 0;
    if (oathThorns > 0 && attacker && attacker.hp !== undefined && res && res.dealt > 0 && !attacker.isDead) {
      const tres = typeof attacker.takeDamage === 'function'
        ? attacker.takeDamage(oathThorns, 'physical', player)
        : null;
      if (!tres) attacker.hp = Math.max(0, attacker.hp - oathThorns);
      this.broadcast({
        type: 'floating_text',
        text: `🛡️ OATH THORNS ${oathThorns}`,
        x: attacker.x,
        z: attacker.z,
        style: 'crit'
      });
      if ((tres && tres.isDead) || (!tres && attacker.hp <= 0)) this.handleEntityDeath(attacker, player);
    }
    return res;
  }

  updateGroundEffects(dt) {
    for (let i = this.groundEffects.length - 1; i >= 0; i--) {
      const eff = this.groundEffects[i];
      eff.duration -= dt;

      // Sanctuary healing
      if (eff.type === 'sanctuary') {
        const sanctuarySource = eff.sourcePlayerId ? this.players[eff.sourcePlayerId] : null;
        for (const p of Object.values(this.players)) {
          if (!p.isDowned && !p.isDead && Math.hypot(p.x - eff.x, p.z - eff.z) <= eff.radius) {
            const rawSanct = eff.healPerSec * dt;
            const sanctAmt = this.systems?.oaths?.onHeal(this, sanctuarySource, p, rawSanct) ?? rawSanct;
            Health.healPlayer(this, p.id, sanctAmt, 'Sanctuary');
          }
        }
      }

      if (eff.duration <= 0) {
        this.groundEffects.splice(i, 1);
      }
    }
  }

  // Phase 3: legacy entry point kept for the profile-restore path.
  // Routes through systems/Gear.js so stats are sanitized, validated, and
  // recomputed server-side — client-sent item objects are never trusted.
  // There is intentionally no IAP grant branch: stat items are never sold.
  equipProceduralItem(player, item) {
    if (!player || !item) return;
    Gear.grantAndEquip(this, player, item);
  }

  // Phase 3: thin wrappers for the gear_equip / gear_unequip messages.
  handleGearEquip(playerId, itemId) {
    return Gear.equip(this, playerId, itemId);
  }

  handleGearUnequip(playerId, slot) {
    return Gear.unequip(this, playerId, slot);
  }

  updateFloorLoot() {
    for (const loot of this.floorLoot) {
      if (loot.pickedUp || loot.type === 'epic_chest') continue;

      for (const p of Object.values(this.players)) {
        if (p.isDowned || p.isDead) continue;
        // Only human players trigger shrines, chests, gear drops & relics so the user activates them intentionally
        if (p.isBot && (loot.type === 'shrine_blood' || loot.type === 'shrine_arcane' || loot.type === 'treasure_chest' || loot.type === 'relic_weapon' || loot.type === 'relic_talisman' || loot.type === 'gear_drop')) {
          continue;
        }

        const d = Math.hypot(p.x - loot.x, p.z - loot.z);

        // Automatic Magnetic Loot Vacuum for Gold, Potions, Gear Drops & Relics across ledges!
        const isMagneticItem = (loot.type === 'gold' || loot.type === 'potion_health' || loot.type === 'gear_drop' || loot.type === 'relic_weapon' || loot.type === 'relic_talisman');
        const magnetRadius = (p.y || 0) > 0.2 ? 16.0 : 9.5;
        if (!p.isBot && isMagneticItem && d <= magnetRadius && d > 1.8) {
          loot.x += (p.x - loot.x) * 0.28;
          loot.z += (p.z - loot.z) * 0.28;
        }

        const pickupRadius = (loot.type === 'shrine_blood' || loot.type === 'shrine_arcane') ? 3.2 : 2.85;
        const distAfterMagnet = Math.hypot(p.x - loot.x, p.z - loot.z);
        if (distAfterMagnet <= pickupRadius) {
          let consumed = true;
          if (loot.type === 'gold') {
            // Phase 2: Silent Coin doubles gold (modifyGoldPickup).
            const goldAmt = this.systems?.oaths?.modifyGoldPickup(p, loot.value) ?? loot.value;
            p.stats.goldCollected += goldAmt;
            this.broadcast({
              type: 'loot_collected',
              playerId: p.id,
              playerName: p.name,
              lootType: 'gold',
              value: goldAmt,
              lootId: loot.id
            });
          } else if (loot.type === 'objective_relic') {
            // Phase 2: objective relics go to the Objectives coordinator.
            this.systems?.objectives?.onRelicPickup(this, p.id, loot);
          } else if (loot.type === 'potion_health') {
            Health.healPlayer(this, p.id, Math.round(p.maxHp * 0.5), 'Elixir');
            this.broadcast({
              type: 'loot_collected',
              playerId: p.id,
              playerName: p.name,
              lootType: 'potion_health',
              lootId: loot.id
            });
            this.broadcast({ type: 'floating_text', text: '+50% HP ELIXIR', x: p.x, z: p.z, style: 'heal' });
          } else if (loot.type === 'gear_drop') {
            // Phase 3: gear goes to INVENTORY, not straight into stats.
            // Pickup is server-decided; equip happens via explicit request.
            const item = loot.itemData || LootGenerator.generateItem(this.floor, 'mob');
            const pickup = Gear.addToInventory(this, p, item, 'drop');
            if (pickup.ok) {
              this.broadcast({
                type: 'floating_text',
                text: `📦 [${String(pickup.item.rarityName).toUpperCase()}] ${pickup.item.name} → INVENTORY (press I)`,
                x: p.x,
                z: p.z,
                style: 'combo'
              });
            } else {
              consumed = false; // inventory full — leave it on the ground
              this.broadcast({
                type: 'floating_text',
                text: `⚠️ ${pickup.reason}`,
                x: p.x,
                z: p.z,
                style: 'crit'
              });
            }
          } else if (loot.type === 'treasure_chest') {
            p.stats.goldCollected += loot.value;
            this.totalGoldDropped += loot.value;
            Health.healPlayer(this, p.id, Math.round(p.maxHp * 0.35), 'Treasure Chest');
            const chestBiome = (this.proceduralConfig && this.proceduralConfig.biome && this.proceduralConfig.biome.id) || 'ossuary_crypt';
            const chestItem = LootGenerator.generateItem(this.floor, 'chest', chestBiome);
            const chestPickup = Gear.addToInventory(this, p, chestItem, 'chest');
            if (!chestPickup.ok) {
              // Inventory full: drop the chest item on the ground instead of losing it.
              this.spawnFloorLoot('gear_drop', loot.x, loot.z, chestItem.gearScore, chestItem.name, false, chestItem);
            }
            this.spawnFloorLoot('gold', loot.x - 1.2, loot.z + 0.8, 35);
            this.spawnFloorLoot('gold', loot.x + 1.2, loot.z + 0.8, 35);
            this.broadcast({
              type: 'floating_text',
              text: `CHEST OPENED! +${loot.value} GOLD & ${chestItem.rarityName.toUpperCase()} GEAR!`,
              x: loot.x,
              z: loot.z,
              style: 'combo'
            });
            this.broadcast({
              type: 'narrator_announcement',
              text: `${p.name} unlocked the ${loot.name} (+${loot.value} Gold & ${chestItem.name})!`,
              tone: 'loot'
            });
          } else if (loot.type === 'relic_weapon') {
            for (const ally of Object.values(this.players)) {
              ally.damageBuff = +(ally.damageBuff + 0.35).toFixed(2);
              ally.lifesteal = +(ally.lifesteal + 0.15).toFixed(2);
              ally.equipment.relics.push("Vorgath's Crimson Greataxe (+35% DMG, 15% Lifesteal)");
            }
            this.broadcast({
              type: 'combo_alert',
              comboName: "RELIC EQUIPPED: VORGATH'S GREATAXE!",
              x: loot.x,
              z: loot.z
            });
          } else if (loot.type === 'relic_talisman') {
            for (const ally of Object.values(this.players)) {
              ally.cooldownHaste = +(ally.cooldownHaste + 0.30).toFixed(2);
              Health.setMaxHp(this, ally.id, ally.maxHp + 250);
              ally.equipment.relics.push("Malthor's Astral Phylactery (+30% Haste, +250 HP)");
            }
            this.broadcast({
              type: 'combo_alert',
              comboName: "RELIC EQUIPPED: ASTRAL PHYLACTERY!",
              x: loot.x,
              z: loot.z
            });
          } else if (loot.type === 'shrine_blood') {
            for (const ally of Object.values(this.players)) {
              if (!ally.isDead) {
                ally.damageBuff = +(ally.damageBuff + 0.25).toFixed(2);
                Health.healPlayer(this, ally.id, Math.round(ally.maxHp * 0.5), 'Blood Shrine');
              }
            }
            this.broadcast({
              type: 'combo_alert',
              comboName: 'BLOOD FURY (+25% PARTY DMG)',
              x: loot.x,
              z: loot.z
            });
            this.broadcast({
              type: 'narrator_announcement',
              text: `THE SHRINE OF BLOOD FURY AWAKENS! All party members gain +25% Attack Power!`,
              tone: 'hype'
            });
          } else if (loot.type === 'shrine_arcane') {
            this.warHornAvailable = true;
            for (const ally of Object.values(this.players)) {
              if (!ally.isDead) {
                Health.setMaxHp(this, ally.id, Math.round(ally.maxHp * 1.3));
                Health.healPlayer(this, ally.id, Math.round(ally.maxHp * 0.65), 'Astral Aegis');
              }
            }
            this.broadcast({
              type: 'combo_alert',
              comboName: 'ASTRAL AEGIS (+30% MAX HP)',
              x: loot.x,
              z: loot.z
            });
            this.broadcast({
              type: 'narrator_announcement',
              text: `THE SHRINE OF ASTRAL AEGIS RESONATES! Party Max HP +30% and War Horn Recharged!`,
              tone: 'hype'
            });
          }
          loot.pickedUp = consumed;
          break;
        }
      }
    }

    // Clean up collected loot
    this.floorLoot = this.floorLoot.filter(l => !l.pickedUp);
  }

  // Phase 2: legacy per-player XP replaced by Progression.grantPartyXP
  // (level-ups, ability points, broadcasts owned there).
  awardPartyXP(xpAmount) {
    return Progression.grantPartyXP(this, xpAmount, 'kill');
  }

  handleEntityDeath(entity, killer) {
    // Phase 2: bosses set isDead=true inside their own takeDamage, so guard on
    // an explicit handled flag instead of isDead (single execution).
    if (entity.deathHandled) return;
    entity.deathHandled = true;
    entity.isDead = true;

    // Phase 2 FIRST: a slain Nemesis drops its bonus loot before anything else.
    if (entity.isNemesis) {
      this.systems?.nemesis?.onNemesisSlain(this, entity, killer);
    }

    // Register corpse for Necromancer Corpse Explosion
    this.corpses.push({ x: entity.x, z: entity.z, time: Date.now() });

    // Award Party XP & Spawn Loot
    const isElite = (entity.type === 'elite_executioner' || entity.type === 'elite_lich');
    const isBoss = (entity.isBoss || entity.id === 'boss_malakor');
    // Phase 2: XP routed through Progression with kill reason.
    Progression.grantPartyXP(this, isBoss ? 1000 : (isElite ? 250 : 45), isBoss ? 'boss' : (isElite ? 'elite' : 'kill'));

    const goldDrop = isElite ? 150 : Math.floor(15 + Math.random() * 25);
    this.spawnFloorLoot('gold', entity.x, entity.z, goldDrop);

    // Phase 3: server-authoritative gear drop. Drop chance AND rarity roll
    // come from the biome drop table (LootGenerator.BIOME_LOOT); the client
    // never participates in the roll.
    const biomeId = (this.proceduralConfig && this.proceduralConfig.biome && this.proceduralConfig.biome.id) || 'ossuary_crypt';
    const dropTier = isBoss ? 'boss' : (isElite ? 'elite' : 'trash');
    if (LootGenerator.rollDropChance(dropTier, biomeId)) {
      const dropItem = LootGenerator.generateItem(this.floor, isBoss ? 'boss' : (isElite ? 'elite' : 'mob'), biomeId);
      this.spawnFloorLoot('gear_drop', entity.x + 0.8, entity.z + 0.6, dropItem.gearScore, dropItem.name, true, dropItem);
    }

    if (entity.type === 'elite_executioner') {
      this.sanctumSealsRemaining = Math.max(0, (this.sanctumSealsRemaining ?? 2) - 1);
      if (this.boss) this.boss.sealsRemaining = this.sanctumSealsRemaining;
      this.spawnFloorLoot('relic_weapon', entity.x, entity.z, 35, "Vorgath's Crimson Greataxe", false);
      this.broadcast({ type: 'screen_shake', magnitude: 0.65 });
      this.broadcast({
        type: 'combo_alert',
        comboName: `SOUL-SEAL SHATTERED! (${2 - this.sanctumSealsRemaining}/2)`,
        x: entity.x,
        z: entity.z
      });
      this.broadcast({
        type: 'narrator_announcement',
        text: `Vorgath falls! West Sanctum Seal shattered (${2 - this.sanctumSealsRemaining}/2) — Claim his Crimson Greataxe Relic!`,
        tone: 'hype'
      });
    } else if (entity.type === 'elite_lich') {
      this.sanctumSealsRemaining = Math.max(0, (this.sanctumSealsRemaining ?? 2) - 1);
      if (this.boss) this.boss.sealsRemaining = this.sanctumSealsRemaining;
      this.spawnFloorLoot('relic_talisman', entity.x, entity.z, 30, "Malthor's Astral Phylactery", false);
      this.broadcast({ type: 'screen_shake', magnitude: 0.65 });
      this.broadcast({
        type: 'combo_alert',
        comboName: `SOUL-SEAL SHATTERED! (${2 - this.sanctumSealsRemaining}/2)`,
        x: entity.x,
        z: entity.z
      });
      this.broadcast({
        type: 'narrator_announcement',
        text: `Arch-Lich Malthor shatters! East Sanctum Seal broken (${2 - this.sanctumSealsRemaining}/2) — Claim his Astral Phylactery!`,
        tone: 'hype'
      });
    }

    if (killer) {
      killer.stats.kills++;
      killer.streakCount = (killer.streakCount || 0) + 1;
      killer.streakTimer = 8.5;
      if (killer.streakCount >= 4 && !killer.overdrive) {
        killer.overdrive = true;
        this.broadcast({
          type: 'combo_alert',
          comboName: `🔥 SOUL OVERDRIVE! (${killer.name} x${killer.streakCount})`,
          x: killer.x,
          z: killer.z
        });
      } else if (killer.streakCount >= 2) {
        this.broadcast({
          type: 'floating_text',
          text: `⚡ ${killer.streakCount}x KILL STREAK!`,
          x: entity.x,
          z: entity.z,
          style: 'combo'
        });
      }
    }

    // Award Soul Shards (💎 Premium Currency) to all human heroes in the party
    const shardReward = isBoss ? 120 : (isElite ? 35 : 5);
    for (const p of Object.values(this.players)) {
      if (!p.isBot) {
        p.stats.shardsEarned = (p.stats.shardsEarned || 0) + shardReward;
      }
    }
    this.broadcast({
      type: 'shards_earned',
      amount: shardReward,
      reason: isBoss ? 'Malakor Defeated' : (isElite ? 'Wing Warden Slain' : 'Enemy Slain'),
      x: entity.x,
      z: entity.z
    });

    // If it was the boss
    if (entity.isBoss || entity.id === 'boss_malakor') {
      if (killer) killer.stats.killingBlowBoss = true;
      this.triggerBossDefeated(killer);
    }

    // Phase 2 end-of-death hooks: objective kill credit, oath kill tracking,
    // living-dungeon kill memory.
    this.systems?.objectives?.onEnemyKilled(this, entity, killer);
    this.systems?.oaths?.onKill(this, entity, killer);
    this.systems?.livingDungeon?.recordKill(this, entity, killer);
  }

  triggerBossDefeated(killer) {
    // Keep state === 'dungeon' during the loot roll so players can still move & roll timer ticks!
    this.endTime = Date.now();

    // Trigger Slow-Mo Kill Cam
    this.broadcast({
      type: 'slow_mo_kill_cam',
      bossX: this.boss.x,
      bossZ: this.boss.z,
      killerName: killer ? killer.name : 'The Party'
    });

    this.broadcast({
      type: 'narrator_announcement',
      text: `MALAKOR SHATTERS INTO MOLTEN EMBERS! A Legendary Relic Chest materializes!`,
      tone: 'victory'
    });

    // Spawn Epic Chest at boss position (no random jitter so it stands squarely on the monument)
    this.spawnFloorLoot('epic_chest', this.boss.x, this.boss.z, 500, "Malakor's Molten Relic", false);

    // Phase 3: the boss showers REAL gear. Boss tier = 100% drop chance
    // with the biome's rarity bonus; these are server-issued items the
    // party claims by walking over them (inventory -> equip).
    const bossBiome = (this.proceduralConfig && this.proceduralConfig.biome && this.proceduralConfig.biome.id) || 'ossuary_crypt';
    for (let i = 0; i < 3; i++) {
      const bossItem = LootGenerator.generateItem(this.floor, 'boss', bossBiome);
      this.spawnFloorLoot('gear_drop', this.boss.x + (i - 1) * 1.6, this.boss.z + 1.2, bossItem.gearScore, bossItem.name, false, bossItem);
    }

    this.recordPotgCandidate('boss_kill', killer, `${killer ? killer.name : 'Party'} landed the decisive killing blow on Malakor!`);
  }

  generatePostGameSummary() {
    // Check Secret Objectives
    for (const p of Object.values(this.players)) {
      if (!p.secretObjective) continue;
      if (p.secretObjective.id === 'gold_hoarder') {
        p.secretCompleted = p.stats.goldCollected >= (this.totalGoldDropped * 0.45);
      } else if (p.secretObjective.id === 'boss_slayer') {
        p.secretCompleted = p.stats.killingBlowBoss;
      } else if (p.secretObjective.id === 'clutch_savior') {
        p.secretCompleted = p.stats.revivesCount >= 1 || this.lastStandActive;
      } else if (p.secretObjective.id === 'iron_shield') {
        const highestDmgTaken = Math.max(...Object.values(this.players).map(x => x.stats.damageTaken));
        p.secretCompleted = p.stats.damageTaken === highestDmgTaken && !p.isDead;
      } else if (p.secretObjective.id === 'relic_thief') {
        p.secretCompleted = true;
      }
    }

    // Determine Play of the Game
    const potg = this.potgCandidates[0] || {
      heroName: Object.values(this.players)[0]?.name || 'Hero',
      title: 'Dungeon Conqueror',
      description: 'Defeated the Soul-Forge Warden!'
    };

    // Calculate Party Score
    const durationSec = Math.round((this.endTime - this.startTime) / 1000);
    const speedBonus = Math.max(0, 10000 - durationSec * 25);
    const comboScore = this.combosTriggeredCount * 600;
    const secretsScore = Object.values(this.players).filter(p => p.secretCompleted).length * 5000;
    const totalScore = 50000 + speedBonus + comboScore + secretsScore;

    // Phase 3 meta-progression: grant persistent account XP / seals from this
    // run's SERVER-OBSERVED results (kills, objectives, bosses, difficulty,
    // victory). Computed entirely server-side — client totals are never read.
    const metaRewards = MetaProgression.grantRunRewards(this, { victory: true });

    this.broadcast({
      type: 'run_completed',
      summary: {
        score: totalScore,
        clearTimeSec: durationSec,
        combosCount: this.combosTriggeredCount,
        players: Object.values(this.players).map(p => ({
          name: p.name,
          role: p.role,
          classKey: p.classKey,
          damageDealt: p.stats.damageDealt,
          damageTaken: p.stats.damageTaken,
          goldCollected: p.stats.goldCollected,
          revives: p.stats.revivesCount,
          secretObjective: p.secretObjective,
          secretCompleted: p.secretCompleted
        })),
        playOfTheGame: potg
      },
      // Phase 3: per-account progression earned this run (for the victory
      // screen covenant panel). Empty for guests/bots.
      meta: metaRewards
    });
  }

  recordPotgCandidate(type, hero, description) {
    if (!hero) return;
    this.potgCandidates.unshift({
      heroName: hero.name,
      classKey: hero.classKey,
      title: type === 'clutch_revive' ? 'CLUTCH RESURRECTION' : (type === 'last_stand_activation' ? 'LAST STAND SURVIVOR' : 'EXECUTIONER'),
      description
    });
  }

  checkEndConditions() {
    // Check if entire party is dead or downed
    const allDefeated = Object.values(this.players).every(p => p.isDowned || p.isDead);
    if (allDefeated && this.state === 'dungeon') {
      this.state = 'defeat';
      this.broadcast({
        type: 'party_wipe',
        message: 'The dungeon claims your souls... Run Failed.'
      });
      // Phase 3: the fallen still feed the covenant — reduced account XP for
      // the attempt (server-observed only), so defeat is never a total loss.
      const metaRewards = MetaProgression.grantRunRewards(this, { victory: false });
      if (metaRewards.length > 0) {
        this.broadcast({ type: 'meta_rewards', victory: false, rewards: metaRewards });
      }
      this.broadcast({
        type: 'narrator_announcement',
        text: 'The torch flickers out. The dungeon consumes yet another expedition...',
        tone: 'danger'
      });
    }
  }

  // Helpers
  findNearestFoe(x, z, maxDist) {
    let closest = null;
    let minDist = maxDist;

    if (this.boss && this.boss.isAwake && !this.boss.isDead) {
      const d = Math.hypot(this.boss.x - x, this.boss.z - z);
      if (d < minDist && CollisionEngine.hasLineOfSight(x, z, this.boss.x, this.boss.z)) {
        minDist = d;
        closest = this.boss;
      }
    }

    for (const m of this.mobs) {
      if (m.isDead) continue;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < minDist && CollisionEngine.hasLineOfSight(x, z, m.x, m.z)) {
        minDist = d;
        closest = m;
      }
    }

    return closest;
  }

  // Phase 2: resolve a lethal hit on a mob. A Nemesis-arc elite may flee on its
  // first lethal blow (tryLethalEscape returns true = death handling skipped);
  // all other cases run normal death handling.
  _resolveMobLethal(mob, killer) {
    if (!mob || mob.deathHandled || mob.hp > 0) return;
    if (mob.isElite && this.systems?.nemesis?.tryLethalEscape(this, mob, killer)) return;
    this.handleEntityDeath(mob, killer);
  }

  dealAreaDamage(attacker, x, z, radius, damage, damageType, extra = {}) {
    const buffMult = (attacker && attacker.damageBuff) ? attacker.damageBuff : 1.0;
    const critChance = (attacker ? (attacker.critChance || 0.18) + (attacker.overdrive ? 0.25 : 0) : 0);
    const isCrit = Math.random() < critChance;
    const critMult = isCrit ? 1.75 : 1.0;
    const scaledDmg = Math.round(damage * buffMult * critMult);

    // Phase 2: objective shrines take real damage from area blasts.
    this.systems?.objectives?.damageShrinesAt(this, x, z, radius, scaledDmg, damageType);

    // Check Boss
    if (this.boss && !this.boss.isDead) {
      if (Math.hypot(this.boss.x - x, this.boss.z - z) <= radius + this.boss.radius) {
        // Phase 2: soul-seal ward + living dungeon resist on boss damage taken.
        const seals = this.boss.sealsRemaining ?? 2;
        const wardMult = seals === 2 ? 0.50 : (seals === 1 ? 0.75 : 1.20);
        const bossMult = (this.systems?.livingDungeon?.getDamageTakenMult(this.boss, damageType) ?? 1) * wardMult;
        const res = this.boss.takeDamage(Math.round(scaledDmg * bossMult), damageType, attacker);
        if (attacker && res.damageDealt) {
          attacker.stats.damageDealt += res.damageDealt;
          this.systems?.nemesis?.onMobDamaged(this, this.boss, attacker, res.damageDealt);
          this.systems?.livingDungeon?.recordDamage(this, attacker, res.damageDealt, damageType);
          this.systems?.oaths?.recordDamageDealt(this, attacker.id, res.damageDealt);
        }
        if (isCrit && attacker && !attacker.isBot) {
          this.broadcast({ type: 'floating_text', text: `💥 CRIT! -${res.damageDealt}`, x: this.boss.x, z: this.boss.z, style: 'crit' });
        }
        if (res.combo && res.combo.comboTriggered) {
          this.combosTriggeredCount++;
          this.broadcast({ type: 'combo_alert', comboName: res.combo.comboName, x: this.boss.x, z: this.boss.z });
        }
        if (res.isDead) this.handleEntityDeath(this.boss, attacker);
      }
    }

    // Check Mobs
    for (const m of this.mobs) {
      if (m.isDead) continue;
      if (Math.hypot(m.x - x, m.z - z) <= radius + 1.2) {
        const res = m.takeDamage ? m.takeDamage(damage * critMult, damageType, attacker) : { damageDealt: scaledDmg };
        if (!m.takeDamage) m.hp = Math.max(0, m.hp - scaledDmg);
        if (attacker) attacker.stats.damageDealt += (res.damageDealt || scaledDmg);
        if (isCrit && attacker && !attacker.isBot) {
          this.broadcast({ type: 'floating_text', text: `💥 CRIT! -${res.damageDealt || scaledDmg}`, x: m.x, z: m.z, style: 'crit' });
        }
        this._resolveMobLethal(m, attacker);
      }
    }
  }

  dealDirectDamage(attacker, target, damage, damageType) {
    if (!target) return;
    const buffMult = (attacker && attacker.damageBuff) ? attacker.damageBuff : 1.0;
    const critChance = (attacker ? (attacker.critChance || 0.18) + (attacker.overdrive ? 0.25 : 0) : 0);
    const isCrit = Math.random() < critChance;
    const critMult = isCrit ? 1.75 : 1.0;
    const scaledDmg = Math.round(damage * buffMult * critMult);
    // Phase 2: boss soul-seal ward + living dungeon resist on direct boss hits.
    let dealtAmt = scaledDmg;
    if (target === this.boss) {
      const seals = this.boss.sealsRemaining ?? 2;
      const wardMult = seals === 2 ? 0.50 : (seals === 1 ? 0.75 : 1.20);
      dealtAmt = Math.round(scaledDmg * wardMult * (this.systems?.livingDungeon?.getDamageTakenMult(this.boss, damageType) ?? 1));
    }
    const res = target.takeDamage ? target.takeDamage(dealtAmt, damageType, attacker) : { damageDealt: scaledDmg };
    if (!target.takeDamage && target.hp !== undefined) target.hp = Math.max(0, target.hp - scaledDmg);
    if (attacker) attacker.stats.damageDealt += (res.damageDealt || scaledDmg);
    if (isCrit && attacker && !attacker.isBot) {
      this.broadcast({ type: 'floating_text', text: `💥 CRIT! -${res.damageDealt || scaledDmg}`, x: target.x, z: target.z, style: 'crit' });
    }
    this._resolveMobLethal(target, attacker);
    // Phase 2: objective shrines take real damage from direct strikes.
    if (target && typeof target.x === 'number') {
      this.systems?.objectives?.damageShrinesAt(this, target.x, target.z, 1.5, scaledDmg, damageType);
    }
  }

  applyAreaStatus(source, x, z, radius, statusName, duration) {
    if (this.boss && !this.boss.isDead && Math.hypot(this.boss.x - x, this.boss.z - z) <= radius + this.boss.radius) {
      ComboEngine.applyStatus(this.boss, statusName, duration, 1, source.id);
    }
    for (const m of this.mobs) {
      if (!m.isDead && Math.hypot(m.x - x, m.z - z) <= radius + 1.2) {
        ComboEngine.applyStatus(m, statusName, duration, 1, source.id);
      }
    }
  }

  castBeam(player, length, width, damage, damageType, healAlly) {
    const fx = Math.sin(player.rotation);
    const fz = Math.cos(player.rotation);

    // Check hit entities along ray
    for (let step = 1; step <= length; step += 1.5) {
      const rx = player.x + fx * step;
      const rz = player.z + fz * step;

      // Heal allies
      for (const ally of Object.values(this.players)) {
        if (ally.id !== player.id && !ally.isDowned && !ally.isDead) {
          if (Math.hypot(ally.x - rx, ally.z - rz) < width) {
            const healAmt = this.systems?.oaths?.onHeal(this, player, ally, healAlly) ?? healAlly;
            const healed = Health.healPlayer(this, ally.id, healAmt, 'Healing Beam');
            player.stats.healingDone += healed;
          }
        }
      }

      // Damage enemies
      this.dealAreaDamage(player, rx, rz, width, damage, damageType);
    }

    this.broadcast({
      type: 'beam_fx',
      sourceX: player.x,
      sourceZ: player.z,
      targetX: player.x + fx * length,
      targetZ: player.z + fz * length,
      color: 0xffea00
    });
  }

  castLineImpale(player, length, damage) {
    const fx = Math.sin(player.rotation);
    const fz = Math.cos(player.rotation);
    for (let step = 1.5; step <= length; step += 2.0) {
      const rx = player.x + fx * step;
      const rz = player.z + fz * step;
      this.dealAreaDamage(player, rx, rz, 1.8, damage, 'physical');
      this.applyAreaStatus(player, rx, rz, 1.8, 'bleeding', 5.0);
    }
    this.broadcast({
      type: 'ground_fx',
      fxType: 'bone_spikes',
      startX: player.x,
      startZ: player.z,
      dirX: fx,
      dirZ: fz,
      length: length,
      color: 0x33ee88
    });
  }

  pullEnemiesToPoint(x, z, radius) {
    for (const m of this.mobs) {
      if (m.isDead) continue;
      const dist = Math.hypot(m.x - x, m.z - z);
      if (dist <= radius) {
        m.x = x + (Math.random() - 0.5) * 1.5;
        m.z = z + (Math.random() - 0.5) * 1.5;
      }
    }
  }

  // Build snapshot for network broadcast
  getSnapshot() {
    return {
      state: this.state,
      floor: this.floor || 1,
      proceduralConfig: this.proceduralConfig ? {
        floor: this.proceduralConfig.floorNumber || this.floor || 1,
        floorNumber: this.proceduralConfig.floorNumber || this.floor || 1,
        seed: this.proceduralConfig.seed,
        biome: this.proceduralConfig.biome,
        anomaly: this.proceduralConfig.anomaly || this.proceduralConfig.hexAnomaly,
        hexAnomaly: this.proceduralConfig.hexAnomaly || this.proceduralConfig.anomaly,
        bossVariant: this.proceduralConfig.bossVariant,
        props: this.proceduralConfig.props || this.proceduralConfig.glbProps || [],
        glbProps: this.proceduralConfig.props || this.proceduralConfig.glbProps || []
      } : null,
      timeScale: this.timeScale,
      warHornActive: this.warHornActive,
      warHornAvailable: this.warHornAvailable,
      lastStandActive: this.lastStandActive,
      sanctumSealsRemaining: this.sanctumSealsRemaining ?? 2,
      players: Object.values(this.players).map(p => ({
        id: p.id,
        name: p.name,
        title: p.title || 'Soul-Sworn',
        cosmeticAura: p.cosmeticAura || null,
        // Phase 3 cosmetic shop (visual only) — every client renders these.
        skinId: p.equippedSkin || null,
        weaponGlow: p.equippedWeaponGlow || null,
        streakCount: p.streakCount || 0,
        overdrive: Boolean(p.overdrive),
        shardsEarned: p.stats.shardsEarned || 0,
        classKey: p.classKey,
        role: p.role,
        // Phase 2: Health + Progression snapshot fields (respawn timers,
        // ability points, build). Later spreads win on level/xp/nextLevelXp.
        ...Health.snapshotFields(p),
        ...Progression.snapshotFields(p),
        ...Gear.snapshotFields(p),
        gold: p.stats.goldCollected || 0,
        damageBuff: p.damageBuff || 1.0,
        lifesteal: p.lifesteal || 0,
        cooldownHaste: p.cooldownHaste || 1.0,
        equipment: p.equipment || { weapon: 'Covenant Arms', armor: 'Initiate Plate', relics: [] },
        cooldowns: p.cooldowns,
        x: p.x,
        y: p.y,
        z: p.z,
        rotation: p.rotation,
        hp: p.hp,
        maxHp: p.maxHp,
        isDowned: p.isDowned,
        isDead: p.isDead,
        isBot: p.isBot,
        downedTimer: p.downedTimer,
        reviveProgress: p.reviveProgress,
        statuses: p.statuses,
        // Phase 2: oath state for HUD badges.
        oathState: p.oathState || { oaths: [] }
      })),
      boss: this.boss ? this.boss.getState() : null,
      // Phase 2 (enemies/PROTOCOL.md): mob sync payload for client
      // EnemyVisuals.syncElites.
      mobs: this.mobs.filter(m => !m.isDead).map(m => ({
        id: m.id,
        type: m.type,
        role: m.role,
        name: m.name,
        biome: m.biome,
        biomeTint: m.biomeTint,
        model: m.model,
        modelScale: m.modelScale,
        x: m.x,
        y: m.y,
        z: m.z,
        hp: m.hp,
        maxHp: m.maxHp,
        damage: m.damage,
        isElite: !!m.isElite,
        affixes: m.affixes || [],
        auraColor: m.auraColor,
        stealthed: !!m.stealthed,
        statuses: m.statuses
      })),
      // Phase 2: oath shrines + objectives + signature state (SIGNATURE_PROTOCOL §2.7).
      shrines: (this.shrines || []).map(s => ({
        id: s.id,
        type: s.type,
        x: s.x,
        z: s.z,
        hp: s.hp,
        maxHp: s.maxHp,
        offers: s.offers || []
      })),
      objectives: this.systems?.objectives?.getSnapshot?.() || null,
      signature: {
        oaths: this.systems?.oaths?.getPublicState(this) || null,
        livingDungeon: this.systems?.livingDungeon?.getPublicState(this) || null,
        nemesis: this.systems?.nemesis?.getPublicState(this) || null
      },
      projectiles: this.projectiles.map(pr => ({
        id: pr.id,
        x: pr.x,
        y: pr.y,
        z: pr.z,
        radius: pr.radius,
        color: pr.color
      })),
      floorLoot: this.floorLoot.filter(l => !l.pickedUp).map(l => ({
        id: l.id,
        type: l.type,
        name: l.name,
        itemData: l.itemData || null,
        x: l.x,
        y: l.y,
        z: l.z
      })),
      groundEffects: this.groundEffects.map(g => ({
        id: g.id,
        type: g.type,
        x: g.x,
        z: g.z,
        radius: g.radius
      }))
    };
  }

  broadcast(message) {
    if (this._broadcastCallback) {
      this._broadcastCallback(message);
    }
  }

  setBroadcastCallback(cb) {
    this._broadcastCallback = cb;
  }
}

module.exports = Room;
