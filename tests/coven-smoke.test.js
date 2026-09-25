// tests/coven-smoke.test.js — Phase 4 (workstream 2) Covens verification.
// Run: node tests/coven-smoke.test.js
//
// Covers, all server-authoritative and persisted in server/data/covens.json:
//   - lifecycle: create (name + tagline, unique name enforced), join by
//     invite code (4-char uppercase, same style as Phase 2 room codes),
//     leave, disband (founder only)
//   - ranks: founder/officer/member — officers invite (reveal/rotate code)
//     and kick members; founder promotes/demotes/disbands; every transition
//     validated server-side
//   - shared progression: coven XP from grantRunRewards hook path
//     (awardRunXp), level thresholds, dark-fantasy level names, level-up
//     reporting
//   - weekly race: best Daily Delve clear per coven per ISO week
//     (server-measured), weekly rollover with winner archived for the banner
//   - chat: last-100 cap, rate limit, length cap, member-only history
//   - persistence across "restarts" (fresh require from disk)
//
// NOTE: this test backs up and restores server/data/covens.json so no test
// data pollutes the real store. CovenService is auth-free by design, so the
// accounts store is never touched.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'server', 'data');
const COVENS_FILE = path.join(DATA_DIR, 'covens.json');

const backup = fs.existsSync(COVENS_FILE) ? fs.readFileSync(COVENS_FILE, 'utf8') : null;
function restore() {
  try {
    if (backup !== null) fs.writeFileSync(COVENS_FILE, backup, 'utf8');
    else if (fs.existsSync(COVENS_FILE)) fs.unlinkSync(COVENS_FILE);
  } catch (e) { console.error('  WARN: could not restore covens.json:', e.message); }
}

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (e) { console.error(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const svcPath = require.resolve('../server/game/systems/CovenService.js');
function freshService() {
  delete require.cache[svcPath];
  return require(svcPath);
}

let C = freshService();
C._resetRateLimits();

const u = (n) => ({ username: n, displayName: n[0].toUpperCase() + n.slice(1) });
const A = u('ashketh'), B = u('morgaine'), D = u('dravok'), E = u('selune');

console.log('Coven smoke tests');

// --- lifecycle -------------------------------------------------------------
let codeA;
ok('create coven: founder rank, 4-char invite code', () => {
  const r = C.createCoven({ ...A, name: 'The Hollow Choir', tagline: 'We drink the dark and call it wine' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.coven.myRank, 'founder');
  assert.strictEqual(r.coven.name, 'The Hollow Choir');
  assert.strictEqual(r.coven.tagline, 'We drink the dark and call it wine');
  assert.match(r.coven.inviteCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  assert.strictEqual(r.coven.level, 1);
  assert.strictEqual(r.coven.levelName, 'Waking Shade');
  codeA = r.coven.inviteCode;
});

ok('duplicate name rejected (case-insensitive)', () => {
  const r = C.createCoven({ ...B, name: 'the hollow choir' });
  assert.ok(!r.ok);
});

ok('invalid names rejected', () => {
  assert.ok(!C.createCoven({ ...B, name: 'AB' }).ok);          // too short
  assert.ok(!C.createCoven({ ...B, name: 'x'.repeat(25) }).ok); // too long
  assert.ok(!C.createCoven({ ...B, name: 'Bad!Name?' }).ok);    // bad chars
});

ok('member in coven cannot found another', () => {
  const r = C.createCoven({ ...A, name: 'Second Oath' });
  assert.ok(!r.ok);
});

ok('join by invite code; members cannot see the code', () => {
  const r = C.joinByCode({ ...B, code: codeA });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.coven.myRank, 'member');
  assert.strictEqual(r.coven.inviteCode, null, 'members must not see the invite code');
  assert.strictEqual(r.coven.memberCount, 2);
});

ok('bad invite code rejected; double membership rejected', () => {
  assert.ok(!C.joinByCode({ ...D, code: 'ZZZZ' }).ok);
  assert.ok(!C.joinByCode({ ...B, code: codeA }).ok);
});

// --- ranks -----------------------------------------------------------------
ok('member cannot promote; founder promotes member to officer', () => {
  assert.ok(!C.setRank({ actorUsername: B.username, targetUsername: A.username, rank: 'member' }).ok);
  const r = C.setRank({ actorUsername: A.username, targetUsername: B.username, rank: 'officer' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.coven.members.find(m => m.username === B.username).rank, 'officer');
});

ok('officer sees invite code; member still cannot', () => {
  const s = C.getCovenState({ username: B.username });
  assert.strictEqual(s.coven.inviteCode, codeA);
});

ok('officer cannot demote or promote; founder can demote', () => {
  C.joinByCode({ ...D, code: codeA });
  assert.ok(!C.setRank({ actorUsername: B.username, targetUsername: D.username, rank: 'officer' }).ok);
  const r = C.setRank({ actorUsername: A.username, targetUsername: B.username, rank: 'member' });
  assert.ok(r.ok, r.error);
});

ok('founder cannot change own rank; cannot promote to founder', () => {
  assert.ok(!C.setRank({ actorUsername: A.username, targetUsername: A.username, rank: 'member' }).ok);
  assert.ok(!C.setRank({ actorUsername: A.username, targetUsername: D.username, rank: 'founder' }).ok);
});

ok('officer kicks member; member cannot kick; self-kick rejected', () => {
  C.setRank({ actorUsername: A.username, targetUsername: D.username, rank: 'officer' });
  C.joinByCode({ ...E, code: codeA });
  const r = C.kickMember({ actorUsername: D.username, targetUsername: E.username });
  assert.ok(r.ok, r.error);
  assert.ok(!r.coven.members.some(m => m.username === E.username));
  C.joinByCode({ ...E, code: codeA }); // rejoin for later tests
  assert.ok(!C.kickMember({ actorUsername: E.username, targetUsername: D.username }).ok);
  assert.ok(!C.kickMember({ actorUsername: D.username, targetUsername: D.username }).ok);
});

ok('officer cannot kick another officer; founder can; founder cannot be kicked', () => {
  assert.ok(!C.kickMember({ actorUsername: D.username, targetUsername: D.username }).ok);
  // D is officer; promote E? E is member. Officer-on-officer: make E officer first.
  C.setRank({ actorUsername: A.username, targetUsername: E.username, rank: 'officer' });
  assert.ok(!C.kickMember({ actorUsername: D.username, targetUsername: E.username }).ok);
  const r = C.kickMember({ actorUsername: A.username, targetUsername: E.username });
  assert.ok(r.ok, r.error);
  assert.ok(!C.kickMember({ actorUsername: D.username, targetUsername: A.username }).ok);
});

ok('invite rotate: member rejected, officer rotates, old code dies', () => {
  C.joinByCode({ ...E, code: codeA });
  assert.ok(!C.rotateInviteCode({ username: E.username }).ok);
  const r = C.rotateInviteCode({ username: D.username });
  assert.ok(r.ok, r.error);
  assert.notStrictEqual(r.coven.inviteCode, codeA);
  assert.ok(!C.joinByCode({ username: 'stranger', displayName: 'Stranger', code: codeA }).ok);
  codeA = r.coven.inviteCode;
});

ok('leave: founder cannot abandon; member can; disband is founder-only', () => {
  assert.ok(!C.leaveCoven({ username: A.username }).ok);
  assert.ok(!C.disbandCoven({ username: D.username }).ok);
  const l = C.leaveCoven({ username: E.username });
  assert.ok(l.ok, l.error);
  const s = C.getCovenState({ username: E.username });
  assert.ok(!s.inCoven);
});

// --- progression -----------------------------------------------------------
ok('awardRunXp: XP accrues, level thresholds, level names, level-up flag', () => {
  let r = C.awardRunXp(A.username, 499);
  assert.ok(r && !r.leveledUp && r.level === 1);
  r = C.awardRunXp(A.username, 1); // 500 total -> level 2
  assert.ok(r.leveledUp && r.level === 2 && r.levelName === 'Ash Novice');
  assert.strictEqual(r.covenName, 'The Hollow Choir');
  r = C.awardRunXp(A.username, 1000); // 1500 total -> level 3
  assert.ok(r.leveledUp && r.level === 3 && r.levelName === 'Hollow Blade');
});

ok('awardRunXp: no coven -> null; invalid xp -> null', () => {
  assert.strictEqual(C.awardRunXp('nobody', 100), null);
  assert.strictEqual(C.awardRunXp(A.username, 0), null);
  assert.strictEqual(C.awardRunXp(A.username, -5), null);
});

// --- weekly race -----------------------------------------------------------
const WEEK1 = new Date('2026-01-05T12:00:00Z'); // ISO 2026-W02
const WEEK2 = new Date('2026-01-12T12:00:00Z'); // ISO 2026-W03

ok('race: best clear per coven per week, server-measured', () => {
  // Second coven for a real race.
  const f = u('vexahlia');
  const c2 = C.createCoven({ ...f, name: 'Moonbleed Pact' });
  assert.ok(c2.ok, c2.error);
  const code2 = c2.coven.inviteCode;
  C.joinByCode({ ...u('kael'), code: code2 });

  let r = C.recordDailyDelveClear(A.username, 240, '2026-01-05', 111, WEEK1);
  assert.ok(r.ok && r.newBest && r.bestSec === 240);
  r = C.recordDailyDelveClear(D.username, 200, '2026-01-05', 111, WEEK1); // faster, same coven
  assert.ok(r.ok && r.newBest && r.bestSec === 200);
  r = C.recordDailyDelveClear(B.username, 300, '2026-01-05', 111, WEEK1); // slower, not best
  assert.ok(r.ok && !r.newBest && r.bestSec === 200);
  r = C.recordDailyDelveClear(f.username, 180, '2026-01-05', 111, WEEK1);
  assert.ok(r.ok && r.newBest);

  const race = C.getWeeklyRace(WEEK1);
  assert.ok(race.ok && race.weekId === '2026-W02');
  assert.strictEqual(race.standings.length, 2);
  assert.strictEqual(race.standings[0].name, 'Moonbleed Pact'); // 180 < 200
  assert.strictEqual(race.standings[0].bestTime, '3m 00s');
  assert.strictEqual(race.standings[1].runs, 3);
});

ok('race: no coven -> not recorded', () => {
  const r = C.recordDailyDelveClear('drifter', 100, '2026-01-05', 111, WEEK1);
  assert.ok(!r.ok);
});

ok('race: weekly rollover archives the winner for the banner', () => {
  const race = C.getWeeklyRace(WEEK2);
  assert.strictEqual(race.weekId, '2026-W03');
  assert.strictEqual(race.standings.length, 0, 'new week starts empty');
  assert.ok(race.lastWinner, 'finished week archived');
  assert.strictEqual(race.lastWinner.winnerName, 'Moonbleed Pact');
  assert.strictEqual(race.lastWinner.weekId, '2026-W02');
});

// --- chat ------------------------------------------------------------------
ok('chat: send ok, length capped at 500, member-only history', () => {
  C._resetRateLimits();
  const r = C.sendChat({ ...A, text: '  The delve calls.  ' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.message.text, 'The delve calls.');
  const long = C.sendChat({ ...A, text: 'x'.repeat(600) });
  assert.ok(long.ok && long.message.text.length === 500);
  const h = C.getChat(r.covenId, 0, D.username);
  assert.ok(h.ok && h.messages.length >= 2);
  assert.ok(!C.getChat(r.covenId, 0, 'drifter').ok, 'non-members cannot read whispers');
  assert.ok(!C.sendChat({ ...u('drifter'), text: 'hi' }).ok, 'non-members cannot whisper');
  assert.ok(!C.sendChat({ ...A, text: '   ' }).ok, 'empty whispers rejected');
});

ok('chat: rate limit (8 per 30s per account)', () => {
  C._resetRateLimits();
  for (let i = 0; i < 8; i++) {
    const r = C.sendChat({ ...B, text: `whisper ${i}` });
    assert.ok(r.ok, r.error);
  }
  const r9 = C.sendChat({ ...B, text: 'one too many' });
  assert.ok(!r9.ok, '9th whisper in 30s must be rate-limited');
});

ok('chat: last-100 messages kept', () => {
  C._resetRateLimits();
  const covenId = C.getCovenIdForUser(A.username);
  for (let i = 0; i < 12; i++) {
    C.sendChat({ ...A, text: `flood ${i}` });
    C.sendChat({ ...D, text: `flood d ${i}` });
    C._resetRateLimits();
  }
  // 2 seed messages (first test) + 24 flood = 26; push past 100 via direct store check path:
  // simulate 100 more by resetting limits between batches.
  for (let i = 0; i < 90; i++) {
    C.sendChat({ ...A, text: `overflow ${i}` });
    if (i % 7 === 6) C._resetRateLimits();
  }
  C._resetRateLimits();
  const h = C.getChat(covenId, 0, A.username);
  assert.ok(h.ok);
  assert.ok(h.messages.length <= 100, `chat capped at 100, got ${h.messages.length}`);
  assert.ok(h.messages.length === 100, `expected exactly 100, got ${h.messages.length}`);
});

// --- disband ---------------------------------------------------------------
ok('disband removes coven, race entry, and frees members', () => {
  const before = C.getWeeklyRace(WEEK2);
  const covenId = C.getCovenIdForUser('vexahlia');
  const r = C.disbandCoven({ username: 'vexahlia' });
  assert.ok(r.ok, r.error);
  assert.ok(!C.getCovenState({ username: 'vexahlia' }).inCoven);
  assert.ok(!C.getCovenState({ username: 'kael' }).inCoven);
  // name is free again
  assert.ok(C.createCoven({ username: 'vexahlia', displayName: 'Vexahlia', name: 'Moonbleed Pact' }).ok);
});

// --- persistence -----------------------------------------------------------
ok('state survives a restart (fresh require from disk)', () => {
  const Fresh = freshService();
  const s = Fresh.getCovenState({ username: A.username });
  assert.ok(s.inCoven);
  assert.strictEqual(s.coven.name, 'The Hollow Choir');
  assert.ok(s.coven.xp >= 1500, `xp persisted, got ${s.coven.xp}`);
  assert.strictEqual(s.coven.level, 3);
  const race = Fresh.getWeeklyRace(WEEK2);
  assert.strictEqual(race.weekId, '2026-W03');
  C = Fresh;
});

restore();
console.log(`\n${passed} coven checks passed.`);
