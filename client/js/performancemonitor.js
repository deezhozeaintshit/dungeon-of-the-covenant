// PerformanceMonitor.js - AAA Game Performance Monitoring System

export class PerformanceMonitor {
  constructor() {
    this.fps = 0;
    this.frameTime = 0;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fpsHistory = [];
    this.maxHistory = 100;
    this.stats = {
      drawCalls: 0,
      triangles: 0,
      particles: 0,
      entities: 0,
      physicsChecks: 0
    };
    this.listeners = {
      onFPSUpdate: [],
      onStatsUpdate: []
    };
    this.monitoring = false;
  }

  // Start monitoring
  start() {
    this.monitoring = true;
    this.lastTime = performance.now();
    this.frameCount = 0;
    console.log('PerformanceMonitor: Started monitoring');
  }

  // Stop monitoring
  stop() {
    this.monitoring = false;
    console.log('PerformanceMonitor: Stopped monitoring');
  }

  // Update frame metrics
  updateFrame(renderer, entityCount, particleCount, physicsChecks) {
    if (!this.monitoring) return;

    this.frameCount++;
    const now = performance.now();
    const delta = now - this.lastTime;

    // Calculate FPS
    this.fps = Math.round(1000 / delta);
    this.frameTime = delta;

    // Update history
    this.fpsHistory.push(this.fps);
    if (this.fpsHistory.length > this.maxHistory) {
      this.fpsHistory.shift();
    }

    // Update stats
    this.stats.drawCalls = renderer.info.render.calls;
    this.stats.triangles = renderer.info.render.triangles;
    this.stats.particles = particleCount;
    this.stats.entities = entityCount;
    this.stats.physicsChecks = physicsChecks;

    // Notify listeners
    this.notifyListeners('onFPSUpdate', { fps: this.fps, frameTime: delta });
    this.notifyListeners('onStatsUpdate', { ...this.stats });

    this.lastTime = now;
  }

  // Get average FPS over history
  getAverageFPS() {
    if (this.fpsHistory.length === 0) return 0;
    const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.fpsHistory.length);
  }

  // Get min FPS
  getMinFPS() {
    if (this.fpsHistory.length === 0) return 0;
    return Math.min(...this.fpsHistory);
  }

  // Get max FPS
  getMaxFPS() {
    if (this.fpsHistory.length === 0) return 0;
    return Math.max(...this.fpsHistory);
  }

  // Get performance tier
  getPerformanceTier() {
    const avgFPS = this.getAverageFPS();
    if (avgFPS >= 55) return 'excellent';
    if (avgFPS >= 45) return 'good';
    if (avgFPS >= 30) return 'acceptable';
    return 'poor';
  }

  // Get optimization suggestions
  getOptimizationSuggestions() {
    const suggestions = [];
    const tier = this.getPerformanceTier();

    if (tier === 'poor' || tier === 'acceptable') {
      suggestions.push('Reduce particle count by 50%');
      suggestions.push('Disable bloom post-processing');
      suggestions.push('Lower shadow map resolution to 512');
      suggestions.push('Reduce fog density');
    }

    if (this.stats.drawCalls > 200) {
      suggestions.push('High draw call count - consider instancing');
    }

    if (this.stats.triangles > 100000) {
      suggestions.push('High triangle count - reduce geometry complexity');
    }

    if (this.stats.particles > 500) {
      suggestions.push('Reduce maximum particle count');
    }

    return suggestions;
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
          console.error('PerformanceMonitor: Listener error:', error);
        }
      }
    }
  }
}
