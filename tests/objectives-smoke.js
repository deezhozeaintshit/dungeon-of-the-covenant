// Smoke test: Objectives.js completion paths against a fake room.
// Run: node tests/objectives-smoke.js
'use strict';
const { Objectives, OBJECTIVE_TYPES } = require('../server/game/systems/Objectives');

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`  PASS ${label}`);
  else { failures++; console.error(`  FAIL ${label}`); }
}

function fakeRoom(floor = 1, biomeId = 'ossuary_crypt') {
  const messages = [];
  const room = {
    floor,
    nextEntityId: 9000,
    proceduralConfig: { seed: 424242, floorScale: 1.0, biome: { id: biomeId, name: 'Test Biome' } },
    players: {
      p1: { id: 'p1', name: 'Hero', isBot: false, isDead: false, x: 0, z: 16, xp: 0, level: 1, nextLevelXp: 100, maxHp: 500, hp: 500, damageBuff: 1 },
      bot1: { id: 'bot1', name: 'Bot', isBot: true, isDead: false, x: 2, z: 16 }
    },
    shrines: [],
    floorLoot: [],
    systems: {},
    broadcast(msg) { messages.push(msg); },
    spawnFloorLoot(type, x, z, value, name, jitter, itemData) {
      const loot = { id: `loot_${Math.random()}`, type, x, z, value, name, itemData, pickedUp: false };
      this.floorLoot.push(loot);
      return loot;
    },
    spawnMob(type, x, z) { this.spawnedMobs = this.spawnedMobs || []; this.spawnedMobs.push({ type, x, z }); },
    awardPartyXP(xp) { this.awardedXP = (this.awardedXP || 0) + xp; }
  };
  room.messages = messages;
  return room;
}

console.log('== Objectives smoke test ==');

// 1. Generation: 3 objectives, one primary, all active
{
  const room = fakeRoom();
  const obj = Objectives.createForRoom(room);
  assert(obj.list.length === 3, 'generates 3 objectives');
  assert(obj.list.filter(o => o.primary).length === 1, 'exactly one PRIMARY');
  assert(obj.list.every(o => o.state === 'active'), 'all start active');
  assert(obj.list[0].type === OBJECTIVE_TYPES.SLAY_WARDEN, 'SLAY_WARDEN is primary');
  assert(room.messages.some(m => m.type === 'objectives_update'), 'objectives_update broadcast on create');
  const snap = obj.getSnapshot();
  assert(snap.objectives.length === 3 && snap.floor === 1, 'getSnapshot shape');
}

// 2. SLAY_WARDEN completes on real elite death
{
  const room = fakeRoom();
  const obj = Objectives.createForRoom(room);
  const warden = obj.list[0];
  obj.onEnemyKilled(room, { type: warden.data.wardenType, name: warden.data.wardenName, x: 5, z: 5, isDead: true }, null);
  assert(warden.state === 'complete', 'SLAY_WARDEN completes on warden kill');
  assert(warden.progress.current === warden.progress.target, 'progress full');
  assert(room.messages.some(m => m.type === 'objective_complete'), 'objective_complete broadcast');
  assert(room.awardedXP === warden.reward.xp, `XP fallback awarded (${room.awardedXP})`);
  assert(room.floorLoot.some(l => l.type === 'gear_drop' && /Bounty Cache/.test(l.name)), 'bounty cache loot spawned');
  // Wrong elite type must not complete
  const room2 = fakeRoom(2);
  const obj2 = Objectives.createForRoom(room2);
  obj2.onEnemyKilled(room2, { type: 'skeleton_warrior', x: 0, z: 0, isDead: true }, null);
  assert(obj2.list[0].state === 'active', 'non-warden kill does not complete');
}

// 3. DESTROY_SHRINES: real hp, destroy detection via damageShrinesAt
{
  const room = fakeRoom(3); // floor 3 -> 3 shrines
  const obj = Objectives.createForRoom(room);
  const shrineObj = obj.list.find(o => o.type === OBJECTIVE_TYPES.DESTROY_SHRINES);
  assert(shrineObj && room.shrines.length === 3, '3 shrines spawned with hp');
  assert(room.shrines.every(s => s.hp > 0 && !s.isDead), 'shrines have real hp');
  const target = room.shrines[0];
  const hits = obj.damageShrinesAt(room, target.x, target.z, 2, 100000, room.players.p1);
  assert(hits.length === 1 && target.isDead, 'overkill destroys shrine via damageShrinesAt');
  assert(shrineObj.progress.current === 1, 'progress advances on destroy');
  // destroy the rest
  for (const s of room.shrines.filter(s => !s.isDead)) {
    obj.damageShrinesAt(room, s.x, s.z, 2, 100000, room.players.p1);
  }
  assert(shrineObj.state === 'complete', 'DESTROY_SHRINES completes at target');
}

// 4. RECOVER_RELIC: pickup -> carry to altar -> complete
{
  const room = fakeRoom();
  const obj = Objectives.createForRoom(room);
  const relicObj = obj.list.find(o => o.type === OBJECTIVE_TYPES.RECOVER_RELIC);
  const loot = room.floorLoot.find(l => l.type === 'objective_relic');
  assert(!!loot, 'relic loot spawned');
  const ok = obj.onRelicPickup(room, room.players.p1, loot);
  assert(ok && loot.pickedUp && room.players.p1.carryingObjectiveRelic === relicObj.id, 'relic pickup marks carrier');
  // walk to altar
  room.players.p1.x = relicObj.data.altar.x;
  room.players.p1.z = relicObj.data.altar.z;
  obj.onTick(room, 0.05);
  assert(relicObj.state === 'complete', 'RECOVER_RELIC completes at altar');
  // player leaving respawns the relic (no lost relic)
  const room2 = fakeRoom();
  const obj2 = Objectives.createForRoom(room2);
  const relic2 = obj2.list.find(o => o.type === OBJECTIVE_TYPES.RECOVER_RELIC);
  const loot2 = room2.floorLoot.find(l => l.type === 'objective_relic');
  obj2.onRelicPickup(room2, room2.players.p1, loot2);
  delete room2.players.p1;
  obj2.onPlayerLeft(room2, 'p1');
  assert(relic2.data.carrierId === null && room2.floorLoot.filter(l => l.type === 'objective_relic' && !l.pickedUp).length === 1,
    'relic respawns when carrier leaves');
}

// 5. SURVIVE_AMBUSH: waves spawn, timer completes, fail path
// (only 2 of the 3 secondary types roll per floor — re-seed until it appears)
function roomWithAmbush() {
  for (let seed = 424242; seed < 424242 + 20; seed++) {
    const room = fakeRoom();
    room.proceduralConfig.seed = seed;
    const obj = Objectives.createForRoom(room);
    const amb = obj.list.find(o => o.type === OBJECTIVE_TYPES.SURVIVE_AMBUSH);
    if (amb) return { room, obj, amb };
  }
  throw new Error('no ambush objective rolled in 20 seeds');
}
function roomWithAmbushSeed() {
  for (let seed = 424242; seed < 424242 + 20; seed++) {
    const room = fakeRoom();
    room.proceduralConfig.seed = seed;
    const obj = Objectives.createForRoom(room);
    if (obj.list.some(o => o.type === OBJECTIVE_TYPES.SURVIVE_AMBUSH)) return seed;
  }
  throw new Error('no ambush objective rolled in 20 seeds');
}
{
  const { room, obj, amb } = roomWithAmbush();
  const dur = amb.data.duration;
  obj.onTick(room, 3.1); // first wave
  assert((room.spawnedMobs || []).length > 0, 'ambush wave spawns real mobs');
  obj.onTick(room, dur); // run out the clock
  assert(amb.state === 'complete', 'SURVIVE_AMBUSH completes with party alive');
  // fail path: everyone dead
  const failSeed = roomWithAmbushSeed();
  const room2 = fakeRoom();
  room2.proceduralConfig.seed = failSeed;
  const obj2 = Objectives.createForRoom(room2);
  const amb2 = obj2.list.find(o => o.type === OBJECTIVE_TYPES.SURVIVE_AMBUSH);
  room2.players.p1.isDead = true;
  obj2.onTick(room2, amb2.data.duration + 1);
  assert(amb2.state === 'failed', 'SURVIVE_AMBUSH fails on party wipe');
  assert(room2.messages.some(m => m.type === 'objective_failed'), 'objective_failed broadcast');
}

// 6. Progression interface is used when present
{
  const room = fakeRoom();
  const grants = [];
  room.systems.progression = { grantXP(r, pid, amount, reason) { grants.push({ pid, amount, reason }); } };
  const obj = Objectives.createForRoom(room);
  const warden = obj.list[0];
  obj.onEnemyKilled(room, { type: warden.data.wardenType, x: 0, z: 0, isDead: true }, null);
  assert(grants.length === 1 && grants[0].pid === 'p1' && grants[0].amount === warden.reward.xp,
    'progression.grantXP called per human player');
  assert(/^objective:/.test(grants[0].reason), 'reason namespaced objective:*');
  assert(room.awardedXP === undefined, 'fallback NOT used when progression present');
}

// 7. Biome flavor matching
{
  const room = fakeRoom(1, 'blood_citadel');
  const obj = Objectives.createForRoom(room);
  const shrineObj = obj.list.find(o => o.type === OBJECTIVE_TYPES.DESTROY_SHRINES);
  assert(/Sanguine/.test(shrineObj.description), 'shrine flavor matched to blood_citadel biome');
  assert(shrineObj.biome === 'blood_citadel', 'biome tag recorded');
}

console.log(failures === 0 ? '\nALL OBJECTIVE SMOKE TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
