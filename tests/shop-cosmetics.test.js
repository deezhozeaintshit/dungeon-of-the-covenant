// tests/shop-cosmetics.test.js — Phase 3 (workstream 6) Cosmetic Shop verification.
// Run: node tests/shop-cosmetics.test.js
//
// Covers: catalog is cosmetics-only (zero stat impact), entitlement grant +
// idempotency + atomic persistence, forged purchase claims rejected, replay
// protection, webhook signature verification, and graceful key-absent mode.
// NOTE: this test backs up and restores server/data/accounts.json so no test
// data pollutes the real store. Real Stripe keys are never printed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCOUNTS_FILE = path.join(__dirname, '..', 'server', 'data', 'accounts.json');
const SESSIONS_FILE = path.join(__dirname, '..', 'server', 'data', 'stripeSessions.json');

// Snapshot real files so the test leaves no trace.
const accountsBackup = fs.existsSync(ACCOUNTS_FILE) ? fs.readFileSync(ACCOUNTS_FILE, 'utf8') : null;
const sessionsBackup = fs.existsSync(SESSIONS_FILE) ? fs.readFileSync(SESSIONS_FILE, 'utf8') : null;

let passed = 0;
function ok(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { passed++; console.log(`  PASS ${name}`); })
        .catch(e => { console.error(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; });
    }
    passed++; console.log(`  PASS ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
  return Promise.resolve();
}

function restore() {
  try {
    if (accountsBackup !== null) fs.writeFileSync(ACCOUNTS_FILE, accountsBackup, 'utf8');
    else if (fs.existsSync(ACCOUNTS_FILE)) fs.unlinkSync(ACCOUNTS_FILE);
    if (sessionsBackup !== null) fs.writeFileSync(SESSIONS_FILE, sessionsBackup, 'utf8');
    else if (fs.existsSync(SESSIONS_FILE)) fs.unlinkSync(SESSIONS_FILE);
  } catch (e) {
    console.error('  WARN: could not restore data files:', e.message);
  }
}

async function main() {
  // Strip any real keys from the environment for deterministic tests.
  // (Values are never printed.)
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  const catalog = require('../server/cosmeticsCatalog');
  const authService = require('../server/authService');
  const stripeService = require('../server/stripeService');

  // --- 1. Catalog is cosmetics-only: no stats, shards, blessings, gear --------
  await ok('catalog grants contain only cosmetic ids (zero stat impact)', () => {
    for (const p of catalog.PRODUCTS) {
      assert.ok(p.amountCents > 0, `${p.id} must have a price`);
      assert.ok(!('stats' in p) && !('shards' in p) && !('blessings' in p) && !('gearScore' in p),
        `${p.id} must not carry gameplay fields`);
      for (const s of p.grants.skins) assert.ok(catalog.isGrantableCosmetic('skin', s), s);
      for (const g of p.grants.weaponGlows) assert.ok(catalog.isGrantableCosmetic('weaponGlow', g), g);
      for (const e of p.grants.emotes) assert.ok(catalog.isGrantableCosmetic('emote', e), e);
    }
    assert.ok(!catalog.isValidProduct('starter_pack'), 'old pay-to-win ids must not resolve');
    assert.ok(!catalog.isValidProduct('iap_hellfire_cleaver'), 'old stat items must not resolve');
    assert.strictEqual(catalog.getProduct('nope'), null);
  });

  await ok('public catalog exposes prices but no entitlement logic', () => {
    const pub = catalog.publicCatalog();
    assert.ok(pub.length >= 9, 'expected skins + glows + emotes + bundle');
    for (const p of pub) {
      assert.ok(p.priceDisplay && /^\$\d+\.\d{2}$/.test(p.priceDisplay), `${p.id} price clarity`);
      assert.ok(!('grants' in p), 'grant lists must stay server-side');
    }
  });

  // --- 2. Entitlement grants --------------------------------------------------
  const reg = authService.register('shoptest_hero', 'testpass123');
  assert.ok(reg.ok, 'test account registration');
  const token = reg.token;
  const before = JSON.parse(JSON.stringify(authService.getProfileByToken(token)));

  await ok('grant rejects unknown token and unknown product', () => {
    assert.strictEqual(authService.grantCosmeticEntitlement('bad_token', 'skin_obsidian_plate').ok, false);
    assert.strictEqual(authService.grantCosmeticEntitlement(token, 'iap_godslayer_scythe').ok, false);
    assert.strictEqual(authService.grantCosmeticEntitlement(token, 'starter_pack').ok, false);
  });

  await ok('grant is idempotent and changes zero gameplay stats', () => {
    const g1 = authService.grantCosmeticEntitlement(token, 'skin_obsidian_plate');
    assert.ok(g1.ok && !g1.alreadyOwned, 'first grant');
    const g2 = authService.grantCosmeticEntitlement(token, 'skin_obsidian_plate');
    assert.ok(g2.ok && g2.alreadyOwned, 'second grant is no-op success');
    const p = authService.getProfileByToken(token);
    assert.deepStrictEqual(p.ownedSkins, ['skin_obsidian_plate'], 'no duplicates');
    // Zero stat impact:
    assert.strictEqual(p.shards, before.shards, 'shards untouched');
    assert.strictEqual(p.gearScore, before.gearScore, 'gear score untouched');
    assert.strictEqual(p.mightRank, before.mightRank, 'blessing ranks untouched');
    assert.strictEqual(p.equippedItem, before.equippedItem, 'no stat weapon equipped');
    // Auto-equip on first grant:
    assert.strictEqual(p.equippedSkin, 'skin_obsidian_plate');
  });

  await ok('grant does not overwrite an existing equip choice', () => {
    authService.grantCosmeticEntitlement(token, 'skin_sunforged');
    const p = authService.getProfileByToken(token);
    assert.strictEqual(p.equippedSkin, 'skin_obsidian_plate', 'existing choice kept');
    assert.deepStrictEqual(p.ownedSkins.sort(), ['skin_obsidian_plate', 'skin_sunforged'].sort());
  });

  await ok('grant persists atomically to accounts.json', () => {
    const onDisk = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    const uname = Object.keys(onDisk).find(u => onDisk[u].token === token);
    assert.ok(uname, 'account persisted');
    assert.ok(onDisk[uname].profile.ownedSkins.includes('skin_obsidian_plate'), 'skin persisted');
    // No temp files left behind by the atomic write.
    const leftovers = fs.readdirSync(path.dirname(ACCOUNTS_FILE)).filter(f => f.endsWith('.tmp'));
    assert.strictEqual(leftovers.length, 0, 'no tmp leftovers');
  });

  await ok('equip validates ownership server-side', () => {
    assert.strictEqual(authService.setEquippedCosmetic(token, 'skin', 'skin_voidborn').ok, false, 'cannot equip unowned');
    assert.ok(authService.setEquippedCosmetic(token, 'skin', 'skin_sunforged').ok, 'can equip owned');
    assert.strictEqual(authService.getProfileByToken(token).equippedSkin, 'skin_sunforged');
    assert.ok(authService.setEquippedCosmetic(token, 'skin', null).ok, 'can unequip');
    assert.strictEqual(authService.getProfileByToken(token).equippedSkin, null);
    assert.strictEqual(authService.setEquippedCosmetic(token, 'hat', 'x').ok, false, 'unknown kind rejected');
    assert.strictEqual(authService.setEquippedCosmetic('bad_token', 'skin', 'skin_obsidian_plate').ok, false);
  });

  await ok('bundle grants every cosmetic exactly once', () => {
    const g = authService.grantCosmeticEntitlement(token, 'bundle_covenant_collector');
    assert.ok(g.ok, 'bundle grant');
    const ent = authService.getEntitlements(token);
    assert.strictEqual(ent.ownedSkins.length, 3);
    assert.strictEqual(ent.ownedWeaponGlows.length, 3);
    assert.strictEqual(ent.ownedEmotes.length, 3);
    assert.strictEqual(new Set(ent.ownedSkins).size, 3, 'no duplicates');
  });

  // --- 3. Key-absent graceful mode ---------------------------------------------
  await ok('shop reports coming-soon with no keys configured', async () => {
    // Simulate a keyless deployment: strip keys AFTER require, because the
    // service's .env loader runs at require time (values never printed).
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const status = stripeService.getConfigStatus();
    assert.strictEqual(status.shopAvailable, false);
    assert.strictEqual(status.mode, 'unconfigured');
    assert.ok(Array.isArray(status.catalog) && status.catalog.length > 0, 'catalog still listed');
    assert.strictEqual(status.publishableKey, '', 'no key material leaked');
    try {
      await stripeService.createCheckoutSession({ productId: 'skin_obsidian_plate', accountToken: token });
      assert.fail('should have thrown');
    } catch (e) {
      assert.strictEqual(e.code, 'STRIPE_NOT_CONFIGURED');
    }
  });

  // --- 4. Forged / invalid purchase claims rejected -----------------------------
  // Verification LOGIC tests: use a placeholder key so isConfigured() passes,
  // and stub the Stripe HTTPS layer so no real network leaves the machine.
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_for_test_only';
  // From here on, Stripe network calls are stubbed on the singleton so no
  // real HTTPS leaves the machine; we test the verification LOGIC.
  const realRequest = stripeService._stripeRequest;
  const paidSession = (sid, productId, accountRef) => ({
    id: sid,
    payment_status: 'paid',
    client_reference_id: accountRef,
    metadata: { productId, accountToken: accountRef }
  });

  await ok('verifySession rejects malformed and unknown sessions', async () => {
    stripeService._stripeRequest = async () => { throw new Error('not found'); };
    let r = await stripeService.verifySession('cov_sandbox_123', token);
    assert.strictEqual(r.verified, false, 'non-Stripe session id rejected');
    r = await stripeService.verifySession('cs_test_forged', token);
    assert.strictEqual(r.verified, false, 'Stripe API failure => not verified');
  });

  await ok('verifySession rejects unpaid sessions and product mismatch', async () => {
    stripeService._stripeRequest = async () => ({ id: 'cs_x', payment_status: 'unpaid', metadata: { productId: 'glow_hellfire' }, client_reference_id: token });
    let r = await stripeService.verifySession('cs_x', token);
    assert.strictEqual(r.verified, false, 'unpaid rejected');
    stripeService._stripeRequest = async () => paidSession('cs_y', 'iap_godslayer_scythe', token);
    r = await stripeService.verifySession('cs_y', token);
    assert.strictEqual(r.verified, false, 'unknown product rejected');
  });

  await ok('verifySession rejects account-token mismatch (stolen session)', async () => {
    stripeService._stripeRequest = async () => paidSession('cs_z', 'glow_hellfire', 'cov_tok_somebody_else');
    const r = await stripeService.verifySession('cs_z', token);
    assert.strictEqual(r.verified, false, 'cross-account claim rejected');
  });

  await ok('verifySession grants once on real paid session (replay-safe)', async () => {
    const reg2 = authService.register('shoptest_two', 'testpass123');
    const tok2 = reg2.token;
    stripeService._stripeRequest = async () => paidSession('cs_real_1', 'glow_astral', tok2);
    const r1 = await stripeService.verifySession('cs_real_1', tok2);
    assert.strictEqual(r1.verified, true, 'paid session verifies');
    assert.ok(authService.getEntitlements(tok2).ownedWeaponGlows.includes('glow_astral'), 'glow granted');
    const r2 = await stripeService.verifySession('cs_real_1', tok2);
    assert.strictEqual(r2.verified, true, 'replay still reports verified');
    assert.strictEqual(r2.alreadyGranted, true, 'replay flagged');
    const ent = authService.getEntitlements(tok2);
    assert.strictEqual(ent.ownedWeaponGlows.filter(g => g === 'glow_astral').length, 1, 'granted exactly once');
    // Session recorded atomically on disk.
    const onDisk = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    assert.ok(onDisk['cs_real_1'], 'granted session persisted');
  });

  await ok('createCheckoutSession validates product before any Stripe call', async () => {
    let stripeHit = false;
    stripeService._stripeRequest = async () => { stripeHit = true; return { id: 'cs_1', url: 'https://x' }; };
    try {
      await stripeService.createCheckoutSession({ productId: 'iap_hellfire_cleaver', accountToken: token });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(/Unknown product/.test(e.message));
    }
    assert.strictEqual(stripeHit, false, 'no Stripe call for invalid product');
  });

  stripeService._stripeRequest = realRequest;
  delete process.env.STRIPE_SECRET_KEY;

  // --- 5. Webhook signature verification -----------------------------------------
  await ok('webhook rejects unsigned, tampered, and stale payloads', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_placeholder_only';
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
    const ts = Math.floor(Date.now() / 1000);
    const goodSig = `t=${ts},v1=${crypto.createHmac('sha256', 'whsec_test_placeholder_only').update(`${ts}.${payload}`).digest('hex')}`;
    assert.strictEqual(stripeService.verifyWebhookSignature(payload, goodSig).ok, true, 'valid signature passes');
    assert.strictEqual(stripeService.verifyWebhookSignature(payload + 'x', goodSig).ok, false, 'tampered body rejected');
    assert.strictEqual(stripeService.verifyWebhookSignature(payload, 't=1,v1=deadbeef').ok, false, 'bad sig rejected');
    assert.strictEqual(stripeService.verifyWebhookSignature(payload, null).ok, false, 'missing header rejected');
    const oldTs = ts - 3600;
    const oldSig = `t=${oldTs},v1=${crypto.createHmac('sha256', 'whsec_test_placeholder_only').update(`${oldTs}.${payload}`).digest('hex')}`;
    assert.strictEqual(stripeService.verifyWebhookSignature(payload, oldSig).ok, false, 'stale timestamp rejected');
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  await ok('webhook grants paid sessions idempotently, ignores others', async () => {
    const reg3 = authService.register('shoptest_three', 'testpass123');
    const tok3 = reg3.token;
    const evt = {
      id: 'evt_webhook_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_webhook_1', payment_status: 'paid', client_reference_id: tok3, metadata: { productId: 'emote_shadow_dance' } } }
    };
    const r1 = await stripeService.handleWebhookEvent(evt);
    assert.strictEqual(r1.received, true);
    assert.strictEqual(r1.granted, 'emote_shadow_dance');
    assert.ok(authService.getEntitlements(tok3).ownedEmotes.includes('emote_shadow_dance'));
    const r2 = await stripeService.handleWebhookEvent(evt);
    assert.strictEqual(r2.duplicate, true, 'duplicate event ignored');
    assert.strictEqual(authService.getEntitlements(tok3).ownedEmotes.length, 1, 'granted once');
    const r3 = await stripeService.handleWebhookEvent({ id: 'evt_x', type: 'customer.created', data: {} });
    assert.strictEqual(r3.received, true, 'unrelated events acknowledged');
    const r4 = await stripeService.handleWebhookEvent({
      id: 'evt_y', type: 'checkout.session.completed',
      data: { object: { id: 'cs_y', payment_status: 'paid', client_reference_id: tok3, metadata: { productId: 'starter_pack' } } }
    });
    assert.strictEqual(r4.ignored, 'unknown_product', 'old pay-to-win product ignored');
  });

  console.log(`\n${passed} shop tests passed.`);
  restore();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exitCode = 1;
  restore();
});
