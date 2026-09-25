// systems/Abilities.js — server-authoritative ability upgrade system.
// ====================================================================
// Two acquisition paths (per spec):
//   (a) LEVEL-UP CHOICE: on level-up the server offers pick-1-of-3
//       (randomized from the class-eligible, non-maxed pool). The client
//       shows a modal; the player picks; the server validates + applies.
//   (b) SKILL TREE: spend ability points (1 granted per level) in a
//       2-branch tree (Wrath = offense, Aegis = defense/utility).
//
// Ability picks are PERMANENT for the run (no respec), so effects are
// applied incrementally per rank — no base/modifier bookkeeping needed.
//
// Effects land on the canonical server-side player fields consumed by the
// sim: damageBuff, cooldownHaste, lifesteal, critChance, speed, maxHp
// (via Health.setMaxHp), armor / resistAll / thorns / hpRegen (via Health).
//
// Build state lives ON the player object (multiplayer-safe, keyed by
// socketId): player.abilities = { abilityId: rank },
// player.abilityPoints = n. A module registry backs getPlayerBuild().

const Health = require('./Health');

const BRANCHES = {
  wrath: { id: 'wrath', name: 'Wrath', tagline: 'Offense — shred them faster', icon: '⚔️' },
  aegis: { id: 'aegis', name: 'Aegis', tagline: 'Defense — endure the dark', icon: '🛡️' }
};

// effectText is player-facing ("+8% damage per rank"); apply() mutates player.
const ABILITIES = [
  {
    id: 'savage_strikes', name: 'Savage Strikes', icon: '⚔️', branch: 'wrath',
    classes: ['juggernaut', 'cleric', 'rogue', 'mage', 'ranger', 'necromancer'],
    maxRanks: 5, perRank: 0.08,
    description: 'Your blows land with brutal force. +8% damage per rank.',
    apply(player) { player.damageBuff = +((player.damageBuff || 1) + 0.08).toFixed(2); }
  },
  {
    id: 'executioner', name: 'Executioner', icon: '🩸', branch: 'wrath',
    classes: ['rogue', 'ranger', 'mage'],
    maxRanks: 3, perRank: 0.05,
    description: 'You smell blood. +5% critical chance per rank.',
    apply(player) { player.critChance = +((player.critChance || 0.18) + 0.05).toFixed(2); }
  },
  {
    id: 'blood_pact', name: 'Blood Pact', icon: '🩸', branch: 'wrath',
    classes: ['juggernaut', 'necromancer', 'rogue'],
    maxRanks: 3, perRank: 0.04,
    description: 'Every wound you deal feeds you. +4% lifesteal per rank.',
    apply(player) { player.lifesteal = +((player.lifesteal || 0) + 0.04).toFixed(2); }
  },
  {
    id: 'spell_surge', name: 'Spell Surge', icon: '🌩️', branch: 'wrath',
    classes: ['mage', 'cleric', 'necromancer', 'ranger'],
    maxRanks: 4, perRank: 0.06,
    description: 'Arcane current quickens your hands. +6% cooldown haste per rank.',
    apply(player) { player.cooldownHaste = +((player.cooldownHaste || 1) + 0.06).toFixed(2); }
  },
  {
    id: 'swift_foot', name: 'Swift Foot', icon: '💨', branch: 'wrath',
    classes: ['rogue', 'ranger', 'juggernaut'],
    maxRanks: 3, perRank: 0.04,
    description: 'The dark cannot catch you. +4% move speed per rank.',
    apply(player) { player.speed = +((player.speed || 5) * 1.04).toFixed(2); }
  },
  {
    id: 'iron_skin', name: 'Iron Skin', icon: '🛡️', branch: 'aegis',
    classes: ['juggernaut', 'cleric', 'rogue', 'mage', 'ranger', 'necromancer'],
    maxRanks: 5, perRank: 60,
    description: 'Your flesh hardens like covenant steel. +60 max HP per rank.',
    apply(player, room) { Health.setMaxHp(room, player.id, player.maxHp + 60, { healDelta: true }); }
  },
  {
    id: 'warded_soul', name: 'Warded Soul', icon: '🔮', branch: 'aegis',
    classes: ['juggernaut', 'cleric', 'rogue', 'mage', 'ranger', 'necromancer'],
    maxRanks: 4, perRank: 0.06,
    description: 'A pale ward turns every blade. +6% resistance to ALL damage per rank.',
    apply(player) { player.resistAll = +((player.resistAll || 0) + 0.06).toFixed(2); }
  },
  {
    id: 'thornmail', name: 'Thornmail', icon: '🌵', branch: 'aegis',
    classes: ['juggernaut', 'cleric'],
    maxRanks: 3, perRank: 0.15,
    description: 'Your armor bites back. Reflect 15% of damage taken per rank.',
    apply(player) { player.thorns = +((player.thorns || 0) + 0.15).toFixed(2); }
  },
  {
    id: 'second_wind', name: 'Second Wind', icon: '💚', branch: 'aegis',
    classes: ['juggernaut', 'cleric', 'rogue', 'mage', 'ranger', 'necromancer'],
    maxRanks: 3, perRank: 0.015,
    description: 'Your wounds knit as you fight. Regenerate 1.5% max HP/sec per rank.',
    apply(player) { player.hpRegen = +((player.hpRegen || 0) + 0.015).toFixed(3); }
  },
  {
    id: 'radiant_guard', name: 'Radiant Guard', icon: '✨', branch: 'aegis',
    classes: ['cleric', 'juggernaut', 'ranger'],
    maxRanks: 4, perRank: 3,
    description: 'Blessed plate shrugs off blows. +3 flat armor per rank.',
    apply(player) { player.armor = Math.round((player.armor || 0) + 3); }
  }
];

const ABILITY_MAP = Object.fromEntries(ABILITIES.map(a => [a.id, a]));

// Registry backing getPlayerBuild(playerId): playerId -> player object.
// Populated by initPlayer() (coordinator calls in Room.addPlayer) and
// lazily by every public function. Entries are dropped on removePlayer.
const buildRegistry = new Map();

function _getPlayer(room, playerId) {
  if (!room || !room.players) return null;
  return room.players[playerId] || null;
}

// Ensure ability state exists on the player + registry entry.
function initPlayer(player) {
  if (!player || typeof player !== 'object') return;
  if (!player.abilities || typeof player.abilities !== 'object') player.abilities = {};
  if (typeof player.abilityPoints !== 'number') player.abilityPoints = 0;
  if (!Array.isArray(player.pendingChoices)) player.pendingChoices = [];
  if (player.id) buildRegistry.set(player.id, player);
  Health.initPlayer(player);
}

function dropPlayer(playerId) {
  buildRegistry.delete(playerId);
}

function getAbility(id) {
  return ABILITY_MAP[id] || null;
}

function getRank(player, abilityId) {
  return Math.max(0, Number(player.abilities?.[abilityId]) || 0);
}

function isEligible(player, ability) {
  return ability.classes.includes(player.classKey) ||
    ability.classes.includes(familyOf(player.classKey));
}

function isMaxed(player, ability) {
  return getRank(player, ability.id) >= ability.maxRanks;
}

// Pool of abilities this player can still be offered (eligible + not maxed).
function offerablePool(player) {
  return ABILITIES.filter(a => isEligible(player, a) && !isMaxed(player, a));
}

// ---------------------------------------------------------------------------
// rollChoices(player, count=3) -> [{ id, name, icon, description, branch,
//   rank, maxRanks, effectText }] — randomized pick-1-of-N offer.
// Deterministic-safe: uses Math.random (server-side only, never trusted client).
// ---------------------------------------------------------------------------
function rollChoices(player, count = 3) {
  const pool = offerablePool(player);
  const picks = [];
  const bag = [...pool];
  while (picks.length < Math.min(count, bag.length)) {
    const i = Math.floor(Math.random() * bag.length);
    picks.push(bag.splice(i, 1)[0]);
  }
  return picks.map(a => serializeChoice(player, a));
}

function serializeChoice(player, ability) {
  return {
    id: ability.id,
    name: ability.name,
    icon: ability.icon,
    description: ability.description,
    branch: ability.branch,
    branchName: BRANCHES[ability.branch].name,
    rank: getRank(player, ability.id),
    maxRanks: ability.maxRanks,
    classes: ability.classes
  };
}

// ---------------------------------------------------------------------------
// applyAbilityPick(room, playerId, abilityId)
// Path (a): consume one PENDING level-up choice. Server-validated:
//   - ability must be in player.pendingChoices (anti-spoof)
//   - must be class-eligible and not maxed
// Returns { ok, ability?, rank?, reason? }.
// ---------------------------------------------------------------------------
function applyAbilityPick(room, playerId, abilityId) {
  const player = _getPlayer(room, playerId);
  if (!player) return { ok: false, reason: 'no_player' };
  initPlayer(player);

  const ability = getAbility(abilityId);
  if (!ability) return { ok: false, reason: 'unknown_ability' };
  if (!player.pendingChoices.includes(abilityId)) {
    return { ok: false, reason: 'not_offered' };
  }
  if (!isEligible(player, ability)) return { ok: false, reason: 'class_locked' };
  if (isMaxed(player, ability)) return { ok: false, reason: 'maxed' };

  player.pendingChoices = player.pendingChoices.filter(id => id !== abilityId);
  player.abilities[abilityId] = getRank(player, abilityId) + 1;
  ability.apply(player, room);

  _broadcastBuild(room, player);
  room.broadcast({
    type: 'floating_text',
    text: `${ability.icon} ${ability.name.toUpperCase()} — RANK ${player.abilities[abilityId]}!`,
    x: player.x,
    z: player.z,
    style: 'combo'
  });
  return { ok: true, ability: abilityId, rank: player.abilities[abilityId] };
}

// ---------------------------------------------------------------------------
// spendAbilityPoint(room, playerId, abilityId)
// Path (b): skill-tree spend. Requires 1 unspent ability point.
// Returns { ok, ability?, rank?, abilityPoints?, reason? }.
// ---------------------------------------------------------------------------
function spendAbilityPoint(room, playerId, abilityId) {
  const player = _getPlayer(room, playerId);
  if (!player) return { ok: false, reason: 'no_player' };
  initPlayer(player);

  const ability = getAbility(abilityId);
  if (!ability) return { ok: false, reason: 'unknown_ability' };
  if (!isEligible(player, ability)) return { ok: false, reason: 'class_locked' };
  if (isMaxed(player, ability)) return { ok: false, reason: 'maxed' };
  if (player.abilityPoints < 1) return { ok: false, reason: 'no_points' };

  player.abilityPoints -= 1;
  player.abilities[abilityId] = getRank(player, abilityId) + 1;
  ability.apply(player, room);

  _broadcastBuild(room, player);
  room.broadcast({
    type: 'floating_text',
    text: `${ability.icon} SKILL TREE: ${ability.name.toUpperCase()} → RANK ${player.abilities[abilityId]}`,
    x: player.x,
    z: player.z,
    style: 'combo'
  });
  return { ok: true, ability: abilityId, rank: player.abilities[abilityId], abilityPoints: player.abilityPoints };
}

// Bot auto-pick: bots consume pending choices + spend banked points instantly.
function autoResolveBot(player, room) {
  if (!player || !player.isBot) return;
  if (player.pendingChoices.length > 0) {
    const pick = player.pendingChoices[Math.floor(Math.random() * player.pendingChoices.length)];
    applyAbilityPick(room, player.id, pick);
  }
  player.pendingChoices = []; // unchosen offers expire for bots
  while (player.abilityPoints > 0) {
    const pool = offerablePool(player);
    if (pool.length === 0) break;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const res = spendAbilityPoint(room, player.id, pick.id);
    if (!res.ok) break;
  }
}

function _broadcastBuild(room, player) {
  room.broadcast({ type: 'build_update', playerId: player.id, build: getPlayerBuild(player.id) });
}

// ---------------------------------------------------------------------------
// getPlayerBuild(playerId) -> build summary for UI / other agents.
// { playerId, name, classKey, level, abilityPoints, ranks: {id: rank},
//   pendingChoices: [ids], tree: { wrath: [...], aegis: [...] } }
// ---------------------------------------------------------------------------
function getPlayerBuild(playerId) {
  const player = buildRegistry.get(playerId);
  if (!player) return null;
  initPlayer(player);
  const tree = { wrath: [], aegis: [] };
  for (const a of ABILITIES) {
    const rank = getRank(player, a.id);
    tree[a.branch].push({
      ...serializeChoice(player, a),
      eligible: isEligible(player, a),
      affordable: player.abilityPoints > 0 && isEligible(player, a) && !isMaxed(player, a)
    });
  }
  return {
    playerId: player.id,
    name: player.name,
    classKey: player.classKey,
    level: player.level || 1,
    abilityPoints: player.abilityPoints || 0,
    ranks: { ...player.abilities },
    pendingChoices: [...player.pendingChoices],
    tree
  };
}

// Full tree definition for a class (client skill-tree panel bootstrap).
// Phase 3 unlockable classes inherit their ability pool from a base class
// family (defined in MetaProgression) — real abilities, no placeholders.
function familyOf(classKey) {
  const fam = {
    plaguecaller: 'necromancer',
    gravewarden: 'juggernaut',
    hexblade: 'rogue'
  };
  return fam[classKey] || classKey;
}

function getTreeForClass(classKey) {
  const fam = familyOf(classKey);
  return {
    branches: Object.values(BRANCHES),
    abilities: ABILITIES.map(a => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      description: a.description,
      branch: a.branch,
      maxRanks: a.maxRanks,
      eligible: a.classes.includes(classKey) || a.classes.includes(fam)
    }))
  };
}

module.exports = {
  BRANCHES,
  ABILITIES,
  initPlayer,
  dropPlayer,
  getAbility,
  getRank,
  isEligible,
  isMaxed,
  offerablePool,
  rollChoices,
  applyAbilityPick,
  spendAbilityPoint,
  autoResolveBot,
  getPlayerBuild,
  getTreeForClass
};
