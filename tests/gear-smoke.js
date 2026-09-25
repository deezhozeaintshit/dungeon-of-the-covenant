// Phase 3 loot & gear smoke test: real Room, headless.
// Verifies the full loop end-to-end with zero mocks:
//   kill -> server rolls drop -> gear_drop on floor -> walk-over pickup ->
//   inventory -> gear_equip (id only) -> server recomputes stats ->
//   forged equip requests rejected.
const Room = require('../server/game/Room');
const LootGenerator = require('../server/game/LootGenerator');
const Gear = require('../server/game/systems/Gear');

const broadcastLog = [];
const room = new Room('GEARSMOKE', null);
room.setBroadcastCallback((m) => broadcastLog.push(m));

let failures = 0;
function check(name, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) failures++;
}

// --- 1. Biome drop tables exist for the real biome ids ---
const biomes = ['ossuary_crypt', 'glacial_sanctum', 'blood_citadel', 'void_nexus', 'blight_catacombs'];
for (const b of biomes) {
  const info = LootGenerator.biomeInfo(b);
  check(`biome table ${b}`, info.id === b && typeof info.dropChance.trash === 'number',
    `trash=${info.dropChance.trash} elite=${info.dropChance.elite} boss=${info.dropChance.boss} bias=${info.affixBias.join('+')}`);
}
check('legacy alias crypt resolves', LootGenerator.biomeInfo('crypt').id === 'ossuary_crypt');
check('unknown biome falls back', LootGenerator.biomeInfo('nope').id === 'ossuary_crypt');

// Boss/elite always drop; trash drops at the table rate (sampled).
check('boss always drops', Array.from({ length: 50 }).every(() => LootGenerator.rollDropChance('boss', 'void_nexus')));
check('elite always drops', Array.from({ length: 50 }).every(() => LootGenerator.rollDropChance('elite', 'blood_citadel')));
const trashRate = Array.from({ length: 2000 }).filter(() => LootGenerator.rollDropChance('trash', 'ossuary_crypt')).length / 2000;
check('trash drop rate near table (0.45)', Math.abs(trashRate - 0.45) < 0.06, `sampled=${trashRate.toFixed(3)}`);

// Item generation: valid slots/rarities, biome tagging, resist/armor affixes appear.
const seenStats = new Set();
let badItem = 0;
for (let i = 0; i < 300; i++) {
  const it = LootGenerator.generateItem(3, 'mob', 'glacial_sanctum');
  if (!Gear.SLOTS.includes(it.slot) || !LootGenerator.isValidRarity(it.rarity)) badItem++;
  if (it.biome !== 'glacial_sanctum') badItem++;
  for (const k of Object.keys(it.stats)) seenStats.add(k);
  const sane = Gear.sanitizeItem(it);
  if (!sane || sane.gearScore !== it.gearScore) badItem++;
}
check('300 generated items valid + sanitize round-trips', badItem === 0);
check('affix pool includes armor + resistAll', seenStats.has('armor') && seenStats.has('resistAll'),
  `stats seen: ${[...seenStats].join(',')}`);

// --- 2. Room: kill -> drop -> pickup -> inventory ---
const p = room.addPlayer('sock1', 'Hero', 'mage', false);
const p2 = room.addPlayer('sock2', 'Hero2', 'rogue', false);
room.startDungeon();
check('inventory_update sent on join', broadcastLog.some(m => m.type === 'inventory_update' && m.playerId === 'sock1'));
check('gear fields init', Array.isArray(p.inventory) && p.inventory.length === 0 && p.gearScore === 0);

let dropLoot = null;
for (let i = 0; i < 40 && !dropLoot; i++) {
  const mob = room.spawnMob('crypt_ghoul', 10, 10);
  room.dealDirectDamage(p, mob, 99999, 'physical');
  dropLoot = room.floorLoot.find(l => l.type === 'gear_drop' && !l.pickedUp);
}
check('trash kill produced a server-decided gear_drop', !!dropLoot, dropLoot ? `${dropLoot.itemData.rarity}/${dropLoot.itemData.name}` : 'none in 40 kills');
check('dropped item is server-issued + sanitized', !!dropLoot && Gear.sanitizeItem(dropLoot.itemData) !== null);

const baseDmg = p.damageBuff, baseHp = p.maxHp, baseCrit = p.critChance, baseArmor = p.armor;
// Walk onto the drop -> pickup goes to INVENTORY, stats unchanged.
p.x = dropLoot.x; p.z = dropLoot.z;
room.updateFloorLoot();
check('pickup landed in inventory (not auto-equipped)', p.inventory.length === 1 && p.inventory[0].id === dropLoot.itemData.id);
check('stats unchanged by pickup', p.damageBuff === baseDmg && p.maxHp === baseHp && p.critChance === baseCrit && p.armor === baseArmor);
check('gear_pickup broadcast', broadcastLog.some(m => m.type === 'gear_pickup' && m.playerId === 'sock1'));

// --- 3. Equip: stats recomputed server-side from the item ---
const item = p.inventory[0];
const res = room.handleGearEquip('sock1', item.id);
check('equip ok', res.ok === true, `slot=${res.slot}`);
check('equip applied exact item stats',
  p.damageBuff === +(baseDmg + item.stats.damageBuff).toFixed(2) &&
  p.critChance === +(baseCrit + item.stats.critChance).toFixed(2) &&
  p.armor === baseArmor + item.stats.armor &&
  p.maxHp === baseHp + item.stats.maxHp,
  `dmg ${baseDmg}->${p.damageBuff} hp ${baseHp}->${p.maxHp} armor ${baseArmor}->${p.armor}`);
check('gear_equipped broadcast', broadcastLog.some(m => m.type === 'gear_equipped' && m.playerId === 'sock1'));
check('inventory_update reflects equipped', broadcastLog.some(m => m.type === 'inventory_update' && m.playerId === 'sock1' && m.equipped[res.slot] && m.equipped[res.slot].id === item.id));

// --- 4. Equip swap: old item returns to inventory, no stat creep ---
const item2 = LootGenerator.generateItem(5, 'elite', 'blood_citadel');
// Force same slot so the swap path is exercised.
const swap = { ...item2, slot: res.slot };
const addRes = Gear.addToInventory(room, p, swap);
check('second item added', addRes.ok === true);
const beforeSwapDmg = p.damageBuff, beforeSwapHp = p.maxHp;
const swapRes = room.handleGearEquip('sock1', addRes.item.id);
check('swap ok', swapRes.ok === true);
check('old item returned to inventory', p.inventory.some(i => i.id === item.id));
check('swap recomputed (no stacking)',
  p.damageBuff === +(beforeSwapDmg - item.stats.damageBuff + addRes.item.stats.damageBuff).toFixed(2) &&
  p.maxHp === beforeSwapHp - item.stats.maxHp + addRes.item.stats.maxHp,
  `dmg=${p.damageBuff} hp=${p.maxHp}`);

// --- 5. Unequip restores baseline exactly ---
const preUnequip = { dmg: p.damageBuff, hp: p.maxHp, crit: p.critChance, armor: p.armor };
const unRes = room.handleGearUnequip('sock1', res.slot);
check('unequip ok', unRes.ok === true);
check('unequip restored exact stats',
  p.damageBuff === +(preUnequip.dmg - addRes.item.stats.damageBuff).toFixed(2) &&
  p.maxHp === preUnequip.hp - addRes.item.stats.maxHp &&
  p.critChance === +(preUnequip.crit - addRes.item.stats.critChance).toFixed(2) &&
  p.armor === preUnequip.armor - addRes.item.stats.armor);

// --- 6. FORGED requests rejected ---
const forgedStats = { dmg: p.damageBuff, hp: p.maxHp };
const f1 = room.handleGearEquip('sock1', 'item_does_not_exist_999');
check('forged unknown itemId rejected', f1.ok === false);
check('gear_error broadcast for forged equip',
  broadcastLog.some(m => m.type === 'gear_error' && m.playerId === 'sock1' && /not in your inventory/i.test(m.message)));
check('stats unchanged after forged equip', p.damageBuff === forgedStats.dmg && p.maxHp === forgedStats.hp);

// Cross-player forgery: sock2 owns an item; sock1 tries to equip it.
const p2item = LootGenerator.generateItem(2, 'mob', 'ossuary_crypt');
const p2add = Gear.addToInventory(room, p2, p2item);
check('p2 item added', p2add.ok === true);
const f2 = room.handleGearEquip('sock1', p2add.item.id);
check("other player's item rejected", f2.ok === false);
check('p2 item still owned by p2', p2.inventory.some(i => i.id === p2add.item.id));

// Bad slot unequip.
const f3 = room.handleGearUnequip('sock1', 'boots');
check('invalid slot rejected', f3.ok === false);

// --- 7. Profile-restore / legacy grant path: sanitize + clamp, never trust ---
// (Shop is cosmetics-only: no stat items are ever granted from purchases.
// A hostile client-shaped item is clamped by sanitizeItem before it can
// touch combat stats.)
const grantDmgBefore = p.damageBuff, grantHpBefore = p.maxHp;
room.equipProceduralItem(p, {
  id: 'legacy_profile_blade',
  name: 'HACKED NAME',
  slot: 'weapon',
  rarity: 'mythic',
  color: '#ff2a55',
  gearScore: 999999,
  stats: { damageBuff: 99, maxHp: 99999, critChance: 9, lifesteal: 9, cooldownHaste: 9, armor: 9999, resistAll: 9, moveSpeed: 99 }
});
const granted = p.equipped.weapon;
check('legacy grant clamped to sane stats (not client values)',
  granted && granted.id === 'legacy_profile_blade' &&
  p.damageBuff === +(grantDmgBefore + 3).toFixed(2) && // clamped per-item max
  p.maxHp === grantHpBefore + 5000 &&
  granted.gearScore === LootGenerator.gearScoreFor(granted.stats), // recomputed, not 999999
  `dmg=${p.damageBuff} hp=${p.maxHp} gs=${granted && granted.gearScore}`);
check('unknown stat keys dropped', granted && !('moveSpeed' in granted.stats));

// --- 8. sanitizeItem clamps hostile input ---
const hostile = Gear.sanitizeItem({
  id: 'x', name: 'Hax', slot: 'weapon', rarity: 'mythic', color: '#ff2a55',
  stats: { damageBuff: 999, maxHp: -500, critChance: 5, lifesteal: 0, cooldownHaste: 0, armor: 1e6, resistAll: 2, moveSpeed: 99 }
});
check('hostile stats clamped, unknown keys dropped',
  hostile && hostile.stats.damageBuff === 3 && hostile.stats.maxHp === 0 &&
  hostile.stats.critChance === 0.9 && hostile.stats.armor === 500 &&
  hostile.stats.resistAll === 0.5 && !('moveSpeed' in hostile.stats));
check('rejects bad slot', Gear.sanitizeItem({ id: 'x', name: 'Hax', slot: 'boots', stats: {} }) === null);

// --- 9. Snapshot carries gear fields (party HUD), not full inventory ---
const snap = room.getSnapshot();
const sp = snap.players.find(x => x.id === 'sock1');
check('snapshot has gearScore + gearBonus', typeof sp.gearScore === 'number' && sp.gearBonus && typeof sp.gearBonus.damageBuff === 'number');
check('snapshot equipment display synced', typeof sp.equipment.weapon === 'string' && sp.equipment.weapon.length > 0);

console.log(failures === 0 ? '\nALL GEAR SMOKE TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
