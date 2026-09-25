# Mixamo Clips — What To Download & Where To Drop It

The game's animation pipeline (`client/js/animation/`) works **right now with zero
downloads** — every state has a hand-tuned procedural fallback. Mixamo clips are
an **optional visual upgrade**: when a real clip file exists, the animator uses
it; when it doesn't, procedural takes over seamlessly.

An agent cannot log into Mixamo (it needs **your** free Adobe ID), so this is a
manual 10-minute job. Do it once per character, or skip it entirely — the game
never looks broken without it.

## 1. The filename convention (this is the important part)

```
<prefix>_<state>.fbx
```

- `<prefix>` — the character key, e.g. `hero_mage`, `enemy_void_assassin`, `boss_sovereign`
- `<state>` — one of: `idle` `walk` `run` `attack` `hit` `death`
  (optional extras: `cast` `jump` `victory`)
- Examples:
  - `hero_mage_idle.fbx`, `hero_mage_walk.fbx`, `hero_mage_run.fbx`,
    `hero_mage_attack.fbx`, `hero_mage_hit.fbx`, `hero_mage_death.fbx`
  - `enemy_skeleton_warrior_attack.fbx`
  - `boss_sovereign_death.fbx`

The loader also accepts `<prefix>_<state>_mixamo.fbx` as a fallback name.
Anything else (different prefix, different state word, `.zip` left unextracted)
is ignored — and the procedural fallback covers that state instead.

## 2. Where to drop the files

```
client/assets/models/
```

Right next to the `.glb` files. No subfolders, no manifest, no registration —
`loadClipSet('<prefix>')` auto-discovers files by the naming convention above.
After dropping new files, the game picks them up on next load (or call
`clipSet.reload()` then `animator.bindClipSet(set).refresh()` for hot-swap).

## 3. What to download on mixamo.com

1. Log in at **mixamo.com** (free Adobe ID).
2. Pick any character on the **Characters** tab (it only donates the skeleton —
   the motion is what we keep; "X Bot" works fine for everything).
3. Search the **Animations** tab for the clip names below, click it, hit
   **DOWNLOAD**, and set:
   - Format: **FBX for Unity** (plain FBX Binary — either works)
   - Skin: **Without Skin** (we only need the motion)
   - Frames: leave at default (full clip); 30 FPS is fine
4. Rename the downloaded file to the convention in section 1 and drop it in
   `client/assets/models/`.

### Clips per character (Mixamo search names)

Universal states — same for everyone:

| State  | File suffix | Download on Mixamo (search this) |
|--------|-------------|----------------------------------|
| idle   | `_idle.fbx`   | `Idle` |
| walk   | `_walk.fbx`   | `Walking` |
| run    | `_run.fbx`    | `Running` (or `Sprint` for the boss) |
| hit    | `_hit.fbx`    | `Hit Reaction` |
| death  | `_death.fbx`  | `Death` (or `Dying`) |
| cast   | `_cast.fbx`   | `Magic Attack` / `Spellcasting` (casters only, optional) |
| jump   | `_jump.fbx`   | `Jump` (optional) |
| victory| `_victory.fbx`| `Victory` (optional) |

Attack clips — pick per archetype (`_attack.fbx`):

| Character | Prefix | Mixamo attack clip to download |
|-----------|--------|--------------------------------|
| Mage | `hero_mage` | `Magic Attack` |
| Cleric | `hero_cleric` | `Magic Attack` (or `Sword Slash` — she carries a scepter) |
| Necromancer | `hero_necromancer` | `Magic Attack` |
| Rogue | `hero_rogue` | `Knife Stab` / `Sword Slash` |
| Ranger | `hero_ranger` | `Bow Draw And Release` / `Arrow Shoot` (search `archery`) |
| Juggernaut | `hero_juggernaut` | `Warhammer Swing` / `Sword Slash` (big two-hander) |
| Skeleton Warrior | `enemy_skeleton_warrior` | `Sword Slash` |
| Cultist Archer | `enemy_cultist_archer` | `Arrow Shoot` |
| Void Assassin | `enemy_void_assassin` | `Knife Stab` |
| Blight Necrolyte | `enemy_blight_necrolyte` | `Magic Attack` |
| Elite Executioner | `enemy_elite_executioner` | `Sword Slash` |
| Elite Lich | `enemy_elite_lich` | `Magic Attack` |
| Sovereign (boss) | `boss_sovereign` | `Sword Slash` + `Magic Attack` (attack uses the first found; drop the cooler one as `_attack.fbx`) |

> Exact Mixamo titles drift over time — if a name above doesn't match, grab the
> closest equivalent. **The pipeline does not care what the clip was called on
> Mixamo**; only the `<prefix>_<state>.fbx` filename matters.

### Priority order (if you're short on time)

Per character, download in this order — each one visibly upgrades the game:

1. `_attack.fbx` 2. `_walk.fbx` 3. `_idle.fbx` 4. `_death.fbx` 5. `_hit.fbx` 6. `_run.fbx`

## 4. How to verify it worked

Open the browser console after loading into the dungeon. The boot code logs the
clip report per character:

```js
const set = await loadClipSet('hero_mage', heroGroup);
console.log(set.report());
// { prefix: 'hero_mage',
//   loaded: ['idle','walk','attack'],   <- real clips found
//   missing: ['run','hit','death',...], <- procedural fallback covers these
//   detail: [...] }
```

Or ask any animator: `animator.hasClip('attack')` → `true` means the real clip
is driving that state.

## 5. How the fallback selection works (for the curious)

`animator.play(state)` checks: is a real clip registered for this state?
**Yes →** plays it through `THREE.AnimationMixer` with fade in/out blending.
**No →** runs the procedural pose from `ProceduralFallback.js`, blended by
lerping pose offsets. Clips can arrive late (async load) — `animator.refresh()`
re-evaluates the live state and crossfades into the new source mid-motion, so
nothing pops. Layered attacks (`play('attack', { layer: 'upper' })`) always run
procedurally on the arms, even over a Mixamo walk clip — that's how the hero
swings while strafing.

Retargeting notes: Mixamo skeletons (`mixamorigHips` …) are remapped to the
game's rigs by canonical bone-name matching. For the game's pivot rigs
(rootBone / chestGroup / arms / legs), position tracks are auto-scaled from
Mixamo centimeters to game units, made relative to the bind pose, and planar
root motion is stripped (the game moves the group; the clip keeps the vertical
bob). Tune via `configureMixamo({ rootMotion, positionMode, positionScale })`.

## 6. Delivered 2026-09-25 — shared hero set + class variants (WIRED)

Fourteen Mixamo clips were delivered, renamed to the convention, and wired
into the game. `entities.js _bindHeroClipSet()` binds a clip set for EVERY
hero (local + remote players) with this resolution order per state:

1. `opts.statePrefixes[state]` — class-specific variant
2. `hero_<class>_<state>.fbx` — class-specific file (none shipped yet)
3. `hero_<state>.fbx` — the shared hero set below

Shared set (all six hero classes):

| File | Mixamo source | State |
|------|---------------|-------|
| `hero_idle.fbx` | Breathing Idle | idle |
| `hero_walk.fbx` | Walking | walk |
| `hero_run.fbx` | Running | run |
| `hero_attack.fbx` | Great Sword Slash | attack |
| `hero_hit.fbx` | Hit Reaction | hit |
| `hero_death.fbx` | Death | death |
| `hero_cast.fbx` | Magic Spell Casting | cast |
| `hero_jump.fbx` | Jump | jump |

Class variants (`HERO_STATE_PREFIX_OVERRIDES` in `client/js/animation/MixamoRig.js`):

| File | Mixamo source | Override |
|------|---------------|----------|
| `hero_rogue_attack.fbx` | Stabbing | rogue attack (fast striker, not a 2H swing) |
| `hero_mage_cast.fbx` | Standing 2H Cast Spell 01 | mage cast (two-handed channel) |
| `hero_juggernaut_idle.fbx` | Great Sword Idle | juggernaut idle (heavy weapon rest pose) |
| `hero_juggernaut_jump.fbx` | Great Sword Jump Attack | juggernaut jump (leaping slam) |

Ready alternates (committed, not auto-discovered — rename to swap in):

| File | Mixamo source | Swap target |
|------|---------------|-------------|
| `hero_idle_alt03.fbx` | Standing Idle 03 | `hero_idle.fbx` |
| `hero_death_alt_swordshield.fbx` | Sword And Shield Death | `hero_death.fbx` |

States with no clip (`victory`, `downed`) stay procedural — by design.
