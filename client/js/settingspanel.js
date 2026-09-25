// SettingsPanel.js - AAA Game Settings UI

export class SettingsPanel {
  constructor(gameApp) {
    this.game = gameApp;
    this.isOpen = false;
    this.currentTab = 'game';
  }

  // Create and append settings panel to DOM
  create() {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.className = 'settings-panel hidden';
    // Audio tab reads live values from the AudioManager (persisted across sessions).
    const _aud = this.game.audio;
    const _pct = (v, d) => (_aud && typeof v === 'number') ? Math.round(v * 100) : d;
    const _masterPct = _pct(_aud?.volume, 82);
    const _musicPct = _pct(_aud?.musicVolume, 58);
    const _sfxPct = _pct(_aud?.sfxVolume, 80);
    const _mutedAttr = _aud?.muted ? 'checked' : '';
    panel.innerHTML = `
      <div class="settings-overlay"></div>
      <div class="settings-content">
        <div class="settings-header">
          <h2>SETTINGS</h2>
          <button class="btn-close" id="btn-close-settings">✕</button>
        </div>
        <div class="settings-tabs">
          <button class="tab-btn active" data-tab="game">Gameplay</button>
          <button class="tab-btn" data-tab="audio">Audio</button>
          <button class="tab-btn" data-tab="video">Video</button>
          <button class="tab-btn" data-tab="controls">Controls</button>
          <button class="tab-btn" data-tab="accessibility">Accessibility</button>
        </div>
        <div class="settings-body">
          <!-- Gameplay Settings -->
          <div class="settings-tab active" id="tab-game">
            <div class="setting-row">
              <label>Auto-Pickup Loot</label>
              <input type="checkbox" id="setting-autopickup" ${this.game.qol?.features.autoPickup ? 'checked' : ''}>
            </div>
            <div class="setting-row">
              <label>Show Damage Numbers</label>
              <input type="checkbox" id="setting-damagenumbers" ${this.game.qol?.features.showDamageNumbers !== false ? 'checked' : ''}>
            </div>
            <div class="setting-row">
              <label>Show Path Markers</label>
              <input type="checkbox" id="setting-pathmarkers" ${this.game.qol?.features.showPathMarkers ? 'checked' : ''}>
            </div>
          </div>
          <!-- Audio Settings -->
          <div class="settings-tab" id="tab-audio">
            <div class="setting-row">
              <label for="setting-master-volume">Master Volume</label>
              <input type="range" id="setting-master-volume" min="0" max="100" value="${_masterPct}" aria-describedby="master-volume-value">
              <span id="master-volume-value" aria-live="polite">${_masterPct}%</span>
            </div>
            <div class="setting-row">
              <label for="setting-music-volume">Music Volume</label>
              <input type="range" id="setting-music-volume" min="0" max="100" value="${_musicPct}" aria-describedby="music-volume-value">
              <span id="music-volume-value" aria-live="polite">${_musicPct}%</span>
            </div>
            <div class="setting-row">
              <label for="setting-sfx-volume">SFX Volume</label>
              <input type="range" id="setting-sfx-volume" min="0" max="100" value="${_sfxPct}" aria-describedby="sfx-volume-value">
              <span id="sfx-volume-value" aria-live="polite">${_sfxPct}%</span>
            </div>
            <div class="setting-row">
              <label for="setting-mute">Mute All Audio</label>
              <input type="checkbox" id="setting-mute" ${_mutedAttr}>
            </div>
          </div>
          <!-- Video Settings -->
          <div class="settings-tab" id="tab-video">
            <div class="setting-row">
              <label>Bloom Intensity</label>
              <input type="range" id="setting-bloom" min="0" max="100" value="80">
              <span id="bloom-value">0.8</span>
            </div>
            <div class="setting-row">
              <label>Effects Quality</label>
              <select id="setting-fxquality">
                <option value="auto" selected>Auto (Recommended)</option>
                <option value="high">High</option>
                <option value="low">Low</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div class="setting-row">
              <label>Shadow Quality</label>
              <select id="setting-shadows">
                <option value="low">Low (512px)</option>
                <option value="medium" selected>Medium (1024px)</option>
                <option value="high">High (2048px)</option>
              </select>
            </div>
            <div class="setting-row">
              <label>Particle Quality</label>
              <select id="setting-particles">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div class="setting-row">
              <label>Reduced Motion</label>
              <input type="checkbox" id="setting-reducedmotion" ${this.game.qol?.features.reducedMotion ? 'checked' : ''}>
            </div>
          </div>
          <!-- Controls Settings -->
          <div class="settings-tab" id="tab-controls">
            <!-- [Phase4-WS5] Touch controls: Auto (detect) / On / Off -->
            <div class="setting-row">
              <label for="setting-touchcontrols">Touch Controls</label>
              <select id="setting-touchcontrols" aria-label="Touch controls mode">
                <option value="auto">Auto (detect device)</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div class="setting-row">
              <label>Move Forward</label>
              <span class="key-bind">W / ↑</span>
            </div>
            <div class="setting-row">
              <label>Move Backward</label>
              <span class="key-bind">S / ↓</span>
            </div>
            <div class="setting-row">
              <label>Move Left</label>
              <span class="key-bind">A / ←</span>
            </div>
            <div class="setting-row">
              <label>Move Right</label>
              <span class="key-bind">D / →</span>
            </div>
            <div class="setting-row">
              <label>Attack</label>
              <span class="key-bind">Space</span>
            </div>
            <div class="setting-row">
              <label>Skill 1</label>
              <span class="key-bind">1</span>
            </div>
            <div class="setting-row">
              <label>Skill 2</label>
              <span class="key-bind">2</span>
            </div>
            <div class="setting-row">
              <label>Skill 3</label>
              <span class="key-bind">3 / R</span>
            </div>
            <div class="setting-row">
              <label>War Horn</label>
              <span class="key-bind">H</span>
            </div>
            <div class="setting-row">
              <label>Rotate Camera Left</label>
              <span class="key-bind">Q</span>
            </div>
            <div class="setting-row">
              <label>Rotate Camera Right</label>
              <span class="key-bind">E</span>
            </div>
          </div>
          <!-- Accessibility Settings -->
          <div class="settings-tab" id="tab-accessibility">
            <div class="setting-row">
              <label>High Contrast Mode</label>
              <input type="checkbox" id="setting-highcontrast">
            </div>
            <div class="setting-row">
              <label>Larger Health Bars</label>
              <input type="checkbox" id="setting-largebars">
            </div>
            <div class="setting-row">
              <label>Show Enemy Health</label>
              <input type="checkbox" id="setting-enemyhealth" checked>
            </div>
          </div>
        </div>
        <div class="settings-footer">
          <button class="btn btn-secondary" id="btn-reset-settings">Reset to Defaults</button>
          <button class="btn btn-primary" id="btn-save-settings">Save & Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    this.bindEvents();
  }

  // Bind all events
  bindEvents() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Close button
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.close();
    });

    // Overlay click to close
    document.querySelector('.settings-overlay')?.addEventListener('click', () => {
      this.close();
    });

    // [Phase4-WS5] Touch controls preference: sync select with live manager state
    // and apply changes immediately (persisted to localStorage by the manager).
    const touchSel = document.getElementById('setting-touchcontrols');
    if (touchSel) {
      const cur = this.game.touchControls?.preference || 'auto';
      touchSel.value = cur;
      touchSel.addEventListener('change', (e) => {
        this.game.touchControls?.setPreference(e.target.value);
      });
    }

    // Save button
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      this.saveSettings();
      this.close();
    });

    // Reset button
    document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
      this.resetSettings();
    });

    // Volume sliders
    document.getElementById('setting-master-volume')?.addEventListener('input', (e) => {
      const value = e.target.value;
      document.getElementById('master-volume-value').textContent = value + '%';
      if (this.game.audio) {
        this.game.audio.setVolume(value / 100);
      }
    });

    document.getElementById('setting-music-volume')?.addEventListener('input', (e) => {
      const value = e.target.value;
      document.getElementById('music-volume-value').textContent = value + '%';
      if (this.game.audio) {
        this.game.audio.setMusicVolume(value / 100);
      }
    });

    document.getElementById('setting-sfx-volume')?.addEventListener('input', (e) => {
      const value = e.target.value;
      document.getElementById('sfx-volume-value').textContent = value + '%';
      if (this.game.audio) {
        this.game.audio.setSfxVolume(value / 100);
      }
    });

    // Mute toggle
    document.getElementById('setting-mute')?.addEventListener('change', (e) => {
      if (this.game.audio) {
        this.game.audio.setMuted(e.target.checked);
      }
    });

    // Bloom slider
    document.getElementById('setting-bloom')?.addEventListener('input', (e) => {
      const value = e.target.value / 100;
      document.getElementById('bloom-value').textContent = value.toFixed(1);
      if (this.game.renderer && typeof this.game.renderer.setBloomIntensity === 'function') {
        this.game.renderer.setBloomIntensity(value);
      }
    });

    // Effects quality: off / low / high / auto (auto degrades on fps drops)
    document.getElementById('setting-fxquality')?.addEventListener('change', (e) => {
      if (this.game.renderer && typeof this.game.renderer.setQuality === 'function') {
        this.game.renderer.setQuality(e.target.value);
      }
    });

    // Particle quality: scales the pooled VFX spawn budgets
    document.getElementById('setting-particles')?.addEventListener('change', (e) => {
      if (this.game.feelFX && typeof this.game.feelFX.setParticleBudget === 'function') {
        this.game.feelFX.setParticleBudget(e.target.value);
      }
    });

    // Reduced motion
    document.getElementById('setting-reducedmotion')?.addEventListener('change', (e) => {
      if (this.game.qol) {
        this.game.qol.toggleReducedMotion();
      }
      // Keep the checkbox honest if qol is absent: drive the renderer directly.
      if (!this.game.qol && this.game.renderer && typeof this.game.renderer.setReducedMotion === 'function') {
        this.game.renderer.setReducedMotion(e.target.checked);
      }
    });

    // High contrast
    document.getElementById('setting-highcontrast')?.addEventListener('change', (e) => {
      if (this.game.qol) {
        this.game.qol.toggleHighContrast();
      }
    });

    // Quality of Life toggles
    document.getElementById('setting-autopickup')?.addEventListener('change', (e) => {
      if (this.game.qol) this.game.qol.toggleAutoPickup();
    });
    document.getElementById('setting-damagenumbers')?.addEventListener('change', (e) => {
      if (this.game.qol) this.game.qol.toggleDamageNumbers();
    });
    document.getElementById('setting-pathmarkers')?.addEventListener('change', (e) => {
      if (this.game.qol) this.game.qol.togglePathMarkers();
    });
  }

  // Switch tab
  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.classList.toggle('active', tab.id === `tab-${tabName}`);
    });
  }

  // Open settings
  open() {
    this.isOpen = true;
    document.getElementById('settings-panel')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  // Close settings
  close() {
    this.isOpen = false;
    document.getElementById('settings-panel')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // Save settings
  saveSettings() {
    if (this.game.qol) {
      this.game.qol.saveSettings();
    }
    if (this.game.saveSystem) {
      this.game.saveSystem.saveGameProgress();
    }
  }

  // Reset settings
  resetSettings() {
    if (this.game.qol) {
      this.game.qol.resetSettings();
    }
    // Reload page to reset all settings
    setTimeout(() => window.location.reload(), 300);
  }

  // Toggle settings panel
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}
