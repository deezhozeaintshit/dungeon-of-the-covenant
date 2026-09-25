// server/stripeService.js — Stripe Checkout for the Covenant COSMETIC SHOP.
//
// COSMETICS ONLY — NEVER PAY-TO-WIN. This service sells hero skins, weapon glow
// effects, and emotes. It grants zero gameplay stats: no attack, no HP, no XP,
// no loot luck, no blessings, no shards. The catalog lives in
// server/cosmeticsCatalog.js, which is the single source of truth.
//
// Security model:
//  - Stripe keys come ONLY from process.env (STRIPE_SECRET_KEY,
//    STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY). This file contains
//    placeholders/empty defaults only — never real keys.
//  - Entitlements are granted ONLY after Stripe confirms payment, via either:
//      (a) a signature-verified checkout.session.completed webhook, or
//      (b) a server-side session retrieval proving payment_status === 'paid'.
//  - Nothing is granted at checkout-session creation time. Forged session ids,
//    unknown product ids, and account-token mismatches are all rejected.
//  - Granted sessions are recorded in server/data/stripeSessions.json
//    (atomic writes) so a session can never grant twice (replay protection).
//  - With no keys configured the shop reports "coming soon"; checkout creation
//    refuses cleanly and the game is fully playable.

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const authService = require('./authService');
const catalog = require('./cosmeticsCatalog');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ENV_TXT_PATH = path.join(__dirname, '..', '.env.txt');

// Local-testing convenience: load a gitignored .env / .env.txt into
// process.env (never overwrites real env vars). Real keys are never printed
// or committed.
function loadEnvFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let val = (match[2] || '').trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (val && !process.env[key]) {
            process.env[key] = val;
          }
        }
      });
    }
  } catch (e) {
    console.warn('[StripeService] Could not parse env file:', e.message);
  }
}

loadEnvFile(ENV_PATH);
loadEnvFile(ENV_TXT_PATH);

const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'stripeSessions.json');
const WEBHOOK_TOLERANCE_SEC = 300; // 5 minutes, per Stripe's recommendation

// Placeholder / empty defaults only. Real keys live in process.env.
const KEY_DEFAULTS = {
  STRIPE_SECRET_KEY: '',
  STRIPE_PUBLISHABLE_KEY: '',
  STRIPE_WEBHOOK_SECRET: ''
};

class StripeService {
  constructor() {
    this.grantedSessions = this._loadGrantedSessions();
  }

  // --- Key access (env only; never real values in code) --------------------
  getSecretKey() {
    const key = (process.env.STRIPE_SECRET_KEY || KEY_DEFAULTS.STRIPE_SECRET_KEY || '').trim();
    if (key.startsWith('sk_live_') || key.startsWith('sk_test_') || key.startsWith('rk_')) {
      return key;
    }
    return '';
  }

  getPublishableKey() {
    // Publishable keys are safe to expose to the browser by design.
    const key = (process.env.STRIPE_PUBLISHABLE_KEY || KEY_DEFAULTS.STRIPE_PUBLISHABLE_KEY || '').trim();
    if (key.startsWith('pk_live_') || key.startsWith('pk_test_')) {
      return key;
    }
    return '';
  }

  getWebhookSecret() {
    return (process.env.STRIPE_WEBHOOK_SECRET || KEY_DEFAULTS.STRIPE_WEBHOOK_SECRET || '').trim();
  }

  isConfigured() {
    return Boolean(this.getSecretKey());
  }

  getBaseUrl(originOverride) {
    return originOverride || process.env.BASE_URL || 'http://localhost:3000';
  }

  getMode() {
    const sk = this.getSecretKey();
    if (!sk) return 'unconfigured';
    return sk.startsWith('sk_live_') ? 'live' : 'test';
  }

  getConfigStatus() {
    return {
      // Shop availability flag the client uses for its "coming soon" state.
      shopAvailable: this.isConfigured(),
      stripeConfigured: this.isConfigured(),
      webhookConfigured: Boolean(this.getWebhookSecret()),
      mode: this.getMode(),
      publishableKey: this.getPublishableKey(),
      catalog: catalog.publicCatalog()
    };
  }

  // --- Replay protection ---------------------------------------------------
  _loadGrantedSessions() {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        if (raw && typeof raw === 'object') return raw;
      }
    } catch (e) {
      console.warn('[StripeService] Could not load granted sessions:', e.message);
    }
    return {};
  }

  _saveGrantedSessions() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${SESSIONS_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.grantedSessions, null, 2), 'utf8');
      fs.renameSync(tmp, SESSIONS_FILE); // atomic on POSIX
    } catch (e) {
      console.error('[StripeService] Failed to persist granted sessions:', e.message);
    }
  }

  hasGrantedSession(sessionId) {
    return Boolean(sessionId && this.grantedSessions[sessionId]);
  }

  _recordGrantedSession(sessionId, record) {
    this.grantedSessions[sessionId] = {
      ...record,
      grantedAt: new Date().toISOString()
    };
    this._saveGrantedSessions();
  }

  // --- Stripe HTTPS helper ---------------------------------------------------
  _stripeRequest({ method, path, postData, idempotencyKey }) {
    const secretKey = this.getSecretKey();
    return new Promise((resolve, reject) => {
      const headers = {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      };
      if (postData) headers['Content-Length'] = Buffer.byteLength(postData);
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const req = https.request(
        { hostname: 'api.stripe.com', port: 443, path, method, headers },
        (res) => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(parsed);
              } else {
                reject(new Error(parsed.error?.message || `Stripe API error ${res.statusCode}`));
              }
            } catch (e) {
              reject(new Error(`Stripe API returned non-JSON (${res.statusCode})`));
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('Stripe API request timed out')));
      if (postData) req.write(postData);
      req.end();
    });
  }

  // --- Checkout session creation ---------------------------------------------
  // Creates a REAL Stripe Checkout session. Grants NOTHING — fulfillment
  // happens only after Stripe confirms payment (webhook or verifySession).
  async createCheckoutSession({ productId, originUrl, playerName, accountToken }) {
    const product = catalog.getProduct(productId);
    if (!product) {
      throw new Error('Unknown product. The cosmetic shop catalog changed — please refresh.');
    }
    if (!this.isConfigured()) {
      const err = new Error('Stripe is not configured yet — the cosmetic shop is coming soon.');
      err.code = 'STRIPE_NOT_CONFIGURED';
      throw err;
    }

    const baseUrl = this.getBaseUrl(originUrl);
    const successUrl = `${baseUrl}/?stripe_success=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/?stripe_cancel=1`;

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', successUrl);
    params.append('cancel_url', cancelUrl);
    params.append('line_items[0][price_data][currency]', product.currency);
    params.append('line_items[0][price_data][unit_amount]', String(product.amountCents));
    params.append('line_items[0][price_data][product_data][name]', `Dungeon of the Covenant — ${product.name}`);
    params.append('line_items[0][price_data][product_data][description]', `${product.description} (Cosmetic only — never pay-to-win.)`);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[productId]', product.id);
    params.append('metadata[playerName]', playerName || 'Hero');
    if (accountToken) {
      params.append('client_reference_id', accountToken);
      params.append('metadata[accountToken]', accountToken);
    }

    // Idempotency: one session per (account, product, 10-minute window).
    const idemKey = crypto
      .createHash('sha256')
      .update(`cov-shop|${accountToken || 'guest'}|${product.id}|${Math.floor(Date.now() / 600000)}`)
      .digest('hex');

    const session = await this._stripeRequest({
      method: 'POST',
      path: '/v1/checkout/sessions',
      postData: params.toString(),
      idempotencyKey: idemKey
    });

    if (!session || !session.url || !session.id) {
      throw new Error('Stripe did not return a checkout URL. Please try again.');
    }

    return {
      mode: this.getMode() === 'live' ? 'stripe_live' : 'stripe_test',
      sessionId: session.id,
      checkoutUrl: session.url,
      product: {
        id: product.id,
        name: product.name,
        priceDisplay: catalog.formatPrice(product.amountCents)
      }
    };
  }

  // --- Session verification (checkout return path) -----------------------------
  // Server-side truth: retrieves the session from Stripe and requires
  // payment_status === 'paid' before granting. Forged session ids, unpaid
  // sessions, product mismatches, and account-token mismatches are rejected.
  async verifySession(sessionId, accountToken) {
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
      return { verified: false, error: 'Invalid checkout session.' };
    }
    if (!this.isConfigured()) {
      return { verified: false, error: 'Stripe is not configured.' };
    }
    if (this.hasGrantedSession(sessionId)) {
      // Already fulfilled (e.g. webhook beat us here) — report success,
      // idempotently, without granting twice.
      const rec = this.grantedSessions[sessionId];
      return { verified: true, alreadyGranted: true, productId: rec.productId };
    }

    let session;
    try {
      session = await this._stripeRequest({
        method: 'GET',
        path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`
      });
    } catch (e) {
      return { verified: false, error: 'Could not verify payment with Stripe. Please try again.' };
    }

    if (!session || session.payment_status !== 'paid') {
      return { verified: false, error: 'Payment not completed for this session.' };
    }

    const productId = session.metadata?.productId;
    const product = catalog.getProduct(productId);
    if (!product) {
      return { verified: false, error: 'Session references an unknown product.' };
    }

    // The session must belong to the account claiming it.
    const sessionAccount = session.client_reference_id || session.metadata?.accountToken || '';
    if (accountToken && sessionAccount && sessionAccount !== accountToken) {
      return { verified: false, error: 'This purchase belongs to a different account.' };
    }
    const grantToken = accountToken || sessionAccount;
    if (!grantToken) {
      return { verified: false, error: 'No account is signed in to receive this purchase.' };
    }

    const grant = authService.grantCosmeticEntitlement(grantToken, product.id);
    if (!grant || !grant.ok) {
      return { verified: false, error: grant?.error || 'Could not grant cosmetic to account.' };
    }

    this._recordGrantedSession(sessionId, {
      productId: product.id,
      accountToken: grantToken,
      source: 'verify_session'
    });

    return { verified: true, productId: product.id, entitlements: grant.entitlements };
  }

  // --- Webhook signature verification ------------------------------------------
  // Stripe-Signature: t=<timestamp>,v1=<hmac-sha256 hex of "t.payload">.
  verifyWebhookSignature(rawBody, signatureHeader) {
    const secret = this.getWebhookSecret();
    if (!secret) {
      return { ok: false, error: 'Webhook secret not configured.' };
    }
    if (!signatureHeader || !rawBody) {
      return { ok: false, error: 'Missing webhook signature.' };
    }

    const parts = {};
    for (const part of String(signatureHeader).split(',')) {
      const [k, v] = part.split('=');
      if (k && v) parts[k.trim()] = v.trim();
    }
    const timestamp = parseInt(parts.t || '', 10);
    const signature = parts.v1 || '';
    if (!timestamp || !signature) {
      return { ok: false, error: 'Malformed webhook signature.' };
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    if (age > WEBHOOK_TOLERANCE_SEC) {
      return { ok: false, error: 'Webhook signature timestamp outside tolerance.' };
    }

    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), payload]);
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    let ok = false;
    try {
      ok = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      return { ok: false, error: 'Webhook signature mismatch.' };
    }
    return { ok: true };
  }

  // --- Webhook event handling (post-signature-verification) ---------------------
  async handleWebhookEvent(event) {
    if (!event || typeof event !== 'object') {
      return { received: false, error: 'Invalid event payload.' };
    }

    // Idempotency on the Stripe event id itself.
    if (event.id && this.grantedSessions[`evt_${event.id}`]) {
      return { received: true, duplicate: true };
    }

    if (event.type === 'checkout.session.completed') {
      const sessionObj = event.data?.object;
      if (!sessionObj) {
        return { received: false, error: 'Missing session object.' };
      }
      if (sessionObj.payment_status !== 'paid') {
        return { received: true, ignored: 'unpaid' };
      }

      const productId = sessionObj.metadata?.productId;
      const product = catalog.getProduct(productId);
      if (!product) {
        console.warn(`[StripeService] Webhook for unknown product: ${productId}`);
        return { received: true, ignored: 'unknown_product' };
      }

      const accountToken = sessionObj.client_reference_id || sessionObj.metadata?.accountToken || '';
      if (!accountToken) {
        console.warn('[StripeService] Webhook session has no account token; cannot grant.');
        return { received: true, ignored: 'no_account' };
      }

      const sessionKey = sessionObj.id;
      if (sessionKey && this.hasGrantedSession(sessionKey)) {
        return { received: true, duplicate: true };
      }

      const grant = authService.grantCosmeticEntitlement(accountToken, product.id);
      if (!grant || !grant.ok) {
        console.warn('[StripeService] Webhook grant failed:', grant?.error);
        return { received: true, ignored: 'grant_failed' };
      }

      if (sessionKey) {
        this._recordGrantedSession(sessionKey, {
          productId: product.id,
          accountToken,
          source: 'webhook'
        });
      }
      if (event.id) {
        this.grantedSessions[`evt_${event.id}`] = { grantedAt: new Date().toISOString(), source: 'webhook_event' };
        this._saveGrantedSessions();
      }
      console.log(`[StripeService] Granted ${product.id} to account via webhook.`);
      return { received: true, granted: product.id };
    }

    // Other event types are acknowledged but need no fulfillment.
    return { received: true, ignored: event.type };
  }
}

module.exports = new StripeService();
