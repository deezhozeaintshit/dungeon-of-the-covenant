# Phase 2 Systems Protocol — JOIN SYSTEM (workstream 3) + OBJECTIVES (workstream 5)

Authoritative notes for the Phase 2 coordinator. Server is always the source of
truth; clients only render.

---

## 1. New / changed WebSocket message types

### Client → Server

| type | payload | behavior |
|---|---|---|
| `list_rooms` | `{}` | Server replies with `room_list`. No auth needed. |
| `create_private_room` | `{ playerName, chosenClass, profile }` | Like `create_room`, but the room is flagged `isPrivate = true`: excluded from `room_list` and from quickplay matchmaking. Direct `join_room` by code still works (this is the invite-link path). Server replies with `room_created` plus `private: true`. |
| `quickplay_matchmaking` | unchanged | Quickplay random queue is UNTOUCHED. Note: it now skips `isPrivate` rooms (privacy would be meaningless otherwise). |

`create_room` and `join_room` are unchanged.

### Server → Client

| type | payload | when |
|---|---|---|
| `room_list` | `{ rooms: [{ code, playerCount, maxPlayers, biome, biomeId, floor, state, ageSec, hasBots }] }` | Reply to `list_rooms`. Only rooms in `lobby` or `dungeon` state (never completed/victory/defeat), private rooms excluded, capped at 20, newest first. `playerCount` = human players only; `maxPlayers` = 8. |
| `room_created` | `{ roomCode, player, room, private? }` | After `create_room` / `create_private_room`. `private: true` only for private rooms. |
| `objectives_update` | `{ floor, objectives: [ObjectiveSnapshot] }` | On floor generation (objectives created), and on ANY objective progress/state change. |
| `objective_complete` | `{ floor, objective: ObjectiveSnapshot, reward: { xp, loot } }` | When an objective completes. |
| `objective_failed` | `{ floor, objective: ObjectiveSnapshot, reason }` | When an objective fails (e.g. party wipe during ambush). |

ObjectiveSnapshot:
```jsonc
{
  "id": "obj_f1_slay_warden_0",
  "type": "SLAY_WARDEN",            // SLAY_WARDEN | DESTROY_SHRINES | RECOVER_RELIC | SURVIVE_AMBUSH
  "biome": "ossuary_crypt",         // ProceduralLevelGenerator biome id
  "name": "Warden Slayer",
  "description": "Slay Vorgath, Bone-Executioner — the West Wing Warden ...",
  "primary": true,                  // exactly one per floor
  "state": "active",                // active | complete | failed
  "progress": { "current": 0, "target": 1 },
  "reward": { "xp": 256, "loot": "gear_drop" },
  "timeRemaining": null,            // seconds, SURVIVE_AMBUSH only
  "carrierId": null,                // player id carrying the relic, RECOVER_RELIC only
  "altar": { "x": 0, "z": 16 },     // extraction altar, RECOVER_RELIC only
  "shrines": null                   // [{id,name,x,z,hp,maxHp,isDead}], DESTROY_SHRINES only
}
```

---

## 2. Coordinator hooks — Room.js MUST call these

All hooks are defensive no-ops when `room.systems.objectives` is missing.

```js
const { Objectives } = require('./systems/Objectives');
```

1. **Floor setup** — at the END of `Room.startDungeon()` and at the END of
   `Room.generateProceduralDungeonFloor()`, AFTER `this.initDungeonLayout()`:
   ```js
   Objectives.createForRoom(this);
   ```
   This generates 3 objectives (1 PRIMARY), spawns shrine entities into
   `room.shrines` and the relic into `room.floorLoot` (type `objective_relic`),
   and broadcasts `objectives_update`.

2. **Enemy kills** — inside `Room.handleEntityDeath(entity, killer)`, after the
   existing logic:
   ```js
   this.systems?.objectives?.onEnemyKilled(this, entity, killer);
   ```
   Drives SLAY_WARDEN (real elite deaths, no mock data).

3. **Tick** — inside `Room.update(dt)`, in the dungeon branch:
   ```js
   this.systems?.objectives?.onTick(this, simDt);
   ```
   Drives SURVIVE_AMBUSH countdown + wave spawns (real mobs via
   `room.spawnMob`), and RECOVER_RELIC altar-proximity detection.

4. **Shrine damage** — inside `Room.dealAreaDamage()`, `castBeam()`,
   `castLineImpale()`, and `applyProjectileHit()` (anywhere an attack resolves
   at a world position):
   ```js
   this.systems?.objectives?.damageShrinesAt(this, x, z, radius, damage, attacker);
   ```
   Shrines have real `hp` on `room.shrines[]`; destruction is detected here and
   advances DESTROY_SHRINES. (The direct path
   `objectives.onShrineDestroyed(room, shrine)` also exists.)

5. **Relic pickup** — inside `Room.updateFloorLoot()`, add a branch for the new
   loot type (human players only, like other relics):
   ```js
   } else if (loot.type === 'objective_relic') {
     this.systems?.objectives?.onRelicPickup(this, p, loot);
   }
   ```
   The method sets `loot.pickedUp = true` and `player.carryingObjectiveRelic`.

6. **Player disconnect** — inside `Room.removePlayer(socketId)`, after delete:
   ```js
   this.systems?.objectives?.onPlayerLeft(this, socketId);
   ```
   Respawns a carried relic at its vault so it can never be lost.

7. **Snapshot** — inside `Room.getSnapshot()`, add:
   ```js
   objectives: this.systems?.objectives?.getSnapshot()?.objectives || [],
   shrines: (this.shrines || []).filter(s => !s.isDead).map(s => ({
     id: s.id, name: s.name, x: s.x, z: s.z, hp: s.hp, maxHp: s.maxHp
   })),
   ```
   Clients render shrine markers from `shrines`; the objective tracker renders
   from `objectives` / `objectives_update`.

8. **Private rooms** — handled in `server.js` (`create_private_room` sets
   `room.isPrivate = true`). Nothing needed in Room.js.

---

## 3. XP reward contract (Progression interface)

On objective completion the Objectives system calls:

```js
room.systems.progression.grantXP(room, playerId, amount, reason)
// reason: "objective:slay_warden" | "objective:destroy_shrines" |
//         "objective:recover_relic" | "objective:survive_ambush"
```

- Called once per HUMAN player (bots excluded), only if
  `room.systems?.progression?.grantXP` is a function.
- Until the Progression system lands, the fallback is the existing
  `room.awardPartyXP(xp)` (real XP, real level-ups — not a no-op).
- A `gear_drop` bounty cache is also spawned at the completion point
  (`room.spawnFloorLoot('gear_drop', x, z, xp, "<Name> Bounty Cache", false, null)` —
  null `itemData` is safe: Room falls back to a generated item on pickup).

---

## 4. Invite-link flow (end-to-end)

1. Create/join a room → `room_created` / `room_joined` carries `roomCode`.
2. Client builds the invite URL:
   `buildInviteLink(code) => ${location.origin}${location.pathname}?room=${code}`
3. "Copy Invite Link" buttons (room-lobby header + HUD room-code chip +
   private-room confirmation) copy that URL via `navigator.clipboard` with an
   `execCommand` fallback.
4. Recipient opens the link → `client/js/ui/mainMenu.js` parses `?room=CODE` on
   boot: pre-fills `#room-code-input`, switches to the CHAMBER tab, shows an
   invite banner, then `history.replaceState` strips the query param so a
   refresh does not re-trigger.
5. Recipient enters hero name / picks class → JOIN CHAMBER →
   `join_room` with that code (private rooms joinable by code, invisible in
   `room_list` and skipped by quickplay).

---

## 5. Objective type reference

| type | generated | completes when | fails when |
|---|---|---|---|
| SLAY_WARDEN (PRIMARY) | always, 1/floor | the named Wing Warden elite dies (`onEnemyKilled` type match) | — |
| DESTROY_SHRINES | 2 of 3 rolls | N corrupted shrines destroyed (2, or 3 on floor ≥ 3); shrines have real hp, breakable via `damageShrinesAt` | — |
| RECOVER_RELIC | 2 of 3 rolls | relic picked up (`onRelicPickup`) then carried within 3.5u of the Extraction Altar (0,16) — detected in `onTick` | — |
| SURVIVE_AMBUSH | 2 of 3 rolls | countdown reaches 0 (40s + 5s/floor, cap 60s) with ≥1 human alive; waves spawn every 10s via `room.spawnMob` | all humans dead when the timer expires |

Flavor text (shrine/relic/ambush names) is matched to the floor's
ProceduralLevelGenerator biome id (`BIOME_FLAVOR` in Objectives.js).

---

## 6. CORE SYSTEMS — HP / XP / ABILITIES (workstream 4)

Server-authoritative core systems. Modules: `server/game/systems/Health.js`,
`Progression.js`, `Abilities.js`. **The client is display-only for hp/xp/level/
builds — never read `hp`, `xp`, `level`, or `maxHp` from any inbound message.**

Coordinator wiring suggestion: `room.systems = { health, progression, abilities }`
in the Room constructor, then call the integration points below.

### 6.1 New / changed WebSocket message types

#### Server → Client

| type | payload | notes |
|---|---|---|
| `level_up` | `{ playerId, playerName, level, x, z }` | LEGACY, kept. Existing client VFX hook in `main.js`. Still broadcast on every level-up. |
| `level_up_choices` | `{ playerId, level, abilityPoints, choices: [{ id, name, icon, description, branch, branchName, rank, maxRanks, classes }] }` | Human players only on level-up. Client shows pick-1-of-3 modal (`client/js/ui/levelup.js`). Bots auto-resolve server-side. |
| `xp_update` | `{ playerId, xp, level, nextLevelXp, gained, reason }` | After every `grantXP`. Client updates XP bar from this (no local math). |
| `player_downed` | `{ playerId, playerName, x, z }` | LEGACY, kept (30s revive window). |
| `player_died` | `{ playerId, playerName, x, z, respawnIn, deathCount }` | Downed timer expired. Death screen shows respawn countdown (`respawnIn` = 15). |
| `player_respawned` | `{ playerId, playerName, x, z, early, xpPenalty }` | Reforged at floor entrance. Hide death screen. |
| `build_update` | `{ playerId, build }` | After any ability pick/spend. `build` = `Abilities.getPlayerBuild(playerId)`. |

#### Client → Server

| type | payload | handler |
|---|---|---|
| `ability_pick` | `{ abilityId }` | `Abilities.applyAbilityPick(room, playerId, abilityId)` — must be a pending choice; server rejects anything else. |
| `skill_tree_spend` | `{ abilityId }` | `Abilities.spendAbilityPoint(room, playerId, abilityId)` — needs 1 unspent point. |
| `respawn_request` | `{}` | `Health.requestRespawn(room, playerId)` — early respawn while dead, costs 10% current XP. |

server.js `ws` switch additions:
```js
case 'ability_pick': {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  const room = rooms.get(meta.roomCode);
  if (room && room.state === 'dungeon') {
    Abilities.applyAbilityPick(room, meta.playerId, String(data.abilityId || ''));
  }
  break;
}
case 'skill_tree_spend': {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  const room = rooms.get(meta.roomCode);
  if (room && room.state === 'dungeon') {
    Abilities.spendAbilityPoint(room, meta.playerId, String(data.abilityId || ''));
  }
  break;
}
case 'respawn_request': {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  const room = rooms.get(meta.roomCode);
  if (room && room.state === 'dungeon') {
    Health.requestRespawn(room, meta.playerId);
  }
  break;
}
```

### 6.2 Server API reference

**Health** (`systems/Health.js`):
```js
Health.initPlayer(player)
Health.damagePlayer(room, playerId, amount, { type, sourceName, attackerId })
  // -> { dealt, dodged, downed, killed, ignored } (dealt = ACTUAL post-mitigation)
Health.healPlayer(room, playerId, amount, sourceName)      // -> actual healed (0 if dead/downed)
Health.setMaxHp(room, playerId, newMax, { healDelta=true }) // -> new maxHp
Health.revivePlayer(room, playerId, hpPct=0.45)             // -> bool
Health.respawnPlayer(room, playerId, { early=false })       // -> bool
Health.requestRespawn(room, playerId)                       // -> { ok, reason }
Health.tick(room, dt)        // downed expiry, respawn countdown, hpRegen — call in Room.update()
Health.snapshotFields(player) // -> { state, respawnIn, armor, deathCount }
```
Mitigation order: flat armor → per-type resist → resistAll → `shielded` status
(×0.4). `invulnerableTimer > 0` → dodged. Thorns reflects onto the mob from
`attackerId` (kill credited to the player).

**Progression** (`systems/Progression.js`) — XP curve `xpToNext(l) = floor(80·l^1.6)`:
```js
Progression.initPlayer(player)
Progression.grantXP(room, playerId, amount, reason)  // <-- cross-workstream API (exact signature)
Progression.grantPartyXP(room, amount, reason)       // skips dead players
Progression.xpToNext(level); Progression.xpForLevel(n)
Progression.XP_REWARDS  // { kill:45, elite:250, boss:1000, objective:150, discovery:40 }
Progression.snapshotFields(player) // { level, xp, nextLevelXp, abilityPoints, abilities }
```
XP curve table (XP to advance): L1→2: 80, L2→3: 242, L3→4: 463, L4→5: 735,
L5→6: 1050, L6→7: 1406, L7→8: 1799, L8→9: 2228, L9→10: 2690.
Cumulative to L5 = 1,520 (≈2 floors / 10–15 min); to L10 = 10,693.
Level-up: maxHp ×1.18 (full heal), damageBuff +0.15, +1 ability point,
pick-1-of-3 ability choice. `grantXP` accepts namespaced reasons
(e.g. `'objective:slay_warden'` from workstream 5) and surfaces them in `xp_update`.

**Abilities** (`systems/Abilities.js`):
```js
Abilities.initPlayer(player); Abilities.dropPlayer(playerId)
Abilities.applyAbilityPick(room, playerId, abilityId)   // -> { ok, ability, rank, reason? }
Abilities.spendAbilityPoint(room, playerId, abilityId)  // -> { ok, ability, rank, abilityPoints, reason? }
Abilities.getPlayerBuild(playerId)                      // -> build summary | null
Abilities.getTreeForClass(classKey)                     // static tree for UI bootstrap
Abilities.rollChoices(player, count=3)
Abilities.ABILITIES / Abilities.BRANCHES
```
10 abilities, 2 branches (Wrath = offense, Aegis = defense), class eligibility
per ability. Each level grants BOTH a free pick-1-of-3 rank AND 1 skill-tree point.
Picks are permanent per run (applied incrementally; no respec).

### 6.3 Room.js integration points (coordinator)

1. Requires at top: `Health`, `Progression`, `Abilities` from `./systems/`.
2. `addPlayer`: `Health.initPlayer(player); Progression.initPlayer(player); Abilities.initPlayer(player);`
3. `removePlayer`: `Abilities.dropPlayer(socketId);`
4. `damagePlayer(player, amount, damageType, sourceName)` → replace body with:
   `return Health.damagePlayer(this, player.id, amount, { type: damageType, sourceName });`
   (optionally pass `attackerId: m.id` at mob-melee call sites for thorns).
5. Direct `*.hp = ...` heals → `Health.healPlayer`: forge elixir branch, tactical
   `heal` branch, soul_drain (+65), skill2 soul-drain (+45), necromancer skill2
   (+60/+30), sanctuary tick in `updateGroundEffects`, potion/shrine pickups in
   `updateFloorLoot`, regroup (+25%).
6. Direct `maxHp` changes → `Health.setMaxHp`: blessing vitality (+150), forge
   armor (+180), hexAnomaly hp bonus, `equipProceduralItem` s.maxHp.
7. `update()`: add `Health.tick(this, dt);`
8. `updatePlayers`: DELETE the legacy downed-timer expiry block
   (`Health.tick` now owns downed→dead and broadcasts the richer `player_died`).
9. `awardPartyXP` → `return Progression.grantPartyXP(this, xpAmount, 'kill');`
   `handleEntityDeath` → `Progression.grantPartyXP(this, amt, 'boss'|'elite'|'kill')`.
10. `getSnapshot` player map: `...Health.snapshotFields(p), ...Progression.snapshotFields(p)`.
11. `handlePlayerAction`: `if (action === 'respawn') { Health.requestRespawn(this, player.id); return; }`
    before the isDowned/isDead early-return (the client already sends this).

### 6.4 Death / respawn rules

hp→0: DOWNED (30s ally-revive window) → timer expires: DEAD (`player_died`,
death screen + 15s countdown) → auto-respawn at floor entrance (0,15), full HP,
3s invuln, cooldowns/statuses cleared. Early manual respawn via
`respawn_request` costs 10% current XP. Ally revive (3.5s channel): 45% HP +
1.5s invuln. Party wipe → unchanged `party_wipe`/`checkEndConditions`.

### 6.5 Client hooks

`client/js/ui/levelup.js` (new): `initLevelUpModal({ onPick })`,
`initSkillTreePanel({ onSpend })`, `updateXPBar({ level, xp, nextLevelXp })`,
`renderRespawnCountdown(sec)`. main.js: call `updateXPBar` in `handleSnapshot`
next to `updateVitals`; add callbacks for `level_up_choices`, `player_died`,
`player_respawned`, `build_update`; death screen driven by real server state;
respawn button sends `{ type: 'respawn_request' }`.
