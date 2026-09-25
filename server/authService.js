// server/authService.js - Persistent Account & Character Auth System (Login / Register / Guest Auto-Login + Stripe IAP Persistence)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// Canonical persistent-account meta-progression schema (see
// server/game/systems/MetaProgression.js for the full contract). Rank is
// DERIVED from accountXp and never stored.
function defaultMeta() {
  return {
    accountXp: 0,
    seals: 0,               // spendable covenant currency, earned from runs
    unlockedClasses: [],    // unlockable hero class keys (plaguecaller, ...)
    unlockedBoons: [],      // owned starting-boon ids
    activeBoons: [],        // equipped run-start boons (max 2)
    stashTabs: 0,           // extra stash tabs beyond the first
    lifetimeRuns: 0,
    lifetimeVictories: 0
  };
}

function ensureMetaOnProfile(profile) {
  if (!profile || typeof profile !== 'object') return;
  if (!profile.meta || typeof profile.meta !== 'object') profile.meta = defaultMeta();
  const m = profile.meta;
  if (typeof m.accountXp !== 'number' || m.accountXp < 0) m.accountXp = 0;
  if (typeof m.seals !== 'number' || m.seals < 0) m.seals = 0;
  if (!Array.isArray(m.unlockedClasses)) m.unlockedClasses = [];
  if (!Array.isArray(m.unlockedBoons)) m.unlockedBoons = [];
  if (!Array.isArray(m.activeBoons)) m.activeBoons = [];
  if (typeof m.stashTabs !== 'number' || m.stashTabs < 0) m.stashTabs = 0;
  if (typeof m.lifetimeRuns !== 'number' || m.lifetimeRuns < 0) m.lifetimeRuns = 0;
  if (typeof m.lifetimeVictories !== 'number' || m.lifetimeVictories < 0) m.lifetimeVictories = 0;
}
const catalog = require('./cosmeticsCatalog');

class AuthService {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    this.accounts = {};
    this.tokens = {}; // token -> username
    this.loadAccounts();
  }

  loadAccounts() {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
        this.accounts = JSON.parse(raw);
        for (const [uname, acc] of Object.entries(this.accounts)) {
          if (acc.token) this.tokens[acc.token] = uname;
          if (acc.profile) {
            this.sanitizeProfile(acc.profile);
            ensureMetaOnProfile(acc.profile);
          }
        }
      }
    } catch (e) {
      console.warn('[AuthService] Starting with fresh accounts store:', e.message);
      this.accounts = {};
    }
  }

  saveAccounts() {
    try {
      // Atomic write: temp file + rename so a crash mid-save never corrupts
      // accounts.json (entitlements must survive restarts intact).
      const tmp = `${ACCOUNTS_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.accounts, null, 2), 'utf8');
      fs.renameSync(tmp, ACCOUNTS_FILE);
    } catch (e) {
      console.error('[AuthService] Failed to save accounts:', e.message);
    }
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(`covenant_salt_${password}`).digest('hex');
  }

  createDefaultProfile(username) {
    return {
      username,
      displayName: username,
      level: 1,
      xp: 0,
      gold: 250,
      shards: 350,
      unlockedAuras: [],
      cosmeticAura: null,
      title: 'Covenant Initiate',
      mightRank: 0,
      vitalityRank: 0,
      hasteRank: 0,
      gearScore: 100,
      equippedItem: null,
      inventory: [],
      purchasedBundles: [],
      // Covenant Cosmetic Shop entitlements (Stripe, cosmetics-only).
      ownedSkins: [],
      ownedWeaponGlows: [],
      ownedEmotes: [],
      equippedSkin: null,
      equippedWeaponGlow: null,
      meta: defaultMeta(), // persistent account progression (ranks, unlocks)
      stats: {
        kills: 0,
        bossesSlain: 0,
        floorsCleared: 0,
        highestFloor: 1
      },
      createdAt: new Date().toISOString()
    };
  }

  // Backfill cosmetic entitlement fields on profiles created before the shop.
  sanitizeProfile(p) {
    if (!p) return p;
    if (!Array.isArray(p.ownedSkins)) p.ownedSkins = [];
    if (!Array.isArray(p.ownedWeaponGlows)) p.ownedWeaponGlows = [];
    if (!Array.isArray(p.ownedEmotes)) p.ownedEmotes = [];
    if (p.equippedSkin !== null && typeof p.equippedSkin !== 'string') p.equippedSkin = null;
    if (p.equippedWeaponGlow !== null && typeof p.equippedWeaponGlow !== 'string') p.equippedWeaponGlow = null;
    return p;
  }

  register(username, password) {
    const cleanUser = (username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanUser || cleanUser.length < 3) {
      return { ok: false, error: 'Username must be at least 3 alphanumeric characters.' };
    }
    if (!password || password.length < 4) {
      return { ok: false, error: 'Password must be at least 4 characters.' };
    }
    if (this.accounts[cleanUser]) {
      return { ok: false, error: 'Username already registered. Please click Login instead.' };
    }

    const token = 'cov_tok_' + crypto.randomBytes(16).toString('hex');
    const profile = this.createDefaultProfile(username.trim());
    this.accounts[cleanUser] = {
      username: cleanUser,
      passwordHash: this.hashPassword(password),
      token,
      profile
    };
    this.tokens[token] = cleanUser;
    this.saveAccounts();

    return { ok: true, token, profile };
  }

  login(username, password) {
    const cleanUser = (username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const acc = this.accounts[cleanUser];
    if (!acc) {
      // Auto-register if account doesn't exist yet for frictionless onboarding!
      return this.register(username, password || 'covenant');
    }
    if (acc.passwordHash !== this.hashPassword(password)) {
      return { ok: false, error: 'Invalid password for this Covenant account.' };
    }
    if (!acc.token) {
      acc.token = 'cov_tok_' + crypto.randomBytes(16).toString('hex');
    }
    this.tokens[acc.token] = cleanUser;
    this.saveAccounts();
    return { ok: true, token: acc.token, profile: acc.profile };
  }

  getProfileByToken(token) {
    if (!token || !this.tokens[token]) return null;
    const uname = this.tokens[token];
    return this.accounts[uname]?.profile || null;
  }

  // Phase 3 meta-progression: resolve the full account record (username +
  // profile) from a session token. Used to link run players to accounts
  // server-side — never trust a client-supplied username.
  getAccountByToken(token) {
    if (!token || !this.tokens[token]) return null;
    const username = this.tokens[token];
    const acc = this.accounts[username];
    if (!acc) return null;
    return { username, profile: acc.profile };
  }

  getProfileByUsername(username) {
    const uname = (username || '').toLowerCase();
    return this.accounts[uname]?.profile || null;
  }

  updateProfile(token, updates = {}) {
    const uname = this.tokens[token];
    if (!uname || !this.accounts[uname]) return null;
    const p = this.accounts[uname].profile;

    if (typeof updates.displayName === 'string' && updates.displayName.trim()) p.displayName = updates.displayName.trim();
    if (typeof updates.level === 'number') p.level = Math.max(p.level || 1, updates.level);
    if (typeof updates.xp === 'number') p.xp = updates.xp;
    if (typeof updates.gold === 'number') p.gold = updates.gold;
    if (typeof updates.shards === 'number') p.shards = updates.shards;
    if (Array.isArray(updates.unlockedAuras)) {
      p.unlockedAuras = Array.from(new Set([...(p.unlockedAuras || []), ...updates.unlockedAuras]));
    }
    if (updates.cosmeticAura !== undefined) p.cosmeticAura = updates.cosmeticAura;
    if (updates.title !== undefined) p.title = updates.title;
    if (typeof updates.mightRank === 'number') p.mightRank = Math.max(p.mightRank || 0, updates.mightRank);
    if (typeof updates.vitalityRank === 'number') p.vitalityRank = Math.max(p.vitalityRank || 0, updates.vitalityRank);
    if (typeof updates.hasteRank === 'number') p.hasteRank = Math.max(p.hasteRank || 0, updates.hasteRank);
    if (updates.equippedItem) {
      p.equippedItem = updates.equippedItem;
      p.gearScore = Math.max(p.gearScore || 100, updates.equippedItem.gearScore || 100);
    }

    this.saveAccounts();
    return p;
  }

  // Grant a cosmetic-shop purchase to an account. Called ONLY after Stripe
  // confirms payment (signature-verified webhook or verified session retrieval).
  // Grants are cosmetics-only: the product's grant lists are validated against
  // the catalog, so a forged productId can never award stats, shards, or gear.
  // Idempotent: re-granting an already-owned cosmetic is a no-op success.
  grantCosmeticEntitlement(accountToken, productId) {
    const uname = this.tokens[accountToken];
    if (!uname || !this.accounts[uname]) {
      return { ok: false, error: 'Account not found. Please sign in again.' };
    }
    const product = catalog.getProduct(productId);
    if (!product) {
      return { ok: false, error: 'Unknown product.' };
    }

    const acc = this.accounts[uname];
    const p = this.sanitizeProfile(acc.profile);
    let newlyGranted = 0;
    const addUnique = (arr, id) => {
      if (!arr.includes(id)) { arr.push(id); newlyGranted++; }
    };
    for (const s of product.grants.skins) addUnique(p.ownedSkins, s);
    for (const g of product.grants.weaponGlows) addUnique(p.ownedWeaponGlows, g);
    for (const e of product.grants.emotes) addUnique(p.ownedEmotes, e);

    if (!p.purchasedBundles) p.purchasedBundles = [];
    if (!p.purchasedBundles.includes(productId)) p.purchasedBundles.push(productId);

    // Auto-equip newly granted cosmetics when the slot is empty, so the
    // purchase is visible immediately. Never overwrites an existing choice.
    if (product.grants.skins.length && !p.equippedSkin) {
      p.equippedSkin = product.grants.skins[0];
    }
    if (product.grants.weaponGlows.length && !p.equippedWeaponGlow) {
      p.equippedWeaponGlow = product.grants.weaponGlows[0];
    }

    this.saveAccounts();
    return { ok: true, alreadyOwned: newlyGranted === 0, entitlements: this.getEntitlements(accountToken) };
  }

  // Read-only view of a token's cosmetic entitlements (safe for the client).
  getEntitlements(accountToken) {
    const profile = this.getProfileByToken(accountToken);
    if (!profile) return null;
    const p = this.sanitizeProfile(profile);
    return {
      ownedSkins: [...p.ownedSkins],
      ownedWeaponGlows: [...p.ownedWeaponGlows],
      ownedEmotes: [...p.ownedEmotes],
      equippedSkin: p.equippedSkin,
      equippedWeaponGlow: p.equippedWeaponGlow
    };
  }

  // Equip a cosmetic the account owns (or null to unequip). Ownership is
  // validated server-side against the persisted profile — clients cannot
  // equip what they have not bought.
  setEquippedCosmetic(accountToken, kind, cosmeticId) {
    const uname = this.tokens[accountToken];
    if (!uname || !this.accounts[uname]) {
      return { ok: false, error: 'Account not found. Please sign in again.' };
    }
    const p = this.sanitizeProfile(this.accounts[uname].profile);

    if (kind === 'skin') {
      if (cosmeticId !== null && !p.ownedSkins.includes(cosmeticId)) {
        return { ok: false, error: 'You do not own that skin.' };
      }
      p.equippedSkin = cosmeticId;
    } else if (kind === 'weaponGlow') {
      if (cosmeticId !== null && !p.ownedWeaponGlows.includes(cosmeticId)) {
        return { ok: false, error: 'You do not own that weapon glow.' };
      }
      p.equippedWeaponGlow = cosmeticId;
    } else {
      return { ok: false, error: 'Unknown cosmetic kind.' };
    }

    this.saveAccounts();
    return { ok: true, entitlements: this.getEntitlements(accountToken) };
  }
}

module.exports = new AuthService();
