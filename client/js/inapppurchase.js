// inapppurchase.js — Covenant Cosmetic Shop purchase manager (web).
//
// Real Stripe Checkout flow, cosmetics only:
//   1. init('web') loads /api/stripe/config -> shop availability + catalog.
//   2. purchase(productId) creates a server-side Checkout session and redirects
//      the tab to Stripe. Nothing is granted until Stripe confirms payment.
//   3. handleCheckoutReturn() verifies the returning session server-side and
//      refreshes entitlements.
//   4. Entitlements/equip go through /api/shop/* (server-validated ownership).
//
// With no Stripe keys configured the shop reports shopAvailable:false and the
// UI renders a "coming soon" state — the game stays fully playable, no errors.

export class ShopUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShopUnavailableError';
    this.code = 'STRIPE_NOT_CONFIGURED';
  }
}

export class InAppPurchaseManager {
  constructor() {
    this.initialized = false;
    this.platform = 'web';
    this.shopStatus = null;      // /api/stripe/config payload
    this.entitlements = null;    // /api/shop/entitlements payload
    this.lastError = null;
    this.listeners = {
      onPurchaseComplete: [],
      onPurchaseError: [],
      onProductLoad: [],
      onRestoreComplete: []
    };
  }

  get accountToken() {
    try {
      return localStorage.getItem('covenant_auth_token') || '';
    } catch (e) {
      return '';
    }
  }

  async init(platform = 'web') {
    this.platform = platform || 'web';
    await this.refreshShopStatus();
    this.initialized = true;
    const catalog = this.getCatalog();
    for (const product of catalog) {
      this.notifyListeners('onProductLoad', product);
    }
    return this.shopStatus;
  }

  async refreshShopStatus() {
    try {
      const resp = await fetch('/api/stripe/config', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`config HTTP ${resp.status}`);
      this.shopStatus = await resp.json();
    } catch (err) {
      // Offline / server hiccup: degrade to "coming soon", never crash.
      console.warn('InAppPurchaseManager: shop status unavailable:', err.message);
      this.shopStatus = { shopAvailable: false, mode: 'unconfigured', catalog: [] };
    }
    return this.shopStatus;
  }

  isShopAvailable() {
    return Boolean(this.shopStatus && this.shopStatus.shopAvailable);
  }

  getCatalog() {
    return (this.shopStatus && Array.isArray(this.shopStatus.catalog))
      ? this.shopStatus.catalog
      : [];
  }

  getProduct(productId) {
    return this.getCatalog().find(p => p.id === productId) || null;
  }

  // Start a real Stripe Checkout for a catalog product. Redirects the current
  // tab to Stripe; the return URL carries ?stripe_success=1&session_id=...
  async purchase(productId) {
    if (!this.initialized) await this.init('web');
    const product = this.getProduct(productId);
    if (!product) {
      const err = new Error('Unknown product. Please refresh the shop.');
      this.notifyListeners('onPurchaseError', err);
      throw err;
    }
    if (!this.accountToken) {
      const err = new Error('Sign in to your Covenant account before purchasing cosmetics.');
      this.notifyListeners('onPurchaseError', err);
      throw err;
    }

    let playerName = 'Hero';
    try {
      playerName = document.getElementById('player-name-input')?.value || 'Hero';
    } catch (e) { /* headless / DOM-less */ }

    const resp = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        accountToken: this.accountToken,
        playerName,
        originUrl: (typeof window !== 'undefined' && window.location) ? window.location.origin : ''
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      const err = (data && data.code === 'STRIPE_NOT_CONFIGURED')
        ? new ShopUnavailableError(data.error || 'The cosmetic shop is coming soon.')
        : new Error((data && data.error) || 'Could not start Stripe checkout.');
      this.lastError = err;
      this.notifyListeners('onPurchaseError', err);
      throw err;
    }
    if (!data.checkoutUrl) {
      const err = new Error('Stripe did not return a checkout URL.');
      this.notifyListeners('onPurchaseError', err);
      throw err;
    }

    // Same-tab redirect: Stripe returns the buyer to ?stripe_success=1, which
    // handleCheckoutReturn() verifies server-side before granting anything.
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = data.checkoutUrl;
    }
    return data;
  }

  // Called on page load. Returns { status: 'verified'|'cancelled'|'none', ... }.
  // Verification is server-side (Stripe API); only a paid session grants.
  async handleCheckoutReturn() {
    if (typeof window === 'undefined') return { status: 'none' };
    const params = new URLSearchParams(window.location.search);
    const cleanUrl = () => {
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (e) { /* noop */ }
    };

    if (params.get('stripe_cancel') === '1') {
      cleanUrl();
      return { status: 'cancelled' };
    }
    if (params.get('stripe_success') === '1') {
      const sessionId = params.get('session_id') || '';
      cleanUrl();
      if (!sessionId) return { status: 'none' };
      try {
        const resp = await fetch('/api/stripe/verify-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, accountToken: this.accountToken })
        });
        const data = await resp.json().catch(() => ({}));
        if (data && data.ok && data.verified) {
          await this.fetchEntitlements();
          const product = this.getProduct(data.productId);
          this.notifyListeners('onPurchaseComplete', product || { id: data.productId });
          return { status: 'verified', productId: data.productId, alreadyGranted: Boolean(data.alreadyGranted) };
        }
        const err = new Error((data && data.error) || 'Payment could not be verified.');
        this.notifyListeners('onPurchaseError', err);
        return { status: 'failed', error: err.message };
      } catch (err) {
        this.notifyListeners('onPurchaseError', err);
        return { status: 'failed', error: err.message };
      }
    }
    return { status: 'none' };
  }

  async fetchEntitlements() {
    if (!this.accountToken) {
      this.entitlements = null;
      return null;
    }
    try {
      const resp = await fetch(`/api/shop/entitlements?token=${encodeURIComponent(this.accountToken)}`, { cache: 'no-store' });
      const data = await resp.json().catch(() => ({}));
      if (data && data.ok) {
        this.entitlements = data.entitlements;
        this.notifyListeners('onRestoreComplete', this.entitlements);
        return this.entitlements;
      }
    } catch (err) {
      console.warn('InAppPurchaseManager: entitlement fetch failed:', err.message);
    }
    return null;
  }

  // Server-validated equip. kind: 'skin' | 'weaponGlow'. cosmeticId may be null
  // to unequip. Returns the updated entitlements on success.
  async equip(kind, cosmeticId) {
    const resp = await fetch('/api/shop/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountToken: this.accountToken, kind, cosmeticId: cosmeticId || null })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      throw new Error((data && data.error) || 'Could not equip cosmetic.');
    }
    this.entitlements = data.entitlements;
    return data.entitlements;
  }

  ownsCosmetic(kind, cosmeticId) {
    if (!this.entitlements || !cosmeticId) return false;
    if (kind === 'skin') return (this.entitlements.ownedSkins || []).includes(cosmeticId);
    if (kind === 'weaponGlow') return (this.entitlements.ownedWeaponGlows || []).includes(cosmeticId);
    if (kind === 'emote') return (this.entitlements.ownedEmotes || []).includes(cosmeticId);
    return false;
  }

  isEquipped(kind, cosmeticId) {
    if (!this.entitlements || !cosmeticId) return false;
    if (kind === 'skin') return this.entitlements.equippedSkin === cosmeticId;
    if (kind === 'weaponGlow') return this.entitlements.equippedWeaponGlow === cosmeticId;
    return false;
  }

  // Legacy alias kept for older UI wiring: re-syncs entitlements from server.
  async restorePurchases() {
    const ent = await this.fetchEntitlements();
    return ent;
  }

  on(event, callback) {
    if (this.listeners[event]) this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(callback);
      if (idx !== -1) this.listeners[event].splice(idx, 1);
    }
  }

  notifyListeners(event, data) {
    const callbacks = this.listeners[event];
    if (callbacks) {
      for (const callback of callbacks) {
        try { callback(data); } catch (error) {
          console.error('InAppPurchaseManager: Listener error:', error);
        }
      }
    }
  }

  destroy() {
    this.listeners = { onPurchaseComplete: [], onPurchaseError: [], onRestoreComplete: [], onProductLoad: [] };
    this.shopStatus = null;
    this.entitlements = null;
    this.initialized = false;
  }
}
