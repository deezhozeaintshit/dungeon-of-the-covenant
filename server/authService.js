// server/authService.js - Persistent Account & Character Auth System (Login / Register / Guest Auto-Login + Stripe IAP Persistence)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

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
        }
      }
    } catch (e) {
      console.warn('[AuthService] Starting with fresh accounts store:', e.message);
      this.accounts = {};
    }
  }

  saveAccounts() {
    try {
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf8');
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
      stats: {
        kills: 0,
        bossesSlain: 0,
        floorsCleared: 0,
        highestFloor: 1
      },
      createdAt: new Date().toISOString()
    };
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

  grantStripePurchaseToAccount(tokenOrUsername, productId) {
    let uname = this.tokens[tokenOrUsername] || (tokenOrUsername || '').toLowerCase();
    if (!this.accounts[uname]) {
      // If guest or no token provided, apply to most recently active account if available
      const keys = Object.keys(this.accounts);
      if (keys.length > 0) uname = keys[keys.length - 1];
    }
    const acc = this.accounts[uname];
    if (!acc) return null;

    const p = acc.profile;
    if (!p.unlockedAuras) p.unlockedAuras = [];
    if (!p.purchasedBundles) p.purchasedBundles = [];
    if (!p.purchasedBundles.includes(productId)) p.purchasedBundles.push(productId);

    if (productId === 'starter_pack') {
      p.shards = (p.shards || 0) + 500;
      if (!p.unlockedAuras.includes('infernal')) p.unlockedAuras.push('infernal');
      p.cosmeticAura = 'infernal';
      p.title = 'Hellfire Warlord';
      p.equippedItem = {
        id: 'iap_hellfire_cleaver',
        name: 'Hellfire Warlord Great-Blade (IAP)',
        slot: 'weapon',
        rarity: 'Legendary',
        color: '#ffaa00',
        beamColor: 0xffaa00,
        gearScore: 680,
        stats: { attackPower: 45, maxHp: 180, critChance: 0.15, lifesteal: 0.10, cooldownHaste: 0.12 }
      };
      p.gearScore = Math.max(p.gearScore || 100, 680);
    } else if (productId === 'founder_pass') {
      p.shards = (p.shards || 0) + 1500;
      if (!p.unlockedAuras.includes('sovereign')) p.unlockedAuras.push('sovereign');
      p.cosmeticAura = 'sovereign';
      p.title = 'Sovereign Ascendant';
      p.mightRank = (p.mightRank || 0) + 1;
      p.vitalityRank = (p.vitalityRank || 0) + 1;
      p.hasteRank = (p.hasteRank || 0) + 1;
      p.equippedItem = {
        id: 'iap_sovereign_relicblade',
        name: 'Sovereign Seraph Relic-Blade (IAP)',
        slot: 'weapon',
        rarity: 'Mythic Covenant',
        color: '#ff2255',
        beamColor: 0xff2255,
        gearScore: 1150,
        stats: { attackPower: 85, maxHp: 350, critChance: 0.25, lifesteal: 0.18, cooldownHaste: 0.20, moveSpeed: 1.5 }
      };
      p.gearScore = Math.max(p.gearScore || 100, 1150);
    } else if (productId === 'mythic_3d_arsenal') {
      p.shards = (p.shards || 0) + 3500;
      ['infernal', 'frost', 'void', 'sovereign'].forEach(a => {
        if (!p.unlockedAuras.includes(a)) p.unlockedAuras.push(a);
      });
      p.cosmeticAura = 'sovereign';
      p.title = 'Grand Architect of the Covenant';
      p.mightRank = (p.mightRank || 0) + 2;
      p.vitalityRank = (p.vitalityRank || 0) + 2;
      p.hasteRank = (p.hasteRank || 0) + 2;
      p.equippedItem = {
        id: 'iap_godslayer_scythe',
        name: "Malakor's Godslayer Astral Scythe (IAP)",
        slot: 'weapon',
        rarity: 'Mythic Covenant',
        color: '#ff2255',
        beamColor: 0xff2255,
        gearScore: 1650,
        stats: { attackPower: 140, maxHp: 600, critChance: 0.35, lifesteal: 0.25, cooldownHaste: 0.30, moveSpeed: 2.2 }
      };
      p.gearScore = Math.max(p.gearScore || 100, 1650);
    } else if (productId === 'shard_vault_3000') {
      p.shards = (p.shards || 0) + 3000;
    }

    this.saveAccounts();
    return p;
  }
}

module.exports = new AuthService();
