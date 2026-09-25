// narrator.js - Reactive Narrator Banner & Studio Audio Cue Dispatcher
export class NarratorSystem {
  constructor(audioManager = null) {
    this.audio = audioManager;
    this.banner = document.getElementById('narrator-banner');
    this.textEl = document.getElementById('narrator-text');
    this.hideTimeout = null;

    const closeBtn = document.getElementById('btn-close-narrator');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearTimeout(this.hideTimeout);
        this.banner?.classList.add('hidden');
      });
    }

    this.initAudioPrompt();
  }

  getAudio() {
    return this.audio || window.gameApp?.audio || null;
  }

  initAudioPrompt() {
    const prompt = document.getElementById('audio-prompt');
    const unlock = () => {
      const aud = this.getAudio();
      if (aud) {
        aud.init();
        aud.resume();
        aud.startAmbient();
      }
      if (prompt) prompt.classList.add('hidden');
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };

    window.addEventListener('click', unlock);
    window.addEventListener('touchstart', unlock);
    window.addEventListener('keydown', unlock);
  }

  say(text, tone = 'info') {
    if (!this.banner || !this.textEl) return;

    this.textEl.innerText = text;
    this.banner.classList.remove('hidden');

    // Trigger studio physical-modeling audio cue matched to announcement tone
    if (tone === 'hype') this.playWarHorn();
    else if (tone === 'combo') this.playComboShatter();
    else if (tone === 'danger' || tone === 'warning') this.playDangerDrone();
    else if (tone === 'loot') this.playLootPickup();
    else this.playNarratorChime();

    clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.banner.classList.add('hidden');
    }, 2400);
  }

  playNarratorChime() {
    const aud = this.getAudio();
    if (aud) aud.playSFX('ui_select');
  }

  playWarHorn() {
    const aud = this.getAudio();
    if (aud) aud.playSFX('war_horn');
  }

  playComboShatter() {
    const aud = this.getAudio();
    if (aud) aud.playSFX('frost');
  }

  playDangerDrone() {
    const aud = this.getAudio();
    if (aud) aud.playSFX('hurt');
  }

  playLootPickup() {
    const aud = this.getAudio();
    if (aud) aud.playSFX('loot');
  }

  playAttackSwing(classKey = 'juggernaut') {
    const aud = this.getAudio();
    if (aud) aud.playSFX('attack', { classKey });
  }
}

