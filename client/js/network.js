// network.js - Real-Time WebSocket Communication & Event Routing
export class NetworkClient {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.ws = null;
    this.connected = false;
    this.queue = [];
    this.connect();
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

  quickplayMatchmaking(playerName, chosenClass, profile = null) {
    this.send({ type: 'quickplay_matchmaking', playerName, chosenClass, profile });
  }

  createRoom(playerName, chosenClass, profile = null) {
    this.send({ type: 'create_room', playerName, chosenClass, profile });
  }

  joinRoom(roomCode, playerName, chosenClass, profile = null) {
    this.send({ type: 'join_room', roomCode, playerName, chosenClass, profile });
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

  submitLootRoll(choice) {
    this.send({ type: 'loot_roll', choice });
  }

  handleMessage(msg) {
    if (this.callbacks[msg.type]) {
      this.callbacks[msg.type](msg);
    }
  }
}
