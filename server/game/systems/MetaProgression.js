// server/game/systems/MetaProgression.js — PERSISTENT ACCOUNT PROGRESSION.
// ============================================================================
// Covenant ranks, account XP, and permanent unlockables (hero classes, starting
// boons, stash tabs) that persist across runs in server/data/accounts.json.
//
// SECURITY MODEL (server-authoritative, never trust the client):
//   - Account XP and seals are granted ONLY by grantRunRewards(), computed
//     server-side from server-observed run events (kills, objectives, boss
//     slain, floors reached, victory/defeat, survival). No ws message and no
//     REST endpoint accepts client-sent XP/seal totals — /api/auth/sync's
//     updateProfile() has no meta fields in its whitelist, so forged values
//     are dropped on the floor.
//   - Unlock purchases are validated server-side (ownership, rank gate, seal
//     balance) and applied to the server-side account record resolved from the
//     auth token. The client only ever sends an itemId.
//   - Join-time effects (unlocked classes, active boons) resolve from the
//     server-side account via the accountToken on join messages, never from
//     the client-supplied profile blob.
//   - Persistence is atomic: authService.saveAccounts() writes to a temp file
//     and renames, so a crash can never leave a half-written accounts file.
//
// ACCOUNT SCHEMA (profile.meta — see authService.defaultMeta for the factory):
//   { accountXp, seals, unlockedClasses, unlockedBoons, activeBoons,
//     stashTabs, lifetimeRuns, lifetimeVictories }
// Rank is DERIVED from accountXp via RANKS (never stored, always consistent).
//
// STASH HOOK (for the inventory workstream): getStashCapacity(meta) returns
// { tabs, slotsPerTab, totalSlots }. Loot/inventory code should call this to
// size the account stash instead of hardcoding a tab count.

'use strict';

const authService = require('../../authService');
const Progression = require('./Progression');
const Health = require('./Health');

// ---------------------------------------------------------------------------
// Covenant ranks — dark-covenant themed, following Oaths.js naming register.
// ---------------------------------------------------------------------------
const RANKS = [
  { name: 'Soul-Sworn Initiate',    xp: 0,     icon: '🕯️' },
  { name: 'Blood Oathbearer',       xp: 1500,  icon: '🩸' },
  { name: 'Grave Vigil',            xp: 4000,  icon: '⚰️' },
  { name: 'Dread Herald',           xp: 8000,  icon: '📯' },
  { name: 'Night Requiem',          xp: 14000, icon: '🌑' },
  { name: 'Doombringer',            xp: 22000, icon: '💀' },
  { name: 'Harbinger of the Hollow', xp: 34000, icon: '🕳️' },
  { name: "Malakor's Chosen",       xp: 50000, icon: '👑' }
];

function rankForXp(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (x >= RANKS[i].xp) index = i;
  }
  const def = RANKS[index];
  const next = RANKS[index + 1] || null;
  return {
    index,
    name: def.name,
    icon: def.icon,
    xp: x,
    xpForRank: def.xp,
    xpToNext: next ? next.xp - x : null,
    nextRankName: next ? next.name : null,
    isMax: !next
  };
}

// ---------------------------------------------------------------------------
// Unlockable hero classes (server-side stat blocks; client mirrors for UI).
// Ability pools are inherited from a base class via CLASS_ABILITY_FAMILY
// (see Abilities.js) — real abilities, no placeholders.
// ---------------------------------------------------------------------------
const EXTRA_CLASS_CONFIGS = {
  plaguecaller: {
    name: 'Plaguecaller', role: 'Alchemist',
    maxHp: 390, speed: 5.0, attackRange: 9.0, color: 0x86a816,
    abilityFamily: 'necromancer',
    desc: 'Bubbling cauldrons of ruin. Siphons life and melts armor with virulent rot.'
  },
  gravewarden: {
    name: 'Grave Warden', role: 'Sentinel',
    maxHp: 700, speed: 4.4, attackRange: 2.4, color: 0x5a6b7d,
    abilityFamily: 'juggernaut',
    desc: 'An unmoving tombstone with a heartbeat. Holds the line where others break.'
  },
  hexblade: {
    name: 'Hexblade', role: 'Dark Knight',
    maxHp: 480, speed: 5.4, attackRange: 2.6, color: 0xa8236b,
    abilityFamily: 'rogue',
    desc: 'A cursed blade that drinks from the shadows it cuts. Fast, cruel, precise.'
  }
};

const CLASS_ABILITY_FAMILY = {
  plaguecaller: 'necromancer',
  gravewarden: 'juggernaut',
  hexblade: 'rogue'
};

const BASE_CLASS_KEYS = ['juggernaut', 'cleric', 'rogue', 'mage', 'ranger', 'necromancer'];

// ---------------------------------------------------------------------------
// Unlockable catalog. minRank is an index into RANKS.
// ---------------------------------------------------------------------------
const UNLOCKABLES = [
  {
    id: 'class_plaguecaller', type: 'class', classKey: 'plaguecaller',
    name: 'Plaguecaller', icon: '🧪', cost: 800, minRank: 1,
    flavor: '"Let them breathe deep. The rot does the rest."',
    effect: 'Unlocks the Plaguecaller hero class (Alchemist — necromantic ability tree, high range).'
  },
  {
    id: 'class_gravewarden', type: 'class', classKey: 'gravewarden',
    name: 'Grave Warden', icon: '⚰️', cost: 1400, minRank: 2,
    flavor: '"The line holds because I am the line."',
    effect: 'Unlocks the Grave Warden hero class (Sentinel — juggernaut ability tree, 700 max HP).'
  },
  {
    id: 'class_hexblade', type: 'class', classKey: 'hexblade',
    name: 'Hexblade', icon: '🗡️', cost: 2200, minRank: 3,
    flavor: '"My blade remembers every shadow it has ever drunk."',
    effect: 'Unlocks the Hexblade hero class (Dark Knight — rogue ability tree, blinding speed).'
  },
  {
    id: 'boon_veterans_grit', type: 'boon', boonId: 'boon_veterans_grit',
    name: "Veteran's Grit", icon: '🛡️', cost: 300, minRank: 0,
    flavor: '"Scars are just armor you grow yourself."',
    effect: 'Start every run with +200 max HP.'
  },
  {
    id: 'boon_soul_well', type: 'boon', boonId: 'boon_soul_well',
    name: 'Soul Well', icon: '🏺', cost: 250, minRank: 0,
    flavor: '"The covenant provides for those who bleed for it."',
    effect: 'Start every run with +120 expedition gold.'
  },
  {
    id: 'boon_swift_covenant', type: 'boon', boonId: 'boon_swift_covenant',
    name: 'Swift Covenant', icon: '💨', cost: 350, minRank: 1,
    flavor: '"The dark cannot catch what it cannot see."',
    effect: 'Start every run with +10% move speed.'
  },
  {
    id: 'boon_executioners_edge', type: 'boon', boonId: 'boon_executioners_edge',
    name: "Executioner's Edge", icon: '🩸', cost: 450, minRank: 2,
    flavor: '"One clean cut. The dungeon provides the neck."',
    effect: 'Start every run with +12% damage.'
  },
  {
    id: 'boon_blessed_vigor', type: 'boon', boonId: 'boon_blessed_vigor',
    name: 'Blessed Vigor', icon: '✨', cost: 600, minRank: 3,
    flavor: '"You have bled enough. Begin already blooded."',
    effect: 'Begin every run at level 2 (level-up stat growth + 1 ability point + blessing choice).'
  },
  {
    id: 'stash_tab_2', type: 'stash', stashIndex: 2,
    name: 'Stash Tab II — The Reliquary', icon: '📦', cost: 500, minRank: 1,
    flavor: '"Every relic deserves a shelf. Even the screaming ones."',
    effect: 'Unlocks a 2nd account stash tab (+24 slots).'
  },
  {
    id: 'stash_tab_3', type: 'stash', stashIndex: 3,
    name: 'Stash Tab III — The Ossuary', icon: '📦', cost: 900, minRank: 2,
    flavor: '"Bones stack neatly if you break them right."',
    effect: 'Unlocks a 3rd account stash tab (+24 slots). Requires Stash Tab II.'
  },
  {
    id: 'stash_tab_4', type: 'stash', stashIndex: 4,
    name: 'Stash Tab IV — The Black Vault', icon: '📦', cost: 1500, minRank: 3,
    flavor: '"Some things should never see daylight again."',
    effect: 'Unlocks a 4th account stash tab (+24 slots). Requires Stash Tab III.'
  }
];

const MAX_ACTIVE_BOONS = 2;
const STASH_SLOTS_PER_TAB = 24;
const MAX_ACCOUNT_XP_PER_RUN = 50000;

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------
function ensureMeta(profile) {
  if (!profile || typeof profile !== 'object') return null;
  if (!profile.meta || typeof profile.meta !== 'object') profile.meta = {};
  const m = profile.meta;
  if (typeof m.accountXp !== 'number' || m.accountXp < 0) m.accountXp = 0;
  if (typeof m.seals !== 'number' || m.seals < 0) m.seals = 0;
  if (!Array.isArray(m.unlockedClasses)) m.unlockedClasses = [];
  if (!Array.isArray(m.unlockedBoons)) m.unlockedBoons = [];
  if (!Array.isArray(m.activeBoons)) m.activeBoons = [];
  if (typeof m.stashTabs !== 'number' || m.stashTabs < 0) m.stashTabs = 0;
  if (typeof m.lifetimeRuns !== 'number' || m.lifetimeRuns < 0) m.lifetimeRuns = 0;
  if (typeof m.lifetimeVictories !== 'number' || m.lifetimeVictories < 0) m.lifetimeVictories = 0;
  // Sanitize: keep only known catalog ids (drop anything hand-edited in).
  const knownBoons = new Set(UNLOCKABLES.filter(u => u.type === 'boon').map(u => u.boonId));
  const knownClasses = new Set(Object.keys(EXTRA_CLASS_CONFIGS));
  m.unlockedBoons = m.unlockedBoons.filter(id => knownBoons.has(id));
  m.unlockedClasses = m.unlockedClasses.filter(id => knownClasses.has(id));
  m.activeBoons = m.activeBoons.filter(id => knownBoons.has(id) && m.unlockedBoons.includes(id)).slice(0, MAX_ACTIVE_BOONS);
  return m;
}

// Stash hook for the inventory workstream: size the account stash from this,
// never from a hardcoded tab count.
function getStashCapacity(meta) {
  const m = meta || {};
  const tabs = 1 + Math.max(0, Math.floor(m.stashTabs || 0));
  return { tabs, slotsPerTab: STASH_SLOTS_PER_TAB, totalSlots: tabs * STASH_SLOTS_PER_TAB };
}

// Client-safe view of account progression (no secrets, no internals).
function publicMeta(meta) {
  const m = ensureMeta({ meta }) || {};
  return {
    accountXp: m.accountXp,
    seals: m.seals,
    rank: rankForXp(m.accountXp),
    unlockedClasses: [...m.unlockedClasses],
    unlockedBoons: [...m.unlockedBoons],
    activeBoons: [...m.activeBoons],
    stashTabs: m.stashTabs,
    stashCapacity: getStashCapacity(m),
    lifetimeRuns: m.lifetimeRuns,
    lifetimeVictories: m.lifetimeVictories,
    maxActiveBoons: MAX_ACTIVE_BOONS
  };
}

// Catalog annotated for the client: ownership, rank gate, affordability.
function catalogFor(meta) {
  const m = ensureMeta({ meta }) || {};
  const rank = rankForXp(m.accountXp);
  return UNLOCKABLES.map(u => {
    const owned =
      (u.type === 'class' && m.unlockedClasses.includes(u.classKey)) ||
      (u.type === 'boon' && m.unlockedBoons.includes(u.boonId)) ||
      (u.type === 'stash' && m.stashTabs >= u.stashIndex - 1);
    return {
      ...u,
      owned,
      rankOk: rank.index >= u.minRank,
      rankName: RANKS[u.minRank].name,
      affordable: m.seals >= u.cost,
      active: u.type === 'boon' && m.activeBoons.includes(u.boonId)
    };
  });
}

// ---------------------------------------------------------------------------
// Purchases — server-side validation only. Mutates meta in place; the caller
// (REST handler) persists via authService.saveAccounts() (atomic).
// ---------------------------------------------------------------------------
function purchase(meta, itemId) {
  const m = ensureMeta({ meta });
  if (!m) return { ok: false, error: 'No account record.' };
  const item = UNLOCKABLES.find(u => u.id === itemId);
  if (!item) return { ok: false, error: 'No such relic exists in the Covenant Vault.' };
  const rank = rankForXp(m.accountXp);

  const owned =
    (item.type === 'class' && m.unlockedClasses.includes(item.classKey)) ||
    (item.type === 'boon' && m.unlockedBoons.includes(item.boonId)) ||
    (item.type === 'stash' && m.stashTabs >= item.stashIndex - 1);
  if (owned) return { ok: false, error: `${item.name} is already claimed.` };

  if (rank.index < item.minRank) {
    return { ok: false, error: `The Vault demands rank ${RANKS[item.minRank].name}. You are ${rank.name}.` };
  }
  if (m.seals < item.cost) {
    return { ok: false, error: `The Vault demands ${item.cost} seals. You hold ${m.seals}.` };
  }
  if (item.type === 'stash' && m.stashTabs !== item.stashIndex - 2) {
    return { ok: false, error: `Claim Stash Tab ${item.stashIndex - 1} first — the Vault builds in order.` };
  }

  m.seals -= item.cost;
  if (item.type === 'class') m.unlockedClasses.push(item.classKey);
  else if (item.type === 'boon') m.unlockedBoons.push(item.boonId);
  else if (item.type === 'stash') m.stashTabs += 1;
  return { ok: true, meta: m, purchased: item.id };
}

// Set the run-start boon loadout. Only owned boons, at most MAX_ACTIVE_BOONS.
function setActiveBoons(meta, boonIds) {
  const m = ensureMeta({ meta });
  if (!m) return { ok: false, error: 'No account record.' };
  if (!Array.isArray(boonIds)) return { ok: false, error: 'Boon loadout must be a list.' };
  const ids = [...new Set(boonIds)].slice(0, MAX_ACTIVE_BOONS);
  for (const id of ids) {
    if (!m.unlockedBoons.includes(id)) {
      return { ok: false, error: 'That boon is not yours to command. Claim it in the Vault first.' };
    }
  }
  m.activeBoons = ids;
  return { ok: true, meta: m };
}

// ---------------------------------------------------------------------------
// Run-start: class gating + boon application (join-time, server-side).
// ---------------------------------------------------------------------------
function classAllowedFor(profile, classKey) {
  if (BASE_CLASS_KEYS.includes(classKey)) return true;
  const m = ensureMeta(profile);
  return !!m && m.unlockedClasses.includes(classKey);
}

function validateClassChoice(profile, classKey) {
  if (classAllowedFor(profile, classKey)) return classKey;
  return 'juggernaut';
}

const BOON_EFFECTS = {
  boon_veterans_grit(room, player) {
    Health.setMaxHp(room, player.id, player.maxHp + 200, { healDelta: true });
  },
  boon_soul_well(room, player) {
    player.stats.goldCollected = (player.stats.goldCollected || 0) + 120;
  },
  boon_swift_covenant(room, player) {
    player.speed = +((player.speed || 5) * 1.10).toFixed(2);
  },
  boon_executioners_edge(room, player) {
    player.damageBuff = +((player.damageBuff || 1) * 1.12).toFixed(2);
  },
  boon_blessed_vigor(room, player) {
    // Real level-up through the authoritative progression system: stat growth,
    // +1 ability point, and a pick-1-of-3 blessing choice for the player.
    Progression.grantXP(room, player.id, Progression.xpToNext(1), 'boon:blessed_vigor');
  }
};

// Apply the account's active boons to a freshly joined player. profile MUST be
// the server-side account record (resolved from the join accountToken).
function applyStartBoons(room, player, profile) {
  if (!room || !player || !profile) return [];
  const m = ensureMeta(profile);
  if (!m) return [];
  const owned = new Set(m.unlockedBoons);
  const active = m.activeBoons.filter(id => owned.has(id)).slice(0, MAX_ACTIVE_BOONS);
  const applied = [];
  for (const id of active) {
    const fx = BOON_EFFECTS[id];
    if (fx) {
      try { fx(room, player); applied.push(id); } catch (e) { /* boon must never break a join */ }
    }
  }
  player.appliedBoons = applied;
  return applied;
}

// ---------------------------------------------------------------------------
// Run-end account XP — computed ONLY from server-observed run state.
// ---------------------------------------------------------------------------
function _clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function computeRunRewards({ kills, secretCompleted, bossSlain, floor, survived, victory }) {
  const k = _clampInt(kills, 0, 5000);
  const f = _clampInt(floor, 1, 99);
  const breakdown = {
    kills: k,
    objectives: secretCompleted ? 1 : 0,
    bosses: bossSlain ? 1 : 0,
    floors: f,
    victory: !!victory,
    survived: !!survived
  };
  let xp;
  if (victory) {
    xp = k * 6
      + (secretCompleted ? 250 : 0)
      + (bossSlain ? 1000 : 0)
      + f * 150
      + 500
      + (survived ? 100 : 0);
  } else {
    // The fallen still feed the covenant — at a reduced tithe.
    xp = k * 3
      + (secretCompleted ? 120 : 0)
      + (bossSlain ? 250 : 0)
      + f * 60;
  }
  xp = Math.min(xp, MAX_ACCOUNT_XP_PER_RUN);
  return { accountXp: xp, seals: Math.floor(xp / 10), breakdown };
}

// Grant account XP/seals to every linked human player present at run end.
// Idempotent per room (room._metaRewardsGranted guard). Returns per-player
// results for the victory/defeat broadcast.
function grantRunRewards(room, { victory = false } = {}) {
  if (!room) return [];
  if (room._metaRewardsGranted) return room._metaRewardsGranted;
  const results = [];
  const bossSlain = !!(room.boss && room.boss.isDead);
  const floor = room.floor || 1;

  for (const player of Object.values(room.players || {})) {
    if (player.isBot || !player.accountUsername) continue;
    const profile = authService.getProfileByUsername(player.accountUsername);
    if (!profile) continue;
    const m = ensureMeta(profile);
    if (!m) continue;

    const oldRank = rankForXp(m.accountXp);
    const rewards = computeRunRewards({
      kills: player.stats?.kills || 0,
      secretCompleted: !!player.secretCompleted,
      bossSlain,
      floor,
      survived: !player.isDead && !player.isDowned,
      victory
    });

    m.accountXp += rewards.accountXp;
    m.seals += rewards.seals;
    m.lifetimeRuns += 1;
    if (victory) m.lifetimeVictories += 1;

    // PHASE 4 (workstream 2): coven XP — shared coven progression fed by the
    // same server-computed account XP. Level-ups are reported on the reward
    // row so the client can toast them. Never breaks run rewards.
    let covenGain = null;
    try {
      const CovenService = require('./CovenService');
      covenGain = CovenService.awardRunXp(player.accountUsername, rewards.accountXp, { victory });
    } catch (e) { /* coven systems must never break run rewards */ }

    const newRank = rankForXp(m.accountXp);
    results.push({
      playerId: player.id,
      name: player.name,
      accountXpGained: rewards.accountXp,
      sealsGained: rewards.seals,
      covenXpGained: covenGain ? covenGain.xpGained : 0,
      covenLevelUp: covenGain ? covenGain.leveledUp : false,
      covenName: covenGain ? covenGain.covenName : null,
      covenLevelName: covenGain ? covenGain.levelName : null,
      victory,
      rankUp: newRank.index > oldRank.index,
      rank: { index: newRank.index, name: newRank.name, icon: newRank.icon },
      accountXp: m.accountXp,
      seals: m.seals,
      breakdown: rewards.breakdown
    });
  }

  if (results.length > 0) authService.saveAccounts(); // atomic write
  room._metaRewardsGranted = results;
  return results;
}

module.exports = {
  RANKS,
  EXTRA_CLASS_CONFIGS,
  CLASS_ABILITY_FAMILY,
  BASE_CLASS_KEYS,
  UNLOCKABLES,
  MAX_ACTIVE_BOONS,
  STASH_SLOTS_PER_TAB,
  rankForXp,
  ensureMeta,
  getStashCapacity,
  publicMeta,
  catalogFor,
  purchase,
  setActiveBoons,
  classAllowedFor,
  validateClassChoice,
  applyStartBoons,
  computeRunRewards,
  grantRunRewards
};
