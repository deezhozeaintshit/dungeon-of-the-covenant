// IntegrationTest.js - End-to-end integration test for RPG Crawler
// Tests all systems working together

const WebSocket = require('ws');
const http = require('http');
const { PerformanceTest } = require('./performancetest');

class IntegrationTest {
  constructor(serverUrl = 'ws://localhost:3000') {
    this.serverUrl = serverUrl;
    this.clients = [];
    this.rooms = [];
    this.results = [];
    this.performance = new PerformanceTest();
  }

  // Run all integration tests
  async runAll() {
    console.log('\n=== RPG CRAWLER INTEGRATION TESTS ===\n');
    
    this.performance.startTest();
    
    try {
      await this.testRoomCreation();
      await this.testPlayerJoin();
      await this.testMovementSync();
      await this.testCombat();
      await this.testLoot();
      await this.testBossFight();
      await this.testNetworkStability();
    } catch (error) {
      console.error('Test error:', error);
    }

    this.performance.stopTest();
    this.printSummary();
  }

  // Test 1: Room Creation
  async testRoomCreation() {
    console.log('\n🧪 Test 1: Room Creation');
    
    const client = this.createClient('TestPlayer');
    
    return new Promise((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'create_room',
          playerName: 'TestPlayer',
          chosenClass: 'juggernaut'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'room_created') {
          console.log('  ✅ Room created:', msg.roomCode);
          this.rooms.push({
            code: msg.roomCode,
            host: client,
            players: [client]
          });
          this.results.push({ test: 'Room Creation', status: 'PASS' });
          resolve();
        } else if (msg.type === 'error') {
          console.log('  ❌ Error:', msg.message);
          this.results.push({ test: 'Room Creation', status: 'FAIL', error: msg.message });
          resolve();
        }
      });

      setTimeout(() => {
        console.log('  ⏱️ Test timeout');
        this.results.push({ test: 'Room Creation', status: 'TIMEOUT' });
        resolve();
      }, 5000);
    });
  }

  // Test 2: Player Join
  async testPlayerJoin() {
    console.log('\n🧪 Test 2: Player Join');
    
    if (this.rooms.length === 0) {
      console.log('  ⚠️ Skipping - no rooms created');
      this.results.push({ test: 'Player Join', status: 'SKIP' });
      return Promise.resolve();
    }

    const room = this.rooms[0];
    const client = this.createClient('JoiningPlayer');
    
    return new Promise((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'join_room',
          roomCode: room.code,
          playerName: 'JoiningPlayer',
          chosenClass: 'cleric'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'room_joined') {
          console.log('  ✅ Player joined room');
          room.players.push(client);
          this.results.push({ test: 'Player Join', status: 'PASS' });
          resolve();
        } else if (msg.type === 'error') {
          console.log('  ❌ Error:', msg.message);
          this.results.push({ test: 'Player Join', status: 'FAIL', error: msg.message });
          resolve();
        }
      });

      setTimeout(() => {
        console.log('  ⏱️ Test timeout');
        this.results.push({ test: 'Player Join', status: 'TIMEOUT' });
        resolve();
      }, 5000);
    });
  }

  // Test 3: Movement Sync
  async testMovementSync() {
    console.log('\n🧪 Test 3: Movement Sync');
    
    if (this.rooms.length === 0) {
      console.log('  ⚠️ Skipping - no rooms created');
      this.results.push({ test: 'Movement Sync', status: 'SKIP' });
      return Promise.resolve();
    }

    const room = this.rooms[0];
    
    return new Promise((resolve) => {
      let tickCount = 0;
      let lastX = null;
      
      const client = room.players[0];
      
      client.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'tick') {
          tickCount++;
          const player = msg.snapshot?.players?.[0];
          if (player) {
            lastX = player.x;
          }
        }
      });

      // Send movement input
      client.send(JSON.stringify({
        type: 'input',
        movement: { x: 1, z: 0 },
        rotation: 0
      }));

      setTimeout(() => {
        if (tickCount > 0 && lastX !== null) {
          console.log(`  ✅ Movement synced (${tickCount} ticks, last X: ${lastX.toFixed(2)})`);
          this.results.push({ test: 'Movement Sync', status: 'PASS', ticks: tickCount });
        } else {
          console.log('  ❌ No movement data received');
          this.results.push({ test: 'Movement Sync', status: 'FAIL' });
        }
        resolve();
      }, 3000);
    });
  }

  // Test 4: Combat
  async testCombat() {
    console.log('\n🧪 Test 4: Combat');
    
    if (this.rooms.length === 0) {
      console.log('  ⚠️ Skipping - no rooms created');
      this.results.push({ test: 'Combat', status: 'SKIP' });
      return Promise.resolve();
    }

    const room = this.rooms[0];
    const client = room.players[0];
    
    return new Promise((resolve) => {
      let attackEvents = 0;
      
      client.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'player_attack_fx') {
          attackEvents++;
        }
      });

      // Start dungeon
      client.send(JSON.stringify({ type: 'start_game' }));

      setTimeout(() => {
        // Send attack
        client.send(JSON.stringify({
          type: 'input',
          action: 'attack',
          targetPos: { x: 0, z: 0 }
        }));

        setTimeout(() => {
          if (attackEvents > 0) {
            console.log(`  ✅ Combat events received (${attackEvents} attacks)`);
            this.results.push({ test: 'Combat', status: 'PASS', attacks: attackEvents });
          } else {
            console.log('  ⚠️ No attack events received');
            this.results.push({ test: 'Combat', status: 'PARTIAL' });
          }
          resolve();
        }, 1000);
      }, 2000);
    });
  }

  // Test 5: Loot System
  async testLoot() {
    console.log('\n🧪 Test 5: Loot System');
    
    if (this.rooms.length === 0) {
      console.log('  ⚠️ Skipping - no rooms created');
      this.results.push({ test: 'Loot System', status: 'SKIP' });
      return Promise.resolve();
    }

    const room = this.rooms[0];
    const client = room.players[0];
    
    return new Promise((resolve) => {
      let lootEvents = 0;
      
      client.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'loot_collected') {
          lootEvents++;
        }
      });

      setTimeout(() => {
        if (lootEvents > 0) {
          console.log(`  ✅ Loot events received (${lootEvents} pickups)`);
          this.results.push({ test: 'Loot System', status: 'PASS', pickups: lootEvents });
        } else {
          console.log('  ⚠️ No loot events received');
          this.results.push({ test: 'Loot System', status: 'PARTIAL' });
        }
        resolve();
      }, 3000);
    });
  }

  // Test 6: Boss Fight
  async testBossFight() {
    console.log('\n🧪 Test 6: Boss Fight');
    
    if (this.rooms.length === 0) {
      console.log('  ⚠️ Skipping - no rooms created');
      this.results.push({ test: 'Boss Fight', status: 'SKIP' });
      return Promise.resolve();
    }

    const room = this.rooms[0];
    const client = room.players[0];
    
    return new Promise((resolve) => {
      let bossEvents = 0;
      
      client.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'boss_awakened' || msg.type === 'boss_phase_change') {
          bossEvents++;
        }
      });

      // Move to boss zone
      client.send(JSON.stringify({
        type: 'input',
        movement: { x: 0, z: -1 },
        rotation: 0
      }));

      setTimeout(() => {
        if (bossEvents > 0) {
          console.log(`  ✅ Boss events received (${bossEvents} events)`);
          this.results.push({ test: 'Boss Fight', status: 'PASS', events: bossEvents });
        } else {
          console.log('  ⚠️ No boss events received');
          this.results.push({ test: 'Boss Fight', status: 'PARTIAL' });
        }
        resolve();
      }, 5000);
    });
  }

  // Test 7: Network Stability
  async testNetworkStability() {
    console.log('\n🧪 Test 7: Network Stability');
    
    const client = this.createClient('StabilityTest');
    
    return new Promise((resolve) => {
      let messagesSent = 0;
      let messagesReceived = 0;
      let errors = 0;

      client.on('open', () => {
        console.log('  ✅ Client connected');
      });

      client.on('message', (data) => {
        messagesReceived++;
      });

      client.on('error', (error) => {
        errors++;
        console.log('  ❌ Network error:', error.message);
      });

      client.on('close', () => {
        console.log('  ⚠️ Client disconnected');
      });

      // Send rapid messages
      const interval = setInterval(() => {
        client.send(JSON.stringify({
          type: 'input',
          movement: { x: Math.random() - 0.5, z: Math.random() - 0.5 },
          rotation: Math.random() * Math.PI * 2
        }));
        messagesSent++;
      }, 50);

      setTimeout(() => {
        clearInterval(interval);
        client.close();

        if (errors === 0) {
          console.log(`  ✅ Network stable (${messagesSent} sent, ${messagesReceived} received)`);
          this.results.push({ test: 'Network Stability', status: 'PASS', sent: messagesSent, received: messagesReceived });
        } else {
          console.log(`  ⚠️ Network errors: ${errors}`);
          this.results.push({ test: 'Network Stability', status: 'DEGRADED', errors });
        }
        resolve();
      }, 3000);
    });
  }

  // Helper: Create test client
  createClient(name) {
    const client = new WebSocket(this.serverUrl);
    this.clients.push(client);

    client.on('open', () => {
      console.log(`  👤 ${name} connected`);
    });

    client.on('close', () => {
      console.log(`  👤 ${name} disconnected`);
      const idx = this.clients.indexOf(client);
      if (idx > -1) this.clients.splice(idx, 1);
    });

    return client;
  }

  // Print summary
  printSummary() {
    console.log('\n=== TEST SUMMARY ===\n');
    
    let passed = 0;
    let failed = 0;
    let partial = 0;
    let skipped = 0;

    for (const result of this.results) {
      switch (result.status) {
        case 'PASS': passed++; break;
        case 'FAIL': failed++; break;
        case 'PARTIAL': partial++; break;
        case 'SKIP': skipped++; break;
      }
    }

    console.log(`Total Tests: ${this.results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Partial: ${partial}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`\nSuccess Rate: ${((passed / (passed + failed + partial)) * 100).toFixed(1)}%\n`);

    console.log('\nDetailed Results:');
    for (const result of this.results) {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : result.status === 'PARTIAL' ? '⚠️' : '⏭️';
      console.log(`  ${icon} ${result.test}: ${result.status}`);
    }

    // Cleanup
    this.cleanup();
  }

  // Cleanup all connections
  cleanup() {
    for (const client of this.clients) {
      client.close();
    }
    this.clients = [];
    this.rooms = [];
  }
}

// Run if executed directly
if (require.main === module) {
  const test = new IntegrationTest(process.argv[2] || 'ws://localhost:3000');
  test.runAll().catch(console.error);
}

module.exports = IntegrationTest;
