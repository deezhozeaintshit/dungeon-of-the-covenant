// LoadTest.js - Stress test for multiplayer scenarios
// Tests server capacity under load

const WebSocket = require('ws');

class LoadTest {
  constructor(serverUrl = 'ws://localhost:3000') {
    this.serverUrl = serverUrl;
    this.clients = [];
    this.startTime = 0;
    this.messagesSent = 0;
    this.messagesReceived = 0;
    this.errors = 0;
    this.results = {
      maxConcurrentClients: 0,
      messagesPerSecond: 0,
      averageLatency: 0,
      errorRate: 0
    };
  }

  // Run load test
  async runTest(config) {
    const {
      clientCount = 10,
      duration = 30000,
      messageRate = 10,
      testPhase = 'all' // 'connect', 'sustain', 'climb', 'all'
    } = config;

    console.log('\n=== LOAD TEST CONFIGURATION ===');
    console.log(`Clients: ${clientCount}`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Message Rate: ${messageRate}/s`);
    console.log(`Test Phase: ${testPhase}`);
    console.log('================================\n');

    this.startTime = Date.now();
    this.messagesSent = 0;
    this.messagesReceived = 0;
    this.errors = 0;

    if (testPhase === 'connect' || testPhase === 'all') {
      await this.testConnectivity(clientCount);
    }

    if (testPhase === 'sustain' || testPhase === 'all') {
      await this.testSustainedLoad(clientCount, messageRate, duration);
    }

    if (testPhase === 'climb' || testPhase === 'all') {
      await this.testClimbingLoad();
    }

    this.calculateResults();
    this.printReport();
  }

  // Test connectivity under load
  async testConnectivity(clientCount) {
    console.log(`\n🧪 Testing connectivity with ${clientCount} simultaneous clients...`);

    const connections = await Promise.all(
      Array.from({ length: clientCount }, (_, i) => this.connectClient(i))
    );

    const successful = connections.filter(c => c !== null).length;
    console.log(`  ✅ Connected: ${successful}/${clientCount}`);
    console.log(`  ❌ Failed: ${clientCount - successful}/${clientCount}`);

    this.results.maxConcurrentClients = successful;

    // Close all connections
    this.clients.forEach(c => c.close());
    this.clients = [];
  }

  // Connect a single client
  connectClient(index) {
    return new Promise((resolve) => {
      const client = new WebSocket(this.serverUrl);

      client.on('open', () => {
        this.clients.push(client);
        resolve(client);
      });

      client.on('error', () => {
        this.errors++;
        resolve(null);
      });

      client.on('close', () => {
        const idx = this.clients.indexOf(client);
        if (idx > -1) this.clients.splice(idx, 1);
      });

      // Timeout
      setTimeout(() => {
        if (this.clients.includes(client)) {
          client.close();
          resolve(null);
        }
      }, 5000);
    });
  }

  // Test sustained load
  async testSustainedLoad(clientCount, messageRate, duration) {
    console.log(`\n🧪 Testing sustained load: ${clientCount} clients, ${messageRate} msg/s for ${duration}ms`);

    // Connect clients
    const connections = await Promise.all(
      Array.from({ length: clientCount }, (_, i) => this.connectClient(i))
    );

    const activeClients = connections.filter(c => c !== null);
    console.log(`  ✅ ${activeClients.length} clients connected`);

    if (activeClients.length === 0) {
      console.log('  ❌ No clients connected, skipping load test');
      return;
    }

    // Start sending messages
    const interval = setInterval(() => {
      for (const client of activeClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'input',
            movement: {
              x: Math.random() - 0.5,
              z: Math.random() - 0.5
            },
            rotation: Math.random() * Math.PI * 2
          }));
          this.messagesSent++;
        }
      }
    }, 1000 / messageRate);

    // Monitor for duration
    await new Promise(resolve => setTimeout(resolve, duration));
    clearInterval(interval);

    // Calculate messages per second
    this.results.messagesPerSecond = this.messagesSent / (duration / 1000);
    console.log(`  📊 Messages/sec: ${this.results.messagesPerSecond.toFixed(1)}`);

    // Close connections
    activeClients.forEach(c => c.close());
    this.clients = [];
  }

  // Test climbing load (gradually increase clients)
  async testClimbingLoad() {
    console.log('\n🧪 Testing climbing load (gradual increase)...');

    const maxClients = 50;
    const step = 5;
    let lastSuccessful = 0;

    for (let i = step; i <= maxClients; i += step) {
      console.log(`  Testing ${i} concurrent clients...`);

      const connections = await Promise.all(
        Array.from({ length: step }, () => this.connectClient(i))
      );

      const successful = connections.filter(c => c !== null).length;
      lastSuccessful += successful;

      if (successful === 0) {
        console.log(`  ❌ Connection failed at ${i} clients`);
        break;
      }

      // Brief pause
      await new Promise(resolve => setTimeout(resolve, 500));

      // Close these batch
      this.clients.slice(-step).forEach(c => c.close());
      this.clients.splice(-step);
    }

    console.log(`  📊 Peak concurrent clients: ${lastSuccessful}`);
    this.results.maxConcurrentClients = lastSuccessful;
  }

  // Calculate results
  calculateResults() {
    const duration = (Date.now() - this.startTime) / 1000;
    
    this.results.duration = duration;
    this.results.totalMessages = this.messagesSent;
    this.results.messagesPerSecond = this.messagesSent / duration;
    this.results.errorRate = this.errors / (this.messagesSent + this.errors);
    this.results.averageLatency = 0; // Would need ping/pong implementation
  }

  // Print report
  printReport() {
    console.log('\n=== LOAD TEST REPORT ===\n');
    console.log(`Duration: ${this.results.duration?.toFixed(1) || 'N/A'}s`);
    console.log(`Max Concurrent Clients: ${this.results.maxConcurrentClients}`);
    console.log(`Total Messages: ${this.results.totalMessages?.toLocaleString() || 0}`);
    console.log(`Messages/sec: ${this.results.messagesPerSecond?.toFixed(1) || 0}`);
    console.log(`Error Rate: ${(this.results.errorRate * 100).toFixed(2)}%`);
    console.log(`Average Latency: ${this.results.averageLatency?.toFixed(0) || 'N/A'}ms`);
    console.log('\n========================\n');

    // Generate HTML report
    this.generateHTMLReport();
  }

  // Generate HTML report
  generateHTMLReport() {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Load Test Report - Dungeon of the Covenant</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #ffd700; }
    .metric { background: #16213e; padding: 15px; margin: 10px 0; border-radius: 8px; }
    .metric h3 { margin-top: 0; color: #ffd700; }
    .metric p { margin: 5px 0; font-size: 18px; }
    .good { color: #2ecc71; }
    .warning { color: #f39c12; }
    .bad { color: #e74c3c; }
  </style>
</head>
<body>
  <h1>📊 Load Test Report</h1>
  <p>Generated: ${new Date().toLocaleString()}</p>
  
  <div class="metric">
    <h3>Performance Metrics</h3>
    <p>Duration: ${this.results.duration?.toFixed(1) || 'N/A'}s</p>
    <p>Max Concurrent Clients: <span class="${this.results.maxConcurrentClients >= 20 ? 'good' : this.results.maxConcurrentClients >= 10 ? 'warning' : 'bad'}">${this.results.maxConcurrentClients}</span></p>
    <p>Total Messages: ${this.results.totalMessages?.toLocaleString() || 0}</p>
    <p>Messages/sec: <span class="${this.results.messagesPerSecond >= 1000 ? 'good' : this.results.messagesPerSecond >= 500 ? 'warning' : 'bad'}">${this.results.messagesPerSecond?.toFixed(1) || 0}</span></p>
    <p>Error Rate: <span class="${this.results.errorRate < 0.01 ? 'good' : this.results.errorRate < 0.05 ? 'warning' : 'bad'}">${(this.results.errorRate * 100).toFixed(2)}%</span></p>
    <p>Average Latency: ${this.results.averageLatency?.toFixed(0) || 'N/A'}ms</p>
  </div>

  <div class="metric">
    <h3>Server Capacity</h3>
    <p>Recommended Max Players: ${Math.floor(this.results.maxConcurrentClients * 0.7)}</p>
    <p>Stress Threshold: ${this.results.maxConcurrentClients >= 30 ? 'High' : this.results.maxConcurrentClients >= 15 ? 'Medium' : 'Low'}</p>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'load_test_report.html';
    a.click();
    URL.revokeObjectURL(url);
  }
}

if (require.main === module) {
  const test = new LoadTest(process.argv[2] || 'ws://localhost:3000');
  test.runTest({
    clientCount: parseInt(process.argv[3]) || 10,
    duration: parseInt(process.argv[4]) || 30000,
    messageRate: parseInt(process.argv[5]) || 10
  }).catch(console.error);
}

module.exports = LoadTest;
