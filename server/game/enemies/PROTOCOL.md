# Phase 2 — Enemies + Logic: Server ⇄ Client Protocol

Workstream 1 (ENEMIES + LOGIC). All messages are **server → client** unless
marked otherwise. The client **never** computes damage; every hit is resolved
server-side and only rendered here.

Conventions: `x/z` are world meters (y-up world, ground plane = x/z).
Durations in seconds, `windupMs` in milliseconds. Colors are hex integers
(e.g. `0xff2222`).

---

## NEW message types (defined by this workstream)

### 1. `enemy_telegraph` — S→C
Broadcast when ANY enemy (mob, elite, or PhaseBoss) begins an attack
windup. The client draws a ground decal for `windupMs`, then removes it.
Damage (if any) was already resolved server-side — this message is
render-only.

```json
{
  "type": "enemy_telegraph",
  "enemyId": "mob_42",
  "kind": "melee | ranged | slam | pounce | aoe_slam | cone_sweep | leap | volley | explosive_fuse",
  "windupMs": 900,
  "isBoss": false,
  "telegraph": {
    "id": "etel_mob_42_1727...",
    "shape": "circle | cone | point",
    "x": 12.34,
    "z": -5.67,
    "radius": 3.8,
    "angle": 1.570,
    "coneAngle": 1.728,
    "duration": 0.9,
    "color": 16711680
  }
}
```

Field notes:
- `telegraph.shape: "circle"` — filled red disc of `radius` at (`x`,`z`).
  `"cone"` — sector of `radius`, half-angle `coneAngle/2`, facing `angle`
  (radians, `atan2(dx, dz)` convention). `"point"` — tiny marker for
  ranged windups (projectile spawns server-side at resolve).
- `angle` / `coneAngle` are omitted (or 0) for circles.
- `isBoss: true` only for PhaseBoss telegraphs; the client may scale the
  decal treatment (thicker ring, screen shake is sent separately).
- The payload shape is intentionally identical to the existing
  `telegraph_start.telegraph` object, so `client/js/enemies.js` can share
  decal geometry with the legacy path.

### 2. `enemy_spawn` — S→C
Broadcast when a mob/elite enters the room (spawn, summon, wave). Lets the
client preload the GLB and attach the elite aura immediately instead of
waiting for the next room-state sync.

```json
{
  "type": "enemy_spawn",
  "enemy": {
    "id": "mob_43",
    "type": "elite_executioner",
    "role": "elite",
    "name": "Ember-Infused Elite Executioner",
    "biome": "forge",
    "biomeTint": 16742178,
    "model": "enemy_elite_executioner.glb",
    "modelScale": 1.25,
    "x": 4.0, "z": -12.0,
    "hp": 1092, "maxHp": 1092,
    "affixes": ["brutal", "swift"],
    "auraColor": 16728100,
    "stealthed": false
  }
}
```

- `auraColor` present only for elites (see Elites.js affix table).
- `stealthed: true` for void assassins out of combat — client renders
  them semi-transparent / shimmering until the flag clears.

### 3. `boss_spawn` — S→C
Broadcast once when a PhaseBoss is created for the floor (before it wakes).

```json
{
  "type": "boss_spawn",
  "boss": {
    "id": "boss_malakor_soul_forge_warden",
    "name": "Malakor, Soul-Forge Warden",
    "title": "Lord of the Smoldering Crypt",
    "biomeId": "forge",
    "model": "boss_sovereign.glb",
    "reskinTint": 16742178,
    "x": 0, "z": -75,
    "hp": 5600, "maxHp": 5600,
    "phase": 1,
    "phaseName": "The Warden Rises"
  }
}
```

### 4. `boss_phase` — S→C
Broadcast on every phase transition (including phase 1 at awaken). The
client shows the phase banner and updates the boss HP bar pips.

```json
{
  "type": "boss_phase",
  "bossId": "boss_malakor_soul_forge_warden",
  "phase": 2,
  "name": "Soul-Forge Ignition",
  "title": "Lord of the Smoldering Crypt"
}
```

`phase` is 1-based. `name` is the phase display name from BOSS_TABLE.

---

## Additions to the existing `room_state` sync (S→C)

The coordinator should extend the `mobs[]` entries already emitted by
`Room.getState()` with these fields (all optional; absent = legacy mob):

| field       | type      | meaning |
|-------------|-----------|---------|
| `role`      | string    | `melee\|ranged\|swarm\|caster\|assassin\|elite` — drives client anim choice |
| `model`     | string    | GLB filename under `client/assets/models/` |
| `modelScale`| number    | world scale multiplier |
| `biomeTint` | int       | hex tint for the biome reskin |
| `affixes`   | string[]  | elite affix ids, e.g. `["swift","brutal"]` |
| `auraColor` | int       | hex aura color for elites |
| `stealthed` | boolean   | assassin stealth flag |
| `aiState`   | string    | brain state: `patrol\|chase\|attack\|flee\|search` (debug/anim) |

The `boss` object in `room_state` should be the `PhaseBoss.getState()`
shape (id, name, title, biomeId, model, reskinTint, x/y/z, hp, maxHp,
phase, phaseName, rotation, isEnraged, isAwake, isDead, activeTelegraph
with `progress` 0..1).

---

## REUSED existing message types (no changes)

These already exist in Room.js / Boss.js / client and are emitted by the
new server code as well:

- `telegraph_start` — legacy telegraph path (MalakorBoss). New code uses
  `enemy_telegraph`; both render as ground decals.
- `boss_awakened` — `{bossId, bossName, bossTitle}` when the boss wakes.
- `narrator_announcement` — `{text, tone}` for phase banners / summons.
- `floating_text` — `{text, x, z, style}` (`crit`, `heal`, `buff` styles used).
- `beam_fx` — `{sourceX, sourceZ, targetX, targetZ, color}` (caster heals).
- `screen_shake` — `{magnitude, duration}` on slams / detonations.
- `boss_attack_anim` — `{attack, bossId}` for basic swings / volleys.

---

## Client wiring checklist (for the coordinator)

1. `client/js/enemies.js` exports `EnemyVisuals`. In `main.js` ws dispatch,
   route `enemy_telegraph` → `enemyVisuals.handleTelegraph(msg)`,
   `enemy_spawn` → `enemyVisuals.handleSpawn(msg)`,
   `boss_spawn` → `enemyVisuals.handleBossSpawn(msg)`,
   `boss_phase` → `enemyVisuals.handleBossPhase(msg)`.
2. Per frame (or on each `room_state`), call
   `enemyVisuals.syncElites(roomState.mobs)` and
   `enemyVisuals.syncBoss(roomState.boss)`.
3. Construct with `new EnemyVisuals(scene, { getMobMesh: id =>
   entityManager.mobMeshes.get(id) })` so elite auras attach to live mobs.
4. `EnemyVisuals` renders only. It never applies damage and never sends
   gameplay messages.
