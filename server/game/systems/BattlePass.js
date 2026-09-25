// server/game/systems/BattlePass.js — PHASE 4 (workstream 1): Season Battle Pass.
//
// COSMETICS ONLY — NEVER PAY-TO-WIN. Every tier reward grants exactly one
// thing: ownership of a cosmetic id (hero skin, weapon glow, or emote), which
// changes only how a hero looks/animates. Zero gameplay stats: no attack, no
// HP, no XP, no loot luck, no blessings, no shards. The pass UI must display
// "COSMETICS ONLY — NEVER PAY-TO-WIN".
//
// Design:
//   - 20 tiers per season, 1000 season XP per tier. Season XP is earned from
//     runs (server-observed results only) and RESETS each season.
//   - Free track: every player, claimable when the tier is reached. Rewards
//     mix shop-catalog cosmetics and battle-pass-exclusive cosmetics.
//   - Premium track: requires the premium entitlement for the CURRENT season
//     (purchased through the Phase 3 Stripe cosmetic-shop billing — this file
//     never touches keys, Checkout, or webhooks; it only records the
//     entitlement AFTER stripeService verifies payment).
//   - Claims are server-validated: tier reached, not already claimed, premium
//     gate. Claimed tiers are stored on profile.meta.season.claimedFree /
//     claimedPremium and archived on season rollover (so old claims can never
//     be re-claimed against a new season).

'use strict';

const SeasonService = require('./SeasonService');
const catalog = require('../../cosmeticsCatalog');

const XP_PER_TIER = 1000;
const TOTAL_TIERS = 20;
const COSMETICS_ONLY_NOTICE = 'COSMETICS ONLY — NEVER PAY-TO-WIN';

// ---------------------------------------------------------------------------
// Battle-pass-exclusive cosmetics. Same shape as the shop catalog's public
// presentation (id, kind, name, icon, skin/glow/emote) so the client renderer
// can apply them with no changes. These ids are grantable ONLY through pass
// tier claims — never sold, never granted any other way.
// ---------------------------------------------------------------------------
// Row format: [id, kind, name, icon, flavor, extra]
//   skin: extra = { armor, trim, glow, cloth } hex colors
//   weaponGlow: extra = { color } hex
//   emote: extra = { sequence, holdMs }
const BP_EXCLUSIVE_ROWS = [
  // ---- Free track exclusives ----
  ['skin_bp_ironbound', 'skin', 'Ironbound Warplate', '🛡️', 'Season-forged iron plate with soot-darkened trim.',
    { armor: 0x3a3f4a, trim: 0x8a6d2b, glow: 0xff8800, cloth: 0x22222a }],
  ['glow_bp_ember', 'weaponGlow', 'Ember Wake', '🌋', 'A slow ember-glow trailing off your weapon.',
    { color: 0xff3300 }],
  ['emote_bp_bow', 'emote', 'Oathbow', '🙇', 'A deep formal bow to the fallen.',
    { sequence: ['victory'], holdMs: 1200 }],
  ['glow_bp_tide', 'weaponGlow', 'Tidecall Edge', '🌊', 'Cold tidal-blue light along the blade.',
    { color: 0x2288ff }],
  ['emote_bp_horn', 'emote', 'War Horn Call', '📯', 'Raise an invisible horn and sound the advance.',
    { sequence: ['attack', 'jump'], holdMs: 850 }],
  ['skin_bp_ashen', 'skin', 'Ashen Mantle', '🌫️', 'Smoke-grey plate wrapped in pale ash cloth.',
    { armor: 0x5a5a60, trim: 0xc0c0c8, glow: 0x99aabb, cloth: 0x3a3a40 }],
  ['glow_bp_thorn', 'weaponGlow', 'Thornbrand', '🌿', 'A sickly thorn-green shimmer.',
    { color: 0x66ff44 }],
  ['glow_bp_grave', 'weaponGlow', 'Gravelight', '🪦', 'Faint grave-blue corpse light.',
    { color: 0x4466aa }],
  ['emote_bp_lantern', 'emote', 'Lantern Lift', '🏮', 'Hoist an unseen lantern against the dark.',
    { sequence: ['victory', 'victory'], holdMs: 1000 }],
  ['skin_bp_nightwatch', 'skin', 'Nightwatch Mail', '🌙', 'Midnight-blue mail with silver watch-trim.',
    { armor: 0x1c2a4a, trim: 0xc0d0e8, glow: 0x88aaff, cloth: 0x14203a }],
  ['glow_bp_frostbane', 'weaponGlow', 'Frostbane Edge', '❄️', 'Biting arctic-white frost along the edge.',
    { color: 0xaaf0ff }],
  ['skin_bp_wraithbound', 'skin', 'Wraithbound Plate', '👻', 'Spectral pale plate, bound with void-thread.',
    { armor: 0xd8d8e8, trim: 0x9d4edd, glow: 0xe0aaff, cloth: 0x4a4a5a }],
  // ---- Premium track exclusives ----
  ['glow_bp_bloodmoon', 'weaponGlow', 'Bloodmoon Edge', '🩸', 'A weapon steeped in blood-moon red.',
    { color: 0xcc1122 }],
  ['emote_bp_ritual', 'emote', 'Covenant Ritual', '🕯️', 'Trace the covenant sigil in the air.',
    { sequence: ['jump', 'victory', 'jump'], holdMs: 700 }],
  ['skin_bp_drakescale', 'skin', 'Drakescale Aegis', '🐉', 'Scaled crimson plate like a drake\u2019s hide.',
    { armor: 0x7a1a1a, trim: 0xffb347, glow: 0xff4400, cloth: 0x2a0f0f }],
  ['glow_bp_stormcall', 'weaponGlow', 'Stormcall Edge', '⛈️', 'Crackling violet storm-light.',
    { color: 0x9d4edd }],
  ['emote_bp_throne', 'emote', 'Hollow Throne', '🪑', 'Sit the unseen throne and survey your domain.',
    { sequence: ['victory'], holdMs: 1600 }],
  ['skin_bp_celestial', 'skin', 'Celestial Shroud', '🌟', 'Starlit ivory plate with gold filigree.',
    { armor: 0xf0e8d0, trim: 0xffd700, glow: 0xfff2b0, cloth: 0xd8ccb0 }],
  ['glow_bp_soulfire', 'weaponGlow', 'Soulfire Edge', '🔷', 'Cold blue soul-fire, burning without heat.',
    { color: 0x44ccff }],
  ['emote_bp_warhorn', 'emote', 'Doomcaller Horn', '📣', 'A war-cry that rattles the dungeon walls.',
    { sequence: ['attack', 'victory', 'attack'], holdMs: 750 }],
  ['skin_bp_bloodtithe', 'skin', 'Bloodtithe Plate', '🩸', 'Deep crimson plate sealed with black wax.',
    { armor: 0x4a0f14, trim: 0xb91c1c, glow: 0xff2222, cloth: 0x1a0808 }],
  ['glow_bp_plague', 'weaponGlow', 'Plaguebrand', '☣️', 'Oozing viridian plague-light.',
    { color: 0x7dff44 }],
  ['emote_bp_omen', 'emote', 'Omen Reading', '🔮', 'Read the dungeon\u2019s fortune in the bones.',
    { sequence: ['jump', 'victory'], holdMs: 1100 }],
  ['skin_bp_doomherald', 'skin', 'Doomherald Plate', '💀', 'Bone-white plate over grave-black mail.',
    { armor: 0xe8e0d0, trim: 0x1a1a1a, glow: 0x66ff88, cloth: 0x0f0f12 }],
  ['glow_bp_aurum', 'weaponGlow', 'Aurum Edge', '🪙', 'Molten gold light, fit for a covenant king.',
    { color: 0xffcc33 }],
  ['emote_bp_gravemarch', 'emote', 'Gravemarch', '⚰️', 'A slow funeral march for your enemies.',
    { sequence: ['victory', 'jump', 'victory'], holdMs: 800 }],
  ['skin_bp_voidcrown', 'skin', 'Voidcrown Regalia', '👑', 'Royal violet plate crowned with void-glow.',
    { armor: 0x2a1a3e, trim: 0xffd700, glow: 0xbb44ff, cloth: 0x140a24 }],
  ['glow_bp_hollowstar', 'weaponGlow', 'Hollowstar Edge', '🕳️', 'A weapon edged with starless dark.',
    { color: 0x220044 }],
  ['emote_bp_covenant_oath', 'emote', 'Covenant Oath', '🤝', 'Swear the oath anew, fist over heart.',
    { sequence: ['attack', 'victory'], holdMs: 1300 }],
  ['skin_bp_everdusk', 'skin', 'Everdusk Mail', '🌆', 'Twilight-purple mail that never sees dawn.',
    { armor: 0x3a2048, trim: 0xff8c42, glow: 0xff6a00, cloth: 0x201228 }],
  ['glow_bp_nightmare', 'weaponGlow', 'Nightmare Edge', '😱', 'Writhing nightmare-black and blood-red.',
    { color: 0x881111 }],
  ['emote_bp_ascension', 'emote', 'Dark Ascension', '🌌', 'Rise, wreathed in void-light, as the dungeon kneels.',
    { sequence: ['jump', 'jump', 'victory', 'victory'], holdMs: 650 }]
];

const BP_COSMETICS = new Map();
for (const [id, kind, name, icon, description, extra] of BP_EXCLUSIVE_ROWS) {
  const def = { id, kind, name, icon, description, battlePassExclusive: true };
  if (kind === 'skin') def.skin = { ...extra };
  else if (kind === 'weaponGlow') def.glow = { ...extra };
  else if (kind === 'emote') def.emote = { sequence: [...extra.sequence], holdMs: extra.holdMs };
  BP_COSMETICS.set(id, def);
}

// Free track: tier -> cosmetic id (catalog ids mixed with BP exclusives).
const FREE_TRACK = {
  1: 'skin_bp_ironbound',
  2: 'emote_war_taunt',
  3: 'glow_bp_ember',
  4: 'glow_astral',
  5: 'emote_bp_bow',
  6: 'emote_victory_flourish',
  7: 'glow_bp_tide',
  8: 'glow_hellfire',
  9: 'skin_bp_ashen',
  10: 'skin_obsidian_plate',
  11: 'emote_bp_horn',
  12: 'glow_bp_frostbane',
  13: 'emote_shadow_dance',
  14: 'glow_necrotic',
  15: 'glow_bp_thorn',
  16: 'skin_bp_nightwatch',
  17: 'emote_bp_lantern',
  18: 'glow_bp_grave',
  19: 'skin_bp_wraithbound',
  20: 'skin_voidborn'
};

// Premium track: tier -> cosmetic id (all BP exclusives).
const PREMIUM_TRACK = {
  1: 'glow_bp_bloodmoon',
  2: 'emote_bp_ritual',
  3: 'skin_bp_drakescale',
  4: 'glow_bp_stormcall',
  5: 'emote_bp_throne',
  6: 'skin_bp_celestial',
  7: 'glow_bp_soulfire',
  8: 'emote_bp_warhorn',
  9: 'skin_bp_bloodtithe',
  10: 'glow_bp_plague',
  11: 'emote_bp_omen',
  12: 'skin_bp_doomherald',
  13: 'glow_bp_aurum',
  14: 'emote_bp_gravemarch',
  15: 'skin_bp_voidcrown',
  16: 'glow_bp_hollowstar',
  17: 'emote_bp_covenant_oath',
  18: 'skin_bp_everdusk',
  19: 'glow_bp_nightmare',
  20: 'emote_bp_ascension'
};

// ---------------------------------------------------------------------------
// Cosmetic resolution + grant (cosmetics only)
// ---------------------------------------------------------------------------
function getCosmeticDef(id) {
  if (BP_COSMETICS.has(id)) return BP_COSMETICS.get(id);
  const product = catalog.getProduct(id);
  if (!product) return null;
  const def = {
    id: product.id,
    kind: product.kind === 'skin' ? 'skin' : product.kind === 'weaponGlow' ? 'weaponGlow' : 'emote',
    name: product.name,
    icon: product.icon,
    description: product.description
  };
  if (product.skin) def.skin = { ...product.skin };
  if (product.glow) def.glow = { ...product.glow };
  if (product.emote) def.emote = { sequence: [...product.emote.sequence], holdMs: product.emote.holdMs };
  return def;
}

// Sanity guard used by tests: every tier reward must resolve to a KNOWN
// cosmetic and must never grant anything gameplay-relevant.
function assertCosmeticsOnly() {
  const bad = [];
  for (const [track, map] of [['free', FREE_TRACK], ['premium', PREMIUM_TRACK]]) {
    for (const [tier, id] of Object.entries(map)) {
      const def = getCosmeticDef(id);
      if (!def) { bad.push(`${track} t${tier}: unknown cosmetic ${id}`); continue; }
      if (!['skin', 'weaponGlow', 'emote'].includes(def.kind)) {
        bad.push(`${track} t${tier}: non-cosmetic kind ${def.kind}`);
      }
    }
  }
  return bad;
}

function _addUnique(arr, id) {
  if (!arr.includes(id)) { arr.push(id); return true; }
  return false;
}

// Grant a cosmetic id to a profile (owned arrays only). Returns true if newly
// granted, false if already owned. The caller persists via authService.
function grantCosmetic(profile, cosmeticId) {
  const def = getCosmeticDef(cosmeticId);
  if (!def) return { ok: false, error: `Unknown cosmetic reward: ${cosmeticId}` };
  if (!profile) return { ok: false, error: 'No account record.' };
  if (!Array.isArray(profile.ownedSkins)) profile.ownedSkins = [];
  if (!Array.isArray(profile.ownedWeaponGlows)) profile.ownedWeaponGlows = [];
  if (!Array.isArray(profile.ownedEmotes)) profile.ownedEmotes = [];
  let newly = false;
  if (def.kind === 'skin') newly = _addUnique(profile.ownedSkins, cosmeticId);
  else if (def.kind === 'weaponGlow') newly = _addUnique(profile.ownedWeaponGlows, cosmeticId);
  else if (def.kind === 'emote') newly = _addUnique(profile.ownedEmotes, cosmeticId);
  return { ok: true, newlyGranted: newly, cosmetic: def };
}

// ---------------------------------------------------------------------------
// Tier math
// ---------------------------------------------------------------------------
function tierForXp(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  return Math.min(TOTAL_TIERS, Math.floor(x / XP_PER_TIER) + 1);
}

function xpForTier(tier) {
  const t = Math.max(1, Math.min(TOTAL_TIERS, Math.floor(Number(tier) || 1)));
  return (t - 1) * XP_PER_TIER;
}

function xpToNextTier(xp) {
  const t = tierForXp(xp);
  if (t >= TOTAL_TIERS) return null;
  return xpForTier(t + 1) - xp;
}

// ---------------------------------------------------------------------------
// Pass state (client-safe) + claims
// ---------------------------------------------------------------------------
function _trackView(trackMap, claimedList, tier, premium, premiumRequired) {
  const out = [];
  for (let t = 1; t <= TOTAL_TIERS; t++) {
    const id = trackMap[t];
    const def = getCosmeticDef(id);
    const unlocked = tier >= t;
    const claimed = claimedList.includes(t);
    out.push({
      tier: t,
      xpRequired: xpForTier(t),
      reward: def ? {
        id: def.id, kind: def.kind, name: def.name, icon: def.icon,
        description: def.description,
        battlePassExclusive: !!def.battlePassExclusive,
        skin: def.skin ? { ...def.skin } : undefined,
        glow: def.glow ? { ...def.glow } : undefined,
        emote: def.emote ? { sequence: [...def.emote.sequence], holdMs: def.emote.holdMs } : undefined
      } : { id, kind: 'unknown', name: id, icon: '❓' },
      state: claimed ? 'claimed' : (!unlocked ? 'locked' : (premiumRequired && !premium ? 'premium_locked' : 'claimable'))
    });
  }
  return out;
}

// Client-safe pass state for a token-resolved account.
function getPassState(accountToken) {
  const authService = require('../../authService');
  const acc = authService.getAccountByToken(accountToken);
  if (!acc || !acc.profile) return { ok: false, error: 'Session expired or not logged in.' };
  const season = SeasonService.getCurrentSeason();
  const s = SeasonService.ensureSeasonState(acc.profile, season.id);
  const premium = SeasonService.hasPremium(acc.profile, season.id);
  const tier = tierForXp(s.xp);
  return {
    ok: true,
    notice: COSMETICS_ONLY_NOTICE,
    season: { id: season.id, name: season.name, startISO: season.startISO, endISO: season.endISO },
    xp: s.xp,
    tier,
    xpPerTier: XP_PER_TIER,
    totalTiers: TOTAL_TIERS,
    xpToNextTier: xpToNextTier(s.xp),
    premium,
    free: _trackView(FREE_TRACK, s.claimedFree, tier, premium, false),
    premiumTrack: _trackView(PREMIUM_TRACK, s.claimedPremium, tier, premium, true)
  };
}

// claimTier(accountToken, track, tier): server-validated tier claim.
// track: 'free' | 'premium'. Validates: known track, tier in range, tier
// reached by season XP, premium entitlement for the premium track, and no
// double-claim. The season id is ALWAYS the current season — claims against
// a stale season id are impossible (the record rolls over first).
function claimTier(accountToken, track, tier) {
  const authService = require('../../authService');
  const acc = authService.getAccountByToken(accountToken);
  if (!acc || !acc.profile) return { ok: false, error: 'Session expired or not logged in.' };

  const trackMap = track === 'free' ? FREE_TRACK : track === 'premium' ? PREMIUM_TRACK : null;
  if (!trackMap) return { ok: false, error: 'Unknown pass track.' };
  const t = Math.floor(Number(tier));
  if (!Number.isInteger(t) || t < 1 || t > TOTAL_TIERS) {
    return { ok: false, error: 'No such tier exists on this pass.' };
  }

  const season = SeasonService.getCurrentSeason();
  const s = SeasonService.ensureSeasonState(acc.profile, season.id);
  const earnedTier = tierForXp(s.xp);
  if (t > earnedTier) {
    return { ok: false, error: `Tier ${t} is not yet unlocked — earn ${xpForTier(t) - s.xp} more season XP.` };
  }

  if (track === 'premium' && !SeasonService.hasPremium(acc.profile, season.id)) {
    return { ok: false, error: 'The premium track requires the Season Pass (premium) for this season.' };
  }

  const claimedList = track === 'free' ? s.claimedFree : s.claimedPremium;
  if (claimedList.includes(t)) {
    return { ok: false, error: `Tier ${t} (${track}) is already claimed.` };
  }

  const cosmeticId = trackMap[t];
  const grant = grantCosmetic(acc.profile, cosmeticId);
  if (!grant.ok) return { ok: false, error: grant.error };

  claimedList.push(t);
  claimedList.sort((a, b) => a - b);
  authService.saveAccounts(); // atomic

  return {
    ok: true,
    track,
    tier: t,
    reward: {
      id: grant.cosmetic.id, kind: grant.cosmetic.kind, name: grant.cosmetic.name,
      icon: grant.cosmetic.icon, description: grant.cosmetic.description,
      alreadyOwned: !grant.newlyGranted
    },
    pass: getPassState(accountToken)
  };
}

// Called AFTER stripeService confirms payment for the season-pass product
// (webhook or verified session retrieval). Records premium for the current
// season on the buyer's account. Delegates persistence to SeasonService.
function grantPremiumFromPurchase(accountToken) {
  return SeasonService.grantPremium(accountToken);
}

// All exclusive BP cosmetic defs, keyed by id — merged into the client's
// cosmeticDefs map so pass rewards render on heroes.
function publicExclusiveDefs() {
  return Array.from(BP_COSMETICS.values()).map(d => ({ ...d }));
}

module.exports = {
  XP_PER_TIER,
  TOTAL_TIERS,
  COSMETICS_ONLY_NOTICE,
  FREE_TRACK,
  PREMIUM_TRACK,
  getCosmeticDef,
  assertCosmeticsOnly,
  grantCosmetic,
  tierForXp,
  xpForTier,
  xpToNextTier,
  getPassState,
  claimTier,
  grantPremiumFromPurchase,
  publicExclusiveDefs
};
