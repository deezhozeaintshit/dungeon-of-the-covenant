# SIGNATURE_PROTOCOL.md — Workstream 6 (Signature Features) wire-up guide

Three server systems live in `server/game/systems/`: **Oaths.js** (flagship),
**LivingDungeon.js**, **Nemesis.js**. They are new files only — nothing in
`Room.js`, `server.js`, or other agents' systems was modified. This document is
the exact contract the coordinator needs to wire them in.

Defensive pattern used throughout: every cross-system call is guarded
(`room.systems?.health?.setMaxHp?.(...)`), so these systems load and run even
if Health.js / Progression.js / Abilities.js are not present yet.

---

## 1. Systems registry

In `server/server.js` (or wherever rooms are constructed), attach once per room:

```js
const Oaths = require('./game/systems/Oaths');
const LivingDungeon = require('./game/systems/LivingDungeon');
const Nemesis = require('./game/systems/Nemesis');

room.systems = room.systems || {};
room.systems.oaths = Oaths;
room.systems.livingDungeon = LivingDungeon;
room.systems.nemesis = Nemesis;

LivingDungeon.init(room);
Nemesis.init(room);
// Oaths needs no init — state is per-player (player.oathState) + room.oathShrines.
```

---

## 2. WebSocket protocol — new message types

### Client → Server

| type | fields | effect |
|---|---|---|
| `swear_oath` | `{ shrineId, oathId }` | Validates (alive, in range ≤5m, shrine offered it, <2 oaths this run, shrine unused by player) then applies the oath. Replies via `oath_sworn` or `oath_swear_denied`. |

Route it in `server.js`'s message switch next to `tactical_command`:
```js
case 'swear_oath': {
  const meta = socketMeta.get(ws);
  const room = meta && rooms.get(meta.roomCode);
  if (room && room.state === 'dungeon' && room.systems?.oaths) {
    room.systems.oaths.handleSwear(room, meta.playerId, data.shrineId, data.oathId);
  }
  break;
}
```

### Server → Client

| type | fields | client behavior |
|---|---|---|
| `oath_shrines_spawned` | `{ shrines: [{id,x,z,model,name}], text }` | Render 3D shrine markers. `model` is `'oath_obelisk'` → `client/assets/models/covenant_obelisk.glb`, `'oath_altar'` → `client/assets/models/soul_altar.glb`. |
| `oath_shrine_available` | `{ playerId, shrineId, shrineName, x, z, choices: [OathDef...] }` | **Only the addressed player** opens the swear ceremony modal (`client/js/ui/oathModal.js`). Others ignore (or show a subtle toast). |
| `oath_sworn` | `{ playerId, playerName, classKey, oathId, oathName, icon, flavor, partyText }` | Party-wide drama toast + buff badge for the swearer. |
| `oath_swear_denied` | `{ playerId, reason }` | Toast the reason to the requester. |
| `oath_broken` | `{ playerId, playerName, oathId, oathName, icon, reason, curseName, curseDesc, partyText }` | Party-wide betrayal toast; remove the swearer’s oath badge; show curse debuff. |
| `dungeon_whisper` | `{ text }` | Narrator whisper styling (violet italic) — Living Dungeon adaptation telegraphs. Always paired with `narrator_announcement` tone `warning`. |
| `dungeon_adaptation` | `{ mobIds, x, z }` | Optional client VFX at the adaptation spawn point. |
| `nemesis_fled` | `{ mobId, name, grudgeName, returns, text }` | Remove the mob mesh with a smoke burst; toast. |
| `nemesis_returned` | `{ mobId, name, grudgeName, returns, taunt, x, z, text }` | Spawn elite mesh with `mob.isNemesis` styling (red glow / nameplate); toast the taunt. |
| `nemesis_slain` | `{ name, killerName, returns, text }` | Victory toast. |

### Snapshot additions

Coordinator: merge into `Room.getSnapshot()` (or the `tick` broadcast):

```js
snapshot.signature = {
  oaths: room.systems?.oaths?.getPublicState(room) || null,
  // { shrines:[{id,x,z,model,name,usedBy}], oaths:{pid:[{id,name,icon}]}, curses:{pid:[{id,name}]} }
  livingDungeon: room.systems?.livingDungeon?.getPublicState(room) || null,
  // { pressure, adaptations:[], adaptationsTotal, dominance:'ranged'|'melee'|'magic'|null, remembered }
  nemesis: room.systems?.nemesis?.getPublicState(room) || null
  // { active:{name,returns,grudgeName,mobId}|null, escapedForever:[] }
};
```

---

## 3. Room.js hook call sites (coordinator edits)

### 3a. Oaths

| Call site in Room.js | Insert |
|---|---|
| `initDungeonLayout()` — end | `room.systems?.oaths?.onFloorStart(room)` — spawns 2 shrines/floor. Also call at end of `generateProceduralDungeonFloor()` (oaths persist across floors; shrines respawn). |
| `update(dt)` — after `updatePlayers` | `room.systems?.oaths?.onTick(room, simDt)` and `room.systems?.oaths?.checkShrineProximity(room)` |
| `dealAreaDamage()` — mob/boss branch, after `res.damageDealt` known | `room.systems?.oaths?.recordDamageDealt(room, attacker.id, res.damageDealt \|\| scaledDmg)`; wrap outgoing: `amount = room.systems?.oaths?.modifyOutgoingDamage(attacker, amount) ?? amount` (curse multipliers). After the mob loop: `room.systems?.oaths?.onAreaDamageLanded(room, attacker, x, z, radius, scaledDmg)` (Ruin friendly fire). |
| `dealDirectDamage()` — after damage | Same `recordDamageDealt` + `modifyOutgoingDamage`; then `room.systems?.oaths?.onOutgoingDamageLanded(room, attacker, res.damageDealt \|\| scaledDmg)` (Ruin Unbound reflect). |
| `damagePlayer()` — after i-frame check, before applying | `amount = Math.round(amount * (room.systems?.oaths?.getDamageTakenMult(player) ?? 1))` (Iron Vigil −30%). After applying damage, if attacker is a mob with thorns: existing thorns handling should ALSO include `room.systems?.oaths?.getThorns(player)` reflected to melee attackers. |
| `updatePlayers()` — movement application | Multiply velocity by `room.systems?.oaths?.getSpeedMult(p) ?? 1` (Iron Vigil −25%). |
| `handlePlayerAction()` — `dash` branch | After dash: `room.systems?.oaths?.onDash(room, player)` (Vigil term). |
| `handleEntityDeath()` — inside `if (killer)` block | `room.systems?.oaths?.onKill(room, killer, entity)` (Ruin detonation; feeds Ruin term timer). |
| `updateGroundEffects()` — sanctuary tick | Route: `const amt = room.systems?.oaths?.onHeal(room, sourcePlayer, p, eff.healPerSec * dt) ?? eff.healPerSec * dt` (Silent Coin denial). `sourcePlayer` = `room.players[eff.sourcePlayerId]`. |
| `castBeam()` — ally-heal section | `const amt = room.systems?.oaths?.onHeal(room, player, ally, healAlly) ?? healAlly` |
| `executeTacticalCommand()` — `heal` branch | For each ally: `const amt = room.systems?.oaths?.onHeal(room, player, ally, healAmt) ?? healAmt` |
| necromancer `skill2` ally-share | Same `onHeal` routing (30 HP share). |
| `updateFloorLoot()` — gold pickup | `p.stats.goldCollected += room.systems?.oaths?.modifyGoldPickup(p, loot.value) ?? loot.value` (Silent Coin ×2). |
| `awardPartyXP()` / any XP grant | `xpAmount = room.systems?.oaths?.modifyXpGain(p, xpAmount) ?? xpAmount` (Silent Coin ×2). Prefer `room.systems?.progression?.grantXP?.(...)` amounts routed the same way. |
| `damagePlayer()` — downed branch (`player.isDowned = true`) | `room.systems?.oaths?.onPlayerDowned(room, player)` (Ashen Martyr buff/break; Hollow Saint break). ALSO call on true death (downedTimer expiry → isDead). |
| Ashen Martyr downed-timer halve | Where `downedTimer = 30` is set: `p.downedTimer = (room.systems?.oaths && p.oathState?.oaths?.some(o => o.id==='ashen_martyr')) ? 15 : 30`. (Read-only access to oath state is fine; or add `Oaths.hasOath(p,'ashen_martyr')`.) |

### 3b. Living Dungeon

| Call site | Insert |
|---|---|
| Room construction | `room.systems?.livingDungeon?.init(room)` |
| `dealAreaDamage()` / `dealDirectDamage()` — mob/boss branch | `room.systems?.livingDungeon?.recordDamage(room, attacker, res.damageDealt \|\| scaledDmg, damageType)` |
| Mob damage intake (the `m.takeDamage(...)` wrapper or `mob.hp -=` fallback) | `const mult = room.systems?.livingDungeon?.getDamageTakenMult(m, damageType) ?? 1; amount = Math.round(amount * mult)` — applies thorn-hardened (45% melee resist) / null-warded (45% magic resist). |
| `handleEntityDeath()` | `room.systems?.livingDungeon?.recordKill(room, killer, entity)` |
| `damagePlayer()` — downed AND death branches | `room.systems?.livingDungeon?.recordDeath(room, player)` |
| `update(dt)` | `room.systems?.livingDungeon?.onRoomTick(room)` (self-throttled to 5s evals) |
| `generateProceduralDungeonFloor()` — after `initDungeonLayout()` | `room.systems?.livingDungeon?.onFloorStart(room)` (resets floor stats; pre-spawns "remembered" counters) |
| Mob AI targeting (updateMobs) | If `mob.huntTargetId` is set and that player is alive, prefer them as the move/attack target (used by HUNTED packs + gap-closers + blood hunts). |

### 3c. Nemesis

| Call site | Insert |
|---|---|
| Room construction | `room.systems?.nemesis?.init(room)` |
| `dealAreaDamage()` / `dealDirectDamage()` — after `m.takeDamage` / boss branch, mob alive | `room.systems?.nemesis?.onMobDamaged(room, m, attacker, res.damageDealt \|\| 0)` (grudge tracking + low-HP flee). |
| `dealAreaDamage()` / `dealDirectDamage()` — where `res.isDead` leads to `handleEntityDeath(m, attacker)` for elites | `if (room.systems?.nemesis?.tryLethalEscape(room, m, attacker)) { /* escaped: skip handleEntityDeath — no XP/loot, the grudge lives */ } else { handleEntityDeath(m, attacker); }` |
| `handleEntityDeath()` — top | `if (entity.isNemesis) room.systems?.nemesis?.onNemesisSlain(room, entity, killer)` (bonus loot + settled broadcast). |
| Mob → player damage (updateMobs attack / boss abilities) | `amount = room.systems?.nemesis?.modifyDamageToPlayer(mob, player, amount) ?? amount` (+30% vs grudge target). |
| `generateProceduralDungeonFloor()` — after LivingDungeon hook | `room.systems?.nemesis?.onFloorStart(room)` (dramatic return entrance). |
| `update(dt)` | `room.systems?.nemesis?.onRoomTick(room)` (90s return timer). |

**Ordering note:** in `handleEntityDeath`, call `Nemesis.onNemesisSlain` FIRST (it clears nemesis state + grants bonus loot), then `Oaths.onKill` / `LivingDungeon.recordKill` as normal.

---

## 4. The six oaths — exact numbers

| Oath | Benefit | Cost | Breaking term → Curse |
|---|---|---|---|
| 🩸 **Crimson Tithe** (The Red Ledger) | +35% damage dealt (damageBuff ×1.35) | Max HP −20% permanently this run | Deal no damage for 90s while foes live → **The Tithe Collects**: lose 30% current HP instantly |
| 🕯️ **Hollow Saint** (The Hollow Saint) | HoT aura: self + allies within 6m heal 3% max HP / 2s | HUNTED: ambush pack (2× void_assassin + 1× cinder_thrall) spawns on you every 45s | An ally falls within 12m of you → **The Saint's Silence**: +20% damage taken, 60s |
| 💥 **Ruin** (Ruin, the Unmaker) | Kills detonate: 90 fire dmg, 4.5m radius | Friendly fire ON: your AoEs deal 50% base to allies | No killing blow for 75s while foes live → **Ruin Unbound**: 15% of your damage reflected to you, 60s |
| 🪙 **Silent Coin** (The Silent Coin) | 2× gold & 2× XP from your kills | Cannot be healed by others (their heals fizzle on you) | An ally's heal touches you twice → **Poverty of the Grave**: lose 50% carried gold, −25% damage 60s |
| 🛡️ **Iron Vigil** (The Iron Vigil) | −30% damage taken, +15 thorns | −25% move speed | Dash while a foe is within 6m → **The Vigil's Shame**: −25% damage, 60s |
| 🔥 **Ashen Martyr** (The Ashen Martyr) | +10% damage; on falling, allies within 15m gain +50% dmg / +40% speed for 20s | Downed timer halved (15s) | Fall with no ally within 15m → **Hollow Sacrifice**: −20% damage, 60s |

Limits: max **2 oaths per player per run**; 2 shrines per floor (Crossroads, −7.5/−19.5 obelisk & 7.5/−19.5 altar); each shrine offers 3 random oaths, usable once per player per shrine. Oaths persist across floors. Bots never swear.

---

## 5. Living Dungeon — trigger reference

- Tracks `damageByType` per floor (melee: physical/shatter/execute · ranged: projectile · magic: fire/frost/dark/radiant/toxic), kills per archetype, deaths.
- Evaluation every 5s; needs ≥1200 tracked damage and one category **>70%**.
- **>70% ranged** → 3× Dungebred void_assassin (+25% speed) + 2× Dungebred cinder_thrall spawn on the ranged damage leader: *"The dungeon has noticed your cowardice..."*
- **>70% melee** → 4× Thorn-Hardened crypt_ghoul (45% melee resist, +10 thorns, +20% HP): *"the dungeon grows THORNS against your steel."*
- **>70% magic** → 3× Null-Warded blight_necrolyte (45% magic resist, faster casts, +20% HP): *"the dungeon DRINKS it now."*
- **3 deaths in a floor** → Bloodscented hunter pack on a random hero: *"The dungeon tastes blood... and it wants MORE."*
- Each adaptation fires **once per floor**; cross-floor memory pre-deploys 2 counters on the next floor: *"The dungeon REMEMBERS your cowardice... it came prepared."*
- All adaptations: `narrator_announcement` (warning) + `dungeon_whisper` + `floating_text` at spawn. Never silent.

---

## 6. Nemesis-lite — flow reference

1. Elite (<elite_executioner>/<elite_lich>) drops below 22% HP → 45% chance it **flees** (no XP/loot; mob removed with smoke VFX). It records per-player damage as **grudges**.
2. A **lethal** blow on an elite triggers the arc deterministically the first time per run (one nemesis at a time).
3. **~90s later or at next floor start**, it returns near its grudge target: `+45% HP / +25% dmg / +0.4 speed per return`, renamed ("Vorgath, Bone-Executioner, the Returned" → "Twice-Returned" → "Thrice-Returned, Apex of the Deep"), +30% damage vs its grudge target, personalized taunt.
4. Slaying it settles the grudge: **2 elite gear drops + 50 shards per human hero** + victory broadcast.
5. It can flee at most 3 times; on the would-be 4th it has nowhere left to run and dies clean.

---

## 7. Client integration (`client/js/ui/oathModal.js`)

- `initOathModal({ network, hud, scene })` → `{ handlers, syncShrines, tick, ... }`.
- Merge `handlers` into the `NetworkClient` callbacks map in `main.js` (keys: `oath_shrine_available`, `oath_sworn`, `oath_broken`, `oath_swear_denied`, `oath_shrines_spawned`, `dungeon_whisper`, `dungeon_adaptation`, `nemesis_fled`, `nemesis_returned`, `nemesis_slain`).
- `syncShrines(scene, shrines)` renders `covenant_obelisk.glb` / `soul_altar.glb` via the existing `/vendor/addons/loaders/GLTFLoader.js`; call `tick(dt)` from the render loop for the pulse animation.
- `network.send({ type: 'swear_oath', shrineId, oathId })` is sent by the modal's hold-to-confirm seal button.
- Uses `COVENANT_THEME` tokens; ceremony copy matches server `flavor`/`benefit`/`cost`/`term` strings verbatim.

## 8. Multiplayer safety notes

- All oath state lives server-side (`player.oathState`, `room.oathShrines`). Clients only render.
- Swear validation is fully server-side (range, offering, caps) — a forged `swear_oath` packet is denied.
- Breaking checks run on the authoritative tick; curses are timed server-side (`expiresAt`).
- Living Dungeon adaptations and Nemesis spawns use `room.spawnMob` / `room.broadcast` only — no client trust.
- `setTimeout` is used in exactly one place (Ashen Martyr buff expiry, 20s) mirroring existing Room.js usage; guarded against dead/disconnected players.
