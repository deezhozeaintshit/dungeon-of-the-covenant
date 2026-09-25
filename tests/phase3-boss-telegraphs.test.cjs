// tests/phase3-boss-telegraphs.test.cjs — headless boss telegraph lead-time tests.
// Verifies: for every signature attack of the Phase 2 multi-phase biome
// bosses, the server broadcasts enemy_telegraph AHEAD of the real attack,
// and the lead time equals the windup the attack was configured with.
// Run: node tests/phase3-boss-telegraphs.test.cjs
'use strict';
const assert = require('node:assert/strict');
const { createBoss, BOSS_TABLE } = require('../server/game/enemies/BossPhases');

const DT = 0.1; // 100ms server tick

function makeCtx(playerPos) {
  const events = [];
  const ctx = {
    now: 0,
    players: {
      p1: { id: 'p1', x: playerPos.x, z: playerPos.z, isDead: false, isDowned: false, hasTaunted: false }
    },
    broadcast: (msg) => events.push({ t: ctx.now, dir: 'broadcast', msg }),
    damagePlayer: (p, dmg, dtype, src) => events.push({ t: ctx.now, dir: 'damage', dmg, dtype, src }),
    spawnProjectile: (o) => events.push({ t: ctx.now, dir: 'projectile', o }),
    spawnAdds: (type, x, z, n) => events.push({ t: ctx.now, dir: 'spawnAdds', type, x, z, n }),
    nextTelegraphId: (() => { let n = 0; return () => `btel_test_${++n}`; })(),
  };
  return { ctx, events };
}

// Drive the boss until `done(events)` is true or the tick budget expires.
function drive(boss, ctx, events, done, maxTicks = 400) {
  for (let i = 0; i < maxTicks; i++) {
    ctx.now += DT;
    boss.update(DT, ctx);
    if (done(events)) return;
  }
  throw new Error('timed out waiting for attack to resolve');
}

// Force exactly one attack id to be ready: put every other attack on cooldown.
function isolateAttack(boss, biome, phaseIdx, attackId, dist, pickRange) {
  const cfg = BOSS_TABLE[biome].phases[phaseIdx];
  boss.phaseIndex = phaseIdx;
  boss.isAwake = true;
  // Match HP to the forced phase so _checkPhaseTransition() keeps it.
  const nextTh = phaseIdx + 1 < BOSS_TABLE[biome].phases.length
    ? BOSS_TABLE[biome].phases[phaseIdx + 1].threshold : 0;
  boss.hp = Math.round(boss.maxHp * ((cfg.threshold + nextTh) / 2));
  boss.timers = {};
  for (const a of cfg.attacks) boss.timers[a.id] = (a.id === attackId) ? 0 : 60;
  boss.basicTimer = 60;
  const atk = cfg.attacks.find(a => a.id === attackId);
  const mid = (atk.range[0] + atk.range[1]) / 2;
  // place the player inside the attack's range band
  const d = pickRange ? Math.min(Math.max(dist, atk.range[0]), atk.range[1]) : mid;
  return d;
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`ok - ${name}`); };

const EXPECTED = {
  aoe_slam: { windupMs: 1800, shape: 'circle', radius: 6.5, impact: 'damage' },
  cone_sweep: { windupMs: 1400, shape: 'cone', radius: 7.0, impact: 'damage' },
  leap: { windupMs: 1600, shape: 'circle', radius: 4.5, impact: 'damage' },
  volley: { windupMs: 1000, shape: 'circle', radius: 3.5, impact: 'projectile' },
  summon_adds: { windupMs: 1200, shape: 'circle', radius: 5.0, impact: 'spawnAdds' },
};

// Check telegraph lead-time for one (biome, attackId).
function checkAttack(biome, attackId) {
  const { ctx, events } = makeCtx({ x: 0, z: -75 });
  const boss = createBoss(biome, 0, -75, 1);
  const phaseIdx = BOSS_TABLE[biome].phases.findIndex(p => p.attacks.some(a => a.id === attackId));
  const d = isolateAttack(boss, biome, phaseIdx, attackId, 0, false);
  // put player at attack distance from boss
  ctx.players.p1.x = boss.x + d; ctx.players.p1.z = boss.z;

  const exp = EXPECTED[attackId];
  drive(boss, ctx, events, (evs) =>
    evs.some(e => e.dir === exp.impact) || evs.some(e => e.dir === 'damage'));

  const tels = events.filter(e => e.dir === 'broadcast' && e.msg.type === 'enemy_telegraph' && e.msg.kind === attackId);
  assert.ok(tels.length >= 1, `${biome}/${attackId}: enemy_telegraph broadcast`);
  const tel = tels[0].msg;
  assert.equal(tel.isBoss, true, `${biome}/${attackId}: isBoss flag`);
  assert.equal(tel.enemyId, boss.id);
  assert.equal(tel.windupMs, exp.windupMs, `${biome}/${attackId}: windupMs`);
  assert.equal(tel.telegraph.shape, exp.shape);
  assert.equal(tel.telegraph.radius, exp.radius);
  assert.ok(tel.telegraph.id, 'telegraph has id');
  assert.equal(tel.windupMs, Math.round(tel.telegraph.duration * 1000), 'windupMs matches duration*1000');

  const impact = events.find(e => e.dir === exp.impact) || events.find(e => e.dir === 'damage');
  const leadMs = Math.round((impact.t - tels[0].t) * 1000);
  // lead time must equal the configured windup within one tick of tolerance
  assert.ok(Math.abs(leadMs - exp.windupMs) <= DT * 1000,
    `${biome}/${attackId}: lead time ${leadMs}ms ~= windup ${exp.windupMs}ms`);
}

// Run every biome x every telegraphed signature attack it fields.
for (const biome of Object.keys(BOSS_TABLE)) {
  for (const attackId of Object.keys(EXPECTED)) {
    const has = BOSS_TABLE[biome].phases.some(p => p.attacks.some(a => a.id === attackId));
    if (!has) continue;
    t(`${biome} ${attackId}: telegraph precedes impact by exactly the windup`,
      () => checkAttack(biome, attackId));
  }
}

// volley projectile damage still carries the phase damage multiplier math.
t('volley resolves with real projectile damage payload', () => {
  const { ctx, events } = makeCtx({ x: 10, z: -75 });
  const boss = createBoss('forge', 0, -75, 1);
  isolateAttack(boss, 'forge', 2, 'volley', 10, false);
  ctx.players.p1.x = 10; ctx.players.p1.z = -75;
  drive(boss, ctx, events, (evs) => evs.some(e => e.dir === 'projectile'));
  const projs = events.filter(e => e.dir === 'projectile');
  assert.equal(projs.length, 8 + 2 * 4, 'phase-3 volley fires 16 bolts');
  assert.ok(projs.every(p => p.o.damage > 0 && p.o.isEnemy), 'bolts are real enemy projectiles');
});

// summon_adds spawns the phase-scaled number of adds when the windup resolves.
t('summon_adds spawns phase-scaled adds on windup resolve', () => {
  const { ctx, events } = makeCtx({ x: 15, z: -75 });
  const boss = createBoss('crypt', 0, -75, 1);
  isolateAttack(boss, 'crypt', 1, 'summon_adds', 15, false);
  ctx.players.p1.x = 15; ctx.players.p1.z = -75;
  drive(boss, ctx, events, (evs) => evs.some(e => e.dir === 'spawnAdds'));
  const adds = events.filter(e => e.dir === 'spawnAdds');
  assert.equal(adds.length, 3, 'phase-2 summons 3 adds');
  const telT = events.find(e => e.msg && e.msg.type === 'enemy_telegraph').t;
  const spawnT = adds[0].t;
  assert.ok(Math.abs((spawnT - telT) * 1000 - 1200) <= DT * 1000,
    'adds spawn exactly 1200ms after the telegraph');
});

console.log(`\n${pass} boss telegraph lead-time tests passed.`);
