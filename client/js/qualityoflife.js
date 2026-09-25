// QualityOfLife.js - Quality of Life Features for AAA Experience

export class QualityOfLife {
  constructor(gameApp) {
    this.game = gameApp;
    this.features = {
      autoPickup: false,
      showDamageNumbers: true,
      showPathMarkers: false,
      reducedMotion: false,
      highContrast: false
    };
    this.listeners = {
      onFeatureToggle: []
    };
  }

  // Toggle auto-pickup (collect nearby loot automatically)
  toggleAutoPickup() {
    this.features.autoPickup = !this.features.autoPickup;
    this.saveSettings();
    this.notifyListeners('onFeatureToggle', { feature: 'autoPickup', value: this.features.autoPickup });
    return this.features.autoPickup;
  }

  // Toggle damage numbers visibility
  toggleDamageNumbers() {
    this.features.showDamageNumbers = !this.features.showDamageNumbers;
    this.saveSettings();
    this.notifyListeners('onFeatureToggle', { feature: 'showDamageNumbers', value: this.features.showDamageNumbers });
    return this.features.showDamageNumbers;
  }

  // Toggle path markers (show waypoint to objective)
  togglePathMarkers() {
    this.features.showPathMarkers = !this.features.showPathMarkers;
    this.saveSettings();
    this.notifyListeners('onFeatureToggle', { feature: 'showPathMarkers', value: this.features.showPathMarkers });
    return this.features.showPathMarkers;
  }

  // Toggle reduced motion (minimize camera shake, animations)
  toggleReducedMotion() {
    this.features.reducedMotion = !this.features.reducedMotion;
    this.saveSettings();
    if (this.features.reducedMotion && this.game.renderer) {
      this.game.renderer.shakeIntensity *= 0.3;
    }
    this.notifyListeners('onFeatureToggle', { feature: 'reducedMotion', value: this.features.reducedMotion });
    return this.features.reducedMotion;
  }

  // Toggle high contrast mode
  toggleHighContrast() {
    this.features.highContrast = !this.features.highContrast;
    this.saveSettings();
    this.applyHighContrast();
    this.notifyListeners('onFeatureToggle', { feature: 'highContrast', value: this.features.highContrast });
    return this.features.highContrast;
  }

  // Apply high contrast visual changes
  applyHighContrast() {
    const body = document.body;
    if (this.features.highContrast) {
      body.style.filter = 'contrast(1.3) saturate(1.2)';
    } else {
      body.style.filter = 'none';
    }
  }

  // Get all settings
  getSettings() {
    return { ...this.features };
  }

  // Load settings from localStorage
  loadSettings() {
    try {
      const raw = localStorage.getItem('rpg_qol_settings');
      if (raw) {
        const settings = JSON.parse(raw);
        Object.assign(this.features, settings);
        this.applyHighContrast();
      }
    } catch (e) {
      console.warn('QualityOfLife: Failed to load settings:', e);
    }
  }

  // Save settings to localStorage
  saveSettings() {
    try {
      localStorage.setItem('rpg_qol_settings', JSON.stringify(this.features));
    } catch (e) {
      console.warn('QualityOfLife: Failed to save settings:', e);
    }
  }

  // Reset all settings to defaults
  resetSettings() {
    this.features = {
      autoPickup: false,
      showDamageNumbers: true,
      showPathMarkers: false,
      reducedMotion: false,
      highContrast: false
    };
    this.saveSettings();
    this.applyHighContrast();
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
          console.error('QualityOfLife: Listener error:', error);
        }
      }
    }
  }
}
