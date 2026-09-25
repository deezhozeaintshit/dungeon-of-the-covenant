// server/cosmeticsCatalog.js — Single source of truth for the Covenant Cosmetic Shop.
//
// COSMETICS ONLY — NEVER PAY-TO-WIN. Every product in this catalog grants zero
// gameplay stats: no attack, no HP, no XP, no loot luck, no blessings, no shards.
// Products grant exactly one thing: ownership of a cosmetic id (hero skin,
// weapon glow effect, or emote), which changes only how a hero looks/animates.
//
// The client NEVER decides what a product does. The server validates productId
// against this catalog on every purchase path (checkout creation, session
// verification, webhook), and authService only ever grants the ids listed here.

const PRODUCTS = [
  // ---- Hero skins: full-body recolors applied through the character material
  // pipeline (armor / trim / glow / cloth channels). Zero stat impact.
  {
    id: 'skin_obsidian_plate',
    kind: 'skin',
    name: 'Obsidian Plate',
    icon: '🖤',
    description: 'Forged-dark obsidian armor with ember trim. A full hero recolor, visible to your whole party.',
    amountCents: 299,
    currency: 'usd',
    grants: { skins: ['skin_obsidian_plate'], weaponGlows: [], emotes: [] },
    skin: { armor: 0x1a1a24, trim: 0xff6a00, glow: 0xff4400, cloth: 0x23232e }
  },
  {
    id: 'skin_sunforged',
    kind: 'skin',
    name: 'Sunforged Regalia',
    icon: '☀️',
    description: 'Radiant sunforged gold and ivory regalia. A full hero recolor, visible to your whole party.',
    amountCents: 499,
    currency: 'usd',
    grants: { skins: ['skin_sunforged'], weaponGlows: [], emotes: [] },
    skin: { armor: 0xe8dcc0, trim: 0xffd700, glow: 0xffe27a, cloth: 0xf5edd8 }
  },
  {
    id: 'skin_voidborn',
    kind: 'skin',
    name: 'Voidborn Shroud',
    icon: '🌌',
    description: 'Deep-void violet plate with astral cyan glow. A full hero recolor, visible to your whole party.',
    amountCents: 499,
    currency: 'usd',
    grants: { skins: ['skin_voidborn'], weaponGlows: [], emotes: [] },
    skin: { armor: 0x2a1a3e, trim: 0x9d4edd, glow: 0x00f5d4, cloth: 0x1a1030 }
  },
  // ---- Weapon glows: recolor the emissive weapon parts. Visual only.
  {
    id: 'glow_hellfire',
    kind: 'weaponGlow',
    name: 'Hellfire Edge',
    icon: '🔥',
    description: 'Your weapon burns with hellfire-orange light. Pure visual flair — same damage as ever.',
    amountCents: 199,
    currency: 'usd',
    grants: { skins: [], weaponGlows: ['glow_hellfire'], emotes: [] },
    glow: { color: 0xff5500 }
  },
  {
    id: 'glow_astral',
    kind: 'weaponGlow',
    name: 'Astral Edge',
    icon: '✨',
    description: 'Your weapon hums with cold astral-blue light. Pure visual flair — same damage as ever.',
    amountCents: 199,
    currency: 'usd',
    grants: { skins: [], weaponGlows: ['glow_astral'], emotes: [] },
    glow: { color: 0x66e0ff }
  },
  {
    id: 'glow_necrotic',
    kind: 'weaponGlow',
    name: 'Necrotic Edge',
    icon: '☠️',
    description: 'Your weapon drips with sickly necrotic-green light. Pure visual flair — same damage as ever.',
    amountCents: 199,
    currency: 'usd',
    grants: { skins: [], weaponGlows: ['glow_necrotic'], emotes: [] },
    glow: { color: 0x4dff6a }
  },
  // ---- Emotes: animation sequences played through the Phase 2 animation
  // state machine. They interrupt nothing gameplay-relevant and grant nothing.
  {
    id: 'emote_victory_flourish',
    kind: 'emote',
    name: 'Victory Flourish',
    icon: '🏆',
    description: 'Strike a victory pose, then leap. Show the party how it is done.',
    amountCents: 199,
    currency: 'usd',
    grants: { skins: [], weaponGlows: [], emotes: ['emote_victory_flourish'] },
    emote: { sequence: ['victory', 'jump'], holdMs: 900 }
  },
  {
    id: 'emote_war_taunt',
    kind: 'emote',
    name: 'War Taunt',
    icon: '⚔️',
    description: 'Brandish your weapon and roar at the dungeon. Intimidation is free.',
    amountCents: 199,
    currency: 'usd',
    grants: { skins: [], weaponGlows: [], emotes: ['emote_war_taunt'] },
    emote: { sequence: ['attack', 'victory'], holdMs: 800 }
  },
  {
    id: 'emote_shadow_dance',
    kind: 'emote',
    name: 'Shadow Dance',
    icon: '💃',
    description: 'A full shadow-dance routine for the victory screen — or mid-boss, if you dare.',
    amountCents: 199,
    currency: 'usd',
    grants: { skins: [], weaponGlows: [], emotes: ['emote_shadow_dance'] },
    emote: { sequence: ['jump', 'victory', 'jump', 'victory'], holdMs: 650 }
  },
  // ---- Bundle: every cosmetic in the shop, one price.
  {
    id: 'bundle_covenant_collector',
    kind: 'bundle',
    name: "Covenant Collector's Bundle",
    icon: '👑',
    description: 'Every skin, every weapon glow, and every emote in the shop. The complete Covenant wardrobe.',
    amountCents: 999,
    currency: 'usd',
    grants: {
      skins: ['skin_obsidian_plate', 'skin_sunforged', 'skin_voidborn'],
      weaponGlows: ['glow_hellfire', 'glow_astral', 'glow_necrotic'],
      emotes: ['emote_victory_flourish', 'emote_war_taunt', 'emote_shadow_dance']
    }
  }
];

const PRODUCT_MAP = new Map(PRODUCTS.map(p => [p.id, p]));

// All cosmetic ids the server will ever grant — used by authService to reject
// anything that is not a known cosmetic (defense against forged grant claims).
const GRANTABLE = {
  skins: new Set(),
  weaponGlows: new Set(),
  emotes: new Set()
};
for (const p of PRODUCTS) {
  for (const s of p.grants.skins) GRANTABLE.skins.add(s);
  for (const g of p.grants.weaponGlows) GRANTABLE.weaponGlows.add(g);
  for (const e of p.grants.emotes) GRANTABLE.emotes.add(e);
}

function getProduct(id) {
  return PRODUCT_MAP.get(id) || null;
}

function isValidProduct(id) {
  return PRODUCT_MAP.has(id);
}

function isGrantableCosmetic(kind, id) {
  if (kind === 'skin') return GRANTABLE.skins.has(id);
  if (kind === 'weaponGlow') return GRANTABLE.weaponGlows.has(id);
  if (kind === 'emote') return GRANTABLE.emotes.has(id);
  return false;
}

// Public view of the catalog — safe to send to browsers. Contains prices and
// presentation only; never any entitlement logic.
function publicCatalog() {
  return PRODUCTS.map(p => {
    const pub = {
      id: p.id,
      kind: p.kind,
      name: p.name,
      icon: p.icon,
      description: p.description,
      amountCents: p.amountCents,
      currency: p.currency,
      priceDisplay: `$${(p.amountCents / 100).toFixed(2)}`
    };
    // Presentation data the client needs to render cosmetics. Colors and
    // emote sequences only — no entitlement logic.
    if (p.skin) pub.skin = { ...p.skin };
    if (p.glow) pub.glow = { ...p.glow };
    if (p.emote) pub.emote = { sequence: [...p.emote.sequence], holdMs: p.emote.holdMs };
    return pub;
  });
}

function formatPrice(amountCents) {
  return `$${(amountCents / 100).toFixed(2)}`;
}

module.exports = {
  PRODUCTS,
  getProduct,
  isValidProduct,
  isGrantableCosmetic,
  publicCatalog,
  formatPrice
};
