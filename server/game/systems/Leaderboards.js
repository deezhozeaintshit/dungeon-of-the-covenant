// server/game/systems/Leaderboards.js — PHASE 4 shared leaderboard store.
//
// Shared contract used by BOTH workstream 1 (seasons + battle pass: fastest
// daily-delve clear, deepest rift tier, most season XP) and workstream 4
// (rifts: deepest rift tier submissions). Any system may call
// Leaderboards.submit(boardId, {...}); clients never submit — the server is
// the only writer, and every value below is measured server-side.
//
// Board scope: all three boards are WEEKLY — entries are keyed by ISO week
// (YYYY-Www) and a new week starts an empty board automatically.
//
// ENTRY SCHEMA (single canonical shape for all boards):
//   {
//     boardId:     'daily_delve_speed' | 'rift_depth' | 'season_xp',
//     weekId:      '2026-W39',            // ISO week the entry belongs to
//     seasonId:    '2026-09',             // covenant season, for context
//     username:    'deezh',               // canonical account username (lowercase)
//     displayName: 'Deezh',              // display name, may be null
//     value:       184,                  // numeric sort value (see each board)
//     displayValue:'3m 04s',              // human string shown in UI
//     meta:        { ... },              // board-specific facts (see below)
//     achievedAt:  '2026-09-25T...'       // ISO timestamp of the submission
//   }
//
// BOARD-SPECIFIC CONTRACT:
//   daily_delve_speed — fastest Daily Delve CLEAR. value = clear time in
//     seconds (direction 'asc' — smaller is better). Only recorded on
//     victory. meta: { clearTimeSec, date, seed, partySize }.
//     Anti-spoof: clear time = room.endTime - room.startTime, measured
//     server-side inside Room's victory handler. Client times are ignored.
//   rift_depth — deepest rift tier REACHED. value = rift tier (int, 'desc').
//     Submitted by the rift system (workstream 4) — call
//     Leaderboards.submit('rift_depth', { username, displayName,
//     riftTier, seasonId, extra }). meta: { riftTier, roomCode? }.
//     Deepest tier = furthest DESCENDED; direction 'desc' keeps the highest
//     value on top.
//   season_xp — most season XP earned in the week. value = season XP earned
//     this week (int, 'desc'), accumulated across submissions (weekly total
//     per account — each submit ADDS to the week's total). meta: { totalXp }.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const BOARDS_FILE = path.join(DATA_DIR, 'leaderboards.json');

// --- Board definitions -------------------------------------------------------
const BOARDS = {
  daily_delve_speed: {
    id: 'daily_delve_speed',
    name: 'Daily Delve — Fastest Clear',
    description: "Fastest victorious run of the day's seeded delve, this week.",
    direction: 'asc',           // lower value wins
    scope: 'weekly',
    accumulate: false,          // keep best (fastest) entry per account
    unit: 'time',
    formatValue
  },
  rift_depth: {
    id: 'rift_depth',
    name: 'Deepest Rift Tier',
    description: 'Deepest rift tier reached this week. (Submitted by the rift system.)',
    direction: 'desc',          // higher value wins
    scope: 'weekly',
    accumulate: false,          // keep deepest entry per account
    unit: 'tier',
    formatValue
  },
  season_xp: {
    id: 'season_xp',
    name: 'Most Season XP',
    description: 'Season XP earned this week, across all runs.',
    direction: 'desc',          // higher value wins
    scope: 'weekly',
    accumulate: true,           // weekly total per account
    unit: 'xp',
    formatValue
  }
};

function formatValue(boardId, value) {
  const v = Number(value) || 0;
  if (boardId === 'daily_delve_speed') {
    const m = Math.floor(v / 60);
    const s = Math.floor(v % 60);
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  if (boardId === 'rift_depth') return `Tier ${v}`;
  if (boardId === 'season_xp') return `${v.toLocaleString('en-US')} XP`;
  return String(v);
}

// --- Persistence -------------------------------------------------------------
function _load() {
  try {
    if (fs.existsSync(BOARDS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BOARDS_FILE, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch (e) {
    console.warn('[Leaderboards] Could not read leaderboard store:', e.message);
  }
  return {};
}

function _save(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${BOARDS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, BOARDS_FILE); // atomic on POSIX
  } catch (e) {
    console.error('[Leaderboards] Failed to persist leaderboards:', e.message);
  }
}

// --- Public API ----------------------------------------------------------------
// submit(boardId, { username, displayName, value, meta, weekId, seasonId }):
// Server-side only. For 'daily_delve_speed' and 'rift_depth' keeps the best
// entry per account per week; for 'season_xp' accumulates the weekly total.
function submit(boardId, { username, displayName = null, value = 0, meta = {}, weekId = null, seasonId = null } = {}) {
  const board = BOARDS[boardId];
  if (!board) return { ok: false, error: `Unknown leaderboard: ${boardId}` };
  const uname = String(username || '').toLowerCase().trim();
  if (!uname) return { ok: false, error: 'Leaderboard submit requires an account username.' };
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return { ok: false, error: 'Invalid leaderboard value.' };

  const SeasonService = require('./SeasonService');
  const wId = weekId || SeasonService.weekIdFor();
  const sId = seasonId || SeasonService.getCurrentSeason().id;

  const store = _load();
  if (!store[boardId] || typeof store[boardId] !== 'object') store[boardId] = {};
  if (!store[boardId][wId] || typeof store[boardId][wId] !== 'object') store[boardId][wId] = {};
  const week = store[boardId][wId];

  const existing = week[uname];
  if (board.accumulate && existing) {
    existing.value = existing.value + v;
    existing.displayValue = formatValue(boardId, existing.value);
    existing.meta = { ...(existing.meta || {}), totalXp: existing.value };
    existing.achievedAt = new Date().toISOString();
    _save(store);
    return { ok: true, entry: existing, improved: true };
  }

  const better = (a, b) => (board.direction === 'asc' ? a < b : a > b);
  if (existing && !better(v, existing.value)) {
    return { ok: true, entry: existing, improved: false };
  }

  const entry = {
    boardId,
    weekId: wId,
    seasonId: sId,
    username: uname,
    displayName: displayName || uname,
    value: v,
    displayValue: formatValue(boardId, v),
    meta: { ...(meta || {}) },
    achievedAt: new Date().toISOString()
  };
  week[uname] = entry;
  _save(store);
  return { ok: true, entry, improved: true };
}

// getBoard(boardId, { weekId, limit }): sorted standings for a week (current
// week by default). Old weeks are kept in the store for history.
function getBoard(boardId, { weekId = null, limit = 25 } = {}) {
  const board = BOARDS[boardId];
  if (!board) return { ok: false, error: `Unknown leaderboard: ${boardId}` };
  const SeasonService = require('./SeasonService');
  const wId = weekId || SeasonService.weekIdFor();
  const store = _load();
  const week = (store[boardId] && store[boardId][wId]) || {};
  const entries = Object.values(week)
    .sort((a, b) => (board.direction === 'asc' ? a.value - b.value : b.value - a.value))
    .slice(0, Math.max(1, Math.min(100, limit)));
  const ranked = entries.map((e, i) => ({ rank: i + 1, ...e }));
  return {
    ok: true,
    board: { id: board.id, name: board.name, description: board.description, direction: board.direction, unit: board.unit },
    weekId: wId,
    entries: ranked
  };
}

// Client-safe: all three boards' standings for the current week.
function publicBoards(limit = 10) {
  const out = {};
  for (const id of Object.keys(BOARDS)) {
    out[id] = getBoard(id, { limit });
  }
  return out;
}

module.exports = {
  BOARDS,
  formatValue,
  submit,
  getBoard,
  publicBoards
};
