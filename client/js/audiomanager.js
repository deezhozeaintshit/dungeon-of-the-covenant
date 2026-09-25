// AudioManager.js - Studio-Grade Web Audio Orchestral Soundtrack & Physical-Modeling Object SFX Engine
// Every weapon, spell, material, loot item, creature, and environment has a custom physical-modeling sound recipe.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.reverbNode = null;
    this.initialized = false;
    this.muted = false;
    this.volume = 0.82;

    // Orchestral Sequencer State
    this.musicPlaying = false;
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicMode = 'lobby'; // 'lobby', 'dungeon', 'boss'
    this.droneOscs = [];

    this.setupAutoUnlock();
  }

  setupAutoUnlock() {
    const unlock = () => {
      this.init();
      this.resume();
      if (!this.musicPlaying) {
        this.startAmbient();
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('gamepadconnected', unlock, { passive: true });
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master Dynamics Compressor so heavy explosions + music never clip
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      compressor.release.setValueAtTime(0.22, this.ctx.currentTime);
      compressor.connect(this.ctx.destination);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(compressor);

      // Cathedral Convolution Reverb for lush orchestral music & dungeon acoustics
      this.reverbNode = this.createCathedralReverb(2.2, 2.8);
      const reverbReturn = this.ctx.createGain();
      reverbReturn.gain.value = 0.36;
      this.reverbNode.connect(reverbReturn);
      reverbReturn.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.92;
      this.sfxGain.connect(this.masterGain);
      this.sfxGain.connect(this.reverbNode);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.58;
      this.musicGain.connect(this.masterGain);
      this.musicGain.connect(this.reverbNode);

      // Pre-generate white/pink noise buffer for physical-modeling percussion, fire, wind & metal
      this.noiseBuffer = this.createNoiseBuffer(2.5);

      this.initialized = true;
    } catch (e) {
      console.error('AudioManager initialization error:', e);
    }
  }

  createCathedralReverb(duration = 2.2, decay = 2.8) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const channel = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        channel[i] = (Math.random() * 2 - 1) * env * 0.5;
      }
    }
    const convolver = this.ctx.createConvolver();
    convolver.buffer = impulse;
    return convolver;
  }

  createNoiseBuffer(duration = 2.0) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && !this.muted && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  setMusicMode(mode) {
    this.musicMode = mode || 'dungeon';
  }

  // ============================================================================
  // 1. CONTINUOUS DARK-FANTASY ORCHESTRAL SOUNDTRACK ENGINE
  // ============================================================================
  startAmbient() {
    this.init();
    this.resume();
    if (!this.initialized || !this.ctx) return;

    this.stopAmbient();
    this.musicPlaying = true;
    this.musicStep = 0;

    // Continuous Deep Cathedral Drone Pad (D1 + A1 Fifth)
    this.startCathedralDrone();

    // 16-Step Polyphonic Sequencer (130 BPM sixteenth/eighth groove -> 220ms per step)
    const stepMs = 230;
    this.musicTimer = setInterval(() => {
      if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
      this.tickMusicSequencer(this.musicStep);
      this.musicStep = (this.musicStep + 1) % 32;
    }, stepMs);
  }

  startCathedralDrone() {
    this.stopCathedralDrone();
    if (!this.ctx) return;

    const freqs = [36.71, 55.0, 73.42]; // D1, A1, D2 Dark Cathedral Organ Pedal
    freqs.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = idx === 0 ? 'sine' : 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (idx - 1) * 6;

      filter.type = 'lowpass';
      filter.frequency.value = 180;

      gain.gain.value = idx === 0 ? 0.14 : 0.06;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);
      osc.start();
      this.droneOscs.push({ osc, gain });
    });
  }

  stopCathedralDrone() {
    this.droneOscs.forEach(d => {
      try { d.osc.stop(); d.osc.disconnect(); } catch (_) {}
    });
    this.droneOscs = [];
  }

  tickMusicSequencer(step) {
    const now = this.ctx.currentTime;
    const isBoss = this.musicMode === 'boss';

    // D Phrygian / Harmonic Minor Dark Fantasy Scale (Hz)
    // D3=146.83, Eb3=155.56, F3=174.61, G3=196.00, A3=220.00, Bb3=233.08, C#4=277.18, D4=293.66
    const bassProgression = [
      73.42, 73.42, 73.42, 73.42,  73.42, 73.42, 87.31, 82.41, // D2 -> F2 -> E2
      58.27, 58.27, 58.27, 58.27,  65.41, 65.41, 73.42, 73.42, // Bb1 -> C2 -> D2
      49.00, 49.00, 49.00, 49.00,  58.27, 58.27, 55.00, 55.00, // G1 -> Bb1 -> A1
      55.00, 55.00, 69.30, 69.30,  73.42, 73.42, 55.00, 73.42  // A1 -> C#2 -> D2
    ];

    // 1. Cello / Contrabass Driving Ostinato
    if (step % 2 === 0 || isBoss) {
      const bassFreq = bassProgression[step % 32];
      this.playCelloNote(bassFreq, now, isBoss ? 0.20 : 0.38, isBoss ? 0.22 : 0.16);
    }

    // 2. Gothic Pipe Organ & Choir Pad Chords (Every 8 steps)
    if (step % 8 === 0) {
      const chordMap = {
        0:  [146.83, 174.61, 220.00, 293.66], // D Minor
        8:  [116.54, 174.61, 233.08, 293.66], // Bb Major 7
        16: [98.00,  146.83, 196.00, 233.08], // G Minor
        24: [110.00, 164.81, 220.00, 277.18]  // A7 Dominant (Gothic tension)
      };
      const chord = chordMap[step] || chordMap[0];
      chord.forEach(freq => this.playChoirPadNote(freq, now, 1.75, 0.065));
    }

    // 3. Celestial Lute / Harp Arpeggio Melody
    const melodyNotes = [
      293.66, 0, 349.23, 440.00,  466.16, 440.00, 349.23, 293.66,
      233.08, 293.66, 349.23, 0,  392.00, 349.23, 293.66, 261.63,
      196.00, 233.08, 293.66, 392.00, 349.23, 293.66, 233.08, 220.00,
      220.00, 277.18, 329.63, 440.00, 554.37, 440.00, 293.66, 0
    ];
    const melFreq = melodyNotes[step % 32];
    if (melFreq > 0) {
      this.playPluckedHarpNote(melFreq, now, 0.55, 0.11);
    }

    // 4. Cinematic War-Drums & Taiko Percussion
    if (step % 4 === 0) {
      // Deep Taiko Boom on downbeats
      this.playTaikoDrum(now, 0.24);
    } else if (step % 4 === 2 && (this.musicMode === 'dungeon' || isBoss)) {
      // Mid Tom / War Rim
      this.playWarTom(now, 115, 0.14);
    } else if (isBoss && step % 2 === 1) {
      // Fast double-kick percussion during Boss Phase
      this.playWarTom(now, 90, 0.12);
    }
  }

  playCelloNote(freq, time, dur, gainVal) {
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq * 0.5, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.8, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.4, time + dur);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(gainVal, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    sub.start(time);
    osc.stop(time + dur + 0.02);
    sub.stop(time + dur + 0.02);
  }

  playChoirPadNote(freq, time, dur, gainVal) {
    [-5, 5].forEach(detune => {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime(detune, time);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 2.0, time);
      filter.Q.value = 1.8;

      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(gainVal, time + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);

      osc.start(time);
      osc.stop(time + dur + 0.05);
    });
  }

  playPluckedHarpNote(freq, time, dur, gainVal) {
    const osc = this.ctx.createOscillator();
    const overtone = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 2.0, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, time);
    filter.frequency.exponentialRampToValueAtTime(450, time + dur);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(gainVal, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    overtone.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    overtone.start(time);
    osc.stop(time + dur + 0.02);
    overtone.stop(time + dur + 0.02);
  }

  playTaikoDrum(time, gainVal = 0.25) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(118, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.28);

    gain.gain.setValueAtTime(gainVal, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.34);

    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.35);
  }

  playWarTom(time, startFreq = 130, gainVal = 0.14) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(52, time + 0.16);

    gain.gain.setValueAtTime(gainVal, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.19);
  }

  stopAmbient() {
    this.musicPlaying = false;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.stopCathedralDrone();
  }

  // ============================================================================
  // 2. OBJECT-MATCHED PHYSICAL-MODELING SOUND EFFECTS
  // ============================================================================
  playSFX(type, options = {}) {
    this.init();
    this.resume();
    if (!this.initialized || this.muted || !this.ctx) return;

    const now = this.ctx.currentTime;
    const classKey = options.classKey || window.game?.selectedClass || 'juggernaut';

    switch (type) {
      case 'attack':
        this.playWeaponAttackSFX(classKey, now);
        break;
      case 'jump':
        this.playJumpSFX(now);
        break;
      case 'jump_slam':
        this.playJumpSlamSFX(now);
        break;
      case 'dash':
        this.playDashWhooshSFX(now);
        break;
      case 'hit':
        this.playMeatArmorHitSFX(now);
        break;
      case 'kill':
        this.playEnemyVanquishedSFX(now);
        break;
      case 'hurt':
        this.playHeroArmorImpactSFX(now);
        break;
      case 'heal':
        this.playHolyElixirChimeSFX(now);
        break;
      case 'loot':
      case 'gold':
        this.playGoldCoinsClinkSFX(now);
        break;
      case 'chest':
      case 'powerup':
        this.playTreasureChestOpenSFX(now);
        break;
      case 'forge':
        this.playBlacksmithAnvilSFX(now);
        break;
      case 'levelup':
        this.playHeroicFanfareSFX(now);
        break;
      case 'explosion':
      case 'fireball':
        this.playFireballDetonationSFX(now);
        break;
      case 'frost':
      case 'ice':
        this.playCrystallineIceShatterSFX(now);
        break;
      case 'bone':
        this.playBoneSpikesEruptSFX(now);
        break;
      case 'spell':
        this.playClassSpellCastSFX(classKey, now);
        break;
      case 'war_horn':
        this.playBrazenWarHornSFX(now);
        break;
      case 'ui_click':
        this.playStoneRuneClickSFX(now);
        break;
      case 'ui_select':
        this.playMetallicSheathSelectSFX(now);
        break;
      default:
        this.playStoneRuneClickSFX(now);
        break;
    }
  }

  // Helper: Filtered Noise Burst (for wind whooshes, fire roar, blade slices, shatter debris)
  playFilteredNoise(time, duration, filterType, startFreq, endFreq, Q, peakGain) {
    if (!this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(startFreq, time);
    if (endFreq && endFreq !== startFreq) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + duration);
    }
    filter.Q.value = Q || 1.5;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + Math.min(0.02, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    src.start(time);
    src.stop(time + duration + 0.02);
  }

  // Helper: Metallic / Bell / String Partial
  playPartial(freq, endFreq, time, duration, type = 'sine', peakGain = 0.2) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + duration);
    }
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  // 1. WEAPON-MATCHED BASIC ATTACK SOUNDS
  playWeaponAttackSFX(classKey, now) {
    if (classKey === 'juggernaut') {
      // Colossal Warhammer: Deep heavy air-whoosh + low iron maul thud + metallic anvil overtone
      this.playFilteredNoise(now, 0.26, 'bandpass', 240, 65, 1.8, 0.45);
      this.playPartial(135, 42, now + 0.04, 0.24, 'triangle', 0.38);
      this.playPartial(420, 390, now + 0.05, 0.18, 'sine', 0.14);
    } else if (classKey === 'rogue') {
      // Dual Plasma Kris Daggers: Twin ultra-fast razor steel slices ("shhhk-zing!")
      this.playFilteredNoise(now, 0.11, 'highpass', 1800, 4200, 2.5, 0.32);
      this.playPartial(1950, 880, now, 0.09, 'sawtooth', 0.12);
      this.playFilteredNoise(now + 0.08, 0.12, 'highpass', 2200, 4800, 2.5, 0.34);
      this.playPartial(2350, 1050, now + 0.08, 0.10, 'sawtooth', 0.14);
    } else if (classKey === 'ranger') {
      // Recurve Starlight Greatbow: Plucked taut bowstring twang + high-speed arrow fletching whistle
      this.playPartial(165, 92, now, 0.18, 'sawtooth', 0.25);
      this.playFilteredNoise(now + 0.02, 0.18, 'bandpass', 2800, 1100, 4.0, 0.32);
    } else if (classKey === 'mage') {
      // Dragon-Skull Ignis Fire Staff: Whooshing flame burst + crackling ember discharge
      this.playFilteredNoise(now, 0.25, 'bandpass', 580, 180, 1.4, 0.40);
      this.playPartial(320, 140, now, 0.22, 'sawtooth', 0.18);
    } else if (classKey === 'cleric') {
      // Solar Sunburst Scepter: Radiant golden bell chime + warm light whoosh
      this.playFilteredNoise(now, 0.18, 'bandpass', 900, 1800, 2.0, 0.22);
      this.playPartial(880, 880, now, 0.28, 'sine', 0.18);
      this.playPartial(1318.5, 1318.5, now + 0.02, 0.32, 'sine', 0.14);
    } else {
      // Dreadweaver 6-Foot Bone Scythe: Sweeping curved reaper blade slice + spectral air tear
      this.playFilteredNoise(now, 0.24, 'bandpass', 1400, 280, 2.8, 0.38);
      this.playPartial(620, 210, now, 0.22, 'sawtooth', 0.16);
    }
  }

  // 2. CLASS SPELL & ELEMENTAL ABILITY SOUNDS
  playClassSpellCastSFX(classKey, now) {
    if (classKey === 'mage') {
      this.playFireballDetonationSFX(now);
    } else if (classKey === 'cleric') {
      this.playHolyElixirChimeSFX(now);
    } else if (classKey === 'necromancer') {
      this.playBoneSpikesEruptSFX(now);
    } else if (classKey === 'juggernaut') {
      this.playBlacksmithAnvilSFX(now);
    } else if (classKey === 'ranger') {
      this.playWeaponAttackSFX('ranger', now);
      this.playWeaponAttackSFX('ranger', now + 0.06);
      this.playWeaponAttackSFX('ranger', now + 0.12);
    } else {
      this.playDashWhooshSFX(now);
    }
  }

  // 3. JUMP, SLAM & DASH TRAVERSAL SOUNDS
  playJumpSFX(now) {
    // Boot push-off stone thud + upward cloth/air whoosh
    this.playPartial(95, 48, now, 0.09, 'sine', 0.30);
    this.playFilteredNoise(now + 0.02, 0.18, 'bandpass', 350, 1100, 1.8, 0.26);
  }

  playJumpSlamSFX(now) {
    // Heavy stone ground impact + shockwave rumble
    this.playPartial(110, 32, now, 0.32, 'triangle', 0.45);
    this.playFilteredNoise(now, 0.28, 'lowpass', 480, 90, 1.2, 0.42);
  }

  playDashWhooshSFX(now) {
    // High-velocity wind rush + phase blink
    this.playFilteredNoise(now, 0.22, 'bandpass', 2400, 260, 2.2, 0.38);
    this.playPartial(540, 180, now, 0.18, 'sine', 0.20);
  }

  // 4. MEAT / BONE / ARMOR IMPACT & KILL SOUNDS
  playMeatArmorHitSFX(now) {
    // Visceral weapon-on-armor/flesh impact crunch (NO sine beep!)
    this.playPartial(145, 44, now, 0.12, 'triangle', 0.36);
    this.playFilteredNoise(now, 0.10, 'bandpass', 1100, 380, 1.6, 0.35);
  }

  playEnemyVanquishedSFX(now) {
    // Bone/Armor collapse + low sub-drop + dark soul release
    this.playPartial(160, 35, now, 0.35, 'sawtooth', 0.34);
    this.playFilteredNoise(now, 0.32, 'bandpass', 950, 180, 1.8, 0.36);
    this.playPartial(587.33, 293.66, now + 0.06, 0.35, 'triangle', 0.16);
  }

  playHeroArmorImpactSFX(now) {
    // Heavy metallic plate crunch + low grunt thud
    this.playPartial(120, 40, now, 0.20, 'sawtooth', 0.35);
    this.playFilteredNoise(now, 0.16, 'bandpass', 800, 250, 2.0, 0.32);
  }

  // 5. GOLD COINS, TREASURE CHESTS, ELIXIRS & FORGE ANVIL
  playGoldCoinsClinkSFX(now) {
    // 4 staggered real silver/gold coin resonant frequencies clinking on stone
    const coinFreqs = [2637, 3136, 3520, 3951];
    coinFreqs.forEach((freq, idx) => {
      const t = now + idx * 0.048;
      this.playPartial(freq, freq * 0.995, t, 0.16, 'sine', 0.18);
      this.playPartial(freq * 1.414, freq * 1.41, t, 0.09, 'sine', 0.08);
    });
  }

  playTreasureChestOpenSFX(now) {
    // Heavy wooden/iron lid creak + cascading gold coins + triumphant D-Major brass chord
    this.playPartial(110, 165, now, 0.22, 'sawtooth', 0.20);
    this.playGoldCoinsClinkSFX(now + 0.12);
    [293.66, 369.99, 440.00, 587.33].forEach((f, idx) => {
      this.playPartial(f, f, now + 0.15 + idx * 0.04, 0.55, 'triangle', 0.15);
    });
  }

  playHolyElixirChimeSFX(now) {
    // Glass potion cork pop + ascending celestial harp shimmer
    this.playPartial(420, 980, now, 0.06, 'sine', 0.22);
    const notes = [587.33, 739.99, 880.00, 1174.66, 1479.98];
    notes.forEach((f, idx) => {
      this.playPartial(f, f, now + 0.04 + idx * 0.05, 0.42, 'sine', 0.15);
    });
  }

  playBlacksmithAnvilSFX(now) {
    // Ringing steel hammer on iron anvil + hot steam quench hiss
    this.playPartial(1046.5, 1040, now, 0.38, 'sine', 0.26);
    this.playPartial(1661.2, 1650, now, 0.24, 'triangle', 0.18);
    this.playFilteredNoise(now + 0.08, 0.35, 'highpass', 2500, 4500, 1.2, 0.22);
  }

  // 6. ELEMENTAL DETONATIONS (FIREBALL, ICE SHATTER, BONE SPIKES, WAR HORN)
  playFireballDetonationSFX(now) {
    // Deep sub-bass concussion + roaring low-pass combustion flame
    this.playPartial(125, 26, now, 0.55, 'sine', 0.48);
    this.playFilteredNoise(now, 0.58, 'lowpass', 850, 110, 1.4, 0.46);
  }

  playCrystallineIceShatterSFX(now) {
    // Brittle high-frequency crystal glass pings + frost crack
    this.playFilteredNoise(now, 0.24, 'highpass', 2200, 5200, 3.0, 0.32);
    [2093, 2793, 3520, 4186].forEach((f, idx) => {
      this.playPartial(f, f * 0.96, now + idx * 0.03, 0.22, 'sine', 0.16);
    });
  }

  playBoneSpikesEruptSFX(now) {
    // Stone earth rupture + dry rattling bone xylophone transients
    this.playFilteredNoise(now, 0.22, 'lowpass', 520, 140, 1.5, 0.35);
    [480, 690, 920, 610].forEach((f, idx) => {
      this.playPartial(f, f * 0.85, now + idx * 0.035, 0.09, 'triangle', 0.24);
    });
  }

  playBrazenWarHornSFX(now) {
    // Rich Viking/Covenant Brass Horn Fifth (D3 + A3 + D4) with warm brass filter swell
    const freqs = [146.83, 220.00, 293.66];
    freqs.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.97, now);
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.18);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, now);
      filter.frequency.exponentialRampToValueAtTime(1450, now + 0.45);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.24 : 0.16, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.65);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 1.7);
    });
  }

  playHeroicFanfareSFX(now) {
    // Triumphant D-Major Royal Brass Fanfare (D4 -> F#4 -> A4 -> D5)
    const fanfare = [293.66, 369.99, 440.00, 587.33];
    fanfare.forEach((f, idx) => {
      const t = now + idx * 0.11;
      this.playPartial(f, f, t, 0.55, 'sawtooth', 0.18);
      this.playPartial(f * 0.5, f * 0.5, t, 0.55, 'triangle', 0.16);
    });
  }

  playStoneRuneClickSFX(now) {
    // Crisp tactile gothic stone-tablet click
    this.playPartial(380, 140, now, 0.045, 'triangle', 0.18);
  }

  playMetallicSheathSelectSFX(now) {
    // Crisp sword-in-scabbard steel ring
    this.playFilteredNoise(now, 0.09, 'highpass', 2400, 4800, 3.0, 0.18);
    this.playPartial(1174.66, 1760, now, 0.14, 'sine', 0.15);
  }

  destroy() {
    this.stopAmbient();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.initialized = false;
    }
  }
}
