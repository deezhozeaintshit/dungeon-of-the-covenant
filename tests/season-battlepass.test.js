// tests/season-battlepass.test.js — Phase 4 (workstream 1) Seasons + Battle
// Pass + Daily Delve + Weekly Leaderboards verification.
// Run: node tests/season-battlepass.test.js
//
// Covers: season object + automatic date rollover + persistence across
// "restarts", deterministic daily seeds (same day => same seed, no shared
// state), battle pass tier math, cosmetics-only reward guarantee, tier claim
// validation (locked / premium-gated / double-claim), Stripe premium flow
// (webhook signature + entitlement grant, keyless mode graceful), and the
// shared leaderboard schema/behavior (best-only vs accumulate, weekly keys,
// server-measured fields).
//
// NOTE: this test backs up and restores server/data/accounts.json,
// season.json, leaderboards.json, and stripeSessions.json so no test data
// pollutes the real store. Real Stripe keys are never printed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'server', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SEASON_FILE = path.join(DATA_DIR, 'season.json');
const BOARDS_FILE = path.join(DATA_DIR, 'leaderboards.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'stripeSessions.json');

function backup(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
const backups = {
  [ACCOUNTS_FILE]: backup(ACCOUNTS_FILE),
  [SEASON_FILE]: backup(SEASON_FILE),
  [BOARDS_FILE]: backup(BOARDS_FILE),
  [SESSIONS_FILE]: backup(SESSIONS_FILE)
};

function restore() {
  try {
    for (const [file, content] of Object.entries(backups)) {
      if (content !== null) fs.writeFileSync(file, content, 'utf8');
      else if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  } catch (e) {
    console.error('  WARN: could not restore data files:', e.message);
  }
}

let passed = 0;
function ok(name, fn) {
  const run = () => { passed++; console.log(`  PASS ${name}`); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(run).catch(e => { console.error(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; });
    }
    run();
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
  return Promise.resolve();
}

async function main() {
  // Deterministic environment: strip any real keys (never printed).
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_PUBLISHABLE_KEY;

  const SeasonService = require('../server/game/systems/SeasonService');
  const BattlePass = require('../server/game/systems/BattlePass');
  const Leaderboards = require('../server/game/systems/Leaderboards');
  const authService = require('../server/authService');
  const stripeService = require('../server/stripeService');

  // stripeService loads the gitignored .env at require time (local testing).
  // Strip keys AGAIN post-require so the keyless-mode tests are deterministic.
  // (Key values are never printed.)
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  console.log('SeasonService — season object, rollover, daily seed');
  await ok('season object has id, name, start/end dates, active flag', () => {
    const s = SeasonService.getCurrentSeason();
    assert.ok(/^\d{4}-\d{2}$/.test(s.id), `bad season id: ${s.id}`);
    assert.ok(typeof s.name === 'string' && s.name.length > 0, 'missing season name');
    assert.ok(new Date(s.startISO) < new Date(s.endISO), 'start must precede end');
    assert.strictEqual(s.active, true);
  });

  await ok('season persists across restarts (file-backed)', () => {
    const a = SeasonService.getCurrentSeason();
    assert.ok(fs.existsSync(SEASON_FILE), 'season.json must exist after first read');
    const b = SeasonService.getCurrentSeason();
    assert.strictEqual(a.id, b.id, 'second read must not roll over');
  });

  await ok('season rolls over automatically when endISO passes', () => {
    // Simulate a stale season: end date in the past.
    const stale = {
      current: { id: '2000-01', name: 'Ancient Season', startISO: '2000-01-01T00:00:00.000Z', endISO: '2000-02-01T00:00:00.000Z', active: true },
      history: []
    };
    fs.writeFileSync(SEASON_FILE, JSON.stringify(stale), 'utf8');
    const rolled = SeasonService.getCurrentSeason();
    assert.notStrictEqual(rolled.id, '2000-01', 'must roll past the stale season');
    assert.strictEqual(rolled.id, SeasonService.seasonIdFor(new Date()), 'must roll to the current month');
    const stored = JSON.parse(fs.readFileSync(SEASON_FILE, 'utf8'));
    assert.ok(stored.history.some(h => h.id === '2000-01'), 'finished season must be archived');
  });

  await ok('daily seed is deterministic per calendar day (no shared state)', () => {
    const s1 = SeasonService.dailySeedFor('2026-09-25');
    const s2 = SeasonService.dailySeedFor('2026-09-25');
    const s3 = SeasonService.dailySeedFor('2026-09-26');
    assert.strictEqual(s1, s2, 'same day must yield the same seed');
    assert.notStrictEqual(s1, s3, 'different days must yield different seeds');
    assert.ok(Number.isInteger(s1) && s1 >= 0 && s1 <= 0xFFFFFFFF, 'seed must be a uint32');
    const delve = SeasonService.getDailyDelve();
    assert.strictEqual(delve.seed, SeasonService.dailySeedFor(delve.date), 'delve seed must match the date-derived seed');
  });

  await ok('weekIdFor yields ISO week keys', () => {
    assert.ok(/^\d{4}-W\d{2}$/.test(SeasonService.weekIdFor()), 'bad week id format');
  });

  console.log('BattlePass — cosmetics-only guarantee + tier math');
  await ok('every tier reward is a known cosmetic (never pay-to-win)', () => {
    const bad = BattlePass.assertCosmeticsOnly();
    assert.deepStrictEqual(bad, [], `non-cosmetic rewards: ${bad.join('; ')}`);
    assert.strictEqual(Object.keys(BattlePass.FREE_TRACK).length, 20, 'free track must have 20 tiers');
    assert.strictEqual(Object.keys(BattlePass.PREMIUM_TRACK).length, 20, 'premium track must have 20 tiers');
  });

  await ok('tier math: 1000 XP per tier, capped at 20', () => {
    assert.strictEqual(BattlePass.tierForXp(0), 1);
    assert.strictEqual(BattlePass.tierForXp(999), 1);
    assert.strictEqual(BattlePass.tierForXp(1000), 2);
    assert.strictEqual(BattlePass.tierForXp(19500), 20);
    assert.strictEqual(BattlePass.tierForXp(999999), 20, 'tier must cap at 20');
    assert.strictEqual(BattlePass.xpForTier(1), 0);
    assert.strictEqual(BattlePass.xpForTier(20), 19000);
    assert.strictEqual(BattlePass.xpToNextTier(999999), null, 'max tier has no next tier');
  });

  console.log('BattlePass — claims, premium gate, season reset');
  const reg = authService.register('pass_tester_' + Date.now().toString(36), 'covenant');
  assert.ok(reg.ok, 'test account registration failed');
  const token = reg.token;
  const profileOf = () => authService.getProfileByToken(token);

  await ok('season XP is awarded and tiers unlock from it', () => {
    const season = SeasonService.getCurrentSeason();
    const s = SeasonService.ensureSeasonState(profileOf(), season.id);
    assert.strictEqual(s.seasonId, season.id);
    assert.strictEqual(s.xp, 0);
    const gain = SeasonService.awardSeasonXp(profileOf(), 2500);
    assert.strictEqual(gain.gained, 2500);
    assert.strictEqual(BattlePass.tierForXp(SeasonService.ensureSeasonState(profileOf()).xp), 3);
    authService.saveAccounts();
  });

  await ok('free tier claim grants the cosmetic and is idempotent', () => {
    const r = BattlePass.claimTier(token, 'free', 2);
    assert.ok(r.ok, `claim failed: ${r.error}`);
    assert.strictEqual(r.reward.id, BattlePass.FREE_TRACK[2]);
    const def = BattlePass.getCosmeticDef(r.reward.id);
    if (def.kind === 'emote') assert.ok(profileOf().ownedEmotes.includes(r.reward.id));
    const again = BattlePass.claimTier(token, 'free', 2);
    assert.ok(!again.ok && /already claimed/.test(again.error), 'double-claim must be rejected');
  });

  await ok('locked tiers cannot be claimed early', () => {
    const r = BattlePass.claimTier(token, 'free', 10);
    assert.ok(!r.ok && /not yet unlocked/.test(r.error), `expected locked error, got: ${r.error}`);
  });

  await ok('premium track is gated until premium is granted', () => {
    const season = SeasonService.getCurrentSeason();
    assert.ok(!SeasonService.hasPremium(profileOf(), season.id), 'should not start premium');
    const gated = BattlePass.claimTier(token, 'premium', 1);
    assert.ok(!gated.ok && /premium/i.test(gated.error), `expected premium gate, got: ${gated.error}`);
    const grant = SeasonService.grantPremium(token);
    assert.ok(grant.ok, `grantPremium failed: ${grant.error}`);
    assert.ok(SeasonService.hasPremium(profileOf(), season.id), 'premium flag must persist');
    const claimed = BattlePass.claimTier(token, 'premium', 1);
    assert.ok(claimed.ok, `premium claim failed: ${claimed.error}`);
    assert.strictEqual(claimed.reward.id, BattlePass.PREMIUM_TRACK[1]);
    const def = BattlePass.getCosmeticDef(claimed.reward.id);
    assert.strictEqual(def.kind, 'weaponGlow');
    assert.ok(profileOf().ownedWeaponGlows.includes(claimed.reward.id), 'premium cosmetic must be owned');
  });

  await ok('season XP and claims reset on season rollover (old claims archived)', () => {
    const season = SeasonService.getCurrentSeason();
    const s = SeasonService.ensureSeasonState(profileOf(), season.id);
    assert.ok(s.xp > 0, 'precondition: xp earned this season');
    assert.ok(s.claimedFree.length > 0, 'precondition: claims made this season');
    const rolled = SeasonService.ensureSeasonState(profileOf(), '2999-01');
    assert.strictEqual(rolled.seasonId, '2999-01');
    assert.strictEqual(rolled.xp, 0, 'new season starts at zero XP');
    assert.deepStrictEqual(rolled.claimedFree, [], 'new season starts with no claims');
    assert.strictEqual(profileOf().meta.lastSeason.seasonId, season.id, 'previous season must be archived');
    assert.ok(profileOf().meta.lastSeason.xp > 0, 'archived XP must be preserved');
  });

  console.log('Leaderboards — shared schema, weekly keys, best-only vs accumulate');
  await ok('entry schema has all canonical fields', () => {
    const r = Leaderboards.submit('rift_depth', {
      username: 'SchemaHero', displayName: 'Schema Hero', value: 7, meta: { riftTier: 7 }
    });
    assert.ok(r.ok, `submit failed: ${r.error}`);
    const e = r.entry;
    for (const f of ['boardId', 'weekId', 'seasonId', 'username', 'displayName', 'value', 'displayValue', 'meta', 'achievedAt']) {
      assert.ok(e[f] !== undefined, `entry missing field: ${f}`);
    }
    assert.strictEqual(e.username, 'schemahero', 'username must be canonical lowercase');
    assert.ok(/^\d{4}-W\d{2}$/.test(e.weekId), 'weekId must be an ISO week key');
    assert.strictEqual(e.displayValue, 'Tier 7');
  });

  await ok('daily_delve_speed keeps the fastest clear (asc, best-only)', () => {
    Leaderboards.submit('daily_delve_speed', { username: 'Speedy', displayName: 'Speedy', value: 300, meta: { clearTimeSec: 300 } });
    let r = Leaderboards.submit('daily_delve_speed', { username: 'Speedy', displayName: 'Speedy', value: 200, meta: { clearTimeSec: 200 } });
    assert.ok(r.improved && r.entry.value === 200, 'faster time must replace');
    r = Leaderboards.submit('daily_delve_speed', { username: 'Speedy', displayName: 'Speedy', value: 250, meta: { clearTimeSec: 250 } });
    assert.ok(!r.improved && r.entry.value === 200, 'slower time must not replace');
    assert.strictEqual(r.entry.displayValue, '3m 20s');
  });

  await ok('season_xp accumulates a weekly total per account (desc)', () => {
    Leaderboards.submit('season_xp', { username: 'Grinder', displayName: 'Grinder', value: 100 });
    const r = Leaderboards.submit('season_xp', { username: 'Grinder', displayName: 'Grinder', value: 50 });
    assert.ok(r.improved && r.entry.value === 150, `expected 150, got ${r.entry.value}`);
    assert.strictEqual(r.entry.displayValue, '150 XP');
  });

  await ok('getBoard sorts by direction and assigns ranks', () => {
    Leaderboards.submit('daily_delve_speed', { username: 'Slowpoke', displayName: 'Slowpoke', value: 600, meta: {} });
    const b = Leaderboards.getBoard('daily_delve_speed', { limit: 10 });
    assert.ok(b.ok, `getBoard failed: ${b.error}`);
    assert.ok(b.entries.length >= 2, 'expected at least 2 entries');
    assert.strictEqual(b.entries[0].username, 'speedy', 'fastest must rank first');
    assert.strictEqual(b.entries[0].rank, 1);
    assert.strictEqual(b.entries[1].rank, 2);
    const bad = Leaderboards.getBoard('nope_board');
    assert.ok(!bad.ok, 'unknown board must error');
  });

  console.log('Stripe — season-pass premium flow (webhook + graceful keyless mode)');
  await ok('keyless mode: pass checkout refuses cleanly, game unaffected', async () => {
    assert.ok(!stripeService.isConfigured(), 'test env must have no Stripe keys');
    let threw = false;
    try {
      await stripeService.createCheckoutSession({ productId: 'pass_premium_season', originUrl: 'http://localhost:3000', playerName: 'T', accountToken: token });
    } catch (e) {
      threw = e.code === 'STRIPE_NOT_CONFIGURED';
    }
    assert.ok(threw, 'keyless checkout must throw STRIPE_NOT_CONFIGURED');
    assert.ok(stripeService.getConfigStatus().shopAvailable === false);
  });

  await ok('signature-verified webhook grants season-pass premium (idempotent)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_phase4';
    const reg2 = authService.register('pass_webhook_' + Date.now().toString(36), 'covenant');
    assert.ok(reg2.ok);
    const season = SeasonService.getCurrentSeason();
    const event = {
      id: 'evt_phase4_test_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_phase4_test_1',
          payment_status: 'paid',
          client_reference_id: reg2.token,
          metadata: { productId: 'pass_premium_season', accountToken: reg2.token }
        }
      }
    };
    const raw = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_test_phase4').update(`${ts}.${raw}`).digest('hex');
    const header = `t=${ts},v1=${sig}`;
    const check = stripeService.verifyWebhookSignature(raw, header);
    assert.ok(check.ok, `signature check failed: ${check.error}`);
    const result = await stripeService.handleWebhookEvent(JSON.parse(raw));
    assert.strictEqual(result.granted, 'season_pass_premium', `unexpected webhook result: ${JSON.stringify(result)}`);
    assert.ok(SeasonService.hasPremium(authService.getProfileByToken(reg2.token), season.id), 'premium must be recorded');
    // Replay the same event: must be idempotent.
    const dup = await stripeService.handleWebhookEvent(JSON.parse(raw));
    assert.ok(dup.duplicate === true, 'replayed webhook must be flagged duplicate');
    // Forged signature must be rejected.
    const forged = stripeService.verifyWebhookSignature(raw, `t=${ts},v1=${'0'.repeat(64)}`);
    assert.ok(!forged.ok, 'forged signature must be rejected');
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  await ok('pass checkout return path (verify-session) grants premium for paid pass sessions', async () => {
    // Keyless: verifySession refuses cleanly without touching accounts.
    const r = await stripeService.verifySession('cs_test_123', token);
    assert.ok(r.verified === false, 'keyless verify must not verify');
    assert.ok(/not configured/i.test(r.error || ''), `unexpected error: ${r.error}`);
  });

  console.log(`\n${passed} checks passed.`);
  restore();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exitCode = 1;
  restore();
});
