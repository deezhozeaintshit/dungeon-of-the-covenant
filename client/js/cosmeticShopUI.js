// cosmeticShopUI.js — Covenant Cosmetic Shop UI controller (Phase 3, workstream 6).
//
// Renders the Stripe-backed cosmetic shop from the SERVER's public catalog
// (prices come from /api/stripe/config — never hardcoded in the client):
//   - "Coming soon" state when Stripe keys are not configured.
//   - Buy buttons -> Stripe Checkout (same-tab redirect).
//   - Owned items -> Equip / Unequip (skins, weapon glows), Use (emotes).
//   - Entitlements + equip go through server-validated /api/shop/* endpoints.
//
// WCAG 2.1 AA: real <button> elements, visible :focus-visible styles (CSS),
// aria-labels on every action, and an aria-live status region announcing
// purchase / equip / error outcomes to screen readers.

const KIND_LABEL = { skin: 'Hero Skin', weaponGlow: 'Weapon Glow', emote: 'Emote', bundle: 'Bundle' };

export class CosmeticShopUI {
  constructor(app) {
    this.app = app;               // GameApp: { iap, entities, network, profile, authToken, localPlayerId, gameState }
    this.iap = app.iap;
    this.grid = null;
    this.comingSoon = null;
    this.statusEl = null;
    this.bound = false;
  }

  els() {
    this.grid = document.getElementById('cosmetic-shop-grid');
    this.comingSoon = document.getElementById('cosmetic-shop-coming-soon');
    this.statusEl = document.getElementById('cosmetic-shop-status');
    return Boolean(this.grid);
  }

  announce(msg) {
    if (this.statusEl) {
      this.statusEl.textContent = '';
      // Force re-announcement for identical consecutive messages.
      requestAnimationFrame(() => { this.statusEl.textContent = msg; });
    }
  }

  async init() {
    if (!this.els() || this.bound) return;
    this.bound = true;

    await this.iap.init('web');
    // Feed the entity renderer the public catalog defs so skins / glows /
    // emotes render on local AND remote heroes.
    if (this.app.entities) {
      const defs = new Map(this.iap.getCatalog().map(p => [p.id, p]));
      this.app.entities.cosmeticDefs = defs;
    }

    this.render();

    // Refresh entitlements whenever a purchase completes (checkout return) or
    // the account signs in.
    this.iap.on('onPurchaseComplete', () => this.render());
    this.iap.on('onRestoreComplete', () => this.render());

    // Handle ?stripe_success=1 / ?stripe_cancel=1 return from Stripe.
    const ret = await this.iap.handleCheckoutReturn();
    if (ret.status === 'verified') {
      const product = this.iap.getProduct(ret.productId);
      this.announce(`Purchase complete: ${product ? product.name : ret.productId}. Your cosmetic is equipped — check your hero.`);
      this.render();
      this.applyEquippedLocally();
    } else if (ret.status === 'cancelled') {
      this.announce('Checkout cancelled. No charge was made.');
    } else if (ret.status === 'failed') {
      this.announce(`Purchase could not be verified: ${ret.error}`);
    }
  }

  async refresh() {
    if (!this.bound) return;
    await this.iap.refreshShopStatus();
    await this.iap.fetchEntitlements();
    if (this.app.entities) {
      this.app.entities.cosmeticDefs = new Map(this.iap.getCatalog().map(p => [p.id, p]));
    }
    this.render();
  }

  render() {
    if (!this.grid) return;
    const available = this.iap.isShopAvailable();
    if (this.comingSoon) this.comingSoon.classList.toggle('hidden', available);
    this.grid.classList.toggle('hidden', !available);
    if (!available) {
      this.grid.innerHTML = '';
      return;
    }

    const catalog = this.iap.getCatalog();
    const ent = this.iap.entitlements;
    this.grid.innerHTML = '';
    for (const product of catalog) {
      this.grid.appendChild(this.cardFor(product, ent));
    }
  }

  // Which cosmetic ids does this product's ownership unlock for the action row?
  actionTargets(product, ent) {
    const targets = [];
    const push = (kind, ids) => {
      for (const id of ids) {
        targets.push({
          kind,
          id,
          owned: this.iap.ownsCosmetic(kind, id),
          equipped: this.iap.isEquipped(kind, id)
        });
      }
    };
    if (product.kind === 'skin') push('skin', [product.id]);
    else if (product.kind === 'weaponGlow') push('weaponGlow', [product.id]);
    else if (product.kind === 'emote') push('emote', [product.id]);
    else if (product.kind === 'bundle' && ent) {
      // Bundle: offer equip/use for every owned cosmetic it contains.
      for (const id of ent.ownedSkins) targets.push({ kind: 'skin', id, owned: true, equipped: ent.equippedSkin === id });
      for (const id of ent.ownedWeaponGlows) targets.push({ kind: 'weaponGlow', id, owned: true, equipped: ent.equippedWeaponGlow === id });
      for (const id of ent.ownedEmotes) targets.push({ kind: 'emote', id, owned: true, equipped: false });
    }
    return targets;
  }

  cardFor(product, ent) {
    const card = document.createElement('article');
    card.className = `cosmetic-card cosmetic-kind-${product.kind}`;
    card.setAttribute('aria-label', `${product.name}, ${product.priceDisplay}`);

    const icon = document.createElement('div');
    icon.className = 'cosmetic-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = product.icon || '✨';

    const kind = document.createElement('div');
    kind.className = 'cosmetic-kind';
    kind.textContent = KIND_LABEL[product.kind] || product.kind;

    const name = document.createElement('h4');
    name.className = 'cosmetic-name';
    name.textContent = product.name;

    const desc = document.createElement('p');
    desc.className = 'cosmetic-desc';
    desc.textContent = product.description;

    const price = document.createElement('div');
    price.className = 'cosmetic-price';
    price.textContent = product.priceDisplay;

    const actions = document.createElement('div');
    actions.className = 'cosmetic-actions';

    const buyBtn = document.createElement('button');
    buyBtn.type = 'button';
    buyBtn.className = 'btn-sm cosmetic-buy-btn';
    buyBtn.textContent = `Buy — ${product.priceDisplay}`;
    buyBtn.setAttribute('aria-label', `Buy ${product.name} for ${product.priceDisplay} via Stripe`);
    buyBtn.addEventListener('click', () => this.onBuy(product, buyBtn));
    actions.appendChild(buyBtn);

    if (ent) {
      for (const t of this.actionTargets(product, ent)) {
        if (!t.owned) continue;
        actions.appendChild(this.actionButtonFor(product, t));
      }
    }

    card.append(icon, kind, name, desc, price, actions);
    return card;
  }

  actionButtonFor(product, t) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const label = this.cosmeticLabel(t.id) || product.name;

    if (t.kind === 'emote') {
      btn.className = 'btn-sm cosmetic-use-btn';
      btn.textContent = `Use ${label}`;
      btn.setAttribute('aria-label', `Perform the ${label} emote`);
      btn.addEventListener('click', () => this.onUseEmote(t.id, label));
      return btn;
    }

    const isEq = t.equipped;
    btn.className = `btn-sm ${isEq ? 'cosmetic-unequip-btn' : 'cosmetic-equip-btn'}`;
    btn.textContent = isEq ? `Unequip ${label}` : `Equip ${label}`;
    btn.setAttribute('aria-label', `${isEq ? 'Unequip' : 'Equip'} ${label} ${KIND_LABEL[t.kind]}`);
    btn.setAttribute('aria-pressed', isEq ? 'true' : 'false');
    btn.addEventListener('click', () => this.onEquip(t.kind, t.id, isEq, label));
    return btn;
  }

  cosmeticLabel(id) {
    const def = this.iap.getProduct(id);
    return def ? def.name : id;
  }

  async onBuy(product, btn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Opening Stripe…';
    this.announce(`Opening Stripe checkout for ${product.name}.`);
    try {
      await this.iap.purchase(product.id);
      // purchase() redirects to Stripe; if we are still here it failed silently.
      btn.disabled = false;
      btn.textContent = original;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      this.announce(`Purchase failed: ${err.message}`);
    }
  }

  async onEquip(kind, cosmeticId, isEquipped, label) {
    try {
      const ent = await this.iap.equip(kind, isEquipped ? null : cosmeticId);
      this.announce(isEquipped ? `${label} unequipped.` : `${label} equipped.`);
      // Persist to the local profile + push to the live room so the party
      // sees the change immediately.
      if (this.app.profile) {
        if (kind === 'skin') this.app.profile.equippedSkin = ent.equippedSkin;
        if (kind === 'weaponGlow') this.app.profile.equippedWeaponGlow = ent.equippedWeaponGlow;
        if (typeof this.app.saveProfile === 'function') {
          try { this.app.saveProfile(); } catch (e) { /* non-fatal */ }
        }
      }
      this.pushCosmeticsToRoom();
      this.applyEquippedLocally();
      this.render();
    } catch (err) {
      this.announce(`Could not equip: ${err.message}`);
    }
  }

  onUseEmote(emoteId, label) {
    const app = this.app;
    if (app.gameState !== 'dungeon' || !app.entities || !app.localPlayerId) {
      this.announce('Join a dungeon run to use emotes — your hero needs a stage.');
      return;
    }
    app.entities.triggerEmote(app.localPlayerId, emoteId);
    try {
      app.network.sendInput({ emote: emoteId, accountToken: app.authToken || '' });
    } catch (e) { /* offline: local-only */ }
    this.announce(`${label} performed.`);
  }

  pushCosmeticsToRoom() {
    const app = this.app;
    if (app.gameState !== 'dungeon' || !app.network) return;
    try {
      app.network.sendInput({
        equipCosmetic: {
          skin: app.profile?.equippedSkin ?? null,
          weaponGlow: app.profile?.equippedWeaponGlow ?? null
        },
        accountToken: app.authToken || ''
      });
    } catch (e) { /* offline: snapshot will catch up */ }
  }

  // Apply the account's equipped cosmetics to the local hero immediately
  // (the server snapshot re-sync keeps remote players correct).
  applyEquippedLocally() {
    const app = this.app;
    if (!app.entities || !app.localPlayerId) return;
    app.entities.applyCosmeticsNow(
      app.localPlayerId,
      app.profile?.equippedSkin || null,
      app.profile?.equippedWeaponGlow || null
    );
  }
}
