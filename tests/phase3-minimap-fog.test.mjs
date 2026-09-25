// tests/phase3-minimap-fog.test.mjs — headless fog-of-war logic tests.
// Run: node tests/phase3-minimap-fog.test.mjs
import assert from 'node:assert/strict';
import {
  DUNGEON_ROOMS, WORLD, VISIBILITY_RADIUS, FogOfWar,
  FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE, zoneNameFor,
} from '../client/js/minimapFog.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`ok - ${name}`); };

// 1. Layout data sanity: 10 rooms, boss sanctum present, bounds inside world.
t('DUNGEON_ROOMS has 10 citadel rooms', () => {
  assert.equal(DUNGEON_ROOMS.length, 10);
  const sanctum = DUNGEON_ROOMS.find(r => r.zoneId === 'boss_sanctum');
  assert.ok(sanctum, 'boss sanctum room exists');
  assert.equal(sanctum.minX, -24); assert.equal(sanctum.maxX, 24);
  assert.equal(sanctum.minZ, -92); assert.equal(sanctum.maxZ, -56);
  for (const r of DUNGEON_ROOMS) {
    assert.ok(r.minX >= WORLD.minX && r.maxX <= WORLD.maxX);
    assert.ok(r.minZ >= WORLD.minZ && r.maxZ <= WORLD.maxZ);
  }
});

// 2. Fresh fog is fully unexplored.
t('fresh fog is unexplored everywhere', () => {
  const f = new FogOfWar();
  assert.equal(f.fogAt(0, 20), FOG_UNEXPLORED);
  assert.equal(f.fogAt(0, -75), FOG_UNEXPLORED);
  assert.equal(f.exploredCount, 0);
});

// 3. Reveal marks disc visible; outside stays unexplored.
t('reveal marks a visible disc', () => {
  const f = new FogOfWar();
  f.reveal(0, 20, 14);
  assert.equal(f.fogAt(0, 20), FOG_VISIBLE);
  assert.equal(f.fogAt(13, 20), FOG_VISIBLE);   // inside radius
  assert.equal(f.fogAt(40, 20), FOG_UNEXPLORED); // outside radius
  assert.ok(f.exploredCount > 0);
});

// 4. beginFrame downgrades visible -> explored (dim), keeps unexplored black.
t('beginFrame downgrades visible cells to explored', () => {
  const f = new FogOfWar();
  f.reveal(0, 20, 14);
  f.beginFrame();
  assert.equal(f.fogAt(0, 20), FOG_EXPLORED);
  assert.equal(f.fogAt(40, 20), FOG_UNEXPLORED);
  // re-reveal same spot: no double-count of explored cells
  const before = f.exploredCount;
  f.reveal(0, 20, 14);
  assert.equal(f.exploredCount, before);
  assert.equal(f.fogAt(0, 20), FOG_VISIBLE);
});

// 5. Out-of-bounds queries are safe.
t('out-of-bounds positions are safe', () => {
  const f = new FogOfWar();
  assert.equal(f.fogAt(-999, 999), FOG_UNEXPLORED);
  f.reveal(-999, 999, 14); // must not throw
  assert.equal(f.exploredCount, 0);
});

// 6. Multiple party members each reveal (server-authoritative shared vision).
t('each party member reveals their own disc', () => {
  const f = new FogOfWar();
  f.reveal(-42, -14, 14); // west wing
  f.reveal(42, -14, 14);  // east wing
  assert.equal(f.fogAt(-42, -14), FOG_VISIBLE);
  assert.equal(f.fogAt(42, -14), FOG_VISIBLE);
  assert.equal(f.fogAt(0, -14), FOG_UNEXPLORED); // middle unexplored
});

// 7. reset clears everything.
t('reset clears fog', () => {
  const f = new FogOfWar();
  f.reveal(0, 20, 14);
  f.reset();
  assert.equal(f.fogAt(0, 20), FOG_UNEXPLORED);
  assert.equal(f.exploredCount, 0);
});

// 8. zone names match the legacy HUD labels (no regressions).
t('zoneNameFor matches legacy zone labels', () => {
  assert.equal(zoneNameFor(0, 20), 'COVENANT ATRIUM');
  assert.equal(zoneNameFor(0, 5), 'NARTHEX PASSAGE');
  assert.equal(zoneNameFor(0, -14), 'THE GRAND CROSSROADS');
  assert.equal(zoneNameFor(-30, -14), 'WEST: BLOOD RELIQUARY');
  assert.equal(zoneNameFor(30, -14), 'EAST: ALCHEMIST VAULT');
  assert.equal(zoneNameFor(0, -34), 'THE ABYSSAL BRIDGE');
  assert.equal(zoneNameFor(0, -49), 'ANTECHAMBER OF CHAINS');
  assert.equal(zoneNameFor(0, -75), 'SOUL-FORGE SANCTUM');
});

console.log(`\n${pass} fog-of-war tests passed.`);
