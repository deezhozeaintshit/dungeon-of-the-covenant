// server/server.js - Authoritative 3D Multiplayer RPG Server, Quickplay Matchmaker, Auth & Live Stripe IAP Host
const http = require('http');
const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const Room = require('./game/Room');
// Phase 2: progression + health systems for the new ws message handlers.
const Abilities = require('./game/systems/Abilities');
const Health = require('./game/systems/Health');
const stripeService = require('./stripeService');
const authService = require('./authService');
// Phase 3 meta-progression (workstream 5): persistent account ranks + unlocks.
const MetaProgression = require('./game/systems/MetaProgression');
// Phase 4 seasons + battle pass + weekly leaderboards (workstream 1):
// server-authoritative seasons, cosmetics-only pass, daily-delve seeding.
const SeasonService = require('./game/systems/SeasonService');
const BattlePass = require('./game/systems/BattlePass');
const Leaderboards = require('./game/systems/Leaderboards');
// Phase 4 Endless Rift mode (workstream 4): server-authoritative tier
// scaling, affixes, keystone entry economy, rift leaderboards.
const Rift = require('./game/systems/Rift');

const PORT = process.env.PORT || 3000;
const app = express();

// Stripe webhooks require the RAW request body for HMAC signature
// verification, so these routes are registered BEFORE express.json().
// Everything else continues to use parsed JSON bodies.
const rawJson = express.raw({ type: 'application/json', limit: '1mb' });
app.post('/api/stripe/webhook', rawJson, handleStripeWebhook);
app.post('/api/webhook', rawJson, handleStripeWebhook);

app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Prevent browser caching during active development
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ============================================================================
// 1. AUTHENTICATION & CLOUD ACCOUNT PERSISTENCE ENDPOINTS
// ============================================================================
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  const result = authService.register(username, password);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = authService.login(username, password);
  res.json(result);
});

app.get('/api/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim() || req.query.token;
  const profile = authService.getProfileByToken(token);
  if (!profile) {
    return res.status(401).json({ ok: false, error: 'Session expired or not logged in.' });
  }
  res.json({ ok: true, profile });
});

app.post('/api/auth/sync', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim() || req.body?.token;
  const profile = authService.updateProfile(token, req.body?.profile || {});
  res.json({ ok: Boolean(profile), profile });
});

// ============================================================================
// 1b. COVENANT VAULT — PERSISTENT ACCOUNT PROGRESSION (Phase 3, workstream 5)
//
// Account XP / seals are granted ONLY from server-observed run results
// (Room -> MetaProgression.grantRunRewards). No endpoint accepts client-sent
// totals: /api/auth/sync's whitelist has no meta fields, and the Vault only
// ever receives an itemId — ownership, rank gates, and seal balances are all
// validated server-side against the token-resolved account record.
// ============================================================================
function metaToken(req) {
  return (req.headers.authorization || '').replace('Bearer ', '').trim()
    || req.query.token || req.body?.token || null;
}

function metaAccount(req, res) {
  const acc = authService.getAccountByToken(metaToken(req));
  if (!acc) {
    res.status(401).json({ ok: false, error: 'Session expired or not logged in.' });
    return null;
  }
  return acc;
}

// Read-only: account progression state + vault catalog (with affordability).
app.get('/api/meta/state', (req, res) => {
  const acc = metaAccount(req, res);
  if (!acc) return;
  const meta = MetaProgression.ensureMeta(acc.profile);
  res.json({
    ok: true,
    meta: MetaProgression.publicMeta(meta),
    catalog: MetaProgression.catalogFor(meta)
  });
});

// Spend seals on a vault unlockable. Validated server-side; forged itemIds,
// insufficient seals, and unmet rank gates are all rejected.
app.post('/api/meta/purchase', (req, res) => {
  const acc = metaAccount(req, res);
  if (!acc) return;
  const itemId = String(req.body?.itemId || '');
  const result = MetaProgression.purchase(MetaProgression.ensureMeta(acc.profile), itemId);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  authService.saveAccounts(); // atomic
  const meta = MetaProgression.ensureMeta(acc.profile);
  res.json({
    ok: true,
    purchased: result.purchased,
    meta: MetaProgression.publicMeta(meta),
    catalog: MetaProgression.catalogFor(meta)
  });
});

// Equip the run-start boon loadout (owned boons only, max 2). Takes effect on
// the NEXT run the account joins.
app.post('/api/meta/boons', (req, res) => {
  const acc = metaAccount(req, res);
  if (!acc) return;
  const result = MetaProgression.setActiveBoons(
    MetaProgression.ensureMeta(acc.profile),
    req.body?.boonIds
  );
  if (!result.ok) {
    return res.status(400).json(result);
  }
  authService.saveAccounts(); // atomic
  const meta = MetaProgression.ensureMeta(acc.profile);
  res.json({
    ok: true,
    meta: MetaProgression.publicMeta(meta),
    catalog: MetaProgression.catalogFor(meta)
  });
});

// ============================================================================
// 2. STRIPE COSMETIC SHOP ENDPOINTS (keys via process.env only; .env gitignored)
//
// The shop is COSMETICS ONLY — never pay-to-win. Entitlements are granted
// exclusively after Stripe confirms payment: a signature-verified webhook, or
// a server-side session verification. Nothing is granted at checkout time.
// With no Stripe keys configured, /api/stripe/config reports shopAvailable:
// false and the client renders a "coming soon" state; the game is unaffected.
// ============================================================================

// Official Stripe Webhook Handler (/api/stripe/webhook and /api/webhook).
// Registered with express.raw() above so the HMAC signature can be verified
// against the exact bytes Stripe sent. Unsigned/forged events are rejected.
async function handleStripeWebhook(req, res) {
  const sigCheck = stripeService.verifyWebhookSignature(req.body, req.headers['stripe-signature']);
  if (!sigCheck.ok) {
    console.warn('[StripeWebhook] Rejected:', sigCheck.error);
    return res.status(400).json({ received: false, error: sigCheck.error });
  }
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ received: false, error: 'Invalid JSON payload.' });
  }
  const result = await stripeService.handleWebhookEvent(event);
  res.json(result);
}

app.get('/api/stripe/config', (req, res) => {
  res.json(stripeService.getConfigStatus());
});

app.post('/api/stripe/create-checkout-session', async (req, res) => {
  try {
    const { productId, originUrl, playerName, accountToken } = req.body || {};
    const origin = originUrl || `${req.protocol}://${req.get('host')}`;
    const session = await stripeService.createCheckoutSession({
      productId,
      originUrl: origin,
      playerName,
      accountToken
    });
    res.json({ ok: true, ...session });
  } catch (err) {
    const status = err.code === 'STRIPE_NOT_CONFIGURED' ? 503 : 400;
    res.status(status).json({ ok: false, error: err.message, code: err.code || 'CHECKOUT_FAILED' });
  }
});

const handleVerifySession = async (req, res) => {
  try {
    const sessionId = req.query.session_id || req.body?.sessionId;
    const accountToken = req.query.token || req.body?.accountToken;
    const result = await stripeService.verifySession(sessionId, accountToken);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
};
app.get('/api/stripe/verify-session', handleVerifySession);
app.post('/api/stripe/verify-session', handleVerifySession);

// --- Cosmetic shop: entitlement read + equip (server-validated ownership) ---
function shopToken(req) {
  return (req.headers.authorization || '').replace('Bearer ', '').trim()
    || req.query.token || req.body?.accountToken || null;
}

app.get('/api/shop/entitlements', (req, res) => {
  const entitlements = authService.getEntitlements(shopToken(req));
  if (!entitlements) {
    return res.status(401).json({ ok: false, error: 'Session expired or not logged in.' });
  }
  res.json({ ok: true, entitlements });
});

app.post('/api/shop/equip', (req, res) => {
  const { kind, cosmeticId } = req.body || {};
  const result = authService.setEquippedCosmetic(
    shopToken(req),
    kind,
    cosmeticId === null || cosmeticId === undefined ? null : String(cosmeticId)
  );
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ============================================================================
// 2b. SEASONS, BATTLE PASS, DAILY DELVE & WEEKLY LEADERBOARDS (Phase 4,
//     workstream 1).
//
// COSMETICS ONLY — NEVER PAY-TO-WIN. Every battle-pass tier reward grants
// exactly one cosmetic (hero skin, weapon glow, or emote): zero gameplay
// stats. Season XP is earned ONLY from server-observed run results (see
// MetaProgression.grantRunRewards) — no endpoint accepts client-sent XP.
// Leaderboard values are measured server-side (clear times from room
// timestamps, rift tiers from the rift system, season XP from run rewards).
// ============================================================================

// Public: current season identity + today's deterministic delve seed.
app.get('/api/season/state', (req, res) => {
  res.json({
    ok: true,
    ...SeasonService.publicSeasonState(),
    passNotice: BattlePass.COSMETICS_ONLY_NOTICE
  });
});

// Battle-pass-exclusive cosmetic defs — merged into the client's cosmeticDefs
// map so pass rewards render on heroes. Presentation data only.
app.get('/api/pass/cosmetics', (req, res) => {
  res.json({ ok: true, defs: BattlePass.publicExclusiveDefs() });
});

// Account's pass state (season XP, tier, claimed/unclaimed per tier/track).
app.get('/api/pass/state', (req, res) => {
  const acc = metaAccount(req, res);
  if (!acc) return;
  res.json(BattlePass.getPassState(metaToken(req)));
});

// Claim a tier reward. Server-validated: tier reached, premium gate, no
// double-claim. The season id is always the current season.
app.post('/api/pass/claim', (req, res) => {
  const acc = metaAccount(req, res);
  if (!acc) return;
  const { track, tier } = req.body || {};
  const result = BattlePass.claimTier(metaToken(req), track, tier);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// Start a Stripe Checkout for the season-pass premium product. Reuses the
// Phase 3 cosmetic-shop billing: nothing is granted at checkout time — the
// entitlement lands only after Stripe confirms payment (webhook or verify).
app.post('/api/pass/checkout', async (req, res) => {
  const token = metaToken(req);
  const acc = metaAccount(req, res);
  if (!acc) return;
  try {
    const season = SeasonService.getCurrentSeason();
    if (SeasonService.hasPremium(acc.profile, season.id)) {
      return res.status(400).json({ ok: false, error: 'You already hold premium for this season.' });
    }
    const origin = req.body?.originUrl || `${req.protocol}://${req.get('host')}`;
    const session = await stripeService.createCheckoutSession({
      productId: 'pass_premium_season',
      originUrl: origin,
      playerName: acc.profile.displayName || acc.username,
      accountToken: token
    });
    res.json({ ok: true, seasonId: season.id, ...session });
  } catch (err) {
    const status = err.code === 'STRIPE_NOT_CONFIGURED' ? 503 : 400;
    res.status(status).json({ ok: false, error: err.message, code: err.code || 'CHECKOUT_FAILED' });
  }
});

// Verify a returning pass-checkout session server-side. On a paid
// pass_premium_season session, records the premium entitlement for the
// CURRENT season (idempotent — replay-safe via stripeService).
const handlePassVerify = async (req, res) => {
  const token = metaToken(req);
  const acc = metaAccount(req, res);
  if (!acc) return;
  try {
    const sessionId = req.query.session_id || req.body?.sessionId;
    const result = await stripeService.verifySession(sessionId, token);
    if (result.verified && result.productId === 'pass_premium_season') {
      const grant = BattlePass.grantPremiumFromPurchase(token);
      if (!grant.ok) {
        return res.status(400).json({ ok: false, error: grant.error });
      }
      return res.json({
        ok: true,
        verified: true,
        alreadyGranted: !!result.alreadyGranted,
        premium: true,
        seasonId: grant.seasonId,
        pass: BattlePass.getPassState(token)
      });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
};
app.get('/api/pass/verify', handlePassVerify);
app.post('/api/pass/verify', handlePassVerify);

// Weekly leaderboards — server-computed standings (shared schema in
// server/game/systems/Leaderboards.js, also used by the rift system).
function leaderboardLimit(req) {
  const n = parseInt(req.query.limit, 10);
  return Math.max(1, Math.min(25, Number.isFinite(n) ? n : 10));
}

app.get('/api/leaderboards', (req, res) => {
  res.json({
    ok: true,
    weekId: SeasonService.weekIdFor(),
    boards: Leaderboards.publicBoards(leaderboardLimit(req))
  });
});

app.get('/api/leaderboards/:board', (req, res) => {
  const result = Leaderboards.getBoard(req.params.board, {
    weekId: req.query.weekId || null,
    limit: leaderboardLimit(req)
  });
  if (!result.ok) {
    return res.status(404).json(result);
  }
  res.json({ ok: true, ...result });
});

// ===========================================================================
// PHASE 4 (workstream 2): COVENS — lifecycle, ranks, progression, race, chat.
// All endpoints are server-authoritative; the client only renders state.
// ===========================================================================
const CovenService = require('./game/systems/CovenService');

function covenAccount(req, res) {
  const acc = authService.getAccountByToken(metaToken(req));
  if (!acc) {
    res.status(401).json({ ok: false, error: 'Session expired or not logged in.' });
    return null;
  }
  return acc;
}

// Live coven websocket subscribers: covenId -> Set<ws>. Used for coven chat
// delivery and coven_update pushes after mutations.
const covenSubscribers = new Map(); // covenId -> Set<ws>
const covenSocketCoven = new Map(); // ws -> covenId

function broadcastToCoven(covenId, messageObj) {
  const subs = covenSubscribers.get(covenId);
  if (!subs || subs.size === 0) return;
  const payload = JSON.stringify(messageObj);
  for (const clientWs of subs) {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(payload);
  }
}

function unsubscribeCovenSocket(ws) {
  const covenId = covenSocketCoven.get(ws);
  if (!covenId) return;
  covenSocketCoven.delete(ws);
  const subs = covenSubscribers.get(covenId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) covenSubscribers.delete(covenId);
  }
}

// Push the fresh public coven state to every online subscriber (roster,
// ranks, XP). Called after every coven mutation below.
function notifyCoven(covenId) {
  const subs = covenSubscribers.get(covenId);
  if (!subs || subs.size === 0) return;
  const store = CovenService; // fresh public view per socket below
  for (const clientWs of [...subs]) {
    try {
      const meta = socketMeta.get(clientWs);
      const uname = meta && meta.accountUsername;
      if (!uname) continue;
      const state = store.getCovenState({ username: uname });
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'coven_update', ...state }));
      }
    } catch (e) { /* never break on a push */ }
  }
}

app.get('/api/coven/state', (req, res) => {
  const acc = authService.getAccountByToken(metaToken(req));
  // Race standings are public (glory is meant to be seen); roster detail
  // needs a session.
  const uname = acc ? acc.username : null;
  res.json(CovenService.getCovenState({ username: uname }));
});

app.post('/api/coven/create', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const result = CovenService.createCoven({
    username: acc.username,
    displayName: acc.profile.displayName || acc.username,
    name: req.body?.name,
    tagline: req.body?.tagline
  });
  if (!result.ok) return res.status(400).json(result);
  notifyCoven(result.coven.id);
  res.json(result);
});

app.post('/api/coven/join', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const result = CovenService.joinByCode({
    username: acc.username,
    displayName: acc.profile.displayName || acc.username,
    code: req.body?.code
  });
  if (!result.ok) return res.status(400).json(result);
  notifyCoven(result.coven.id);
  res.json(result);
});

app.post('/api/coven/leave', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const covenId = CovenService.getCovenIdForUser(acc.username);
  const result = CovenService.leaveCoven({ username: acc.username });
  if (!result.ok) return res.status(400).json(result);
  if (covenId) notifyCoven(covenId);
  res.json(result);
});

app.post('/api/coven/disband', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const covenId = CovenService.getCovenIdForUser(acc.username);
  const result = CovenService.disbandCoven({ username: acc.username });
  if (!result.ok) return res.status(400).json(result);
  if (covenId) {
    broadcastToCoven(covenId, { type: 'coven_disbanded', covenId, covenName: result.covenName });
    for (const clientWs of [...(covenSubscribers.get(covenId) || [])]) unsubscribeCovenSocket(clientWs);
  }
  res.json(result);
});

app.post('/api/coven/promote', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const result = CovenService.setRank({
    actorUsername: acc.username,
    targetUsername: req.body?.username,
    rank: 'officer'
  });
  if (!result.ok) return res.status(400).json(result);
  notifyCoven(result.coven.id);
  res.json(result);
});

app.post('/api/coven/demote', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const result = CovenService.setRank({
    actorUsername: acc.username,
    targetUsername: req.body?.username,
    rank: 'member'
  });
  if (!result.ok) return res.status(400).json(result);
  notifyCoven(result.coven.id);
  res.json(result);
});

app.post('/api/coven/kick', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const target = (req.body?.username || '').toLowerCase().trim();
  const covenId = CovenService.getCovenIdForUser(acc.username);
  const result = CovenService.kickMember({ actorUsername: acc.username, targetUsername: target });
  if (!result.ok) return res.status(400).json(result);
  if (covenId) notifyCoven(covenId);
  res.json(result);
});

app.post('/api/coven/invite/rotate', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const result = CovenService.rotateInviteCode({ username: acc.username });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/coven/race', (req, res) => {
  res.json(CovenService.getWeeklyRace());
});

app.get('/api/coven/chat', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const covenId = req.query.covenId || CovenService.getCovenIdForUser(acc.username);
  const result = CovenService.getChat(covenId, req.query.after || 0, acc.username);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/coven/chat', (req, res) => {
  const acc = covenAccount(req, res);
  if (!acc) return;
  const result = CovenService.sendChat({
    username: acc.username,
    displayName: acc.profile.displayName || acc.username,
    text: req.body?.text
  });
  if (!result.ok) return res.status(400).json(result);
  broadcastToCoven(result.covenId, { type: 'coven_chat', covenId: result.covenId, message: result.message });
  res.json(result);
});

// ============================================================================
// 3. STATIC CLIENT & THREE.JS ADDONS HOSTING
// ============================================================================
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')));
app.use('/vendor/addons', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm')));

// Player documentation: serve the game guide at /docs
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'docs.html'));
});

// ============================================================================
// 4. REAL-TIME MULTIPLAYER ROOMS & INSTANT QUICKPLAY AUTO-MATCHMAKER
// ============================================================================
const rooms = new Map();
const socketMeta = new Map();

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function findOrCreateQuickplayRoom() {
  // Find any active room with fewer than 8 human players so random people get thrown into a match together!
  // Private rooms are skipped: quickplay never throws strangers into a private chamber.
  for (const [code, room] of rooms.entries()) {
    if (room.isPrivate) continue;
    const humanCount = Object.values(room.players).filter(p => !p.isBot).length;
    if (humanCount < 8 && room.state !== 'completed') {
      return { roomCode: code, room, isNew: false };
    }
  }
  const roomCode = generateRoomCode();
  const room = new Room(roomCode);
  room.setBroadcastCallback((msg) => broadcastToRoom(roomCode, msg));
  rooms.set(roomCode, room);
  return { roomCode, room, isNew: true };
}

// PHASE 4 (workstream 1): Daily Delve matchmaking. One shared public room per
// calendar day, seeded deterministically so every player runs the SAME
// dungeon. Base room code 'DLDY' with overflow codes DLD2..DLD9 (8 humans per
// room). Stale rooms from a previous day are retired on sight.
function findOrCreateDailyRoom() {
  const delve = SeasonService.getDailyDelve();
  for (let n = 0; n < 9; n++) {
    const code = n === 0 ? 'DLDY' : `DLD${n + 1}`;
    const existing = rooms.get(code);
    if (existing) {
      if (existing.dailyDate !== delve.date) {
        existing.state = 'completed';
        rooms.delete(code);
      } else if (existing.state !== 'completed') {
        const humanCount = Object.values(existing.players).filter(p => !p.isBot).length;
        if (humanCount < 8) return { roomCode: code, room: existing, isNew: false };
        continue; // full — try the next overflow room
      }
    }
    const room = new Room(code);
    room.isDailyDelve = true;
    room.dailySeed = delve.seed;
    room.dailyDate = delve.date;
    room.setBroadcastCallback((msg) => broadcastToRoom(code, msg));
    rooms.set(code, room);
    return { roomCode: code, room, isNew: true };
  }
  // Practically unreachable (9 full daily rooms) — fall back to quickplay.
  return findOrCreateQuickplayRoom();
}

wss.on('connection', (ws) => {
  const socketId = `p_${Math.random().toString(36).substring(2, 9)}`;

  ws.on('message', (messageRaw) => {
    try {
      const data = JSON.parse(messageRaw);
      handleClientMessage(ws, socketId, data);
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    // PHASE 4 (workstream 2): drop coven live-channel subscription.
    unsubscribeCovenSocket(ws);
    const meta = socketMeta.get(ws);
    if (meta && meta.roomCode) {
      const room = rooms.get(meta.roomCode);
      if (room) {
        room.removePlayer(socketId);
        room.broadcast({
          type: 'player_left',
          playerId: socketId
        });
        const remainingHumans = Object.values(room.players).filter(p => !p.isBot).length;
        if (remainingHumans === 0) {
          rooms.delete(meta.roomCode);
        }
      }
    }
    socketMeta.delete(ws);
  });
});

function handleClientMessage(ws, socketId, data) {
  switch (data.type) {
    // NEW (Phase 2): Lobby browser — list joinable public rooms, newest first.
    case 'list_rooms': {
      const MAX_PLAYERS = 8;
      const list = [];
      const entries = Array.from(rooms.entries()).reverse(); // newest first
      for (const [code, room] of entries) {
        if (list.length >= 20) break;
        if (room.isPrivate) continue; // private chambers are invite-only
        if (room.state !== 'lobby' && room.state !== 'dungeon') continue; // never list completed rooms
        const players = Object.values(room.players || {});
        const humanCount = players.filter(p => !p.isBot).length;
        list.push({
          code,
          playerCount: humanCount,
          maxPlayers: MAX_PLAYERS,
          biome: (room.proceduralConfig && room.proceduralConfig.biome && room.proceduralConfig.biome.name) || 'Uncharted Depths',
          biomeId: (room.proceduralConfig && room.proceduralConfig.biome && room.proceduralConfig.biome.id) || null,
          floor: room.floor || 1,
          state: room.state,
          ageSec: Math.round((Date.now() - (room.createdAt || Date.now())) / 1000),
          hasBots: players.some(p => p.isBot)
        });
      }
      ws.send(JSON.stringify({ type: 'room_list', rooms: list }));
      break;
    }

    // NEW: Instant Quickplay Auto-Matchmaking — throws players directly into a live randomly generated dungeon together!
    case 'quickplay_matchmaking': {
      const { roomCode, room, isNew } = findOrCreateQuickplayRoom();
      const player = room.addPlayer(socketId, data.playerName, data.chosenClass, false, data.profile, data.accountToken);
      socketMeta.set(ws, { roomCode, playerId: socketId });

      if (isNew || room.state === 'lobby') {
        room.startDungeon();
      }

      ws.send(JSON.stringify({
        type: 'room_joined',
        roomCode,
        player,
        room: room.getSnapshot()
      }));

      ws.send(JSON.stringify({
        type: 'dungeon_started',
        roomCode,
        snapshot: room.getSnapshot()
      }));

      if (room.proceduralConfig) {
        ws.send(JSON.stringify({
          type: 'procedural_floor_generated',
          config: room.proceduralConfig,
          proceduralConfig: room.proceduralConfig
        }));
      }

      if (player.secretObjective) {
        ws.send(JSON.stringify({
          type: 'secret_objective_assigned',
          objective: player.secretObjective
        }));
      }

      room.broadcast({
        type: 'player_joined',
        player
      });
      break;
    }

    // PHASE 4 (workstream 1): Daily Delve matchmaking — joins today's shared
    // seeded dungeon. Same flow as quickplay: joins the daily room, starts
    // the dungeon on first entry, and reports the daily seed to the client.
    case 'daily_delve_matchmaking': {
      const { roomCode, room, isNew } = findOrCreateDailyRoom();
      const player = room.addPlayer(socketId, data.playerName, data.chosenClass, false, data.profile, data.accountToken);
      socketMeta.set(ws, { roomCode, playerId: socketId });

      if (isNew || room.state === 'lobby') {
        room.startDungeon();
      }

      ws.send(JSON.stringify({
        type: 'room_joined',
        roomCode,
        player,
        room: room.getSnapshot(),
        dailyDelve: true,
        dailyDate: room.dailyDate || null,
        dailySeed: room.dailySeed != null ? room.dailySeed : null
      }));

      if (room.state === 'dungeon') {
        ws.send(JSON.stringify({
          type: 'dungeon_started',
          roomCode,
          snapshot: room.getSnapshot(),
          dailyDelve: true,
          dailySeed: room.dailySeed != null ? room.dailySeed : null
        }));

        if (room.proceduralConfig) {
          ws.send(JSON.stringify({
            type: 'procedural_floor_generated',
            config: room.proceduralConfig,
            proceduralConfig: room.proceduralConfig
          }));
        }
      }

      if (player.secretObjective) {
        ws.send(JSON.stringify({
          type: 'secret_objective_assigned',
          objective: player.secretObjective
        }));
      }

      room.broadcast({
        type: 'player_joined',
        player
      });
      break;
    }

    case 'create_room': {
      const roomCode = generateRoomCode();
      const room = new Room(roomCode);

      room.setBroadcastCallback((msg) => {
        broadcastToRoom(roomCode, msg);
      });

      const player = room.addPlayer(socketId, data.playerName, data.chosenClass, false, data.profile, data.accountToken);
      rooms.set(roomCode, room);
      socketMeta.set(ws, { roomCode, playerId: socketId });

      ws.send(JSON.stringify({
        type: 'room_created',
        roomCode,
        player,
        room: room.getSnapshot()
      }));
      break;
    }

    case 'join_room': {
      const roomCode = (data.roomCode || '').toUpperCase().trim();
      const room = rooms.get(roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: `Chamber ${roomCode} not found. Use Quickplay Matchmaking to join an active match!` }));
        return;
      }
      // Phase 4 (workstream 4): rift rooms are tier-gated — joining a tier
      // you have not unlocked is tier-skipping by another door. Denied.
      if (room.riftTier > 0) {
        const joinAcc = authService.getAccountByToken(data.accountToken);
        const riftState = joinAcc ? Rift.ensureRift(joinAcc.profile) : null;
        if (!riftState || riftState.unlockedTier < room.riftTier) {
          ws.send(JSON.stringify({
            type: 'rift_denied',
            reason: `Rift Tier ${room.riftTier} is sealed for you. Clear Tier ${riftState ? riftState.unlockedTier : 0} first.`
          }));
          return;
        }
      }
      const player = room.addPlayer(socketId, data.playerName, data.chosenClass, false, data.profile, data.accountToken);
      socketMeta.set(ws, { roomCode, playerId: socketId });

      ws.send(JSON.stringify({
        type: 'room_joined',
        roomCode,
        player,
        room: room.getSnapshot()
      }));

      if (room.state === 'dungeon') {
        ws.send(JSON.stringify({
          type: 'dungeon_started',
          roomCode,
          snapshot: room.getSnapshot()
        }));
        if (room.proceduralConfig) {
          ws.send(JSON.stringify({
            type: 'procedural_floor_generated',
            config: room.proceduralConfig,
            proceduralConfig: room.proceduralConfig
          }));
        }
      }

      room.broadcast({
        type: 'player_joined',
        player
      });
      break;
    }

    // NEW (Phase 2): Create a private chamber — flagged private so it is
    // excluded from room_list and skipped by quickplay matchmaking.
    // Invite-only: friends join via join_room with the code (or invite link).
    case 'create_private_room': {
      const roomCode = generateRoomCode();
      const room = new Room(roomCode);
      room.isPrivate = true;

      room.setBroadcastCallback((msg) => {
        broadcastToRoom(roomCode, msg);
      });

      const player = room.addPlayer(socketId, data.playerName, data.chosenClass, false, data.profile, data.accountToken);
      rooms.set(roomCode, room);
      socketMeta.set(ws, { roomCode, playerId: socketId });

      ws.send(JSON.stringify({
        type: 'room_created',
        roomCode,
        player,
        room: room.getSnapshot(),
        private: true
      }));
      break;
    }

    case 'start_game': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'lobby') {
        room.startDungeon();
        for (const [clientWs, clientMeta] of socketMeta.entries()) {
          if (clientMeta.roomCode === meta.roomCode) {
            const p = room.players[clientMeta.playerId];
            if (p && p.secretObjective) {
              clientWs.send(JSON.stringify({
                type: 'secret_objective_assigned',
                objective: p.secretObjective
              }));
            }
          }
        }
        broadcastToRoom(meta.roomCode, {
          type: 'dungeon_started',
          snapshot: room.getSnapshot()
        });
      }
      break;
    }

    case 'generate_new_floor': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon') {
        room.generateProceduralDungeonFloor(data.floor, data.seed);
      }
      break;
    }

    case 'tactical_command': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon') {
        room.executeTacticalCommand(meta.playerId, data.command, data.targetPos || { x: data.x, z: data.z });
      }
      break;
    }

    case 'input':
    case 'player_input': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon') {
        room.handleInput(meta.playerId, data.input || data);
      }
      break;
    }

    case 'use_horn': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon' && typeof room.activateWarHorn === 'function') {
        room.activateWarHorn(meta.playerId);
      }
      break;
    }

    // Phase 3 loot & gear: server-authoritative equip/unequip. The client
    // sends only an itemId (equip) or slot (unequip); systems/Gear.js
    // validates ownership and recomputes stats. Forged ids are rejected.
    case 'gear_equip': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && typeof room.handleGearEquip === 'function') {
        room.handleGearEquip(meta.playerId, data.itemId);
      }
      break;
    }

    case 'gear_unequip': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && typeof room.handleGearUnequip === 'function') {
        room.handleGearUnequip(meta.playerId, data.slot);
      }
      break;
    }

    case 'ping': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.players[meta.playerId]) {
        const p = room.players[meta.playerId];
        broadcastToRoom(meta.roomCode, {
          type: 'party_ping',
          playerId: meta.playerId,
          playerName: p.name,
          pingType: data.pingType,
          x: p.x,
          z: p.z
        });
      }
      break;
    }

    // Phase 2: progression / oath message handlers.
    case 'ability_pick': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon' && Abilities && typeof Abilities.applyAbilityPick === 'function') {
        Abilities.applyAbilityPick(room, meta.playerId, String(data.abilityId || ''));
      }
      break;
    }

    case 'skill_tree_spend': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon' && Abilities && typeof Abilities.spendAbilityPoint === 'function') {
        Abilities.spendAbilityPoint(room, meta.playerId, String(data.abilityId || ''));
      }
      break;
    }

    case 'respawn_request': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon' && Health && typeof Health.requestRespawn === 'function') {
        Health.requestRespawn(room, meta.playerId);
      }
      break;
    }

    case 'swear_oath': {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (room && room.state === 'dungeon') {
        room.systems?.oaths?.handleSwear(room, meta.playerId, data.shrineId, data.oathId);
      }
      break;
    }

    // Phase 4 (workstream 4): Endless Rift — account rift state (keystones,
    // unlocked tier). Read from the server-side account record only.
    case 'rift_status': {
      const acc = authService.getAccountByToken(data.accountToken);
      if (!acc) {
        ws.send(JSON.stringify({ type: 'rift_status', ok: false, reason: 'Link your account to commune with the Rift.' }));
        return;
      }
      ws.send(JSON.stringify({ type: 'rift_status', ...Rift.publicStatus(acc.profile) }));
      break;
    }

    // Phase 4 (workstream 4): deterministic per-tier affix/scaling preview.
    // Computed server-side from the tier alone — never trusted from clients.
    case 'rift_tier_preview': {
      const acc = authService.getAccountByToken(data.accountToken);
      if (!acc) {
        ws.send(JSON.stringify({ type: 'rift_tier_preview', ok: false, reason: 'Link your account to commune with the Rift.' }));
        return;
      }
      const tier = Math.max(1, Math.min(Rift.MAX_TIER, Math.floor(Number(data.tier) || 1)));
      const r = Rift.ensureRift(acc.profile);
      const allowed = r.unlockedTier >= 1 && tier <= r.unlockedTier;
      ws.send(JSON.stringify({
        type: 'rift_tier_preview',
        ok: true,
        tier,
        affixes: Rift.publicAffixes(tier),
        scaling: Rift.scalingFor(tier),
        allowed,
        reason: !allowed
          ? (r.unlockedTier < 1
            ? 'The Rift is sealed. Defeat Malakor to earn your first keystone.'
            : `Clear Tier ${r.unlockedTier} to unlock Tier ${r.unlockedTier + 1}.`)
          : null
      }));
      break;
    }

    // Phase 4 (workstream 4): enter the Endless Rift. Full server-side
    // validation: account resolved from token, tier gate (no skipping),
    // keystone consumed OR Rift Pact sworn. Creates a dedicated rift room.
    case 'rift_start': {
      const acc = authService.getAccountByToken(data.accountToken);
      if (!acc) {
        ws.send(JSON.stringify({ type: 'rift_denied', reason: 'Link your account to enter the Rift.' }));
        return;
      }
      const tier = Math.max(1, Math.min(Rift.MAX_TIER, Math.floor(Number(data.tier) || 1)));
      const payment = data.payment === 'pact' ? 'pact' : 'keystone';
      const v = Rift.validateEntry(acc.profile, tier, payment);
      if (!v.ok) {
        ws.send(JSON.stringify({ type: 'rift_denied', reason: v.reason }));
        return;
      }
      if (!Rift.consumeEntry(acc.profile, payment)) {
        ws.send(JSON.stringify({ type: 'rift_denied', reason: 'The gate rejects your offering.' }));
        return;
      }
      authService.saveAccounts(); // atomic — keystone consumed before the room exists

      const roomCode = generateRoomCode();
      const room = new Room(roomCode);
      room.setBroadcastCallback((msg) => {
        broadcastToRoom(roomCode, msg);
      });
      // Rift state is set BEFORE startDungeon so spawns scale correctly.
      room.riftTier = v.tier;
      room.riftAffixes = Rift.affixesForTier(v.tier);
      room.riftPact = (payment === 'pact');

      const player = room.addPlayer(socketId, data.playerName, data.chosenClass, false, data.profile, data.accountToken);
      rooms.set(roomCode, room);
      socketMeta.set(ws, { roomCode, playerId: socketId });

      if (room.riftPact) Rift.applyPactToPlayer(room, player);
      room.startDungeon();

      ws.send(JSON.stringify({
        type: 'room_joined',
        roomCode,
        player,
        room: room.getSnapshot()
      }));
      ws.send(JSON.stringify({
        type: 'dungeon_started',
        roomCode,
        snapshot: room.getSnapshot()
      }));
      if (room.proceduralConfig) {
        ws.send(JSON.stringify({
          type: 'procedural_floor_generated',
          config: room.proceduralConfig,
          proceduralConfig: room.proceduralConfig
        }));
      }
      ws.send(JSON.stringify({
        type: 'rift_started',
        roomCode,
        tier: v.tier,
        affixes: Rift.publicAffixes(v.tier),
        scaling: Rift.scalingFor(v.tier),
        pact: room.riftPact,
        keystones: Rift.ensureRift(acc.profile).keystones
      }));
      room.broadcast({
        type: 'narrator_announcement',
        text: `🌀 ${player.name} descends into RIFT TIER ${v.tier}! Affixes: ${Rift.publicAffixes(v.tier).map(a => `${a.icon} ${a.name}`).join(' · ')}`,
        tone: 'danger'
      });
      break;
    }

    // PHASE 4 (workstream 2): coven live channel. Subscribers receive
    // 'coven_chat' whispers and 'coven_update' roster/XP pushes for their
    // coven. Auth resolved from the account token, never trusted from the
    // client. Chat text is validated and stored by CovenService (last 100
    // per coven, rate-limited, length-capped).
    case 'coven_subscribe': {
      const acc = authService.getAccountByToken(data.accountToken);
      if (!acc) {
        ws.send(JSON.stringify({ type: 'coven_subscribe', ok: false, reason: 'Link your account to hear your coven.' }));
        return;
      }
      const covenId = CovenService.getCovenIdForUser(acc.username);
      if (!covenId) {
        ws.send(JSON.stringify({ type: 'coven_subscribe', ok: false, reason: 'no_coven' }));
        return;
      }
      unsubscribeCovenSocket(ws);
      const meta = socketMeta.get(ws) || {};
      meta.accountUsername = acc.username;
      socketMeta.set(ws, meta);
      if (!covenSubscribers.has(covenId)) covenSubscribers.set(covenId, new Set());
      covenSubscribers.get(covenId).add(ws);
      covenSocketCoven.set(ws, covenId);
      ws.send(JSON.stringify({
        type: 'coven_subscribe',
        ok: true,
        covenId,
        state: CovenService.getCovenState({ username: acc.username })
      }));
      break;
    }

    case 'coven_chat': {
      const acc = authService.getAccountByToken(data.accountToken);
      if (!acc) {
        ws.send(JSON.stringify({ type: 'coven_chat', ok: false, reason: 'Link your account to whisper.' }));
        return;
      }
      const result = CovenService.sendChat({
        username: acc.username,
        displayName: acc.profile.displayName || acc.username,
        text: data.text
      });
      if (!result.ok) {
        ws.send(JSON.stringify({ type: 'coven_chat', ok: false, reason: result.error }));
        return;
      }
      broadcastToCoven(result.covenId, { type: 'coven_chat', covenId: result.covenId, message: result.message });
      break;
    }
  }
}

function broadcastToRoom(roomCode, messageObj) {
  const payload = JSON.stringify(messageObj);
  for (const [clientWs, meta] of socketMeta.entries()) {
    if (meta.roomCode === roomCode && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(payload);
    }
  }
}

// Authoritative 20Hz Server Game Loop
const TICK_RATE = 20;
setInterval(() => {
  const dt = 1 / TICK_RATE;
  for (const [roomCode, room] of rooms.entries()) {
    if (room.state === 'dungeon') {
      room.update(dt);
      broadcastToRoom(roomCode, {
        type: 'tick',
        snapshot: room.getSnapshot()
      });
    }
  }
}, 1000 / TICK_RATE);

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const { execSync } = require('child_process');
let retriedListen = false;

wss.on('error', () => {}); // Prevent unhandled error event on WebSocketServer during port takeover

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && !retriedListen) {
    retriedListen = true;
    console.log(`[Port ${PORT}] Taking over port ${PORT} from previous server instance...`);
    try {
      if (process.platform === 'win32') {
        execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne ${process.pid} -and $_.OwningProcess -gt 0 } | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
      }
    } catch (e) {}
    setTimeout(() => {
      server.listen(PORT, '0.0.0.0');
    }, 600);
  } else {
    console.error('[Server Error]', err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n======================================================');
  console.log('🗡️  DUNGEON OF THE COVENANT - MULTIPLAYER RPG SERVER 🛡️');
  console.log('======================================================');
  console.log(` Local Browser:   http://localhost:${PORT}`);
  console.log(` Phone / Wi-Fi:   http://${ip}:${PORT}`);
  console.log('======================================================\n');
});
