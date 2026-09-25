// server/game/systems/SeasonService.js — PHASE 4 (workstream 1): Seasons +
// Daily Delve.
//
// Server-authoritative season lifecycle:
//   - One season per calendar month, persisted in server/data/season.json so it
//     survives restarts. Rollover is AUTOMATIC by date: any read that observes
//     now >= endISO archives the finished season and opens the new month.
//   - Daily Delve: one deterministic dungeon seed per calendar day, derived
//     from the date string (sha256 -> uint32). Every player gets the SAME seed
//     for the same day, on any machine, without any shared state.
//   - Season XP bookkeeping per account lives on profile.meta.season and is
//     awarded ONLY from server-observed run results (via MetaProgression).
//
// Dates are evaluated in the covenant timezone (default America/Chicago,
// override with SEASON_TIMEZONE) so "today" matches the player's wall clock
// and rollover happens once, consistently.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SEASON_FILE = path.join(DATA_DIR, 'season.json');

const SEASON_TZ = process.env.SEASON_TIMEZONE || 'America/Chicago';
const HISTORY_CAP = 12;

// Dark-fantasy season names, one per month, cycling yearly.
const SEASON_NAMES = [
  "Season of the Bleeding Moon",
  "Season of Ashfall",
  "Season of the Hollow Star",
  "Season of Grave Bloom",
  "Season of the Drowned Bell",
  "Season of Ember Vigil",
  "Season of the Weeping Vault",
  "Season of Thorn and Oath",
  "Season of the Pale Hunt",
  "Season of Iron Requiem",
  "Season of the Silent Choir",
  "Season of Frostbound Kings"
];

// ---------------------------------------------------------------------------
// Date helpers (covenant timezone)
// ---------------------------------------------------------------------------

// Calendar date string "YYYY-MM-DD" for a Date in the covenant timezone.
function dateStrFor(date, tz = SEASON_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
  return parts; // en-CA yields YYYY-MM-DD
}

function todayStr() {
  return dateStrFor(new Date());
}

// Start-of-month / end-of-month (end = start of next month) as ISO strings,
// evaluated in the covenant timezone. Implemented by formatting local parts.
function monthBoundsFor(date, tz = SEASON_TZ) {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit'
  }).format(date); // "YYYY-MM"
  const [y, m] = local.split('-').map(Number);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  // UTC-midnight anchors: ordering is all we need; the covenant TZ only
  // decides WHICH month a wall-clock instant belongs to.
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(nextY, nextM - 1, 1, 0, 0, 0)).toISOString();
  return { start, end };
}

function seasonIdFor(date) {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEASON_TZ, year: 'numeric', month: '2-digit'
  }).format(date);
  return local; // "2026-10"
}

// ISO-8601 week id "YYYY-Www" (UTC-based; weeks are unambiguous enough for
// weekly leaderboards).
function weekIdFor(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Daily Delve seed — deterministic per calendar day.
// ---------------------------------------------------------------------------
function dailySeedFor(dateStr) {
  const s = String(dateStr || todayStr());
  const hash = crypto.createHash('sha256').update(`covenant-daily-delve|${s}`).digest();
  return hash.readUInt32BE(0);
}

function getDailyDelve() {
  const date = todayStr();
  return {
    date,
    seed: dailySeedFor(date),
    label: `Today's Delve — ${date}`
  };
}

// ---------------------------------------------------------------------------
// Season persistence + automatic rollover
// ---------------------------------------------------------------------------
function _readStore() {
  try {
    if (fs.existsSync(SEASON_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SEASON_FILE, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch (e) {
    console.warn('[SeasonService] Could not read season store:', e.message);
  }
  return null;
}

function _writeStore(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${SEASON_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, SEASON_FILE); // atomic on POSIX
  } catch (e) {
    console.error('[SeasonService] Failed to persist season store:', e.message);
  }
}

function _openSeason(now = new Date()) {
  const id = seasonIdFor(now);
  const { start, end } = monthBoundsFor(now);
  const monthIdx = Number(id.split('-')[1]) - 1;
  return {
    id,
    name: SEASON_NAMES[monthIdx] || SEASON_NAMES[0],
    startISO: start,
    endISO: end,
    active: true,
    openedAt: now.toISOString()
  };
}

// Returns the current season object, rolling over automatically when the
// calendar month has advanced. Survives restarts via season.json.
function getCurrentSeason(now = new Date()) {
  const store = _readStore();
  if (store && store.current && store.current.endISO && now.toISOString() < store.current.endISO) {
    return store.current;
  }
  const fresh = _openSeason(now);
  const history = (store && Array.isArray(store.history) ? store.history : []).slice();
  if (store && store.current && store.current.id !== fresh.id) {
    history.unshift({
      id: store.current.id,
      name: store.current.name,
      startISO: store.current.startISO,
      endISO: store.current.endISO,
      closedAt: now.toISOString()
    });
  }
  const next = { current: fresh, history: history.slice(0, HISTORY_CAP) };
  _writeStore(next);
  if (!store || !store.current || store.current.id !== fresh.id) {
    console.log(`[SeasonService] Rolled over to season ${fresh.id} — ${fresh.name}`);
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Per-account season XP bookkeeping (profile.meta.season).
// Season XP is earned from runs and RESETS each season. The season id on the
// record guards stale claims: when the season rolls over, old XP/claims are
// archived to profile.meta.lastSeason and the new season starts at zero.
// ---------------------------------------------------------------------------
function ensureSeasonState(profile, seasonId) {
  if (!profile || typeof profile !== 'object') return null;
  if (!profile.meta || typeof profile.meta !== 'object') profile.meta = {};
  const sid = seasonId || getCurrentSeason().id;
  if (!profile.meta.season || typeof profile.meta.season !== 'object' || profile.meta.season.seasonId !== sid) {
    const prev = profile.meta.season;
    if (prev && typeof prev === 'object' && prev.seasonId && prev.seasonId !== sid) {
      profile.meta.lastSeason = { seasonId: prev.seasonId, xp: Math.max(0, Math.floor(prev.xp || 0)) };
    }
    profile.meta.season = { seasonId: sid, xp: 0, claimedFree: [], claimedPremium: [] };
  }
  const s = profile.meta.season;
  if (typeof s.xp !== 'number' || s.xp < 0) s.xp = 0;
  if (!Array.isArray(s.claimedFree)) s.claimedFree = [];
  if (!Array.isArray(s.claimedPremium)) s.claimedPremium = [];
  return s;
}

// Award season XP to an account record (callers persist via authService).
// Reuses the covenant-rank account XP value as the season XP amount so the
// two economies stay consistent; season XP is simply the per-season slice.
function awardSeasonXp(profile, amount) {
  const s = ensureSeasonState(profile);
  if (!s) return null;
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  s.xp += gain;
  return { seasonId: s.seasonId, xp: s.xp, gained: gain };
}

// ---------------------------------------------------------------------------
// Premium season-pass entitlement (per season, per account).
// The purchase itself flows through the Phase 3 Stripe cosmetic-shop billing
// (server/cosmeticsCatalog.js product 'pass_premium_season'); this module only
// records which seasons an account holds premium for. Cosmetics-only — it
// unlocks reward claims, never stats, XP, or loot.
// ---------------------------------------------------------------------------
function ensurePremiumMap(profile) {
  if (!profile || typeof profile !== 'object') return {};
  if (!profile.seasonPassPremium || typeof profile.seasonPassPremium !== 'object') {
    profile.seasonPassPremium = {};
  }
  return profile.seasonPassPremium;
}

function hasPremium(profile, seasonId) {
  const sid = seasonId || getCurrentSeason().id;
  const map = ensurePremiumMap(profile);
  return map[sid] === true;
}

// Records premium for the current season. Called ONLY after Stripe confirms
// payment (signature-verified webhook or verified session retrieval) — the
// billing flow lives in server.js/stripeService.js.
function grantPremium(accountToken, seasonId) {
  // Lazy require avoids a load-order cycle with authService consumers.
  const authService = require('../../authService');
  const acc = authService.getAccountByToken(accountToken);
  if (!acc || !acc.profile) return { ok: false, error: 'Account not found. Please sign in again.' };
  const sid = seasonId || getCurrentSeason().id;
  const map = ensurePremiumMap(acc.profile);
  map[sid] = true;
  authService.saveAccounts();
  return { ok: true, seasonId: sid, premium: true };
}

// Client-safe public view: season identity, daily delve, and nothing account-
// specific (no tokens, no entitlements).
function publicSeasonState() {
  const season = getCurrentSeason();
  const delve = getDailyDelve();
  return {
    season: {
      id: season.id,
      name: season.name,
      startISO: season.startISO,
      endISO: season.endISO,
      active: season.active !== false
    },
    dailyDelve: { date: delve.date, seed: delve.seed, label: delve.label },
    weekId: weekIdFor(),
    timezone: SEASON_TZ
  };
}

module.exports = {
  SEASON_TZ,
  SEASON_NAMES,
  dateStrFor,
  todayStr,
  seasonIdFor,
  weekIdFor,
  dailySeedFor,
  getDailyDelve,
  getCurrentSeason,
  ensureSeasonState,
  awardSeasonXp,
  hasPremium,
  grantPremium,
  publicSeasonState
};
