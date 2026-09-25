// server/game/systems/CovenService.js — PHASE 4 (workstream 2): Covens.
//
// Server-authoritative coven (player fellowship) lifecycle, persisted in
// server/data/covens.json so everything survives restarts:
//
//   - Lifecycle: create (name + dark tagline, unique name enforced), join by
//     invite code (same 4-char uppercase style as the Phase 2 room-code
//     system), leave, disband (founder only).
//   - Member ranks: founder / officer / member. Officers can invite (reveal
//     and rotate the invite code) and kick members; the founder can
//     promote/demote officers and disband. Every rank change is validated
//     server-side.
//   - Shared coven progression: coven XP accrues from member completed runs
//     (hooked into MetaProgression.grantRunRewards). Coven levels carry
//     dark-fantasy names. Level-ups are reported back to the caller.
//   - Coven-vs-coven weekly race: covens compete on the Daily Delve seeded
//     dungeon (SeasonService.getDailyDelve / dailySeedFor, Leaderboards'
//     weekly keying reused). Scoring: best clear time per coven per week,
//     server-measured (Room's victory handler passes the measured
//     durationSec). The week rolls over automatically; the finished week's
//     winner is archived for the banner.
//   - Coven chat: minimal persistent-message channel — the server stores the
//     last 100 messages per coven, rate-limits sends, and caps message
//     length. Live delivery rides the websocket subscriber map in
//     server/server.js; history is served over HTTP.
//
// Thematic naming throughout: covens, rites, oaths. Never "guild"/"clan".
//
// This module is auth-free on purpose: callers resolve the account (via
// authService.getAccountByToken) and pass { username, displayName } in, so
// the service stays unit-testable without the auth store.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const COVENS_FILE = path.join(DATA_DIR, 'covens.json');

// Invite codes use the same style as the Phase 2 room-code system:
// 4 uppercase chars, unambiguous alphabet (no I/O/0/1).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 4;

const RANKS = { FOUNDER: 'founder', OFFICER: 'officer', MEMBER: 'member' };
const RANK_ORDER = { founder: 3, officer: 2, member: 1 };

// Name rules: 3-24 chars, letters/numbers/spaces/apostrophes/hyphens.
// Uniqueness is enforced case-insensitively on the trimmed name.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-]{1,22}[A-Za-z0-9]$/;
const MAX_TAGLINE = 80;
const MAX_CHAT_LEN = 500;
const CHAT_HISTORY_CAP = 100;
const RACE_HISTORY_CAP = 8;

// Chat rate limit: 8 sends per 30 seconds per account (in-memory only).
const CHAT_WINDOW_MS = 30 * 1000;
const CHAT_MAX_PER_WINDOW = 8;
const chatTimestamps = new Map(); // username -> [ms, ...]

// ---------------------------------------------------------------------------
// Coven levels — dark-fantasy names per level. Level L requires
// 500 * L * (L - 1) / 2 total XP (L=2 needs 500, L=3 needs 1500, ...).
// ---------------------------------------------------------------------------
const LEVEL_NAMES = [
  'Waking Shade',        // 1
  'Ash Novice',          // 2
  'Hollow Blade',        // 3
  'Veil Warden',         // 4
  'Grave Cantor',        // 5
  'Blood Rite Bound',    // 6
  'Nightwarden',         // 7
  'Doom Herald',         // 8
  'Umbral Knight',       // 9
  'Pale Reaver',         // 10
  'Voidsworn',           // 11
  'Thorn Regent',        // 12
  'Soul Tithe Warden',   // 13
  'Dread Covenant',      // 14
  'Moonbleed Order',     // 15
  'Iron Requiem',        // 16
  'Silent Choir',        // 17
  'Obsidian Throne',     // 18
  'Eclipse Sovereign',   // 19
  'God-Eater Pact'       // 20
];

function xpForLevel(level) {
  const L = Math.max(1, Math.floor(level));
  return 500 * L * (L - 1) / 2;
}

function levelForXp(xp) {
  const x = Math.max(0, Math.floor(xp || 0));
  let level = 1;
  while (level < 200 && xpForLevel(level + 1) <= x) level++;
  return level;
}

function levelNameFor(level) {
  if (level <= LEVEL_NAMES.length) return LEVEL_NAMES[level - 1];
  return `Mythic Tier ${level}`;
}

// ---------------------------------------------------------------------------
// Persistence (atomic write, same pattern as SeasonService)
// ---------------------------------------------------------------------------
function _blankStore() {
  return { covens: {}, race: { weekId: null, entries: {}, history: [] } };
}

function _load() {
  try {
    if (fs.existsSync(COVENS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(COVENS_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        if (!raw.covens || typeof raw.covens !== 'object') raw.covens = {};
        if (!raw.race || typeof raw.race !== 'object') raw.race = { weekId: null, entries: {}, history: [] };
        if (!raw.race.entries || typeof raw.race.entries !== 'object') raw.race.entries = {};
        if (!Array.isArray(raw.race.history)) raw.race.history = [];
        return raw;
      }
    }
  } catch (e) {
    console.warn('[CovenService] Could not read coven store:', e.message);
  }
  return _blankStore();
}

function _save(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${COVENS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, COVENS_FILE); // atomic on POSIX
  } catch (e) {
    console.error('[CovenService] Failed to persist coven store:', e.message);
  }
}

// In-memory store; every mutation saves. Reads also go through the store so
// other processes' writes (tests) are picked up on the next fresh require.
let store = _load();
function _reload() { store = _load(); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _normUsername(u) { return String(u || '').trim().toLowerCase(); }
function _normName(n) { return String(n || '').trim(); }
function _normCode(c) { return String(c || '').toUpperCase().trim(); }

function _generateCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }
    const taken = Object.values(store.covens).some(c => c.inviteCode === code);
    if (!taken) return code;
  }
  // Practically unreachable (31^4 space), but never loop forever.
  return `${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

function _findByUsername(username) {
  const uname = _normUsername(username);
  for (const coven of Object.values(store.covens)) {
    if (coven.members && coven.members[uname]) return coven;
  }
  return null;
}

function _nameTaken(name, exceptId = null) {
  const key = _normName(name).toLowerCase();
  return Object.values(store.covens).some(c => c.id !== exceptId && _normName(c.name).toLowerCase() === key);
}

function _newCovenId() {
  return `cv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _cleanTagline(t) {
  let s = String(t || '').trim().replace(/\s+/g, ' ');
  if (s.length > MAX_TAGLINE) s = s.slice(0, MAX_TAGLINE);
  return s;
}

function _fail(error) { return { ok: false, error }; }

// Public, client-safe view of a coven. The invite code is revealed only to
// officers and the founder — members see the roster, never the code.
function publicCoven(coven, viewerUsername) {
  if (!coven) return null;
  const uname = _normUsername(viewerUsername);
  const me = coven.members[uname];
  const myRank = me ? me.rank : null;
  const canSeeCode = myRank === RANKS.FOUNDER || myRank === RANKS.OFFICER;
  const members = Object.values(coven.members || {})
    .map(m => ({ username: m.username, displayName: m.displayName, rank: m.rank, joinedAt: m.joinedAt }))
    .sort((a, b) => (RANK_ORDER[b.rank] - RANK_ORDER[a.rank]) || a.displayName.localeCompare(b.displayName));
  const xp = Math.max(0, Math.floor(coven.xp || 0));
  const level = levelForXp(xp);
  const levelFloor = xpForLevel(level);
  const levelCeil = xpForLevel(level + 1);
  return {
    id: coven.id,
    name: coven.name,
    tagline: coven.tagline || '',
    founder: coven.founder,
    createdAt: coven.createdAt,
    members,
    memberCount: members.length,
    myRank,
    inviteCode: canSeeCode ? coven.inviteCode : null,
    canInvite: canSeeCode,
    xp,
    level,
    levelName: levelNameFor(level),
    xpIntoLevel: xp - levelFloor,
    xpForNextLevel: levelCeil - levelFloor
  };
}

// ---------------------------------------------------------------------------
// Weekly race rollover (lazy, same pattern as SeasonService). The week key
// is the ISO week id (YYYY-Www), matching the shared leaderboard schema.
// ---------------------------------------------------------------------------
function _weekId(now) {
  try {
    const SeasonService = require('./SeasonService');
    return SeasonService.weekIdFor(now || new Date());
  } catch (e) {
    // Fallback: compute ISO week locally if SeasonService is unavailable.
    const d = now ? new Date(now) : new Date();
    const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = u.getUTCDay() || 7;
    u.setUTCDate(u.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((u - yearStart) / 86400000) + 1) / 7);
    return `${u.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
}

// Close the finished week (if any) and archive its winner. Returns the race
// block; callers pass an optional `now` for testability.
function _ensureRaceWeek(now) {
  const wid = _weekId(now);
  if (store.race.weekId === wid) return store.race;
  // Archive the finished week.
  if (store.race.weekId && store.race.entries && Object.keys(store.race.entries).length > 0) {
    const entries = Object.entries(store.race.entries);
    entries.sort((a, b) => a[1].bestSec - b[1].bestSec);
    const [winnerId, win] = entries[0];
    const wc = store.covens[winnerId];
    store.race.history.unshift({
      weekId: store.race.weekId,
      winnerCovenId: winnerId,
      winnerName: (wc && wc.name) || win.covenName || 'A fallen coven',
      bestSec: win.bestSec,
      date: win.date,
      by: win.by || null
    });
    store.race.history = store.race.history.slice(0, RACE_HISTORY_CAP);
  }
  store.race = { weekId: wid, entries: {}, history: store.race.history || [] };
  _save(store);
  return store.race;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function createCoven({ username, displayName, name, tagline } = {}) {
  _reload();
  const uname = _normUsername(username);
  if (!uname) return _fail('not_logged_in');
  const cleanName = _normName(name);
  if (!cleanName || !NAME_RE.test(cleanName)) {
    return _fail('A coven name must be 3-24 characters: letters, numbers, spaces, apostrophes, hyphens.');
  }
  if (_findByUsername(uname)) return _fail('You already belong to a coven. Leave it before founding a new one.');
  if (_nameTaken(cleanName)) return _fail(`The name "${cleanName}" is already sworn to another coven.`);
  const now = new Date().toISOString();
  const id = _newCovenId();
  const disp = String(displayName || username || 'Nameless').trim() || 'Nameless';
  const coven = {
    id,
    name: cleanName,
    tagline: _cleanTagline(tagline),
    inviteCode: _generateCode(),
    founder: uname,
    createdAt: now,
    xp: 0,
    chat: [],
    members: {
      [uname]: { username: uname, displayName: disp, rank: RANKS.FOUNDER, joinedAt: now }
    }
  };
  store.covens[id] = coven;
  _save(store);
  return { ok: true, coven: publicCoven(coven, uname) };
}

function joinByCode({ username, displayName, code } = {}) {
  _reload();
  const uname = _normUsername(username);
  if (!uname) return _fail('not_logged_in');
  if (_findByUsername(uname)) return _fail('You already belong to a coven. Leave it before joining another.');
  const clean = _normCode(code);
  if (!clean) return _fail('Speak the invite rite: enter the coven\'s invite code.');
  const coven = Object.values(store.covens).find(c => c.inviteCode === clean);
  if (!coven) return _fail('No coven answers to that invite code.');
  const disp = String(displayName || username || 'Nameless').trim() || 'Nameless';
  coven.members[uname] = { username: uname, displayName: disp, rank: RANKS.MEMBER, joinedAt: new Date().toISOString() };
  _save(store);
  return { ok: true, coven: publicCoven(coven, uname) };
}

function leaveCoven({ username } = {}) {
  _reload();
  const uname = _normUsername(username);
  if (!uname) return _fail('not_logged_in');
  const coven = _findByUsername(uname);
  if (!coven) return _fail('You belong to no coven.');
  const me = coven.members[uname];
  if (me.rank === RANKS.FOUNDER) {
    return _fail('A founder cannot abandon the coven. Promote a successor, or disband the rite.');
  }
  delete coven.members[uname];
  _save(store);
  return { ok: true, left: coven.id, covenName: coven.name };
}

function disbandCoven({ username } = {}) {
  _reload();
  const uname = _normUsername(username);
  if (!uname) return _fail('not_logged_in');
  const coven = _findByUsername(uname);
  if (!coven) return _fail('You belong to no coven.');
  if (coven.members[uname].rank !== RANKS.FOUNDER) {
    return _fail('Only the founder may disband the coven.');
  }
  delete store.covens[coven.id];
  if (store.race.entries[coven.id]) delete store.race.entries[coven.id];
  _save(store);
  return { ok: true, disbanded: coven.id, covenName: coven.name };
}

// ---------------------------------------------------------------------------
// Ranks — every transition validated server-side.
// ---------------------------------------------------------------------------
function _actorAndTarget(actorUsername, targetUsername) {
  const actor = _normUsername(actorUsername);
  const target = _normUsername(targetUsername);
  if (!actor) return { error: 'not_logged_in' };
  if (!target) return { error: 'Name the coven-brother or sister you mean.' };
  const coven = _findByUsername(actor);
  if (!coven) return { error: 'You belong to no coven.' };
  if (!coven.members[target]) return { error: 'That soul is not of your coven.' };
  return { coven, actor, target };
}

// Promote member->officer or demote officer->member. Founder only; the
// founder's own rank is immutable through this path.
function setRank({ actorUsername, targetUsername, rank } = {}) {
  _reload();
  const ctx = _actorAndTarget(actorUsername, targetUsername);
  if (ctx.error) return _fail(ctx.error);
  const { coven, actor, target } = ctx;
  const want = String(rank || '').toLowerCase();
  if (want !== RANKS.OFFICER && want !== RANKS.MEMBER) {
    return _fail('Rank must be officer or member. The founder\'s seat is not granted by rite.');
  }
  if (coven.members[actor].rank !== RANKS.FOUNDER) return _fail('Only the founder may raise or lower a rank.');
  if (actor === target) return _fail('The founder cannot change their own rank.');
  const cur = coven.members[target].rank;
  if (cur === RANKS.FOUNDER) return _fail('The founder\'s seat is not granted by rite.');
  if (cur === want) return _fail('That rank is already sworn.');
  coven.members[target].rank = want;
  _save(store);
  return { ok: true, coven: publicCoven(coven, actor) };
}

// Officers may kick members; the founder may kick officers and members.
// Nobody may kick the founder, and nobody may kick themselves.
function kickMember({ actorUsername, targetUsername } = {}) {
  _reload();
  const ctx = _actorAndTarget(actorUsername, targetUsername);
  if (ctx.error) return _fail(ctx.error);
  const { coven, actor, target } = ctx;
  const actorRank = coven.members[actor].rank;
  const targetRank = coven.members[target].rank;
  if (actor === target) return _fail('You cannot exile yourself. Leave the coven instead.');
  if (targetRank === RANKS.FOUNDER) return _fail('The founder cannot be exiled.');
  if (actorRank === RANKS.MEMBER) return _fail('Only officers and the founder may exile.');
  if (actorRank === RANKS.OFFICER && targetRank === RANKS.OFFICER) {
    return _fail('An officer cannot exile another officer. The founder must judge.');
  }
  delete coven.members[target];
  _save(store);
  return { ok: true, coven: publicCoven(coven, actor) };
}

// Officers and the founder may rotate the invite code (the invite rite).
function rotateInviteCode({ username } = {}) {
  _reload();
  const uname = _normUsername(username);
  if (!uname) return _fail('not_logged_in');
  const coven = _findByUsername(uname);
  if (!coven) return _fail('You belong to no coven.');
  const rank = coven.members[uname].rank;
  if (rank !== RANKS.FOUNDER && rank !== RANKS.OFFICER) {
    return _fail('Only officers and the founder may speak a new invite rite.');
  }
  coven.inviteCode = _generateCode();
  _save(store);
  return { ok: true, coven: publicCoven(coven, uname) };
}

// ---------------------------------------------------------------------------
// Shared progression — called from MetaProgression.grantRunRewards with the
// server-computed account XP for each linked human at run end.
// ---------------------------------------------------------------------------
function awardRunXp(username, xp, { victory = false } = {}) {
  const uname = _normUsername(username);
  if (!uname) return null;
  _reload();
  const coven = _findByUsername(uname);
  if (!coven) return null;
  const gain = Math.max(0, Math.floor(Number(xp) || 0));
  if (gain <= 0) return null;
  const oldLevel = levelForXp(coven.xp || 0);
  coven.xp = Math.max(0, Math.floor(coven.xp || 0)) + gain;
  const newLevel = levelForXp(coven.xp);
  _save(store);
  const leveledUp = newLevel > oldLevel;
  return {
    ok: true,
    covenId: coven.id,
    covenName: coven.name,
    xpGained: gain,
    xp: coven.xp,
    level: newLevel,
    levelName: levelNameFor(newLevel),
    leveledUp,
    victory: !!victory
  };
}

// ---------------------------------------------------------------------------
// Weekly race — best Daily Delve clear time per coven per ISO week.
// Called from Room's daily-delve victory handler with the server-measured
// durationSec. Lazy weekly rollover; the finished week's winner is archived
// for the banner.
// ---------------------------------------------------------------------------
function recordDailyDelveClear(username, clearTimeSec, date, seed, now) {
  const uname = _normUsername(username);
  const secs = Math.max(1, Math.floor(Number(clearTimeSec) || 0));
  if (!uname || !secs) return { ok: false, error: 'invalid' };
  _reload();
  const coven = _findByUsername(uname);
  if (!coven) return { ok: false, error: 'no_coven' };
  const race = _ensureRaceWeek(now);
  const prev = race.entries[coven.id];
  const isBest = !prev || secs < prev.bestSec;
  race.entries[coven.id] = {
    bestSec: isBest ? secs : prev.bestSec,
    date: isBest ? (date || null) : prev.date,
    seed: isBest ? (seed != null ? seed : null) : prev.seed,
    by: isBest ? uname : prev.by,
    covenName: coven.name,
    runs: (prev ? prev.runs : 0) + 1,
    memberCount: Object.keys(coven.members || {}).length
  };
  _save(store);
  return { ok: true, recorded: true, newBest: isBest, covenId: coven.id, bestSec: race.entries[coven.id].bestSec };
}

function formatRaceTime(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Client-safe weekly standings. Public: any logged-in player may view the
// rite war — glory is meant to be seen.
function getWeeklyRace(now) {
  _reload();
  const race = _ensureRaceWeek(now);
  const standings = Object.entries(race.entries)
    .map(([covenId, e]) => {
      const live = store.covens[covenId];
      return {
        covenId,
        name: (live && live.name) || e.covenName || 'Fallen coven',
        bestSec: e.bestSec,
        bestTime: formatRaceTime(e.bestSec),
        date: e.date,
        runs: e.runs,
        memberCount: (live && Object.keys(live.members || {}).length) || e.memberCount || 0
      };
    })
    .sort((a, b) => a.bestSec - b.bestSec)
    .map((s, i) => ({ ...s, rank: i + 1 }));
  return {
    ok: true,
    weekId: race.weekId,
    standings,
    lastWinner: (race.history && race.history[0]) || null,
    history: (race.history || []).slice(0, RACE_HISTORY_CAP)
  };
}

// ---------------------------------------------------------------------------
// Coven chat — last 100 messages per coven, rate-limited, length-capped.
// ---------------------------------------------------------------------------
function _checkRateLimit(uname) {
  const now = Date.now();
  const arr = (chatTimestamps.get(uname) || []).filter(t => now - t < CHAT_WINDOW_MS);
  if (arr.length >= CHAT_MAX_PER_WINDOW) return false;
  arr.push(now);
  chatTimestamps.set(uname, arr);
  return true;
}

function sendChat({ username, displayName, text } = {}) {
  const uname = _normUsername(username);
  if (!uname) return _fail('not_logged_in');
  _reload();
  const coven = _findByUsername(uname);
  if (!coven) return _fail('You belong to no coven.');
  let clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return _fail('Whisper something first.');
  if (clean.length > MAX_CHAT_LEN) clean = clean.slice(0, MAX_CHAT_LEN);
  if (!_checkRateLimit(uname)) {
    return _fail('The shadows ask for patience — slow your whispers.');
  }
  if (!Array.isArray(coven.chat)) coven.chat = [];
  const msg = {
    seq: (coven.chat.length ? coven.chat[coven.chat.length - 1].seq + 1 : 1),
    from: uname,
    displayName: String(displayName || username || 'Nameless').trim() || 'Nameless',
    text: clean,
    at: new Date().toISOString()
  };
  coven.chat.push(msg);
  if (coven.chat.length > CHAT_HISTORY_CAP) {
    coven.chat = coven.chat.slice(-CHAT_HISTORY_CAP);
  }
  _save(store);
  return { ok: true, message: msg, covenId: coven.id };
}

function getChat(covenId, afterSeq = 0, viewerUsername) {
  _reload();
  const coven = store.covens[String(covenId || '')];
  if (!coven) return _fail('No such coven.');
  const uname = _normUsername(viewerUsername);
  if (!uname || !coven.members[uname]) return _fail('Only coven members may hear its whispers.');
  const after = Math.max(0, Number(afterSeq) || 0);
  const msgs = (Array.isArray(coven.chat) ? coven.chat : []).filter(m => m.seq > after);
  return { ok: true, covenId: coven.id, messages: msgs, latestSeq: coven.chat.length ? coven.chat[coven.chat.length - 1].seq : 0 };
}

// ---------------------------------------------------------------------------
// State for one account.
// ---------------------------------------------------------------------------
function getCovenState({ username } = {}, now) {
  _reload();
  const uname = _normUsername(username);
  if (!uname) return { ok: true, username: null, inCoven: false, coven: null, race: getWeeklyRace(now) };
  const coven = _findByUsername(uname);
  return {
    ok: true,
    username: uname,
    inCoven: !!coven,
    coven: coven ? publicCoven(coven, uname) : null,
    race: getWeeklyRace(now)
  };
}

function getCovenIdForUser(username) {
  _reload();
  const coven = _findByUsername(username);
  return coven ? coven.id : null;
}

module.exports = {
  RANKS,
  RANK_ORDER,
  LEVEL_NAMES,
  xpForLevel,
  levelForXp,
  levelNameFor,
  formatRaceTime,
  createCoven,
  joinByCode,
  leaveCoven,
  disbandCoven,
  setRank,
  kickMember,
  rotateInviteCode,
  awardRunXp,
  recordDailyDelveClear,
  getWeeklyRace,
  sendChat,
  getChat,
  getCovenState,
  getCovenIdForUser,
  publicCoven,
  // Test seam: force an in-memory reload from disk.
  _reload,
  // Test seam: clear chat rate-limit state (per-username send timestamps).
  _resetRateLimits: () => chatTimestamps.clear()
};
