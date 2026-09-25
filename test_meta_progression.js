// ============================================================================
// test_meta_progression.js — Phase 3 workstream 5: persistent account progression
//
// What this covers:
//   A. MetaProgression unit math (ranks, run rewards, purchases, boons, class
//      gating, stash ordering/capacity, clamping, idempotency)
//   B. Security: no client-sent totals are trusted (forged /api/auth/sync
//      meta is dropped; purchase() takes no XP/seal totals; forged catalog
//      ids are sanitized out of the account record)
//   C. Integration: real Room join-time class gating + boon application from
//      the server-resolved account record (locked class -> juggernaut +
//      class_choice_denied; unlocked class passes; guest can never use a
//      locked class)
//   D. Persistence: atomic saveAccounts (temp+rename) + full "server restart"
//      reload from disk — account XP, seals, unlocks, and boon loadout survive.
//
// Run: node test_meta_progression.js
// IMPORTANT: mutates server/data/accounts.json during the run; the original
// file is backed up in memory and restored in a finally block.
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'server/data/accounts.json');
const BACKUP = fs.readFileSync(DATA_FILE);

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL:', label); }
}
function eq(a, b, label) {
  ok(a === b, `${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const M = require('./server/game/systems/MetaProgression');
const authService = require('./server/authService');

function freshMeta() {
  const m = M.ensureMeta({});
  m.accountXp = 2000;   // rank 1: Blood Oathbearer
  m.seals = 5000;
  return m;
}

try {
  // ---------------------------------------------------------------- A. ranks
  console.log('A. rank thresholds');
  const rankCases = [
    [0, 0, 'Soul-Sworn Initiate'], [1499, 0, 'Soul-Sworn Initiate'],
    [1500, 1, 'Blood Oathbearer'], [3999, 1, 'Blood Oathbearer'],
    [4000, 2, 'Grave Vigil'], [7999, 2, 'Grave Vigil'],
    [8000, 3, 'Dread Herald'], [13999, 3, 'Dread Herald'],
    [14000, 4, 'Night Requiem'], [21999, 4, 'Night Requiem'],
    [22000, 5, 'Doombringer'], [33999, 5, 'Doombringer'],
    [34000, 6, 'Harbinger of the Hollow'], [49999, 6, 'Harbinger of the Hollow'],
    [50000, 7, "Malakor's Chosen"], [999999, 7, "Malakor's Chosen"],
    [-50, 0, 'Soul-Sworn Initiate'], ['abc', 0, 'Soul-Sworn Initiate']
  ];
  for (const [xp, idx, name] of rankCases) {
    const r = M.rankForXp(xp);
    eq(r.index, idx, `rankForXp(${JSON.stringify(xp)}).index`);
    eq(r.name, name, `rankForXp(${JSON.stringify(xp)}).name`);
  }
  const maxed = M.rankForXp(50000);
  ok(maxed.isMax === true && maxed.xpToNext === null, 'max rank has no next rank');
  const mid = M.rankForXp(2000);
  eq(mid.xpToNext, 2000, 'xpToNext from 2000 -> 4000 is 2000');
  eq(mid.nextRankName, 'Grave Vigil', 'nextRankName at rank 1');

  // ------------------------------------------------- A. run reward computation
  console.log('A. computeRunRewards');
  const v = M.computeRunRewards({ kills: 50, secretCompleted: true, bossSlain: true, floor: 3, survived: true, victory: true });
  eq(v.accountXp, 2600, 'victory XP: 50*6+250+1000+3*150+500+100');
  eq(v.seals, 260, 'seals = floor(XP/10)');
  eq(v.breakdown.kills, 50, 'breakdown carries kills');
  eq(v.breakdown.victory, true, 'breakdown carries victory');

  const d = M.computeRunRewards({ kills: 50, secretCompleted: true, bossSlain: true, floor: 3, survived: false, victory: false });
  eq(d.accountXp, 700, 'defeat XP: 50*3+120+250+3*60');
  eq(d.seals, 70, 'defeat seals');

  const zero = M.computeRunRewards({ kills: 0, secretCompleted: false, bossSlain: false, floor: 1, survived: false, victory: true });
  eq(zero.accountXp, 650, 'bare victory: 0+0+0+150+500+0');
  eq(zero.seals, 65, 'bare victory seals');

  // Clamping: hostile / malformed input never inflates or breaks the math.
  const clamp = M.computeRunRewards({ kills: -500, secretCompleted: 0, bossSlain: 0, floor: 0, survived: 1, victory: true });
  eq(clamp.accountXp, 750, 'negative kills clamped to 0; floor clamped to 1');
  const clamp2 = M.computeRunRewards({ kills: 99999, secretCompleted: true, bossSlain: true, floor: 999, survived: true, victory: true });
  ok(clamp2.accountXp <= 50000, 'XP capped at MAX_ACCOUNT_XP_PER_RUN (50000)');
  eq(clamp2.breakdown.floors, 99, 'floor clamped to 99');
  eq(clamp2.breakdown.kills, 5000, 'kills clamped to 5000');
  const nan = M.computeRunRewards({ kills: NaN, secretCompleted: false, bossSlain: false, floor: NaN, survived: false, victory: false });
  eq(nan.accountXp, 60, 'NaN inputs clamp to minimums (floor 1 -> 60 XP)');

  // ------------------------------------------------- A. purchases
  console.log('A. purchase validation');
  let m = freshMeta();
  let r1 = M.purchase(m, 'boon_veterans_grit');
  ok(r1.ok === true, 'buy boon_veterans_grit at rank 1 with 5000 seals');
  eq(m.seals, 4700, 'seals deducted (5000-300)');
  ok(m.unlockedBoons.includes('boon_veterans_grit'), 'boon recorded as unlocked');
  const dup = M.purchase(m, 'boon_veterans_grit');
  ok(dup.ok === false && /already claimed/.test(dup.error), 'duplicate purchase rejected');

  const poor = M.purchase(m, 'class_plaguecaller'); // 800, rank 1 -> affordable
  ok(poor.ok === true, 'class_plaguecaller purchased (800 seals, rank 1)');
  ok(m.unlockedClasses.includes('plaguecaller'), 'plaguecaller unlocked');
  eq(m.seals, 3900, 'seals after class purchase');

  const rankGate = M.purchase(m, 'class_gravewarden'); // rank 2 required
  ok(rankGate.ok === false && /Grave Vigil/.test(rankGate.error), 'class_gravewarden rejected below rank 2 (names the required rank)');

  m.seals = 10;
  const broke = M.purchase(m, 'boon_soul_well'); // 250
  ok(broke.ok === false && /10/.test(broke.error), 'purchase rejected when seals < cost');
  m.seals = 5000;

  const forged = M.purchase(m, 'class_admin_godmode');
  ok(forged.ok === false && /No such relic/.test(forged.error), 'forged itemId rejected');

  // Stash tabs must be claimed in order: 2 -> 3 -> 4.
  // (tab_3 needs rank 2, so test the ordering rule at rank 2.)
  m.accountXp = 4000;
  const skip = M.purchase(m, 'stash_tab_3');
  ok(skip.ok === false && /Claim Stash Tab 2 first/.test(skip.error), 'stash_tab_3 rejected before stash_tab_2');
  const t2 = M.purchase(m, 'stash_tab_2');
  ok(t2.ok === true && m.stashTabs === 1, 'stash_tab_2 purchased (stashTabs=1)');
  const t3 = M.purchase(m, 'stash_tab_3');
  ok(t3.ok === true && m.stashTabs === 2, 'stash_tab_3 purchased after tab 2 (stashTabs=2)');
  const t2again = M.purchase(m, 'stash_tab_2');
  ok(t2again.ok === false && /already claimed/.test(t2again.error), 'owned stash tab rejected');
  const t4gate = M.purchase(m, 'stash_tab_4'); // rank 3 required
  ok(t4gate.ok === false && /Dread Herald/.test(t4gate.error), 'stash_tab_4 rejected below rank 3');

  // Rank 3 account can finish the vault.
  m.accountXp = 8000;
  const hex = M.purchase(m, 'class_hexblade');
  ok(hex.ok === true, 'class_hexblade purchased at rank 3');
  m.seals = 5000;
  const t4 = M.purchase(m, 'stash_tab_4');
  ok(t4.ok === true && m.stashTabs === 3, 'stash_tab_4 purchased at rank 3');

  // purchase() takes (meta, itemId) only — there is no parameter through
  // which the client could inject XP/seal totals.
  eq(M.purchase.length, 2, 'purchase() signature has no totals parameter');

  // ------------------------------------------------- A. stash capacity hook
  console.log('A. stash capacity');
  eq(M.getStashCapacity({ stashTabs: 0 }).totalSlots, 24, '0 extra tabs -> 24 slots');
  const cap = M.getStashCapacity({ stashTabs: 3 });
  eq(cap.tabs, 4, '3 extra tabs -> 4 tabs');
  eq(cap.totalSlots, 96, '4 tabs * 24 slots = 96');

  // ------------------------------------------------- A. boon loadout
  console.log('A. setActiveBoons');
  let m2 = freshMeta();
  m2.unlockedBoons = ['boon_veterans_grit', 'boon_soul_well', 'boon_swift_covenant'];
  let b1 = M.setActiveBoons(m2, ['boon_veterans_grit', 'boon_soul_well']);
  ok(b1.ok === true && m2.activeBoons.length === 2, 'two owned boons equipped');
  const bBad = M.setActiveBoons(m2, ['boon_blessed_vigor']);
  ok(bBad.ok === false && /not yours/.test(bBad.error), 'unowned boon rejected');
  const b3 = M.setActiveBoons(m2, ['boon_veterans_grit', 'boon_soul_well', 'boon_swift_covenant']);
  ok(b3.ok === true && m2.activeBoons.length === 2, 'loadout truncated to MAX_ACTIVE_BOONS (2)');
  const bType = M.setActiveBoons(m2, 'boon_veterans_grit');
  ok(bType.ok === false, 'non-array loadout rejected');

  // ------------------------------------------------- A. boon effects (real numbers)
  console.log('A. boon effects');
  let m3 = freshMeta();
  m3.unlockedBoons = ['boon_soul_well', 'boon_swift_covenant', 'boon_executioners_edge', 'boon_blessed_vigor'];
  m3.activeBoons = ['boon_soul_well', 'boon_swift_covenant'];
  const p1 = { id: 'p1', stats: { goldCollected: 0 }, speed: 5 };
  const applied1 = M.applyStartBoons({}, p1, { meta: m3 });
  eq(applied1.length, 2, 'two owned active boons applied');
  eq(p1.stats.goldCollected, 120, 'soul_well: +120 starting gold');
  eq(p1.speed, 5.5, 'swift_covenant: speed x1.10');
  // Unowned ids in activeBoons are filtered server-side (never applied).
  m3.activeBoons = ['boon_soul_well', 'boon_veterans_grit'];
  const p2 = { id: 'p2', stats: { goldCollected: 0 }, speed: 5 };
  const applied2 = M.applyStartBoons({}, p2, { meta: m3 });
  eq(applied2.length, 1, 'unowned boon in loadout silently filtered');
  ok(!p2.appliedBoons.includes('boon_veterans_grit'), 'unowned boon not applied');
  const p3 = { id: 'p3', stats: {}, speed: 5, damageBuff: 1 };
  m3.activeBoons = ['boon_executioners_edge'];
  M.applyStartBoons({}, p3, { meta: m3 });
  eq(p3.damageBuff, 1.12, 'executioners_edge: damageBuff x1.12');
  // blessed_vigor runs a real level-up through Progression — must not throw
  // on a sparse player (boons must never break a join).
  const p4 = { id: 'p4', stats: {}, level: 1, xp: 0, nextLevelXp: 100 };
  m3.activeBoons = ['boon_blessed_vigor'];
  let noThrow = true;
  try { M.applyStartBoons({}, p4, { meta: m3 }); } catch (e) { noThrow = false; }
  ok(noThrow, 'blessed_vigor path never throws on join');

  // ------------------------------------------------- A. class gating
  console.log('A. class gating');
  ok(M.classAllowedFor(null, 'juggernaut') === true, 'guest may play juggernaut');
  ok(M.classAllowedFor(null, 'hexblade') === false, 'guest may NOT play a vault class');
  ok(M.classAllowedFor({ meta: { unlockedClasses: [] } }, 'mage') === true, 'base class always allowed');
  const prof = { meta: m }; // m from purchase tests: owns plaguecaller, hexblade
  ok(M.classAllowedFor(prof, 'plaguecaller') === true, 'owned class allowed');
  ok(M.classAllowedFor(prof, 'gravewarden') === false, 'unowned class denied');
  eq(M.validateClassChoice(prof, 'gravewarden'), 'juggernaut', 'locked choice falls back to juggernaut');
  eq(M.validateClassChoice(prof, 'hexblade'), 'hexblade', 'owned choice passes through');
  eq(M.validateClassChoice(null, 'plaguecaller'), 'juggernaut', 'guest locked choice falls back');

  // Server-side stat blocks for the vault classes exist and are sane.
  for (const key of ['plaguecaller', 'gravewarden', 'hexblade']) {
    const cfg = M.EXTRA_CLASS_CONFIGS[key];
    ok(!!cfg && cfg.maxHp > 0 && cfg.speed > 0, `EXTRA_CLASS_CONFIGS has playable ${key}`);
  }
  eq(M.CLASS_ABILITY_FAMILY.plaguecaller, 'necromancer', 'plaguecaller inherits necromancer blessings');
  eq(M.CLASS_ABILITY_FAMILY.gravewarden, 'juggernaut', 'gravewarden inherits juggernaut blessings');
  eq(M.CLASS_ABILITY_FAMILY.hexblade, 'rogue', 'hexblade inherits rogue blessings');
  eq(M.UNLOCKABLES.length, 11, 'vault catalog has 11 unlockables');

  // ------------------------------------------------- A. sanitization
  console.log('A. account-record sanitization');
  const dirty = M.ensureMeta({ meta: { unlockedClasses: ['hexblade', 'forged_class'], unlockedBoons: ['boon_soul_well', 'boon_godmode'], activeBoons: ['boon_godmode', 'boon_soul_well'] } });
  ok(dirty.unlockedClasses.includes('hexblade'), 'legit class id survives');
  ok(!dirty.unlockedClasses.includes('forged_class'), 'forged class id sanitized out');
  ok(!dirty.unlockedBoons.includes('boon_godmode'), 'forged boon id sanitized out');
  ok(!dirty.activeBoons.includes('boon_godmode'), 'forged active boon sanitized out');

  // ------------------------------------------------- A. catalog + public view
  console.log('A. catalogFor / publicMeta');
  const m4 = freshMeta(); // rank 1, 5000 seals
  const cat = M.catalogFor(m4);
  eq(cat.length, 11, 'catalog has 11 entries');
  const pc = cat.find(u => u.id === 'class_plaguecaller');
  ok(pc.rankOk === true && pc.affordable === true && pc.owned === false, 'plaguecaller shown purchasable');
  const hb = cat.find(u => u.id === 'class_hexblade');
  ok(hb.rankOk === false && hb.rankName === 'Dread Herald', 'hexblade rank-gated at rank 1 (shows required rank name)');
  const pub = M.publicMeta(m4);
  eq(pub.rank.index, 1, 'publicMeta carries computed rank');
  eq(pub.stashCapacity.totalSlots, 24, 'publicMeta carries stash capacity');
  eq(pub.maxActiveBoons, 2, 'publicMeta carries boon loadout cap');
  ok(!('password' in pub) && !('token' in pub), 'publicMeta leaks no credentials');

  // ------------------------------------ A. grantRunRewards (mock room, idempotent)
  console.log('A. grantRunRewards');
  const TEST_USER_A = 'w5_mt_user_a';
  authService.register(TEST_USER_A, 'testpass');
  const pa = authService.getProfileByUsername(TEST_USER_A);
  const ma = M.ensureMeta(pa);
  ma.accountXp = 1400; ma.seals = 0; ma.lifetimeRuns = 0; ma.lifetimeVictories = 0;
  const mockRoom = {
    players: {
      s1: { id: 's1', name: 'Tester', isBot: false, accountUsername: TEST_USER_A, stats: { kills: 50 }, secretCompleted: true, isDead: false, isDowned: false },
      s2: { id: 's2', name: 'Bot', isBot: true, accountUsername: null, stats: { kills: 999 } },
      s3: { id: 's3', name: 'Guest', isBot: false, accountUsername: null, stats: { kills: 999 } }
    },
    boss: { isDead: true },
    floor: 3
  };
  const gr = M.grantRunRewards(mockRoom, { victory: true });
  eq(gr.length, 1, 'only the linked human earns (bot + guest skipped)');
  eq(gr[0].accountXpGained, 2600, 'victory grant XP');
  eq(gr[0].sealsGained, 260, 'victory grant seals');
  eq(gr[0].rankUp, true, '1400 + 2600 = 4000 crosses into rank 2 -> rankUp');
  eq(gr[0].rank.name, 'Grave Vigil', 'new rank name in result');
  eq(ma.accountXp, 4000, 'account XP accumulated');
  eq(ma.seals, 260, 'seals accumulated');
  eq(ma.lifetimeRuns, 1, 'lifetimeRuns incremented');
  eq(ma.lifetimeVictories, 1, 'lifetimeVictories incremented');
  const gr2 = M.grantRunRewards(mockRoom, { victory: true });
  eq(gr2.length, 1, 'second call returns the same results');
  eq(ma.accountXp, 4000, 'idempotent: no double XP on re-grant');

  const mockRoomDefeat = {
    players: { s1: { id: 's1', name: 'Tester', isBot: false, accountUsername: TEST_USER_A, stats: { kills: 10 }, secretCompleted: false, isDead: true, isDowned: false } },
    boss: { isDead: false },
    floor: 2
  };
  const gd = M.grantRunRewards(mockRoomDefeat, { victory: false });
  eq(gd[0].accountXpGained, 150, 'defeat grant: 10*3+0+0+2*60 = 150');
  eq(gd[0].victory, false, 'defeat flagged');
  eq(ma.lifetimeRuns, 2, 'defeat still counts as a run');
  eq(ma.lifetimeVictories, 1, 'defeat does not count as victory');

  // ------------------------------------ B. forged totals are never trusted
  console.log('B. client-sent totals are ignored');
  const TEST_USER_B = 'w5_mt_user_b';
  const regB = authService.register(TEST_USER_B, 'testpass');
  ok(regB.ok === true, 'test account registered');
  const mb = M.ensureMeta(authService.getProfileByUsername(TEST_USER_B));
  const forgedSync = authService.updateProfile(regB.token, {
    displayName: 'Legit Name',
    meta: { accountXp: 999999, seals: 999999, unlockedClasses: ['hexblade'] }
  });
  eq(forgedSync.meta.accountXp, 0, 'forged accountXp via /api/auth/sync dropped');
  eq(forgedSync.meta.seals, 0, 'forged seals via /api/auth/sync dropped');
  ok(!forgedSync.meta.unlockedClasses.includes('hexblade'), 'forged unlocks via /api/auth/sync dropped');
  eq(forgedSync.displayName, 'Legit Name', 'whitelisted fields still update');

  // updateProfile is called by the sync endpoint — confirm the endpoint path
  // uses it (no separate meta branch exists).
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');
  ok(!/req\.body\?\.\s*meta|body\.meta/.test(serverSrc), 'server.js has no code path reading client-sent meta');

  // ------------------------------------ C. real Room join-time enforcement
  console.log('C. Room join-time class gating + boon application');
  const Room = require('./server/game/Room');
  const TEST_USER_C = 'w5_mt_user_c';
  const regC = authService.register(TEST_USER_C, 'testpass');
  const room = new Room('W5TEST');
  const sent = [];
  room.broadcast = (msg) => sent.push(msg);

  // Locked class, no unlock -> forced to juggernaut + denial broadcast.
  const pLocked = room.addPlayer('sock1', 'TesterC', 'hexblade', false, null, regC.token);
  eq(pLocked.classKey, 'juggernaut', 'locked class choice forced to juggernaut');
  eq(pLocked.accountUsername, TEST_USER_C, 'account linked from server-side token');
  ok(sent.some(m => m.type === 'class_choice_denied' && m.playerId === 'sock1'), 'class_choice_denied broadcast sent');

  // Base class passes through untouched.
  const pBase = room.addPlayer('sock2', 'TesterC2', 'mage', false, null, regC.token);
  eq(pBase.classKey, 'mage', 'base class choice honored');

  // Guest (no token) can never use a vault class.
  const pGuest = room.addPlayer('sock3', 'GuestC', 'plaguecaller', false, null, null);
  eq(pGuest.classKey, 'juggernaut', 'guest locked choice forced to juggernaut');
  eq(pGuest.accountUsername, null, 'guest has no account link');

  // After a real purchase, the class passes.
  const pc2 = authService.getProfileByUsername(TEST_USER_C);
  const mc = M.ensureMeta(pc2);
  mc.accountXp = 8000; mc.seals = 5000;
  ok(M.purchase(mc, 'class_hexblade').ok === true, 'test account buys hexblade');
  mc.unlockedBoons.push('boon_swift_covenant');
  mc.activeBoons = ['boon_swift_covenant'];
  const pUnlocked = room.addPlayer('sock4', 'TesterC4', 'hexblade', false, null, regC.token);
  eq(pUnlocked.classKey, 'hexblade', 'purchased class honored at join');
  eq(pUnlocked.speed, +(pUnlocked.speed).toFixed(2), 'boon applied without breaking join');
  ok(pUnlocked.appliedBoons && pUnlocked.appliedBoons.includes('boon_swift_covenant'), 'active boon applied from server record at join');
  ok(sent.some(m => m.type === 'floating_text' && /COVENANT BOONS/.test(m.text)), 'boon application announced');

  // A forged client profile blob cannot grant a locked class (server record wins).
  const pForged = room.addPlayer('sock5', 'Forged', 'gravewarden', false, { unlockedClasses: ['gravewarden'] }, regC.token);
  eq(pForged.classKey, 'juggernaut', 'client-sent profile unlocks are ignored');

  // ------------------------------------ D. atomic persistence + restart reload
  console.log('D. atomic persistence across restart');
  const TEST_USER_D = 'w5_mt_user_d';
  const regD = authService.register(TEST_USER_D, 'testpass');
  const pd = authService.getProfileByUsername(TEST_USER_D);
  const md = M.ensureMeta(pd);
  md.accountXp = 2000; md.seals = 5000;
  ok(M.purchase(md, 'class_plaguecaller').ok === true, 'persist test: buy plaguecaller');
  ok(M.purchase(md, 'boon_soul_well').ok === true, 'persist test: buy soul_well');
  M.setActiveBoons(md, ['boon_soul_well']);
  const dRoom = {
    players: { s1: { id: 's1', name: 'Persist', isBot: false, accountUsername: TEST_USER_D, stats: { kills: 20 }, secretCompleted: false, isDead: false, isDowned: false } },
    boss: { isDead: false },
    floor: 1
  };
  M.grantRunRewards(dRoom, { victory: true }); // 20*6+0+0+150+500+100 = 870 XP, 87 seals
  authService.saveAccounts();

  // The on-disk file must reflect the in-memory record (atomic write done).
  const onDisk = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const diskMeta = onDisk[TEST_USER_D].profile.meta;
  eq(diskMeta.accountXp, 2870, 'disk: accountXp persisted (2000+870)');
  eq(diskMeta.seals, 5000 - 800 - 250 + 87, 'disk: seals persisted after purchase + grant');
  ok(diskMeta.unlockedClasses.includes('plaguecaller'), 'disk: class unlock persisted');
  ok(diskMeta.activeBoons.includes('boon_soul_well'), 'disk: boon loadout persisted');
  eq(diskMeta.lifetimeRuns, 1, 'disk: lifetimeRuns persisted');

  // Simulate a full server restart: drop the modules, re-require, reload.
  for (const k of Object.keys(require.cache)) {
    if (k.includes('authService') || k.includes('MetaProgression')) delete require.cache[k];
  }
  const authAfter = require('./server/authService');
  const pdAfter = authAfter.getProfileByUsername(TEST_USER_D);
  const mdAfter = pdAfter && pdAfter.meta;
  eq(mdAfter && mdAfter.accountXp, 2870, 'restart: accountXp reloaded from disk');
  eq(mdAfter && mdAfter.seals, 5000 - 800 - 250 + 87, 'restart: seals reloaded from disk');
  ok(mdAfter && mdAfter.unlockedClasses.includes('plaguecaller'), 'restart: unlocks reloaded');
  ok(mdAfter && mdAfter.activeBoons.includes('boon_soul_well'), 'restart: boon loadout reloaded');
  const M2 = require('./server/game/systems/MetaProgression');
  eq(M2.rankForXp(mdAfter.accountXp).index, 1, 'restart: rank recomputed from persisted XP');

  // Atomicity: saveAccounts writes temp + rename, never a partial file.
  const authSrc = fs.readFileSync(path.join(ROOT, 'server/authService.js'), 'utf8');
  ok(authSrc.includes('renameSync') && /\.tmp/.test(authSrc), 'saveAccounts uses temp-file + atomic rename');
} finally {
  fs.writeFileSync(DATA_FILE, BACKUP);
  console.log('(accounts.json restored from backup)');
}

console.log(`\nmeta-progression: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
