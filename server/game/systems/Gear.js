// systems/Gear.js — SERVER-AUTHORITATIVE loot inventory & equipment.
// ================================================================
// The full gear loop lives here, server-side only:
//
//   kill enemy  -> Room.handleEntityDeath rolls via LootGenerator
//   drop spawns -> floor loot (server-issued item data)
//   pickup      -> Gear.addToInventory (item enters INVENTORY, not stats)
//   equip       -> client sends { type: 'gear_equip', itemId } ONLY
//   stats       -> Gear validates ownership + slot, then recomputes
//
// Security contract (mirrors Progression.js / Health.js):
//   - Client-sent item STATS are never read. Equip requests carry an
//     itemId; the item is looked up in the player's own server-side
//     inventory. Forged ids, ids from other players' inventories, or
//     invented stat blocks are rejected with a 'gear_error' message.
//   - Combat stats (damageBuff, critChance, lifesteal, cooldownHaste,
//     armor, resistAll, maxHp) are recomputed here from equipped items.
//     player.gearBonus tracks exactly what gear contributed so unequip
//     restores the base build precisely (no stat creep).
//
// Protocol (client must never send anything not listed here):
//   C->S: { type: 'gear_equip', itemId }      equip an owned item
//   C->S: { type: 'gear_unequip', slot }     unequip a slot
//   S->C: { type: 'inventory_update', playerId, inventory, equipped,
//           gearBonus, gearScore, cap }       authoritative state
//   S->C: { type: 'gear_pickup', playerId, playerName, item, source }
//   S->C: { type: 'gear_equipped', playerId, playerName, item, slot }
//   S->C: { type: 'gear_error', playerId, message }   (client filters by id)

const Health = require('./Health');
const LootGenerator = require('../LootGenerator');

const SLOTS = ['weapon', 'armor', 'relic'];
const INVENTORY_CAP = 40;

// Every gear stat key a generated item may carry. Anything else on a
// client-sent object is dropped by sanitizeItem.
const STAT_KEYS = ['damageBuff', 'maxHp', 'critChance', 'lifesteal', 'cooldownHaste', 'armor', 'resistAll'];

// Per-stat sanity clamps applied on sanitize (per ITEM, not total).
const STAT_CLAMP = {
  damageBuff: [0, 3],
  maxHp: [0, 5000],
  critChance: [0, 0.9],
  lifesteal: [0, 0.9],
  cooldownHaste: [0, 0.9],
  armor: [0, 500],
  resistAll: [0, 0.5]
};

function _num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _zeroBonus() {
  return { damageBuff: 0, maxHp: 0, critChance: 0, lifesteal: 0, cooldownHaste: 0, armor: 0, resistAll: 0 };
}

function _clampStat(key, v) {
  const [lo, hi] = STAT_CLAMP[key];
  return Math.max(lo, Math.min(hi, _num(v, 0)));
}

// ---------------------------------------------------------------------------
// Item sanitization — the single choke point. Returns a clean item or null.
// id/name/slot/rarity/color are validated; stats are clamped; gearScore is
// RECOMPUTED from stats (never trusted). summary is rebuilt for display.
// ---------------------------------------------------------------------------
function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const slot = String(raw.slot || '');
  if (!SLOTS.includes(slot)) return null;
  const name = String(raw.name || '').slice(0, 80);
  if (!name) return null;
  const rarity = String(raw.rarity || 'common');
  const stats = {};
  for (const key of STAT_KEYS) stats[key] = _clampStat(key, raw.stats && raw.stats[key]);
  const rarityRec = LootGenerator.isValidRarity(rarity) ? rarity : 'common';
  const color = /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : '#c0c6d4';
  const gearScore = LootGenerator.gearScoreFor(stats);
  return {
    id: String(raw.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    name,
    slot,
    rarity: rarityRec,
    rarityName: String(raw.rarityName || rarityRec).slice(0, 24),
    color,
    floor: Math.max(1, Math.floor(_num(raw.floor, 1))),
    biome: String(raw.biome || '').slice(0, 40) || undefined,
    gearScore,
    stats,
    summary: summarizeStats(stats)
  };
}

function summarizeStats(stats) {
  const parts = [];
  if (stats.damageBuff > 0) parts.push(`+${Math.round(stats.damageBuff * 100)}% DMG`);
  if (stats.maxHp > 0) parts.push(`+${stats.maxHp} HP`);
  if (stats.critChance > 0) parts.push(`+${Math.round(stats.critChance * 100)}% CRIT`);
  if (stats.lifesteal > 0) parts.push(`+${Math.round(stats.lifesteal * 100)}% LEECH`);
  if (stats.cooldownHaste > 0) parts.push(`+${Math.round(stats.cooldownHaste * 100)}% HASTE`);
  if (stats.armor > 0) parts.push(`+${stats.armor} ARMOR`);
  if (stats.resistAll > 0) parts.push(`+${Math.round(stats.resistAll * 100)}% ALL RESIST`);
  return parts.join(' · ') || 'No bonus';
}

// ---------------------------------------------------------------------------
// Player init / snapshot. Coordinator: call once in Room.addPlayer.
// ---------------------------------------------------------------------------
function initPlayer(player) {
  if (!player || typeof player !== 'object') return;
  if (!Array.isArray(player.inventory)) player.inventory = [];
  if (!player.equipped || typeof player.equipped !== 'object') {
    player.equipped = { weapon: null, armor: null, relic: null };
  } else {
    for (const s of SLOTS) if (!(s in player.equipped)) player.equipped[s] = null;
  }
  if (!player.gearBonus || typeof player.gearBonus !== 'object') player.gearBonus = _zeroBonus();
  if (typeof player.gearScore !== 'number') player.gearScore = 0;
  if (!player.equipment || typeof player.equipment !== 'object') {
    player.equipment = { weapon: 'Covenant Initiate Arms', armor: 'Initiate Plate', relics: [] };
  }
}

function snapshotFields(player) {
  return {
    gearScore: player.gearScore || 0,
    gearBonus: { ..._zeroBonus(), ...(player.gearBonus || {}) }
    // NOTE: inventory is intentionally NOT in the broadcast snapshot —
    // it goes out via targeted inventory_update only.
  };
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------
function _getPlayer(room, playerId) {
  if (!room || !room.players) return null;
  return room.players[playerId] || null;
}

function _error(room, playerId, message) {
  room.broadcast({ type: 'gear_error', playerId, message });
  return { ok: false, reason: message };
}

// Targeted state push: broadcast with playerId so the client filters.
// (Matches the xp_update pattern used by Progression.)
function sendInventoryUpdate(room, player) {
  if (!room || !player) return;
  room.broadcast({
    type: 'inventory_update',
    playerId: player.id,
    inventory: player.inventory.map(i => ({ ...i, stats: { ...i.stats } })),
    equipped: {
      weapon: player.equipped.weapon ? { ...player.equipped.weapon } : null,
      armor: player.equipped.armor ? { ...player.equipped.armor } : null,
      relic: player.equipped.relic ? { ...player.equipped.relic } : null
    },
    gearBonus: { ...player.gearBonus },
    gearScore: player.gearScore,
    cap: INVENTORY_CAP
  });
}

// Keep legacy string display (party HUD / lobby) in sync with real slots.
function _syncDisplayEquipment(player) {
  const eq = player.equipped || {};
  player.equipment = {
    weapon: eq.weapon ? eq.weapon.name : 'Covenant Initiate Arms',
    armor: eq.armor ? eq.armor.name : 'Initiate Plate',
    relics: eq.relic ? [eq.relic.name] : []
  };
}

// ---------------------------------------------------------------------------
// Gear stat (re)apply. Subtracts exactly what gear previously contributed,
// then adds the current equipped set. No creep, no drift.
// ---------------------------------------------------------------------------
function _reapplyGear(room, player) {
  const old = player.gearBonus || _zeroBonus();
  player.damageBuff = +(_num(player.damageBuff, 1) - _num(old.damageBuff, 0)).toFixed(2);
  player.critChance = +(_num(player.critChance, 0.18) - _num(old.critChance, 0)).toFixed(2);
  player.lifesteal = +(_num(player.lifesteal, 0) - _num(old.lifesteal, 0)).toFixed(2);
  player.cooldownHaste = +(_num(player.cooldownHaste, 1) - _num(old.cooldownHaste, 0)).toFixed(2);
  player.armor = Math.max(0, Math.round(_num(player.armor, 0) - _num(old.armor, 0)));
  player.resistAll = +(_num(player.resistAll, 0) - _num(old.resistAll, 0)).toFixed(2);
  if (_num(old.maxHp, 0) > 0) {
    Health.setMaxHp(room, player.id, Math.max(1, player.maxHp - _num(old.maxHp, 0)));
  }

  const bonus = _zeroBonus();
  let gearScore = 0;
  for (const s of SLOTS) {
    const item = player.equipped[s];
    if (!item) continue;
    for (const key of STAT_KEYS) bonus[key] += _num(item.stats[key], 0);
    gearScore += _num(item.gearScore, 0);
  }
  for (const key of STAT_KEYS) {
    bonus[key] = key === 'maxHp' || key === 'armor' ? Math.round(bonus[key]) : +bonus[key].toFixed(2);
  }

  player.damageBuff = +(player.damageBuff + bonus.damageBuff).toFixed(2);
  player.critChance = +(player.critChance + bonus.critChance).toFixed(2);
  player.lifesteal = +(player.lifesteal + bonus.lifesteal).toFixed(2);
  player.cooldownHaste = +(player.cooldownHaste + bonus.cooldownHaste).toFixed(2);
  player.armor = Math.round(player.armor + bonus.armor);
  player.resistAll = +(player.resistAll + bonus.resistAll).toFixed(2);
  if (bonus.maxHp > 0) {
    Health.setMaxHp(room, player.id, player.maxHp + bonus.maxHp);
  }

  player.gearBonus = bonus;
  player.gearScore = gearScore;
  _syncDisplayEquipment(player);
}

// ---------------------------------------------------------------------------
// Inventory ops
// ---------------------------------------------------------------------------

// Server-issued item -> player inventory. Used by floor-loot pickup and
// chests. Returns { ok, reason }.
function addToInventory(room, player, rawItem, source = 'loot') {
  initPlayer(player);
  const item = sanitizeItem(rawItem);
  if (!item) return { ok: false, reason: 'Invalid item data.' };
  if (player.inventory.length >= INVENTORY_CAP) {
    return { ok: false, reason: `Inventory full (${INVENTORY_CAP}). Equip or leave loot behind.` };
  }
  if (player.inventory.some(i => i.id === item.id)) return { ok: false, reason: 'Already in inventory.' };
  player.inventory.push(item);
  sendInventoryUpdate(room, player);
  room.broadcast({
    type: 'gear_pickup',
    playerId: player.id,
    playerName: player.name,
    item,
    source
  });
  return { ok: true, item };
}

// Equip flow. itemId is looked up in the player's OWN server-side
// inventory — nothing from the client except the id is trusted.
function equip(room, playerId, itemId) {
  const player = _getPlayer(room, playerId);
  if (!player) return _error(room, playerId, 'Player not found.');
  if (player.isDead) return _error(room, playerId, 'Cannot equip while dead.');
  initPlayer(player);

  const id = String(itemId || '');
  const idx = player.inventory.findIndex(i => i.id === id);
  if (idx < 0) return _error(room, playerId, 'Item not in your inventory.');

  const item = player.inventory[idx];
  if (!SLOTS.includes(item.slot)) return _error(room, playerId, 'Item has no valid equipment slot.');

  player.inventory.splice(idx, 1);
  const current = player.equipped[item.slot];
  if (current) player.inventory.push(current);
  player.equipped[item.slot] = item;

  _reapplyGear(room, player);
  sendInventoryUpdate(room, player);

  room.broadcast({
    type: 'gear_equipped',
    playerId: player.id,
    playerName: player.name,
    item,
    slot: item.slot
  });
  room.broadcast({
    type: 'floating_text',
    text: `⚔️ [${String(item.rarityName).toUpperCase()}] ${item.name} (${item.summary})`,
    x: player.x,
    z: player.z,
    style: 'combo'
  });
  return { ok: true, item, slot: item.slot };
}

function unequip(room, playerId, slot) {
  const player = _getPlayer(room, playerId);
  if (!player) return _error(room, playerId, 'Player not found.');
  if (player.isDead) return _error(room, playerId, 'Cannot unequip while dead.');
  initPlayer(player);

  const s = String(slot || '');
  if (!SLOTS.includes(s)) return _error(room, playerId, 'Unknown equipment slot.');
  const current = player.equipped[s];
  if (!current) return _error(room, playerId, 'Nothing equipped in that slot.');
  if (player.inventory.length >= INVENTORY_CAP) {
    return _error(room, playerId, `Inventory full (${INVENTORY_CAP}).`);
  }

  player.equipped[s] = null;
  player.inventory.push(current);
  _reapplyGear(room, player);
  sendInventoryUpdate(room, player);
  room.broadcast({
    type: 'floating_text',
    text: `🛡️ Unequipped ${current.name}`,
    x: player.x,
    z: player.z,
    style: 'info'
  });
  return { ok: true, item: current, slot: s };
}

// ---------------------------------------------------------------------------
// NOTE: there are intentionally NO IAP / purchased stat-item grants anywhere
// in the gear system. The shop is cosmetics-only (server/cosmeticsCatalog.js);
// stat items are never sold and never granted. Any client-sent "purchased
// item" claim is rejected by the sanitize + validate path in grantAndEquip.
// ---------------------------------------------------------------------------

// Server-issued procedural item (profile restore, chest/legacy paths):
// sanitize, inventory, equip — all through the same validated pipeline.
function grantAndEquip(room, player, rawItem) {
  initPlayer(player);
  const item = sanitizeItem(rawItem);
  if (!item) return { ok: false, reason: 'Invalid item data.' };
  if (!player.inventory.some(i => i.id === item.id)) {
    if (player.inventory.length >= INVENTORY_CAP) return { ok: false, reason: 'Inventory full.' };
    player.inventory.push(item);
  }
  return equip(room, player.id, item.id);
}

module.exports = {
  SLOTS,
  INVENTORY_CAP,
  STAT_KEYS,
  initPlayer,
  snapshotFields,
  sanitizeItem,
  summarizeStats,
  addToInventory,
  equip,
  unequip,
  grantAndEquip,
  sendInventoryUpdate
};
