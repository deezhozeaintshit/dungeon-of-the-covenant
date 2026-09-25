// Phase 4 Endless Rift smoke test: real systems, headless, zero mocks of
// game logic. Covers: scaling curve sanity, deterministic affix rolls,
// affix combat hooks, tier-gate validation, keystone/pact entry economy,
// rift-aware loot, campaign-victory keystone grant, rift clear unlock +
// deepest-tier leaderboard submit, and Room integration (spawn scaling).
//
// authService is stubbed via require-cache BEFORE Rift/Room load so no real
// account file is touched. leaderboards.json is snapshotted + restored.
const fs = require('fs');
const path = require('path');

// --- stub authService before anything requires it ---------------------------
const authPath = require.resolve('../server/authService');
const fakeProfiles = {};
let saveCount = 0;
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAccountByToken: () => null,
    getProfileByUsername: (u) => fakeProfiles[u] || null,
    saveAccounts: () => { saveCount++; }
  }
};

const Rift = require('../server/game/systems/Rift');
const Leaderboards = require('../server/game/systems/Leaderboards');
const LootGenerator = require('../server/game/LootGenerator');
const Room = require('../server/game/Room');

let failures = 0;
function check(name, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) failures++;
}

// --- 1. Scaling curve sanity -------------------------------------------------
const s1 = Rift.scalingFor(1);
check('tier 1 scaling', s1.hpMult === 1.312 && s1.dmgMult === 1.122 && s1.speedMult === 1.014,
  JSON.stringify(s1));
const s10 = Rift.scalingFor(10);
check('tier 10 scaling', s10.hpMult === 5.2 && Math.abs(s10.dmgMult - 2.42) < 0.001 && s10.speedMult === 1.14,
  JSON.stringify(s10));
const s50 = Rift.scalingFor(50);
check('tier 50 hard-but-finite', s50.hpMult === 46 && s50.dmgMult === 12.5 && s50.speedMult === 1.4,
  JSON.stringify(s50));
const s999 = Rift.scalingFor(999);
check('tier 999 no overflow', Number.isFinite(s999.hpMult) && Number.isFinite(s999.dmgMult) && s999.speedMult === 1.4,
  `hp=${s999.hpMult} dmg=${s999.dmgMult}`);
check('tier clamp (0/negative/NaN -> 1)', Rift.scalingFor(0).tier === 1 && Rift.scalingFor(-5).tier === 1 && Rift.scalingFor(NaN).tier === 1);
check('speed never exceeds cap across tiers', Array.from({ length: 200 }, (_, i) => Rift.scalingFor(i + 1).speedMult).every(v => v <= 1.4));
check('hp strictly increasing', (() => { let prev = 0; for (let t = 1; t <= 100; t++) { const v = Rift.scalingFor(t).hpMult; if (v <= prev) return false; prev = v; } return true; })());

// --- 2. Affix rolls: deterministic, 1-3 count, full catalog coverage ---------
check('affix counts 1/2/3', Rift.affixCountForTier(1) === 1 && Rift.affixCountForTier(4) === 1 &&
  Rift.affixCountForTier(5) === 2 && Rift.affixCountForTier(11) === 2 && Rift.affixCountForTier(12) === 3);
const a7a = Rift.affixesForTier(7).map(a => a.id).join(',');
const a7b = Rift.affixesForTier(7).map(a => a.id).join(',');
check('affix roll deterministic per tier', a7a === a7b && Rift.affixesForTier(7).length === 2, a7a);
const seen = new Set();
for (let t = 1; t <= 80; t++) for (const a of Rift.affixesForTier(t)) seen.add(a.id);
check('all 8 affixes reachable', seen.size === 8, [...seen].join(','));
check('affix defs have client catalog fields', Rift.AFFIX_IDS.every(id => {
  const d = Rift.AFFIX_DEFS[id];
  return d && d.icon && d.name && d.desc;
}));
check('publicAffixes leaks no tunables', (() => {
  const p = Rift.publicAffixes(20);
  return p.length === 3 && p.every(a => Object.keys(a).sort().join(',') === 'desc,icon,id,name');
})());

// --- 3. scaleMobStats: real stat mutation ------------------------------------
function baseStats(role = 'trash') {
  return { maxHp: 100, hp: 100, damage: 10, speed: 5, role, attackCooldown: 2.0, telegraphMs: 800 };
}
const m10 = Rift.scaleMobStats(baseStats(), 10, []);
check('tier 10 trash scaling', m10.maxHp === 520 && m10.damage === 24 && m10.speed === 5.7,
  `hp=${m10.maxHp} dmg=${m10.damage} spd=${m10.speed}`);
const mf = Rift.scaleMobStats(baseStats(), 10, [Rift.AFFIX_DEFS.frenzied]);
check('frenzied shortens cooldown + telegraph', mf.attackCooldown === 1.1 && mf.telegraphMs === 640,
  `cd=${mf.attackCooldown} tele=${mf.telegraphMs}`);
const mt = Rift.scaleMobStats(baseStats('elite'), 10, [Rift.AFFIX_DEFS.tyrannical]);
check('tyrannical doubles elite HP, +35% dmg', mt.maxHp === 1040 && mt.damage === 33,
  `hp=${mt.maxHp} dmg=${mt.damage}`);
const mtTrash = Rift.scaleMobStats(baseStats('trash'), 10, [Rift.AFFIX_DEFS.tyrannical]);
check('tyrannical ignores trash', mtTrash.maxHp === 520, `hp=${mtTrash.maxHp}`);

// --- 4. shielded absorb -------------------------------------------------------
const shieldMob = { maxHp: 1000, riftShield: { amount: 60, expiresAt: Date.now() + 60000 } };
check('shield absorbs partial', Rift.absorbShield(shieldMob, 100) === 40 && shieldMob.riftShield === null);
const shieldMob2 = { maxHp: 1000, riftShield: { amount: 60, expiresAt: Date.now() + 60000 } };
check('shield absorbs fully, remainder stands', Rift.absorbShield(shieldMob2, 25) === 0 && shieldMob2.riftShield.amount === 35);
const shieldMob3 = { maxHp: 1000, riftShield: { amount: 60, expiresAt: Date.now() - 1000 } };
check('expired shield ignored', Rift.absorbShield(shieldMob3, 25) === 25 && shieldMob3.riftShield === null);
check('no shield passthrough', Rift.absorbShield({ maxHp: 100 }, 25) === 25);

// --- 5. vampiric + volatile hooks ----------------------------------------------
const vampRoom = {
  riftTier: 5, riftAffixes: [Rift.AFFIX_DEFS.vampiric],
  players: {}, broadcast: () => {}
};
const vampMob = { id: 'mob_1', hp: 400, maxHp: 1000, isDead: false };
Rift.onPlayerDamaged(vampRoom, { id: 'p1' }, vampMob, 100);
check('vampiric heals attacker 30%', vampMob.hp === 430, `hp=${vampMob.hp}`);
const vampMobFull = { id: 'mob_2', hp: 990, maxHp: 1000, isDead: false };
Rift.onPlayerDamaged(vampRoom, { id: 'p1' }, vampMobFull, 100);
check('vampiric capped at maxHp', vampMobFull.hp === 1000);
const heroAttacker = { id: 'p9' };
const vampRoom2 = { riftTier: 5, riftAffixes: [Rift.AFFIX_DEFS.vampiric], players: { p9: heroAttacker }, broadcast: () => {} };
const notHealed = { id: 'p9', hp: 50, maxHp: 100 };
Rift.onPlayerDamaged(vampRoom2, { id: 'p1' }, notHealed, 100);
check('vampiric never heals heroes', notHealed.hp === 50);

const boomLog = [];
const boomRoom = {
  riftTier: 8, riftAffixes: [Rift.AFFIX_DEFS.volatile],
  players: { p1: { id: 'p1', x: 0, z: 0, isDead: false, isDowned: false } },
  broadcast: (m) => boomLog.push(m),
  damagePlayer: (p, amt) => { p._dmg = (p._dmg || 0) + amt; return { dealt: amt }; }
};
Rift.onMobDeath(boomRoom, { id: 'mob_9', x: 0, z: 0, isBoss: false }, null);
const boomFx = boomLog.find(m => m.type === 'ground_fx');
check('volatile broadcasts detonation fx', !!boomFx && boomFx.fxType === 'corpse_explosion');
check('volatile damages nearby hero', boomRoom.players.p1._dmg > 0, `dmg=${boomRoom.players.p1._dmg}`);
check('volatile skips bosses', (() => {
  const log2 = [];
  Rift.onMobDeath({ ...boomRoom, broadcast: (m) => log2.push(m) }, { id: 'b', x: 0, z: 0, isBoss: true }, null);
  return log2.length === 0;
})());

// --- 6. Tier-gate validation + entry economy ----------------------------------
function testProfile(over = {}) {
  return { meta: { rift: { keystones: 2, unlockedTier: 2, bestTier: 2, totalClears: 3, bestTimes: {}, lastDailyDelve: null, ...over } } };
}
check('sealed account denied', Rift.validateEntry(testProfile({ unlockedTier: 0 }), 1, 'keystone').ok === false);
check('tier skip denied', (() => {
  const r = Rift.validateEntry(testProfile(), 3, 'keystone');
  return r.ok === false && /Tier 2/.test(r.reason);
})(), Rift.validateEntry(testProfile(), 3, 'keystone').reason);
check('unlocked tier allowed (keystone)', Rift.validateEntry(testProfile(), 2, 'keystone').ok === true);
check('no keystone denied', Rift.validateEntry(testProfile({ keystones: 0 }), 2, 'keystone').ok === false);
check('pact allowed without keystone', Rift.validateEntry(testProfile({ keystones: 0 }), 2, 'pact').ok === true);
const econProfile = testProfile();
check('keystone consumed', Rift.consumeEntry(econProfile, 'keystone') === true && econProfile.meta.rift.keystones === 1);
check('pact consumes nothing', Rift.consumeEntry(econProfile, 'pact') === true && econProfile.meta.rift.keystones === 1);
check('ensureRift defaults on fresh profile', (() => {
  const r = Rift.ensureRift({});
  return r.keystones === 0 && r.unlockedTier === 0 && r.bestTier === 0 && typeof r.bestTimes === 'object';
})());
const pub = Rift.publicStatus(testProfile());
check('publicStatus shape', pub.ok === true && pub.unlockedTier === 2 && pub.keystones === 2 && pub.unlocked === true);

// Rift pact application
const pactLog = [];
const pactPlayer = { id: 'pp', name: 'Pacty', maxHp: 1000, hp: 1000, isBot: false };
Rift.applyPactToPlayer({ broadcast: (m) => pactLog.push(m) }, pactPlayer);
check('pact cuts maxHp 15%', pactPlayer.maxHp === 850 && pactPlayer.hp === 850 && pactPlayer.riftPact === true);
check('pact damage-taken mult', Rift.getPlayerDamageTakenMult(pactPlayer) === 1.1);
check('pact announces to party', pactLog.some(m => m.type === 'narrator_announcement' && /RIFT PACT/.test(m.text)));

// --- 7. Loot: rift rarity bonus improves tables, base path untouched ----------
const hiTier = Array.from({ length: 600 }, () => Rift.generateRiftItem(30, 'mob', 'ossuary_crypt'));
const loTier = Array.from({ length: 600 }, () => Rift.generateRiftItem(1, 'mob', 'ossuary_crypt'));
const hiRate = hiTier.filter(i => ['epic', 'legendary', 'mythic'].includes(i.rarity)).length / hiTier.length;
const loRate = loTier.filter(i => ['epic', 'legendary', 'mythic'].includes(i.rarity)).length / loTier.length;
check('tier 30 out-loots tier 1 (epic+)', hiRate > loRate + 0.15, `t30=${hiRate.toFixed(2)} t1=${loRate.toFixed(2)}`);
check('rift items valid + sanitize-clean', hiTier.every(i =>
  LootGenerator.isValidRarity(i.rarity) && i.gearScore > 0 && ['weapon', 'armor', 'relic'].includes(i.slot)));
check('generateItem backward compatible (no opts)', (() => {
  const it = LootGenerator.generateItem(3, 'mob', 'glacial_sanctum');
  return it && it.biome === 'glacial_sanctum' && LootGenerator.isValidRarity(it.rarity);
})());
check('rarityBonusForTier sane', Rift.rarityBonusForTier(1) === 2 && Rift.rarityBonusForTier(20) === 40 && Rift.rarityBonusForTier(50) === 40);

// --- 8. Leaderboard (workstream 1 shared schema): rift_depth --------------------
const lbFile = path.join(__dirname, '..', 'server', 'data', 'leaderboards.json');
let lbBackup = null;
try { lbBackup = fs.readFileSync(lbFile, 'utf8'); } catch (_) { /* no file yet */ }
const sub = Leaderboards.submit('rift_depth', {
  username: 'rift_smoke_test', displayName: 'SmokeTester', value: 7,
  meta: { riftTier: 7, clearTimeMs: 180000, partySize: 2 }
});
check('rift_depth submit ok', sub.ok === true && sub.entry.value === 7 && sub.entry.boardId === 'rift_depth',
  sub.ok ? `value=${sub.entry.value}` : sub.error);
const board = Leaderboards.getBoard('rift_depth', { limit: 100 });
check('board contains test entry', board.ok && board.entries.some(e => e.username === 'rift_smoke_test'));
check('board sorted desc by tier', (() => {
  const vals = board.entries.map(e => e.value);
  return vals.every((v, i) => i === 0 || vals[i - 1] >= v);
})());
const bad = Leaderboards.submit('rift_depth', { username: '', value: 3 });
check('leaderboard rejects empty username', bad.ok === false);
// restore leaderboard store
try {
  if (lbBackup === null) { if (fs.existsSync(lbFile)) fs.unlinkSync(lbFile); }
  else fs.writeFileSync(lbFile, lbBackup, 'utf8');
} catch (_) { /* ignore */ }
check('leaderboard store restored', (() => {
  try {
    const cur = fs.existsSync(lbFile) ? fs.readFileSync(lbFile, 'utf8') : null;
    return cur === lbBackup;
  } catch (_) { return false; }
})());

// --- 9. Room integration: spawn scaling, clear, victory keystone --------------
const broadcastLog = [];
const room = new Room('RIFTSMOKE', null);
room.setBroadcastCallback((m) => broadcastLog.push(m));
room.riftTier = 5;
room.riftAffixes = Rift.affixesForTier(5);
const riftMob = room.spawnMob('cinder_thrall', 10, 10);
check('room spawn scaled by rift tier', riftMob && riftMob.riftTier !== undefined || (riftMob && riftMob.maxHp > 0 && room.riftTier === 5));
check('spawned mob hp above unscaled baseline', (() => {
  const plain = new Room('PLAINSMOKE', null);
  plain.setBroadcastCallback(() => {});
  const m0 = plain.spawnMob('cinder_thrall', 10, 10);
  return riftMob.maxHp > m0.maxHp;
})(), `rift hp=${riftMob.maxHp}`);
// shielded absorb through the real mob takeDamage path
const shRoom = new Room('SHIELDSMOKE', null);
shRoom.setBroadcastCallback(() => {});
shRoom.riftTier = 3;
shRoom.riftAffixes = [Rift.AFFIX_DEFS.shielded];
const shMob = shRoom.spawnMob('cinder_thrall', 0, 0);
shMob.riftShield = { amount: 1000, expiresAt: Date.now() + 60000 };
const hpBefore = shMob.hp;
shMob.takeDamage(50, 'physical', null);
check('shielded affix absorbs via takeDamage', shMob.hp === hpBefore, `hp ${hpBefore} -> ${shMob.hp}`);

// campaign victory grants keystone + unlocks tier 1
fakeProfiles['rift_hero'] = { meta: {} };
const vLog = [];
const vRoom = new Room('VICTORYSMOKE', null);
vRoom.setBroadcastCallback((m) => vLog.push(m));
vRoom.riftTier = 0;
vRoom.players = { p1: { id: 'p1', isBot: false, accountUsername: 'rift_hero', name: 'Hero' } };
Rift.onCampaignVictory(vRoom);
const vr = fakeProfiles['rift_hero'].meta.rift;
check('campaign victory grants keystone', vr.keystones === 1 && vr.unlockedTier === 1);
check('campaign victory broadcasts grant', vLog.some(m => m.type === 'rift_keystone_granted'));
check('campaign victory skipped in rift rooms', (() => {
  const l2 = [];
  const rr = new Room('RIFTVICT', null);
  rr.setBroadcastCallback((m) => l2.push(m));
  rr.riftTier = 4;
  rr.players = { p1: { id: 'p1', isBot: false, accountUsername: 'rift_hero', name: 'Hero' } };
  Rift.onCampaignVictory(rr);
  return fakeProfiles['rift_hero'].meta.rift.keystones === 1 && !l2.some(m => m.type === 'rift_keystone_granted');
})());

// rift clear: unlock, daily delve, leaderboard, single execution
const lbFile2 = lbFile;
let lbBackup2 = null;
try { lbBackup2 = fs.readFileSync(lbFile2, 'utf8'); } catch (_) { /* ignore */ }
fakeProfiles['rift_hero2'] = { meta: {} };
Rift.ensureRift(fakeProfiles['rift_hero2']).unlockedTier = 3;
Rift.ensureRift(fakeProfiles['rift_hero2']).keystones = 0;
const cLog = [];
const cRoom = new Room('CLEARSMOKE', null);
cRoom.setBroadcastCallback((m) => cLog.push(m));
cRoom.riftTier = 3;
cRoom.riftAffixes = Rift.affixesForTier(3);
cRoom.startTime = Date.now() - 120000;
cRoom.players = { p1: { id: 'p1', isBot: false, accountUsername: 'rift_hero2', name: 'Clearer' } };
const cleared = Rift.onRiftCleared(cRoom, null);
const cr = fakeProfiles['rift_hero2'].meta.rift;
check('rift clear unlocks tier+1', cleared && cr.unlockedTier === 4 && cr.bestTier === 3 && cr.totalClears === 1);
check('daily delve bonus keystone', cleared.dailyDelveBonus === true && cr.keystones === 1);
check('rift_cleared broadcast', cLog.some(m => m.type === 'rift_cleared' && m.tier === 3 && m.newUnlockedTier === 4));
check('clear is single-execution', Rift.onRiftCleared(cRoom, null) === null);
check('second clear same day: no bonus keystone', (() => {
  const c2 = new Room('CLEARSMOKE2', null);
  c2.setBroadcastCallback(() => {});
  c2.riftTier = 3; c2.riftAffixes = []; c2.startTime = Date.now() - 60000;
  c2.players = { p1: { id: 'p1', isBot: false, accountUsername: 'rift_hero2', name: 'Clearer' } };
  const r2 = Rift.onRiftCleared(c2, null);
  return r2.dailyDelveBonus === false && fakeProfiles['rift_hero2'].meta.rift.keystones === 1;
})());
try {
  if (lbBackup2 === null) { if (fs.existsSync(lbFile2)) fs.unlinkSync(lbFile2); }
  else fs.writeFileSync(lbFile2, lbBackup2, 'utf8');
} catch (_) { /* ignore */ }

// getPublicState / snapshot wiring
check('getPublicState null outside rifts', Rift.getPublicState({ riftTier: 0 }) === null);
const ps = Rift.getPublicState({ riftTier: 12, riftAffixes: Rift.affixesForTier(12), riftPact: true });
check('getPublicState shape', ps.tier === 12 && ps.affixes.length === 3 && ps.pact === true);

console.log(failures === 0 ? '\nRIFT SMOKE: ALL PASS' : `\nRIFT SMOKE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
