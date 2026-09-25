// GameLoopBenchmark.js - FPS and frame timing benchmark
// Tests rendering performance under various conditions

class GameLoopBenchmark {
  constructor() {
    this.fpsHistory = [];
    this.frameTimes = [];
    this.maxHistory = 300;
    this.isRunning = false;
    this.startTime = 0;
    this.frameCount = 0;
    this.stats = {
      minFPS: Infinity,
      maxFPS: 0,
      avgFPS: 0,
      frameTimeMin: Infinity,
      frameTimeMax: 0,
      frameTimeAvg: 0
    };
    this.listeners = {
      onBenchmarkComplete: [],
      onFPSSample: []
    };
  }

  // Start benchmark
  start() {
    this.isRunning = true;
    this.startTime = performance.now();
    this.frameCount = 0;
    this.fpsHistory = [];
    this.frameTimes = [];
    console.log('GameLoopBenchmark: Started');
  }

  // Stop benchmark
  stop() {
    this.isRunning = false;
    const duration = (performance.now() - this.startTime) / 1000;
    
    this.stats.avgFPS = this.fpsHistory.length > 0 
      ? this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length
      : 0;
    this.stats.minFPS = this.fpsHistory.length > 0 ? Math.min(...this.fpsHistory) : 0;
    this.stats.maxFPS = this.fpsHistory.length > 0 ? Math.max(...this.fpsHistory) : 0;
    
    if (this.frameTimes.length > 0) {
      this.stats.frameTimeAvg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.stats.frameTimeMin = Math.min(...this.frameTimes);
      this.stats.frameTimeMax = Math.max(...this.frameTimes);
    }

    console.log('GameLoopBenchmark: Complete');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Average FPS: ${this.stats.avgFPS.toFixed(1)}`);
    console.log(`Min FPS: ${this.stats.minFPS.toFixed(1)}`);
    console.log(`Max FPS: ${this.stats.maxFPS.toFixed(1)}`);
    
    this.notifyListeners('onBenchmarkComplete', { ...this.stats, duration });
  }

  // Record a frame
  recordFrame(deltaTime) {
    if (!this.isRunning) return;

    this.frameCount++;
    
    const fps = 1000 / deltaTime;
    this.fpsHistory.push(fps);
    this.frameTimes.push(deltaTime);

    if (this.fpsHistory.length > this.maxHistory) {
      this.fpsHistory.shift();
    }
    if (this.frameTimes.length > this.maxHistory) {
      this.frameTimes.shift();
    }

    this.notifyListeners('onFPSSample', { fps, deltaTime });
  }

  // Get performance tier
  getPerformanceTier() {
    const avg = this.stats.avgFPS || 0;
    if (avg >= 55) return 'excellent';
    if (avg >= 45) return 'good';
    if (avg >= 30) return 'acceptable';
    return 'poor';
  }

  // Get optimization suggestions
  getSuggestions() {
    const suggestions = [];
    const tier = this.getPerformanceTier();

    if (tier === 'poor' || tier === 'acceptable') {
      suggestions.push('Reduce particle count by 50%');
      suggestions.push('Disable bloom post-processing');
      suggestions.push('Lower shadow quality to medium or low');
      suggestions.push('Reduce fog density');
      suggestions.push('Enable spatial partitioning for collision');
    }

    if (this.stats.frameTimeMax > 33) {
      suggestions.push('Frame spikes detected (>33ms) - check for GC pauses');
    }

    if (this.stats.minFPS < 20) {
      suggestions.push('Severe FPS drops detected - check entity count');
    }

    return suggestions;
  }

  // Generate report
  generateReport(filename = 'benchmark_report.html') {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Benchmark Report - Dungeon of the Covenant</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #ffd700; }
    .metric { background: #16213e; padding: 15px; margin: 10px 0; border-radius: 8px; }
    .metric h3 { margin-top: 0; color: #ffd700; }
    .metric p { margin: 5px 0; font-size: 18px; }
    .good { color: #2ecc71; }
    .warning { color: #f39c12; }
    .bad { color: #e74c3c; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #333; }
  </style>
</head>
<body>
  <h1>🎮 Benchmark Report</h1>
  <p>Generated: ${new Date().toLocaleString()}</p>
  
  <div class="metric">
    <h3>Frame Rate Performance</h3>
    <p>Average FPS: <span class="${this.stats.avgFPS >= 55 ? 'good' : this.stats.avgFPS >= 30 ? 'warning' : 'bad'}">${this.stats.avgFPS.toFixed(1)}</span></p>
    <p>Min FPS: <span class="${this.stats.minFPS >= 45 ? 'good' : this.stats.minFPS >= 25 ? 'warning' : 'bad'}">${this.stats.minFPS.toFixed(1)}</span></p>
    <p>Max FPS: ${this.stats.maxFPS.toFixed(1)}</p>
    <p>Frame Time Avg: ${this.stats.frameTimeAvg?.toFixed(2) || 'N/A'}ms</p>
    <p>Frame Time Min: ${this.stats.frameTimeMin === Infinity ? 'N/A' : this.stats.frameTimeMin.toFixed(2)}ms</p>
    <p>Frame Time Max: ${this.stats.frameTimeMax || 'N/A'}ms</p>
  </div>

  <div class="metric">
    <h3>Performance Tier</h3>
    <p>${this.getPerformanceTier().toUpperCase()}</p>
  </div>

  <div class="metric">
    <h3>Optimization Suggestions</h3>
    <ul>
      ${this.getSuggestions().map(s => `<li>${s}</li>`).join('')}
    </ul>
  </div>

  <div class="metric">
    <h3>FPS Distribution</h3>
    <table>
      <tr><th>Range</th><th>Percentage</th></tr>
      <tr><td>>= 60 FPS</td><td>${this.getPercentile(60).toFixed(1)}%</td></tr>
      <tr><td>45-60 FPS</td><td>${(this.getPercentile(45) - this.getPercentile(60)).toFixed(1)}%</td></tr>
      <tr><td>30-45 FPS</td><td>${(this.getPercentile(30) - this.getPercentile(45)).toFixed(1)}%</td></tr>
      <tr><td>< 30 FPS</td><td>${(100 - this.getPercentile(30)).toFixed(1)}%</td></tr>
    </table>
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

  // Get percentile
  getPercentile(targetFPS) {
    if (this.fpsHistory.length === 0) return 0;
    const sorted = [...this.fpsHistory].sort((a, b) => a - b);
    const index = Math.floor((targetFPS / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)] >= targetFPS 
      ? ((sorted.length - index) / sorted.length) * 100 
      : 0;
  }

  // Register event listener
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  // Remove event listener
  off(event, callback) {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(callback);
      if (idx !== -1) {
        this.listeners[event].splice(idx, 1);
      }
    }
  }

  // Notify all listeners
  notifyListeners(event, data) {
    const callbacks = this.listeners[event];
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data);
        } catch (error) {
          console.error('GameLoopBenchmark: Listener error:', error);
        }
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameLoopBenchmark;
}
