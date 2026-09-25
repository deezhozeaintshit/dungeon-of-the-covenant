// tests/test_core_systems.js — Workstream 4 (HP/XP/Abilities) verification.
// Run: node tests/test_core_systems.js
const assert = require('assert');
const Health = require('../server/game/systems/Health');
const Progression = require('../server/game/systems/Progression');
const Abilities = require('../server/game/systems/Abilities');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (e) { console.error(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

function mockRoom() {
  const broadcasts = [];
  return {
    state: 'dungeon',
    players: {},
    mobs: [],
    broadcasts,
    broadcast(msg) { broadcasts.push(msg); },
    handleEntityDeath(mob, killer) {
      mob.isDead = true;
      if (killer && killer.stats) killer.stats.kills++;
    }
  };
}

function mockPlayer(id, cls = 'juggernaut') {
  return {
    id, name: `Hero_${id}`, classKey: cls, x: 5, z: 5,
    maxHp: 650, hp: 650, level: 1, xp: 0,
    damageBuff: 1.0, cooldownHaste: 1.0, lifesteal: 0, critChance: 0.18, speed: 4.8,
    isDowned: false, isDead: false, isBot: false,
    invulnerableTimer: 0, statuses: {}, cooldowns: {},
    stats: { damageDealt: 0, damageTaken: 0, healingDone: 0, kills: 0 }
  };
}

console.log('== Health ==');
ok('initPlayer sets defaults', () => {
  const p = mockPlayer('a');
  Health.initPlayer(p);
  assert.strictEqual(p.armor, 0);
  assert.strictEqual(p.state, 'alive');
  assert.strictEqual(p.respawnTimer, 0);
});
ok('damagePlayer basic + returns actual dealt', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  const r = Health.damagePlayer(room, 'a', 100, { type: 'physical', sourceName: 'Ghoul' });
  assert.strictEqual(r.dealt, 100);
  assert.strictEqual(p.hp, 550);
  assert.strictEqual(p.stats.damageTaken, 100);
});
ok('hostile input ignored (NaN, negative, string)', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  for (const bad of [NaN, -50, 'hack', Infinity, undefined]) {
    const r = Health.damagePlayer(room, 'a', bad, {});
    assert.strictEqual(r.dealt, 0, `bad=${bad}`);
  }
  assert.strictEqual(p.hp, 650);
});
ok('armor + resists + shielded mitigation order', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  p.armor = 20; p.resists = { fire: 0.5 }; p.resistAll = 0.1;
  p.statuses.shielded = { duration: 5, maxDuration: 5, potency: 1 };
  // 200 - 20 armor = 180; *0.5 fire = 90; *0.9 all = 81; *0.4 shield = 32.4 -> 32
  const r = Health.damagePlayer(room, 'a', 200, { type: 'fire' });
  assert.strictEqual(r.dealt, 32);
});
ok('invuln frames dodge', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  p.invulnerableTimer = 0.4;
  const r = Health.damagePlayer(room, 'a', 999, {});
  assert.strictEqual(r.dealt, 0); assert.ok(r.dodged);
  assert.strictEqual(p.hp, 650);
  assert.ok(room.broadcasts.some(b => b.type === 'floating_text' && b.text === 'DODGED!'));
});
ok('lethal damage -> downed, not dead', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  const r = Health.damagePlayer(room, 'a', 9999, { sourceName: 'Malakor' });
  assert.ok(r.downed);
  assert.strictEqual(p.hp, 0);
  assert.ok(p.isDowned && !p.isDead && p.state === 'downed');
  assert.ok(room.broadcasts.some(b => b.type === 'player_downed'));
});
ok('downed players take no further damage', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  p.isDowned = true; p.hp = 0;
  const r = Health.damagePlayer(room, 'a', 100, {});
  assert.strictEqual(r.dealt, 0);
});
ok('thorns reflects to attacker mob, kill credited', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  p.thorns = 0.5;
  room.mobs.push({ id: 'mob_1', x: 5, z: 6, hp: 40, maxHp: 40, isDead: false });
  const r = Health.damagePlayer(room, 'a', 100, { attackerId: 'mob_1' });
  assert.strictEqual(r.dealt, 100);
  assert.ok(room.mobs[0].isDead, 'mob should die from 50 thorns');
  assert.strictEqual(p.stats.kills, 1);
});
ok('healPlayer clamps, ignores dead/downed', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  p.hp = 600;
  assert.strictEqual(Health.healPlayer(room, 'a', 1000, 'test'), 50);
  assert.strictEqual(p.hp, 650);
  p.isDowned = true;
  assert.strictEqual(Health.healPlayer(room, 'a', 100, 'test'), 0);
});
ok('setMaxHp grows and heals delta', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  p.hp = 600;
  assert.strictEqual(Health.setMaxHp(room, 'a', 800), 800);
  assert.strictEqual(p.hp, 750); // 600 + 150 delta
});
ok('tick: downed expiry -> dead -> auto respawn', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  Health.damagePlayer(room, 'a', 9999, {});
  Health.tick(room, 30); // expire downed
  assert.ok(p.isDead && p.state === 'dead');
  assert.ok(room.broadcasts.some(b => b.type === 'player_died' && b.respawnIn === 15));
  assert.strictEqual(p.respawnTimer, 15);
  Health.tick(room, 15); // auto respawn
  assert.ok(!p.isDead && p.state === 'alive');
  assert.strictEqual(p.hp, p.maxHp);
  assert.strictEqual(p.invulnerableTimer, 3.0);
  assert.ok(room.broadcasts.some(b => b.type === 'player_respawned'));
});
ok('requestRespawn early: instant, costs 10% xp', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p); p.xp = 1000;
  Health.damagePlayer(room, 'a', 9999, {});
  Health.tick(room, 30);
  const res = Health.requestRespawn(room, 'a');
  assert.ok(res.ok);
  assert.strictEqual(p.xp, 900);
  assert.ok(!p.isDead);
  assert.ok(room.broadcasts.some(b => b.type === 'player_respawned' && b.early === true));
});
ok('requestRespawn rejected when alive', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  assert.strictEqual(Health.requestRespawn(room, 'a').ok, false);
});
ok('hpRegen ticks', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Health.initPlayer(p);
  p.hpRegen = 0.1; p.hp = 500;
  Health.tick(room, 1);
  assert.strictEqual(p.hp, 565); // 650 * 0.1
});

console.log('== Progression ==');
ok('XP curve table values', () => {
  assert.strictEqual(Progression.xpToNext(1), 80);
  assert.strictEqual(Progression.xpToNext(2), 242);
  assert.strictEqual(Progression.xpToNext(3), 463);
  assert.strictEqual(Progression.xpToNext(4), 735);
  assert.strictEqual(Progression.xpForLevel(5), 1520);
  assert.strictEqual(Progression.xpForLevel(1), 0);
});
ok('grantXP single level-up: growth + point + choices', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Progression.initPlayer(p);
  const r = Progression.grantXP(room, 'a', 100, 'kill');
  assert.ok(r.leveledUp && r.newLevel === 2);
  assert.strictEqual(r.xp, 20); // 100 - 80
  assert.strictEqual(r.nextLevelXp, 242);
  assert.strictEqual(p.abilityPoints, 1);
  assert.strictEqual(p.maxHp, Math.round(650 * 1.18));
  assert.strictEqual(p.hp, p.maxHp);
  assert.strictEqual(p.damageBuff, 1.15);
  assert.strictEqual(p.pendingChoices.length, 3);
  assert.ok(room.broadcasts.some(b => b.type === 'level_up' && b.level === 2));
  const ch = room.broadcasts.find(b => b.type === 'level_up_choices');
  assert.ok(ch && ch.choices.length === 3);
  assert.ok(room.broadcasts.some(b => b.type === 'xp_update' && b.gained === 100 && b.reason === 'kill'));
});
ok('grantXP multi-level chain', () => {
  const room = mockRoom(); const p = mockPlayer('a', 'mage');
  room.players.a = p; Progression.initPlayer(p);
  const r = Progression.grantXP(room, 'a', 5000, 'boss');
  assert.strictEqual(r.newLevel, 7);
  assert.strictEqual(r.xp, 1024);
  assert.strictEqual(p.abilityPoints, 6);
});
ok('grantXP accepts namespaced reason (workstream 5)', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Progression.initPlayer(p);
  Progression.grantXP(room, 'a', 50, 'objective:slay_warden');
  const b = room.broadcasts.find(b => b.type === 'xp_update');
  assert.strictEqual(b.reason, 'objective:slay_warden');
});
ok('grantPartyXP skips dead, includes downed', () => {
  const room = mockRoom();
  const a = mockPlayer('a'); const b = mockPlayer('b'); const c = mockPlayer('c');
  room.players = { a, b, c };
  for (const p of [a, b, c]) Progression.initPlayer(p);
  b.isDead = true; c.isDowned = true;
  const res = Progression.grantPartyXP(room, 45, 'kill');
  assert.strictEqual(res.length, 2);
  assert.strictEqual(a.xp, 45); assert.strictEqual(c.xp, 45); assert.strictEqual(b.xp, 0);
});
ok('grantXP hostile amounts ignored', () => {
  const room = mockRoom(); const p = mockPlayer('a');
  room.players.a = p; Progression.initPlayer(p);
  Progression.grantXP(room, 'a', -500, 'kill');
  Progression.grantXP(room, 'a', NaN, 'kill');
  assert.strictEqual(p.xp, 0); assert.strictEqual(p.level, 1);
});

console.log('== Abilities ==');
ok('rollChoices: 3, class-eligible, not maxed', () => {
  const p = mockPlayer('a', 'mage'); Abilities.initPlayer(p);
  const choices = Abilities.rollChoices(p, 3);
  assert.strictEqual(choices.length, 3);
  const ids = new Set(choices.map(c => c.id));
  assert.strictEqual(ids.size, 3);
  for (const c of choices) {
    assert.ok(c.classes.includes('mage'), `${c.id} not mage-eligible`);
    assert.ok(c.rank < c.maxRanks);
  }
});
ok('applyAbilityPick happy path + effect applied', () => {
  const room = mockRoom(); const p = mockPlayer('a', 'mage');
  room.players.a = p; Abilities.initPlayer(p);
  const before = p.cooldownHaste;
  p.pendingChoices = ['spell_surge', 'savage_strikes', 'iron_skin'];
  const r = Abilities.applyAbilityPick(room, 'a', 'spell_surge');
  assert.ok(r.ok && r.rank === 1);
  assert.ok(p.cooldownHaste > before);
  assert.ok(!p.pendingChoices.includes('spell_surge'));
  assert.ok(room.broadcasts.some(b => b.type === 'build_update'));
});
ok('applyAbilityPick rejects spoofed / maxed / class-locked', () => {
  const room = mockRoom(); const p = mockPlayer('a', 'mage');
  room.players.a = p; Abilities.initPlayer(p);
  assert.strictEqual(Abilities.applyAbilityPick(room, 'a', 'savage_strikes').reason, 'not_offered');
  p.pendingChoices = ['thornmail']; // juggernaut/cleric only
  assert.strictEqual(Abilities.applyAbilityPick(room, 'a', 'thornmail').reason, 'class_locked');
  p.pendingChoices = ['iron_skin']; p.abilities.iron_skin = 5;
  assert.strictEqual(Abilities.applyAbilityPick(room, 'a', 'iron_skin').reason, 'maxed');
  assert.strictEqual(Abilities.applyAbilityPick(room, 'a', 'nope').reason, 'unknown_ability');
});
ok('spendAbilityPoint: point consumed, maxed/no-points rejected', () => {
  const room = mockRoom(); const p = mockPlayer('a', 'juggernaut');
  room.players.a = p; Abilities.initPlayer(p);
  assert.strictEqual(Abilities.spendAbilityPoint(room, 'a', 'iron_skin').reason, 'no_points');
  p.abilityPoints = 2;
  const before = p.maxHp;
  const r = Abilities.spendAbilityPoint(room, 'a', 'iron_skin');
  assert.ok(r.ok && r.abilityPoints === 1 && r.rank === 1);
  assert.strictEqual(p.maxHp, before + 60);
  p.abilities.iron_skin = 5;
  assert.strictEqual(Abilities.spendAbilityPoint(room, 'a', 'iron_skin').reason, 'maxed');
});
ok('getPlayerBuild shape', () => {
  const p = mockPlayer('a', 'rogue'); Abilities.initPlayer(p);
  p.abilityPoints = 3; p.abilities.savage_strikes = 2; p.pendingChoices = ['swift_foot'];
  const b = Abilities.getPlayerBuild('a');
  assert.ok(b);
  assert.strictEqual(b.abilityPoints, 3);
  assert.strictEqual(b.ranks.savage_strikes, 2);
  assert.deepStrictEqual(b.pendingChoices, ['swift_foot']);
  assert.ok(Array.isArray(b.tree.wrath) && Array.isArray(b.tree.aegis));
  assert.strictEqual(Abilities.getPlayerBuild('ghost'), null);
});
ok('bot auto-resolves choices + spends points', () => {
  const room = mockRoom(); const p = mockPlayer('bot1', 'cleric');
  p.isBot = true; room.players.bot1 = p;
  Progression.initPlayer(p);
  Progression.grantXP(room, 'bot1', 200, 'kill'); // level 2, pending choices offered
  assert.strictEqual(p.pendingChoices.length, 0, 'bot consumed its choice');
  assert.strictEqual(p.abilityPoints, 0, 'bot spent its point');
  assert.ok(Object.keys(p.abilities).length >= 1);
});
ok('getTreeForClass filters eligibility', () => {
  const t = Abilities.getTreeForClass('mage');
  assert.strictEqual(t.abilities.length, 10);
  const thorn = t.abilities.find(a => a.id === 'thornmail');
  assert.strictEqual(thorn.eligible, false);
  const surge = t.abilities.find(a => a.id === 'spell_surge');
  assert.strictEqual(surge.eligible, true);
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (WITH FAILURES)' : ''}.`);
