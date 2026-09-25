// Phase 2 integration smoke: runs Room with all systems wired.
const Room = require('../server/game/Room');

const broadcastLog = [];
const room = new Room('TEST', { broadcast: (m) => broadcastLog.push(m.type) });
room.setBroadcastCallback((m) => broadcastLog.push(m.type));

// Add a player
const p = room.addPlayer('sock1', 'Hero', 'mage', { profile: {} });
console.log('initPlayer fields:', {
  hasAbilityPoints: p.abilityPoints !== undefined,
  nextLevelXp: p.nextLevelXp,
  hasThorns: p.thorns !== undefined
});

// Dungeon start (floor systems)
room.startDungeon();
console.log('floor systems:', {
  objectives: !!room.systems?.objectives,
  oathsShrines: (room.oathShrines || []).length,
  shrines: (room.shrines || []).length,
  hasBoss: !!room.boss,
  bossIsBoss: !!room.boss?.isBoss,
  bossModel: room.boss?.model,
  mobs: room.mobs.length,
  mobHasBrain: room.mobs.every(m => !!m._brain),
  mobFields: room.mobs[0] ? { role: room.mobs[0].role, model: room.mobs[0].model, biomeTint: room.mobs[0].biomeTint } : null
});

// Tick the room (brains + system ticks + boss update)
for (let i = 0; i < 60; i++) room.update(1 / 60);
console.log('after 60 ticks: players alive =', Object.values(room.players).filter(x => !x.isDead).length,
  '| mobs =', room.mobs.length,
  '| boss.hp =', room.boss.hp, '/', room.boss.maxHp);

// Mob damage intake: absorb + hooks
const mob = room.spawnMob('crypt_ghoul', 10, 10);
const before = mob.hp;
const res = mob.takeDamage(100, 'physical', p);
console.log('mob takeDamage:', { dealt: res.damageDealt, hpDelta: before - mob.hp, isDead: res.isDead });

// dealDirectDamage with lethal resolution
const mob2 = room.spawnMob('cinder_thrall', 11, 10);
room.dealDirectDamage(p, mob2, 99999, 'physical');
console.log('lethal direct:', { deathHandled: !!mob2.deathHandled, isDead: mob2.isDead });

// dealAreaDamage path
const mob3 = room.spawnMob('bone_archer', 12, 10);
room.dealAreaDamage(p, 12, 10, 3, 99999, 'fire');
console.log('lethal area:', { deathHandled: !!mob3.deathHandled });

// Elite lethal escape (first lethal blow per run => flee, no death handling)
const elite = room.spawnMob('elite_executioner', 13, 10);
elite.hp = 50;
room.dealDirectDamage(p, elite, 9999, 'physical');
console.log('elite first lethal:', { fled: !!elite.fledNemesis, deathHandled: !!elite.deathHandled, inMobs: room.mobs.includes(elite) });

// Player damage choke: oath mult + downed flow
p.hp = 10;
const dres = room.damagePlayer(p, 50, 'physical', 'Test Mob', mob);
console.log('damagePlayer downed:', { dealt: dres.dealt, downed: dres.downed, isDowned: p.isDowned });
// Health.tick drives downed->dead
for (let i = 0; i < 400; i++) room.update(1 / 60);
console.log('after bleed-out:', { isDead: p.isDead, deathBroadcast: broadcastLog.includes('player_died') });

// grantPartyXP with reason + Silent Coin doubling
const p2 = room.addPlayer('sock2', 'Hero2', 'rogue', { profile: {} });
const results = room.systems.progression.grantPartyXP(room, 45, 'kill');
console.log('grantPartyXP:', results.map(r => ({ lvl: r.level, leveled: r.leveledUp })));

// Snapshot shape
const snap = room.getSnapshot();
console.log('snapshot:', {
  hasShrines: Array.isArray(snap.shrines),
  hasObjectives: snap.objectives !== undefined,
  hasSignature: !!snap.signature,
  playerFields: Object.keys(snap.players[0]).filter(k => ['abilityPoints', 'abilities', 'oathState', 'respawnIn'].includes(k)),
  mobFields: Object.keys(snap.mobs[0] || {}).filter(k => ['role', 'isElite', 'affixes', 'auraColor', 'stealthed'].includes(k)),
  bossPhase: snap.boss ? snap.boss.phaseName : null
});

// Message types seen (Phase 2 surface)
const p2set = new Set(broadcastLog);
console.log('phase2 msgs:', ['enemy_spawn', 'boss_spawn', 'oath_shrines_spawned', 'objectives_update', 'enemy_telegraph'].filter(t => p2set.has(t)));
console.log('SMOKE DONE');
