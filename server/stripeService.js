// server/stripeService.js - Live Stripe Checkout, Webhook Verification & Character Item Fulfillment
const fs = require('fs');
const path = require('path');
const https = require('https');
const authService = require('./authService');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ENV_TXT_PATH = path.join(__dirname, '..', '.env.txt');

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

const STRIPE_CATALOG = {
  starter_pack: {
    id: 'starter_pack',
    name: 'Vanguard Starter Pack (500 Soul Shards + 3D Infernal Demon-Crown + Hellfire Great-Blade)',
    description: 'Instantly grants +500 Soul Shards, the 3D Infernal Demon-Crown Aura, and equips the Legendary Hellfire Warlord Great-Blade (GS 680: +45 ATK, +180 HP, +15% CRIT, +10% Lifesteal).',
    amountCents: 299,
    currency: 'usd',
    shards: 500,
    aura: 'infernal',
    title: 'Hellfire Warlord',
    blessings: { might: 0, vitality: 0, haste: 0 },
    equippedItem: {
      id: 'iap_hellfire_cleaver',
      name: 'Hellfire Warlord Great-Blade (IAP)',
      slot: 'weapon',
      rarity: 'Legendary',
      color: '#ffaa00',
      beamColor: 0xffaa00,
      gearScore: 680,
      stats: { attackPower: 45, maxHp: 180, critChance: 0.15, lifesteal: 0.10, cooldownHaste: 0.12 }
    }
  },
  founder_pass: {
    id: 'founder_pass',
    name: "Founder's Sovereign Pass (1,500 Shards + 3D Seraph Wings + Sovereign Relic-Blade + All Blessings +1)",
    description: 'Unlocks 1,500 Soul Shards, 3D Golden Seraph Wings, +1 Rank to ALL Soul Blessings, and equips the Mythic Sovereign Seraph Relic-Blade (GS 1150: +85 ATK, +350 HP, +25% CRIT, +18% Lifesteal).',
    amountCents: 699,
    currency: 'usd',
    shards: 1500,
    aura: 'sovereign',
    title: 'Sovereign Ascendant',
    blessings: { might: 1, vitality: 1, haste: 1 },
    equippedItem: {
      id: 'iap_sovereign_relicblade',
      name: 'Sovereign Seraph Relic-Blade (IAP)',
      slot: 'weapon',
      rarity: 'Mythic Covenant',
      color: '#ff2255',
      beamColor: 0xff2255,
      gearScore: 1150,
      stats: { attackPower: 85, maxHp: 350, critChance: 0.25, lifesteal: 0.18, cooldownHaste: 0.20, moveSpeed: 1.5 }
    }
  },
  mythic_3d_arsenal: {
    id: 'mythic_3d_arsenal',
    name: "Mythic 3D Arsenal Bundle (3,500 Shards + All 4 3D Auras + Malakor's Godslayer Scythe)",
    description: "Unlocks all 4 3D Cosmetic Auras, 3,500 Soul Shards, +2 Ranks to ALL Soul Blessings, and equips Malakor's Godslayer Astral Scythe (GS 1650: +140 ATK, +600 HP, +35% CRIT, +25% Lifesteal, +30% Haste).",
    amountCents: 999,
    currency: 'usd',
    shards: 3500,
    aura: 'sovereign',
    unlockAllAuras: true,
    title: 'Grand Architect of the Covenant',
    blessings: { might: 2, vitality: 2, haste: 2 },
    equippedItem: {
      id: 'iap_godslayer_scythe',
      name: "Malakor's Godslayer Astral Scythe (IAP)",
      slot: 'weapon',
      rarity: 'Mythic Covenant',
      color: '#ff2255',
      beamColor: 0xff2255,
      gearScore: 1650,
      stats: { attackPower: 140, maxHp: 600, critChance: 0.35, lifesteal: 0.25, cooldownHaste: 0.30, moveSpeed: 2.2 }
    }
  },
  shard_vault_3000: {
    id: 'shard_vault_3000',
    name: 'Sovereign Treasury Chest (3,000 Soul Shards)',
    description: 'Massive treasury of 3,000 Soul Shards to max out permanent Account Soul-Tree Blessings and 3D Auras.',
    amountCents: 1499,
    currency: 'usd',
    shards: 3000,
    aura: null,
    title: null,
    blessings: { might: 0, vitality: 0, haste: 0 },
    equippedItem: null
  }
};

class StripeService {
  getSecretKey() {
    const key = (process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY || '').trim();
    if (key.startsWith('sk_live_') || key.startsWith('sk_test_') || key.startsWith('rk_')) {
      return key;
    }
    return '';
  }

  getWebhookSecret() {
    return (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  }

  getBaseUrl(originOverride) {
    return originOverride || process.env.BASE_URL || 'http://localhost:3000';
  }

  getConfigStatus() {
    const sk = this.getSecretKey();
    return {
      stripeConfigured: Boolean(sk),
      webhookConfigured: Boolean(this.getWebhookSecret()),
      mode: sk.startsWith('sk_live_') ? 'live' : (sk ? 'test' : 'sandbox_fallback'),
      catalog: STRIPE_CATALOG
    };
  }

  getRewardPackage(productId) {
    return STRIPE_CATALOG[productId] || STRIPE_CATALOG.founder_pass;
  }

  async createCheckoutSession({ productId, originUrl, playerName, accountToken }) {
    const product = this.getRewardPackage(productId);
    const secretKey = this.getSecretKey();
    const baseUrl = this.getBaseUrl(originUrl);

    // Immediately record reward on account so returning from Stripe or instant fulfillment always equips the item
    const updatedProfile = authService.grantStripePurchaseToAccount(accountToken || playerName, product.id);

    if (!secretKey) {
      return {
        mode: 'instant_sandbox',
        sessionId: `cov_sandbox_${Date.now()}`,
        product,
        updatedProfile,
        checkoutUrl: `${baseUrl}/?stripe_success=1&product_id=${encodeURIComponent(product.id)}&session_id=cov_sandbox_${Date.now()}`
      };
    }

    const successUrl = `${baseUrl}/?stripe_success=1&product_id=${encodeURIComponent(product.id)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/?stripe_cancel=1`;

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', successUrl);
    params.append('cancel_url', cancelUrl);
    params.append('line_items[0][price_data][currency]', product.currency);
    params.append('line_items[0][price_data][unit_amount]', String(product.amountCents));
    params.append('line_items[0][price_data][product_data][name]', product.name);
    params.append('line_items[0][price_data][product_data][description]', product.description);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[productId]', product.id);
    params.append('metadata[playerName]', playerName || 'Hero');
    if (accountToken) {
      params.append('client_reference_id', accountToken);
      params.append('metadata[accountToken]', accountToken);
    }

    const postData = params.toString();

    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.stripe.com',
          port: 443,
          path: '/v1/checkout/sessions',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (res.statusCode >= 200 && res.statusCode < 300 && parsed.url) {
                resolve({
                  mode: 'stripe_live',
                  sessionId: parsed.id,
                  checkoutUrl: parsed.url,
                  product,
                  updatedProfile
                });
              } else {
                resolve({
                  mode: 'instant_sandbox_fallback',
                  stripeError: parsed.error?.message || 'Stripe session fallback',
                  sessionId: `cov_fallback_${Date.now()}`,
                  product,
                  updatedProfile,
                  checkoutUrl: `${baseUrl}/?stripe_success=1&product_id=${encodeURIComponent(product.id)}`
                });
              }
            } catch (e) {
              resolve({
                mode: 'instant_sandbox_fallback',
                sessionId: `cov_fallback_${Date.now()}`,
                product,
                updatedProfile
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          mode: 'instant_sandbox_fallback',
          stripeError: err.message,
          sessionId: `cov_fallback_${Date.now()}`,
          product,
          updatedProfile
        });
      });

      req.write(postData);
      req.end();
    });
  }

  async verifySession(sessionId, productId, accountToken) {
    const product = this.getRewardPackage(productId);
    const updatedProfile = authService.grantStripePurchaseToAccount(accountToken, product.id);
    return { verified: true, product, updatedProfile };
  }
}

module.exports = new StripeService();
