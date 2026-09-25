// ============================================================
// VOID WALKER - Stripe Payment Integration
// ============================================================

/**
 * In-App Purchase System using Stripe
 * Handles products, checkout, and webhooks
 */

const Stripe = require('stripe');

class StripePaymentSystem {
  constructor(apiKey) {
    this.stripe = Stripe(apiKey);
    this.products = new Map();
    this.initializeProducts();
  }

  // Initialize default products
  initializeProducts() {
    const defaultProducts = [
      {
        id: 'hero_skin_void_walker',
        name: 'Void Walker Skin',
        description: 'Exclusive cosmic skin for Aetherion',
        price: 4.99,
        currency: 'usd',
        category: 'cosmetics'
      },
      {
        id: 'weapon_skin_void_blade',
        name: 'Void Blade Skin',
        description: 'Ethereal energy blade effect',
        price: 9.99,
        currency: 'usd',
        category: 'cosmetics'
      },
      {
        id: 'vfx_cosmic_pack',
        name: 'Cosmic VFX Pack',
        description: 'Particle effects for all abilities',
        price: 2.99,
        currency: 'usd',
        category: 'vfx'
      },
      {
        id: 'battle_pass_monthly',
        name: 'Battle Pass',
        description: 'Monthly rewards and exclusive items',
        price: 4.99,
        currency: 'usd',
        category: 'subscription',
        recurring: true
      },
      {
        id: 'gem_pack_small',
        name: 'Small Gem Pack',
        description: '100 gems for in-game purchases',
        price: 0.99,
        currency: 'usd',
        category: 'currency'
      },
      {
        id: 'gem_pack_large',
        name: 'Large Gem Pack',
        description: '500 gems for in-game purchases',
        price: 3.99,
        currency: 'usd',
        category: 'currency'
      }
    ];

    for (const product of defaultProducts) {
      this.products.set(product.id, product);
    }
  }

  // Create checkout session
  async createCheckoutSession(productId, userId) {
    const product = this.products.get(productId);
    if (!product) throw new Error('Product not found');

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: product.currency,
          product_data: {
            name: product.name,
            description: product.description
          },
          unit_amount: Math.round(product.price * 100), // Convert to cents
          ...(product.recurring && {
            recurring: { interval: 'month' }
          })
        },
        quantity: 1
      }],
      mode: product.recurring ? 'subscription' : 'payment',
      customer_email: userId,
      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
      metadata: {
        productId,
        userId
      }
    });

    return { sessionId: session.id, url: session.url };
  }

  // Verify payment and deliver items
  async verifyPayment(sessionId, userId) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      throw new Error('Payment not completed');
    }

    const productId = session.metadata.productId;
    const product = this.products.get(productId);

    if (!product) {
      throw new Error('Invalid product');
    }

    // Deliver items to user
    await this.deliverItems(productId, userId, session);

    return {
      success: true,
      product,
      delivered: true
    };
  }

  // Deliver purchased items
  async deliverItems(productId, userId, session) {
    const product = this.products.get(productId);

    // Update user inventory in database
    // This would connect to your game's backend
    console.log(`Delivering ${product.name} to user ${userId}`);

    switch (product.category) {
      case 'cosmetics':
        await this.grantCosmetic(userId, productId);
        break;
      case 'vfx':
        await this.grantVFX(userId, productId);
        break;
      case 'currency':
        await this.grantGems(userId, productId);
        break;
      case 'subscription':
        await this.activateBattlePass(userId, session);
        break;
    }
  }

  // Grant cosmetic item
  async grantCosmetic(userId, cosmeticId) {
    // Implementation would connect to game database
    console.log(`Granted cosmetic ${cosmeticId} to ${userId}`);
    return { success: true };
  }

  // Grant VFX pack
  async grantVFX(userId, vfxId) {
    console.log(`Granted VFX ${vfxId} to ${userId}`);
    return { success: true };
  }

  // Grant gems
  async grantGems(userId, packId) {
    const gemAmounts = {
      'gem_pack_small': 100,
      'gem_pack_large': 500
    };
    const amount = gemAmounts[packId] || 0;
    console.log(`Granted ${amount} gems to ${userId}`);
    return { success: true, amount };
  }

  // Activate battle pass
  async activateBattlePass(userId, session) {
    console.log(`Activated battle pass for ${userId}`);
    return {
      success: true,
      expiresAt: new Date(session.current_period_end * 1000)
    };
  }

  // Handle webhook events
  handleWebhook(event) {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.handlePaymentSuccess(event.data.object);
      case 'checkout.session.completed':
        return this.handleCheckoutComplete(event.data.object);
      case 'customer.subscription.created':
        return this.handleSubscriptionCreated(event.data.object);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event.data.object);
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  async handlePaymentSuccess(paymentIntent) {
    console.log('Payment succeeded:', paymentIntent.id);
    return { success: true };
  }

  async handleCheckoutComplete(session) {
    const { productId, userId } = session.metadata;
    console.log('Checkout completed:', { productId, userId });
    return { success: true };
  }

  async handleSubscriptionCreated(subscription) {
    console.log('Subscription created:', subscription.id);
    return { success: true };
  }

  async handleSubscriptionDeleted(subscription) {
    console.log('Subscription deleted:', subscription.id);
    return { success: true };
  }

  // Get product list
  getProducts() {
    return Array.from(this.products.values());
  }

  // Get product by ID
  getProduct(productId) {
    return this.products.get(productId);
  }
}

// Express route handlers
function createPaymentRoutes(app, paymentSystem) {
  // Create checkout session
  app.post('/api/create-checkout-session', async (req, res) => {
    try {
      const { productId, userId } = req.body;
      const result = await paymentSystem.createCheckoutSession(productId, userId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Verify payment
  app.post('/api/verify-payment', async (req, res) => {
    try {
      const { sessionId, userId } = req.body;
      const result = await paymentSystem.verifyPayment(sessionId, userId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get products
  app.get('/api/products', (req, res) => {
    res.json(paymentSystem.getProducts());
  });

  // Stripe webhook
  app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    paymentSystem.handleWebhook(event);
    res.json({ received: true });
  });
}

module.exports = { StripePaymentSystem, createPaymentRoutes };
