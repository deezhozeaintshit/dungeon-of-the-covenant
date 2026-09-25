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
