// systems/Progression.js — SERVER-AUTHORITATIVE XP + leveling.
// ============================================================
// Client-sent xp/level values are NEVER read. All XP flows through
// grantXP / grantPartyXP. Level-ups apply stat growth, grant 1 ability
// point (skill tree), and offer a pick-1-of-3 ability choice.
//
// XP CURVE
//   xpToNext(level) = floor(80 * level^1.6)   (XP to go level -> level+1)
//   xpForLevel(n)   = cumulative XP required to REACH level n
//
//   L1->2:    80 | L2->3:   242 | L3->4:   463 | L4->5:   735
//   L5->6:  1050 | L6->7:  1406 | L7->8:  1799 | L8->9:  2228 | L9->10: 2690
//   Cumulative to L5 = 1,520 XP | to L10 = 10,693 XP.
//
// TUNING: a floor yields ~25 mob kills (~45 XP) + elites/objectives ≈
// 700-900 XP, i.e. ~2 floors / 10-15 min of play to reach level 5.
// Boss kill = 1,000 XP, elite = 250 XP (matches legacy awardPartyXP).
//
// LEVEL-UP GROWTH (matches legacy feel): maxHp *1.18 (rounded, full heal),
// damageBuff +0.15, +1 ability point, pick-1-of-3 ability choice.
//
// grantXP(room, playerId, amount, reason) — THE signature other agents use.
//   reason: 'kill' | 'objective' | 'boss' | 'discovery' (informational,
//   surfaced in xp_update for the HUD feed).

const Health = require('./Health');
const Abilities = require('./Abilities');

const MAX_XP_PER_GRANT = 100000; // sanity clamp per call

// Canonical per-source XP amounts (other agents: use these when calling grantXP).
const XP_REWARDS = {
  kill: 45,        // standard mob kill (party-shared)
  elite: 250,      // elite / mini-boss kill (party-shared)
  boss: 1000,      // Malakor kill (party-shared)
  objective: 150,  // secret objective / quest step
  discovery: 40    // shrine / lore / secret room discovery
};

const VALID_REASONS = ['kill', 'elite', 'boss', 'objective', 'discovery'];
// Reason is informational (surfaced in xp_update). Other systems may pass
// namespaced reasons like 'objective:slay_warden' — those are accepted as-is.

function _num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// XP needed to advance from `level` to `level + 1`.
function xpToNext(level) {
  const l = Math.max(1, Math.floor(_num(level, 1)));
  return Math.floor(80 * Math.pow(l, 1.6));
}

// Total cumulative XP required to REACH level n (n >= 1).
function xpForLevel(n) {
  const target = Math.max(1, Math.floor(_num(n, 1)));
  let total = 0;
  for (let l = 1; l < target; l++) total += xpToNext(l);
  return total;
}

// Coordinator: call once in Room.addPlayer (migrates legacy xp fields).
function initPlayer(player) {
  if (!player || typeof player !== 'object') return;
  if (typeof player.level !== 'number' || player.level < 1) player.level = 1;
  if (typeof player.xp !== 'number' || player.xp < 0) player.xp = 0;
  player.nextLevelXp = xpToNext(player.level);
  Abilities.initPlayer(player);
}

function _getPlayer(room, playerId) {
  if (!room || !room.players) return null;
  return room.players[playerId] || null;
}

// ---------------------------------------------------------------------------
// grantXP(room, playerId, amount, reason)
// Server-authoritative XP grant. Handles multi-level chains. On each
// level-up: stat growth, +1 ability point, legacy 'level_up' broadcast
// (existing client VFX hook), and 'level_up_choices' with 3 offers.
// Bots auto-resolve their choice immediately.
// Returns { granted, leveledUp, newLevel, xp, nextLevelXp }.
// ---------------------------------------------------------------------------
function grantXP(room, playerId, amount, reason = 'kill') {
  const player = _getPlayer(room, playerId);
  const empty = { granted: 0, leveledUp: false, newLevel: 0, xp: 0, nextLevelXp: 0 };
  if (!player) return empty;
  initPlayer(player);

  let amt = _num(amount, 0);
  if (amt <= 0) return { ...empty, newLevel: player.level, xp: player.xp, nextLevelXp: player.nextLevelXp };
  amt = Math.min(Math.floor(amt), MAX_XP_PER_GRANT);

  const cleanReason = (typeof reason === 'string' && reason.length > 0) ? reason : 'kill';
  player.xp += amt;

  let leveledUp = false;
  while (player.xp >= player.nextLevelXp) {
    player.xp -= player.nextLevelXp;
    _applyLevelUp(room, player);
    leveledUp = true;
  }

  room.broadcast({
    type: 'xp_update',
    playerId: player.id,
    xp: player.xp,
    level: player.level,
    nextLevelXp: player.nextLevelXp,
    gained: amt,
    reason: cleanReason
  });

  return {
    granted: amt,
    leveledUp,
    newLevel: player.level,
    xp: player.xp,
    nextLevelXp: player.nextLevelXp
  };
}

// Party-wide XP (mob/elite/boss kills). Dead players earn nothing;
// downed players still earn (they're fighting on, just bleeding).
function grantPartyXP(room, amount, reason = 'kill') {
  if (!room || !room.players) return [];
  const results = [];
  for (const player of Object.values(room.players)) {
    if (player.isDead) continue;
    // Phase 2: Silent Coin oath doubles XP per-player.
    const amt = room.systems?.oaths?.modifyXpGain(player, amount) ?? amount;
    results.push({ playerId: player.id, ...grantXP(room, player.id, amt, reason) });
  }
  return results;
}

function _applyLevelUp(room, player) {
  player.level += 1;
  player.nextLevelXp = xpToNext(player.level);

  // Stat growth (legacy feel): +18% max HP with full heal, +15% damage.
  const newMax = Math.round(player.maxHp * 1.18);
  Health.setMaxHp(room, player.id, newMax, { healDelta: true });
  player.hp = player.maxHp;
  player.damageBuff = +((player.damageBuff || 1) + 0.15).toFixed(2);

  // 1 ability point for the skill tree.
  player.abilityPoints = (player.abilityPoints || 0) + 1;

  // Legacy broadcast (existing client level-up VFX hook in main.js).
  room.broadcast({
    type: 'level_up',
    playerId: player.id,
    playerName: player.name,
    level: player.level,
    x: player.x,
    z: player.z
  });
  room.broadcast({
    type: 'floating_text',
    text: `⭐ LEVEL UP! LV. ${player.level} (+18% HP, +15% DMG, +1 SKILL POINT)`,
    x: player.x,
    z: player.z,
    style: 'combo'
  });

  // Pick-1-of-3 ability choice.
  const choices = Abilities.rollChoices(player, 3);
  player.pendingChoices = choices.map(c => c.id);

  if (player.isBot) {
    Abilities.autoResolveBot(player, room);
  } else {
    room.broadcast({
      type: 'level_up_choices',
      playerId: player.id,
      level: player.level,
      abilityPoints: player.abilityPoints,
      choices
    });
  }
}

// Snapshot helper — coordinator appends in Room.getSnapshot().
function snapshotFields(player) {
  return {
    level: player.level || 1,
    xp: player.xp || 0,
    nextLevelXp: player.nextLevelXp || xpToNext(player.level || 1),
    abilityPoints: player.abilityPoints || 0,
    abilities: { ...(player.abilities || {}) }
  };
}

module.exports = {
  XP_REWARDS,
  VALID_REASONS,
  xpToNext,
  xpForLevel,
  initPlayer,
  grantXP,
  grantPartyXP,
  snapshotFields
};
