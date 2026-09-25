// InAppPurchase.js - IAP Framework Stub for Future Implementation
// Ready for integration with platform payment systems (Apple App Store, Google Play, Stripe, etc.)

export class InAppPurchaseManager {
  constructor() {
    this.initialized = false;
    this.platform = null; // 'ios', 'android', 'web', 'steam'
    this.products = new Map();
    this.purchases = new Map(); // productId -> purchaseState
    this.transactions = [];
    this.listeners = {
      onPurchaseComplete: [],
      onPurchaseError: [],
      onProductLoad: [],
      onRestoreComplete: []
    };
  }

  // Initialize IAP for specific platform
  async init(platform) {
    this.platform = platform;
    
    switch (platform) {
      case 'ios':
        await this.initIOS();
        break;
      case 'android':
        await this.initAndroid();
        break;
      case 'web':
        await this.initWeb();
        break;
      default:
        console.warn('InAppPurchaseManager: Unknown platform', platform);
    }
    
    this.initialized = true;
    this.loadProducts();
  }

  async initIOS() {
    // Stub for StoreKit 2 integration
    console.log('InAppPurchaseManager: iOS IAP initialized (stub)');
  }

  async initAndroid() {
    // Stub for Google Play Billing integration
    console.log('InAppPurchaseManager: Android IAP initialized (stub)');
  }

  async initWeb() {
    try {
      const resp = await fetch('/api/stripe/config');
      if (resp.ok) {
        this.stripeStatus = await resp.json();
        console.log('InAppPurchaseManager: Stripe Web IAP initialized:', this.stripeStatus.mode);
      }
    } catch (err) {
      console.warn('InAppPurchaseManager: Stripe config fetch error:', err);
    }
  }

  async getStripeStatus() {
    try {
      const resp = await fetch('/api/stripe/config');
      if (resp.ok) {
        this.stripeStatus = await resp.json();
        return this.stripeStatus;
      }
    } catch (err) {
      console.warn('Stripe status fetch error:', err);
    }
    return { configured: false, mode: 'sandbox_ready', catalog: [] };
  }

  async configureStripeKeys(secretKey, publishableKey = '') {
    const resp = await fetch('/api/stripe/configure-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretKey, publishableKey })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || 'Failed to save Stripe API keys');
    }
    this.stripeStatus = data.status;
    return data.status;
  }

  // Register available products
  registerProduct(productId, config) {
    this.products.set(productId, {
      id: productId,
      name: config.name || productId,
      description: config.description || '',
      price: config.price || 0,
      currency: config.currency || 'USD',
      type: config.type || 'consumable', // 'consumable', 'non_consumable', 'subscription'
      icon: config.icon || null,
      metadata: config.metadata || {}
    });
    
    this.notifyListeners('onProductLoad', productId);
  }

  // Load all registered products
  async loadProducts() {
    console.log('InAppPurchaseManager: Loading', this.products.size, 'products');
    for (const [id, product] of this.products) {
      this.notifyListeners('onProductLoad', product);
    }
  }

  // Purchase a product
  async purchase(productId) {
    if (!this.initialized) {
      console.error('InAppPurchaseManager: Not initialized');
      this.notifyListeners('onPurchaseError', new Error('Not initialized'));
      return false;
    }

    const product = this.products.get(productId) || { id: productId, name: productId };

    try {
      let success = false;
      switch (this.platform) {
        case 'ios':
          success = await this.purchaseIOS(productId);
          break;
        case 'android':
          success = await this.purchaseAndroid(productId);
          break;
        case 'web':
          success = await this.purchaseWeb(productId);
          break;
        default:
          success = true;
      }

      if (success) {
        this.purchases.set(productId, 'purchased');
        this.transactions.push({
          productId,
          timestamp: Date.now(),
          platform: this.platform,
          success: true
        });
        this.notifyListeners('onPurchaseComplete', product);
        return true;
      }
    } catch (error) {
      console.error('InAppPurchaseManager: Purchase failed:', error);
      this.notifyListeners('onPurchaseError', error);
    }

    return false;
  }

  async purchaseIOS(productId) {
    return true;
  }

  async purchaseAndroid(productId) {
    return true;
  }

  async purchaseWeb(productId) {
    const accountToken = localStorage.getItem('covenant_auth_token') || '';
    const playerName = document.getElementById('player-name-input')?.value || 'Vanguard';
    const resp = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, accountToken, playerName, originUrl: window.location.origin })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || 'Stripe checkout failed');
    }

    // If a live/test Stripe API Checkout URL was returned by api.stripe.com, open Stripe Checkout in a new tab while equipping the item immediately!
    if (data.checkoutUrl && data.mode === 'stripe_live') {
      window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
    }
    this.lastStripeSession = data;
    return true;
  }

  // Restore previous purchases
  async restorePurchases() {
    if (!this.initialized) return;

    try {
      let restored = 0;
      
      switch (this.platform) {
        case 'ios':
          restored = await this.restoreIOS();
          break;
        case 'android':
          restored = await this.restoreAndroid();
          break;
        case 'web':
          restored = await this.restoreWeb();
          break;
      }

      this.notifyListeners('onRestoreComplete', restored);
    } catch (error) {
      console.error('InAppPurchaseManager: Restore failed:', error);
    }
  }

  async restoreIOS() {
    // Stub: Implement with StoreKit receipt validation
    return 0;
  }

  async restoreAndroid() {
    // Stub: Implement with Google Play purchase history
    return 0;
  }

  async restoreWeb() {
    // Stub: Implement with server-side receipt validation
    return 0;
  }

  // Check if product is owned
  isOwned(productId) {
    return this.purchases.get(productId) === 'purchased';
  }

  // Get product info
  getProduct(productId) {
    return this.products.get(productId);
  }

  // Get all products
  getAllProducts() {
    return Array.from(this.products.values());
  }

  // Register event listener
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  // Remove event listener
  off(event, callback) {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(callback);
      if (idx !== -1) {
        this.listeners[event].splice(idx, 1);
      }
    }
  }

  // Notify all listeners
  notifyListeners(event, data) {
    const callbacks = this.listeners[event];
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data);
        } catch (error) {
          console.error('InAppPurchaseManager: Listener error:', error);
        }
      }
    }
  }

  // Get transaction history
  getTransactions() {
    return [...this.transactions];
  }

  // Cleanup
  destroy() {
    this.listeners = { onPurchaseComplete: [], onPurchaseError: [], onProductLoad: [], onRestoreComplete: [] };
    this.products.clear();
    this.purchases.clear();
    this.transactions.clear();
    this.initialized = false;
  }
}
