// PerformanceTest.js - Benchmark suite for RPG Crawler
// Measures FPS, memory usage, and system load

class PerformanceTest {
  constructor() {
    this.results = {
      fps: { avg: 0, min: Infinity, max: 0, samples: [] },
      memory: { jsHeapSize: 0, totalHeapSize: 0, usedHeapSize: 0 },
      drawCalls: 0,
      triangles: 0,
      entities: 0,
      physicsUpdates: 0,
      networkMessages: 0
    };
    this.startTime = 0;
    this.frameCount = 0;
    this.testRunning = false;
  }

  // Start benchmark test
  startTest() {
    this.testRunning = true;
    this.startTime = performance.now();
    this.frameCount = 0;
    this.results.fps.samples = [];
    this.results.fps.min = Infinity;
    this.results.fps.max = 0;
    console.log('PerformanceTest: Benchmark started');
  }

  // Stop benchmark test
  stopTest() {
    this.testRunning = false;
    const duration = (performance.now() - this.startTime) / 1000;
    this.results.fps.avg = Math.round(this.frameCount / duration);
    this.results.duration = duration;
    console.log('PerformanceTest: Benchmark complete');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Average FPS: ${this.results.fps.avg}`);
    console.log(`Min FPS: ${this.results.fps.min}`);
    console.log(`Max FPS: ${this.results.fps.max}`);
    this.printReport();
  }

  // Record frame data
  recordFrame(renderer, entityCount, physicsChecks, networkMsgs) {
    if (!this.testRunning) return;

    this.frameCount++;

    // FPS calculation
    const now = performance.now();
    const fps = 1000 / (now - (this.lastFrameTime || now));
    this.lastFrameTime = now;

    if (fps < this.results.fps.min) this.results.fps.min = fps;
    if (fps > this.results.fps.max) this.results.fps.max = fps;
    this.results.fps.samples.push(fps);

    // Store renderer stats
    if (renderer) {
      this.results.drawCalls = renderer.info.render.calls;
      this.results.triangles = renderer.info.render.triangles;
    }

    this.results.entities = entityCount;
    this.results.physicsUpdates = physicsChecks;
    this.results.networkMessages = networkMsgs;

    // Memory (if available)
    if (performance.memory) {
      this.results.memory.jsHeapSize = performance.memory.jsHeapSizeUsed;
      this.results.memory.totalHeapSize = performance.memory.totalJSHeapSize;
      this.results.memory.usedHeapSize = performance.memory.usedJSHeapSize;
    }
  }

  // Print detailed report
  printReport() {
    console.log('\n=== PERFORMANCE REPORT ===');
    console.log(`Duration: ${this.results.duration?.toFixed(2) || 'N/A'}s`);
    console.log(`Average FPS: ${this.results.fps.avg}`);
    console.log(`Min FPS: ${this.results.fps.min === Infinity ? 'N/A' : this.results.fps.min.toFixed(1)}`);
    console.log(`Max FPS: ${this.results.fps.max}`);
    console.log(`Draw Calls: ${this.results.drawCalls}`);
    console.log(`Triangles: ${this.results.triangles.toLocaleString()}`);
    console.log(`Entities: ${this.results.entities}`);
    console.log(`Physics Updates: ${this.results.physicsUpdates}`);
    console.log(`Network Messages: ${this.results.networkMessages}`);

    if (this.results.memory.jsHeapSize) {
      console.log(`JS Heap Used: ${(this.results.memory.jsHeapSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Total Heap: ${(this.results.memory.totalHeapSize / 1024 / 1024).toFixed(2)} MB`);
    }

    console.log('========================\n');
  }

  // Generate HTML report
  generateHTMLReport(filename = 'performance_report.html') {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Performance Report - Dungeon of the Covenant</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #ffd700; }
    .metric { background: #16213e; padding: 15px; margin: 10px 0; border-radius: 8px; }
    .metric h3 { margin-top: 0; color: #ffd700; }
    .metric p { margin: 5px 0; }
    .good { color: #2ecc71; }
    .warning { color: #f39c12; }
    .bad { color: #e74c3c; }
  </style>
</head>
<body>
  <h1>🎮 Performance Report</h1>
  <p>Generated: ${new Date().toLocaleString()}</p>
  
  <div class="metric">
    <h3>Frame Rate</h3>
    <p>Average FPS: <span class="${this.results.fps.avg >= 55 ? 'good' : this.results.fps.avg >= 30 ? 'warning' : 'bad'}">${this.results.fps.avg}</span></p>
    <p>Min FPS: <span class="${this.results.fps.min >= 45 ? 'good' : this.results.fps.min >= 25 ? 'warning' : 'bad'}">${this.results.fps.min === Infinity ? 'N/A' : this.results.fps.min.toFixed(1)}</span></p>
    <p>Max FPS: ${this.results.fps.max}</p>
  </div>

  <div class="metric">
    <h3>Rendering</h3>
    <p>Draw Calls: ${this.results.drawCalls}</p>
    <p>Triangles: ${this.results.triangles.toLocaleString()}</p>
  </div>

  <div class="metric">
    <h3>Entities</h3>
    <p>Active Entities: ${this.results.entities}</p>
    <p>Physics Updates: ${this.results.physicsUpdates}</p>
  </div>

  <div class="metric">
    <h3>Network</h3>
    <p>Messages Processed: ${this.results.networkMessages}</p>
  </div>

  ${this.results.memory.jsHeapSize ? `
  <div class="metric">
    <h3>Memory</h3>
    <p>JS Heap Used: ${(this.results.memory.jsHeapSize / 1024 / 1024).toFixed(2)} MB</p>
    <p>Total Heap: ${(this.results.memory.totalHeapSize / 1024 / 1024).toFixed(2)} MB</p>
  </div>
  ` : ''}

  <div class="metric">
    <h3>Test Configuration</h3>
    <p>Duration: ${this.results.duration?.toFixed(2) || 'N/A'} seconds</p>
    <p>Frame Count: ${this.results.frameCount.toLocaleString()}</p>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerformanceTest;
}
