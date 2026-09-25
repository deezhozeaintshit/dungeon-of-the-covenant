// network.js - Real-Time WebSocket Communication & Event Routing
export class NetworkClient {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    // Phase 2: secondary subscribers (UI modules) that do not own the primary
    // callback map. handleMessage dispatches to primary callbacks first, then
    // to every registered listener for the message type.
    this.listeners = {};
    this.ws = null;
    this.connected = false;
    this.queue = [];
    this.connect();
  }

  // Subscribe an extra handler for a ws message type without disturbing the
  // primary callback registered in the constructor.
  on(type, cb) {
    if (typeof cb !== 'function') return () => {};
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
    return () => this.off(type, cb);
  }

  off(type, cb) {
    const arr = this.listeners[type];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i !== -1) arr.splice(i, 1);
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      console.log('Connected to Covenant Game Server.');
      if (this.callbacks.on_connect) this.callbacks.on_connect();
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        this.ws.send(JSON.stringify(item));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.log('Disconnected from Game Server. Reconnecting in 2s...');
      if (this.callbacks.on_disconnect) this.callbacks.on_disconnect();
      setTimeout(() => this.connect(), 2000);
    };
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      this.queue.push(data);
    }
  }

  quickplayMatchmaking(playerName, chosenClass, profile = null, accountToken = null) {
    this.send({ type: 'quickplay_matchmaking', playerName, chosenClass, profile, accountToken });
  }

  createRoom(playerName, chosenClass, profile = null, accountToken = null) {
    this.send({ type: 'create_room', playerName, chosenClass, profile, accountToken });
  }

  // Phase 2: private (invite-only) chamber — excluded from room_list and
  // skipped by quickplay matchmaking.
  createPrivateRoom(playerName, chosenClass, profile = null, accountToken = null) {
    this.send({ type: 'create_private_room', playerName, chosenClass, profile, accountToken });
  }

  // Phase 2: ask the server for the public lobby browser list.
  listRooms() {
    this.send({ type: 'list_rooms' });
  }

  joinRoom(roomCode, playerName, chosenClass, profile = null, accountToken = null) {
    this.send({ type: 'join_room', roomCode, playerName, chosenClass, profile, accountToken });
  }

  startGame() {
    this.send({ type: 'start_game' });
  }

  sendInput(inputData) {
    this.send({ type: 'input', ...inputData });
  }

  useWarHorn() {
    this.send({ type: 'use_horn' });
  }

  // Phase 3 gear: only the itemId (equip) or slot (unequip) is sent.
  // Stats are never sent — the server validates and recomputes everything.
  equipItem(itemId) {
    this.send({ type: 'gear_equip', itemId });
  }

  unequipItem(slot) {
    this.send({ type: 'gear_unequip', slot });
  }

  handleMessage(msg) {
    if (this.callbacks[msg.type]) {
      try {
        this.callbacks[msg.type](msg);
      } catch (err) {
        console.error(`[network] primary handler for ${msg.type} threw:`, err);
      }
    }
    const extra = this.listeners[msg.type];
    if (extra) {
      for (const cb of extra.slice()) {
        try {
          cb(msg);
        } catch (err) {
          console.error(`[network] listener for ${msg.type} threw:`, err);
        }
      }
    }
  }
}
