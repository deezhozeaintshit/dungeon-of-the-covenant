// systems/Health.js — SERVER-AUTHORITATIVE player HP system.
// ========================================================
// The client NEVER dictates health. Any client-sent hp/xp values in
// inputData are hostile input and MUST be ignored (never read them).
// All damage/healing flows through these functions; they validate,
// clamp, apply armor/resists/invuln, and return the ACTUAL amount dealt.
//
// Player state fields owned by this module (initialized by initPlayer):
//   player.hp, player.maxHp            - current / max hit points
//   player.armor                       - flat damage reduction (number >= 0)
//   player.resists                      - { damageType: 0..1 } fractional reduction
//   player.resistAll                    - fractional reduction vs ALL types
//   player.thorns                       - fraction of damage taken reflected to attacker
//   player.hpRegen                      - fraction of maxHp regenerated per second
//   player.invulnerableTimer            - seconds of i-frames remaining (existing field)
//   player.state                        - 'alive' | 'downed' | 'dead'  (mirrors isDowned/isDead)
//   player.downedTimer                  - seconds left in revive window (existing field)
//   player.respawnTimer                 - seconds until auto-respawn once dead
//   player.deathCount                   - deaths this run
//
// DEATH / RESPAWN RULES (documented decision):
//   hp hits 0      -> DOWNED (30s ally-revive window, existing co-op flow)
//   downed expires -> DEAD, auto-respawn in 15s at floor entrance (x=0, z=15),
//                     full HP, 3s invulnerability, no penalty
//   manual respawn -> while dead, the player may request an EARLY respawn
//                     (respawn_request) at the cost of 10% of current XP.
//   Whole party dead/downed -> 'party_wipe' / defeat is still owned by
//   Room.checkEndConditions (unchanged).

const ComboEngine = require('../Combos');

const RESPAWN_DELAY_SEC = 15;     // auto-respawn delay once dead
const RESPAWN_INVULN_SEC = 3.0;   // i-frames granted on respawn
const DOWNED_DURATION_SEC = 30;   // ally revive window (matches legacy value)
const MAX_SINGLE_HIT = 1000000;   // sanity clamp on any one damage/heal call

// Floor entrance anchor — matches addPlayer spawn (x offset, z = 15).
const SPAWN_X = 0;
const SPAWN_Z = 15;

function _num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Ensure every health-owned field exists on a fresh player object.
// Coordinator: call once in Room.addPlayer (see PROTOCOL.md integration).
function initPlayer(player) {
  if (!player || typeof player !== 'object') return;
  if (typeof player.armor !== 'number') player.armor = 0;
  if (!player.resists || typeof player.resists !== 'object') player.resists = {};
  if (typeof player.resistAll !== 'number') player.resistAll = 0;
  if (typeof player.thorns !== 'number') player.thorns = 0;
  if (typeof player.hpRegen !== 'number') player.hpRegen = 0;
  if (typeof player.invulnerableTimer !== 'number') player.invulnerableTimer = 0;
  if (typeof player.state !== 'string') player.state = player.isDead ? 'dead' : (player.isDowned ? 'downed' : 'alive');
  if (typeof player.downedTimer !== 'number') player.downedTimer = 0;
  if (typeof player.respawnTimer !== 'number') player.respawnTimer = 0;
  if (typeof player.deathCount !== 'number') player.deathCount = 0;
  if (!player.stats || typeof player.stats !== 'object') player.stats = {};
  if (typeof player.stats.damageTaken !== 'number') player.stats.damageTaken = 0;
  if (typeof player.stats.healingDone !== 'number') player.stats.healingDone = 0;
  player.hp = Math.max(0, Math.min(_num(player.hp, 1), _num(player.maxHp, 1)));
}

function _getPlayer(room, playerId) {
  if (!room || !room.players) return null;
  return room.players[playerId] || null;
}

// ---------------------------------------------------------------------------
// damagePlayer(room, playerId, amount, { type, sourceName, attackerId })
// Applies validated, mitigated damage to a player. Returns the ACTUAL damage
// dealt after armor/resists/invuln (useful for lifesteal / combat credit).
// Result: { dealt, dodged, downed, killed, ignored }
// ---------------------------------------------------------------------------
function damagePlayer(room, playerId, amount, opts = {}) {
  initPlayerGuard(room, playerId);
  const player = _getPlayer(room, playerId);
  const fail = { dealt: 0, dodged: false, downed: false, killed: false, ignored: true };
  if (!player) return fail;

  // Dead or already downed players cannot be damaged further.
  if (player.isDead || player.isDowned) return { ...fail, ignored: true };

  let dmg = _num(amount, 0);
  if (dmg <= 0) return { ...fail, ignored: false }; // hostile/zero input -> no-op
  dmg = Math.min(dmg, MAX_SINGLE_HIT);

  const damageType = typeof opts.type === 'string' ? opts.type : 'physical';
  const sourceName = typeof opts.sourceName === 'string' ? opts.sourceName : 'Enemy';

  // 1. Invulnerability i-frames (tactical dash / respawn grace).
  if (player.invulnerableTimer > 0) {
    room.broadcast({
      type: 'floating_text',
      text: 'DODGED!',
      x: player.x,
      z: player.z,
      style: 'combo'
    });
    return { dealt: 0, dodged: true, downed: false, killed: false, ignored: false };
  }

  // 2. Flat armor reduction.
  const armor = Math.max(0, _num(player.armor, 0));
  dmg = Math.max(0, dmg - armor);

  // 3. Fractional resists: per-type, then resist-all.
  const typeResist = Math.max(0, Math.min(0.95, _num(player.resists[damageType], 0)));
  const allResist = Math.max(0, Math.min(0.95, _num(player.resistAll, 0)));
  dmg = dmg * (1 - typeResist) * (1 - allResist);

  // 4. 'shielded' status (Iron Bastion / regroup) — legacy 60% reduction.
  if (ComboEngine.hasStatus(player, 'shielded')) {
    dmg = dmg * 0.4;
  }

  const dealt = Math.max(0, Math.round(dmg));
  if (dealt <= 0) return { dealt: 0, dodged: false, downed: false, killed: false, ignored: false };

  player.hp = Math.max(0, player.hp - dealt);
  player.stats.damageTaken += dealt;

  // 5. Thorns: reflect a fraction of the DEALT damage back at the attacker.
  const thorns = Math.max(0, Math.min(1, _num(player.thorns, 0)));
  if (thorns > 0 && opts.attackerId && room.mobs) {
    const mob = room.mobs.find(m => m.id === opts.attackerId && !m.isDead);
    if (mob) {
      const reflect = Math.max(1, Math.round(dealt * thorns));
      mob.hp = Math.max(0, mob.hp - reflect);
      room.broadcast({
        type: 'floating_text',
        text: `🗡️ THORNS ${reflect}`,
        x: mob.x,
        z: mob.z,
        style: 'crit'
      });
      if (mob.hp <= 0 && typeof room.handleEntityDeath === 'function') {
        room.handleEntityDeath(mob, player); // player credited with the kill
      }
    }
  }

  if (player.hp <= 0) {
    _enterDowned(room, player);
    return { dealt, dodged: false, downed: true, killed: false, ignored: false };
  }
  return { dealt, dodged: false, downed: false, killed: false, ignored: false };
}

function initPlayerGuard(room, playerId) {
  const p = _getPlayer(room, playerId);
  if (p) initPlayer(p);
}

function _enterDowned(room, player) {
  player.hp = 0;
  player.isDowned = true;
  player.isDead = false;
  player.state = 'downed';
  // Phase 2: Ashen Martyr oath halves the bleed-out timer (sworn burn faster).
  const oaths = (player.oathState && player.oathState.oaths) || [];
  player.downedTimer = oaths.includes('ashen_martyr')
    ? DOWNED_DURATION_SEC / 2
    : DOWNED_DURATION_SEC;
  player.respawnTimer = 0;
  room.broadcast({
    type: 'player_downed',
    playerId: player.id,
    playerName: player.name,
    x: player.x,
    z: player.z
  });
  room.broadcast({
    type: 'narrator_announcement',
    text: `${player.name} has fallen! Step into their glyph to revive!`,
    tone: 'danger'
  });
}

// Downed timer ran out with no revive -> true death, respawn clock starts.
function _enterDead(room, player) {
  player.isDowned = false;
  player.isDead = true;
  player.state = 'dead';
  player.hp = 0;
  player.deathCount += 1;
  player.respawnTimer = RESPAWN_DELAY_SEC;
  player.revivingTargetId = null;
  player.reviveProgress = 0;
  room.broadcast({
    type: 'player_died',
    playerId: player.id,
    playerName: player.name,
    x: player.x,
    z: player.z,
    respawnIn: RESPAWN_DELAY_SEC,
    deathCount: player.deathCount
  });
  room.broadcast({
    type: 'narrator_announcement',
    text: `${player.name} has succumbed to their wounds in the dark...`,
    tone: 'warning'
  });
}

// ---------------------------------------------------------------------------
// healPlayer(room, playerId, amount, sourceName) -> actual healed (number)
// Only living, non-downed players can be healed (downed players need revive).
// Never overheals. Returns 0 for dead/downed/invalid input.
// ---------------------------------------------------------------------------
function healPlayer(room, playerId, amount, sourceName = 'Heal') {
  initPlayerGuard(room, playerId);
  const player = _getPlayer(room, playerId);
  if (!player || player.isDead || player.isDowned) return 0;

  let amt = _num(amount, 0);
  if (amt <= 0) return 0;
  amt = Math.min(amt, MAX_SINGLE_HIT);

  const missing = Math.max(0, player.maxHp - player.hp);
  const healed = Math.min(missing, Math.round(amt));
  player.hp += healed;
  player.stats.healingDone += healed;
  return healed;
}

// ---------------------------------------------------------------------------
// setMaxHp(room, playerId, newMax, { healDelta })
// Authoritative max-HP change (level-ups, blessings, forge armor, abilities).
// healDelta=true (default): also heal the delta so the player isn't punished.
// Returns the new maxHp.
// ---------------------------------------------------------------------------
function setMaxHp(room, playerId, newMax, opts = {}) {
  initPlayerGuard(room, playerId);
  const player = _getPlayer(room, playerId);
  if (!player) return 0;
  const healDelta = opts.healDelta !== false;

  const clamped = Math.max(1, Math.round(_num(newMax, player.maxHp)));
  const delta = clamped - player.maxHp;
  player.maxHp = clamped;
  if (healDelta && delta > 0) {
    player.hp = Math.min(player.maxHp, player.hp + delta);
  } else {
    player.hp = Math.min(player.maxHp, Math.max(0, player.hp));
  }
  return player.maxHp;
}

// ---------------------------------------------------------------------------
// revivePlayer(room, playerId, hpPct) — ally revive (existing 45% rule).
// Returns true if the revive landed.
// ---------------------------------------------------------------------------
function revivePlayer(room, playerId, hpPct = 0.45) {
  initPlayerGuard(room, playerId);
  const player = _getPlayer(room, playerId);
  if (!player || !player.isDowned || player.isDead) return false;
  player.isDowned = false;
  player.state = 'alive';
  player.hp = Math.max(1, Math.round(player.maxHp * hpPct));
  player.downedTimer = 0;
  player.invulnerableTimer = Math.max(player.invulnerableTimer || 0, 1.5);
  return true;
}

// ---------------------------------------------------------------------------
// respawnPlayer(room, playerId, { early }) — dead -> alive at floor entrance.
// early=true: instant respawn at the cost of 10% current XP (player's choice).
// ---------------------------------------------------------------------------
function respawnPlayer(room, playerId, opts = {}) {
  initPlayerGuard(room, playerId);
  const player = _getPlayer(room, playerId);
  if (!player || !player.isDead) return false;

  let xpPenalty = 0;
  if (opts.early && player.xp > 0) {
    xpPenalty = Math.floor(player.xp * 0.10);
    player.xp = Math.max(0, player.xp - xpPenalty);
  }

  const idx = Object.keys(room.players).indexOf(playerId);
  player.x = SPAWN_X + ((idx % 5) * 1.5 - 3.0);
  player.y = 0;
  player.z = SPAWN_Z;
  player.vx = 0;
  player.vz = 0;
  player.rotation = Math.PI; // face into the dungeon (north, -z)
  player.hp = player.maxHp;
  player.isDead = false;
  player.isDowned = false;
  player.state = 'alive';
  player.respawnTimer = 0;
  player.downedTimer = 0;
  player.statuses = {};
  player.cooldowns = {
    attack: 0, skill1: 0, skill2: 0, skill3: 0, dash: 0,
    jump: 0, tacticalHeal: 0
  };
  player.invulnerableTimer = RESPAWN_INVULN_SEC;
  player.revivingTargetId = null;
  player.reviveProgress = 0;

  room.broadcast({
    type: 'player_respawned',
    playerId: player.id,
    playerName: player.name,
    x: player.x,
    z: player.z,
    early: Boolean(opts.early),
    xpPenalty
  });
  room.broadcast({
    type: 'floating_text',
    text: opts.early ? `⚔️ ${player.name} REFORGED EARLY! (-${xpPenalty} XP)` : `⚔️ ${player.name} REFORGED BY THE COVENANT!`,
    x: player.x,
    z: player.z,
    style: 'heal'
  });
  return true;
}

// Manual early-respawn request from the death screen (respawn_request msg).
// Returns { ok, reason } for the coordinator's ack.
function requestRespawn(room, playerId) {
  initPlayerGuard(room, playerId);
  const player = _getPlayer(room, playerId);
  if (!player) return { ok: false, reason: 'no_player' };
  if (!player.isDead) return { ok: false, reason: player.isDowned ? 'awaiting_revive' : 'alive' };
  const ok = respawnPlayer(room, playerId, { early: true });
  return { ok, reason: ok ? 'respawned' : 'failed' };
}

// ---------------------------------------------------------------------------
// tick(room, dt) — per-tick health maintenance. Coordinator: call ONCE per
// Room.update() tick (20Hz). Handles:
//   * downedTimer expiry -> _enterDead (REPLACES the legacy block in
//     Room.updatePlayers — delete it to avoid double-death)
//   * respawnTimer countdown -> auto respawnPlayer
//   * hpRegen (Second Wind ability) on living players
// ---------------------------------------------------------------------------
function tick(room, dt) {
  if (!room || !room.players || room.state !== 'dungeon') return;
  const step = _num(dt, 0);
  if (step <= 0) return;

  for (const player of Object.values(room.players)) {
    initPlayer(player);

    if (player.isDowned && !player.isDead) {
      player.downedTimer -= step;
      if (player.downedTimer <= 0) {
        _enterDead(room, player);
      }
      continue;
    }

    if (player.isDead) {
      if (player.respawnTimer > 0) {
        player.respawnTimer -= step;
        if (player.respawnTimer <= 0) {
          respawnPlayer(room, player.id, { early: false });
        }
      }
      continue;
    }

    // Living: passive regen (Second Wind ability stacks).
    const regen = Math.max(0, _num(player.hpRegen, 0));
    if (regen > 0 && player.hp > 0 && player.hp < player.maxHp) {
      healPlayer(room, player.id, player.maxHp * regen * step, 'Second Wind');
    }
  }
}

// Snapshot helpers — coordinator appends these fields in Room.getSnapshot().
function snapshotFields(player) {
  return {
    state: player.state || 'alive',
    respawnIn: Math.max(0, Math.ceil(player.respawnTimer || 0)),
    armor: Math.round(player.armor || 0),
    deathCount: player.deathCount || 0
  };
}

module.exports = {
  RESPAWN_DELAY_SEC,
  RESPAWN_INVULN_SEC,
  DOWNED_DURATION_SEC,
  SPAWN_X,
  SPAWN_Z,
  initPlayer,
  damagePlayer,
  healPlayer,
  setMaxHp,
  revivePlayer,
  respawnPlayer,
  requestRespawn,
  tick,
  snapshotFields
};
