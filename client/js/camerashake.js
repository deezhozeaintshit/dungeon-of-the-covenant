// camerashake.js - Trauma-based screen shake + hit-stop timescale (pure logic, no DOM)
// Follows the classic "trauma" model: trauma in [0,1], shake magnitude = trauma^2,
// so small hits barely register and big hits dominate. Rotational + translational.
// Zero allocation: update() writes into a caller-supplied out object.
// prefers-reduced-motion: when enabled, addTrauma/trigger are no-ops and
// timescale stays 1 (no shake, no hit-stop).

export class TraumaShake {
  constructor() {
    this.trauma = 0;          // 0..1
    this.reducedMotion = false;
    // Tunables: offset scale relative to the game's ~24-unit camera distance.
    this.maxOffset = 1.15;    // world units at trauma == 1
    this.maxRoll = 0.045;     // radians at trauma == 1
    this.maxTilt = 0.028;     // radians pitch/yaw at trauma == 1
    this.decayRate = 1.7;     // trauma units lost per second
    this._time = 0;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = !!enabled;
    if (this.reducedMotion) this.trauma = 0;
  }

  // Backward-compatible alias for the old renderer.triggerScreenShake(magnitude)
  addTrauma(amount) {
    if (this.reducedMotion) return;
    if (!(amount > 0)) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  reset() {
    this.trauma = 0;
  }

  update(dt, out) {
    this._time += dt;
    if (this.reducedMotion || this.trauma <= 0) {
      out.ox = 0; out.oy = 0; out.oz = 0;
      out.roll = 0; out.pitch = 0; out.yaw = 0;
      return out;
    }
    this.trauma = Math.max(0, this.trauma - this.decayRate * dt);
    const s = this.trauma * this.trauma; // quadratic falloff
    const t = this._time;
    // Multi-frequency noise so it never looks like a clean sine.
    const n1 = Math.sin(t * 61.7) * 0.6 + Math.sin(t * 23.3 + 1.7) * 0.4;
    const n2 = Math.cos(t * 54.1 + 0.6) * 0.6 + Math.sin(t * 31.9 + 2.9) * 0.4;
    const n3 = Math.sin(t * 47.3 + 3.4) * 0.6 + Math.cos(t * 19.7 + 0.3) * 0.4;
    out.ox = n1 * this.maxOffset * s;
    out.oy = n2 * this.maxOffset * s * 0.7;
    out.oz = n3 * this.maxOffset * s * 0.5;
    out.roll = n2 * this.maxRoll * s;
    out.pitch = n3 * this.maxTilt * s;
    out.yaw = n1 * this.maxTilt * s;
    return out;
  }
}

// HitStop - brief timescale dip on heavy hits. During the stop window the game
// simulates nothing (timeScale 0), then ramps back to 1 over recoverTime so the
// release feels like a snap instead of a jolt. Pure and allocation-free.
export class HitStop {
  constructor() {
    this.reducedMotion = false;
    this.timeScale = 1;
    this.stopTimer = 0;      // seconds of full freeze remaining
    this.recoverTimer = 0;   // seconds of ramp-back remaining
    this.recoverDuration = 0.12;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = !!enabled;
    if (this.reducedMotion) {
      this.stopTimer = 0;
      this.recoverTimer = 0;
      this.timeScale = 1;
    }
  }

  // Backward-compatible with renderer.triggerHitStop(ms)
  trigger(ms = 70) {
    if (this.reducedMotion) return;
    const s = Math.max(0.02, Math.min(0.25, ms / 1000));
    // A stronger stop overrides a weaker one; never shorten an active stop.
    this.stopTimer = Math.max(this.stopTimer, s);
    this.recoverTimer = this.recoverDuration;
  }

  get active() {
    return this.stopTimer > 0 || this.recoverTimer > 0;
  }

  update(dt) {
    if (this.reducedMotion) {
      this.timeScale = 1;
      return 1;
    }
    if (this.stopTimer > 0) {
      this.stopTimer -= dt;
      this.timeScale = 0;
      if (this.stopTimer <= 0) this.recoverTimer = this.recoverDuration;
    } else if (this.recoverTimer > 0) {
      this.recoverTimer -= dt;
      const k = 1 - Math.max(0, this.recoverTimer) / this.recoverDuration;
      // ease-out ramp: fast snap back, no jolt
      this.timeScale = k * k * (3 - 2 * k);
      if (this.recoverTimer <= 0) this.timeScale = 1;
    } else {
      this.timeScale = 1;
    }
    return this.timeScale;
  }
}
