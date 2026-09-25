// main.js - Master Client Orchestrator (AAA Enhanced)
import * as THREE from '/vendor/three.module.js';
import { GameRenderer } from './renderer.js?v=9.0';
import { DungeonBuilder } from './dungeon.js?v=9.0';
import { EntityManager } from './entities.js?v=9.0';
import { CombatVisuals } from './combat.js?v=9.0';
import { GameControls } from './controls.js?v=9.0';
import { NarratorSystem } from './narrator.js?v=9.0';
import { LootSystem } from './loot.js?v=9.0';
import { NetworkClient } from './network.js?v=9.0';
import { AudioManager } from './audiomanager.js?v=9.0';
import { InAppPurchaseManager } from './inapppurchase.js?v=9.0';
import { AchievementSystem } from './achievementsystem.js?v=9.0';
import { SaveSystem } from './savesystem.js?v=9.0';
import { TutorialSystem } from './tutorialsystem.js?v=9.0';
// --- upgrade tracks integration (2026-09-25) ---
import { initCharacterRimLight } from './characterLighting.js?v=9.0';
import { setDamageListener } from './characterAnimation.js?v=9.0';
import { applyTheme } from './ui/theme.js?v=5.0';
import { initMainMenu } from './ui/mainMenu.js?v=5.0';
import { initCharacterSelect } from './ui/characterSelect.js?v=5.0';
import { initHUD } from './ui/hud.js?v=5.0';
import { initScreens } from './ui/screens.js?v=5.0';
import { initDamageNumbers } from './ui/damageNumbers.js?v=5.0';

const _projV = new THREE.Vector3(); // shared projector scratch vector

const CLASSES = {
  juggernaut: {
    name: 'Juggernaut',
    role: 'Tank',
    icon: '🛡️',
    desc: 'Armored titan that controls crowds and shatters frozen targets with devastating hammer impacts.',
    abilities: [
      { name: 'Shield Slam', icon: '💥', desc: 'Stuns enemies in front and shatters frozen foes for 250% damage.' },
      { name: 'Iron Bastion', icon: '🛡️', desc: 'Taunts all nearby enemies and shields all allies with 40% damage resistance.' },
      { name: 'Seismic Vortex', icon: '🌀', desc: 'Pulls all enemies in the room into a tight cluster for teammate AoE nukes.' }
    ]
  },
  cleric: {
    name: 'Radiant Cleric',
    role: 'Healer',
    icon: '✨',
    desc: 'Holy champion that purges the darkness and empowers teammate strikes with radiant explosions.',
    abilities: [
      { name: 'Luminary Lance', icon: '⚡', desc: 'Piercing light beam that damages enemies and heals allies in a line.' },
      { name: 'Sanctuary Ward', icon: '🔆', desc: 'Places an ancient golden glyph that rapidly regenerates ally health.' },
      { name: 'Judgement Brand', icon: '👁️', desc: 'Brands the target. Every teammate attack procs radiant burst explosions!' }
    ]
  },
  rogue: {
    name: 'Shadowblade',
    role: 'Rogue',
    icon: '🗡️',
    desc: 'Lethal assassin that coats fields in flammable pitch and tears through vulnerable foes.',
    abilities: [
      { name: 'Shadowstep', icon: '👤', desc: 'Teleports behind the target and inflicts a vicious bleeding strike.' },
      { name: 'Tar Bomb', icon: '💣', desc: 'Throws flammable tar slick (60% slow). Can be ignited by fire into a roaring inferno!' },
      { name: 'Eviscerate', icon: '🩸', desc: 'Massive execute deal 300% bonus damage to burning or crowd-controlled targets.' }
    ]
  },
  mage: {
    name: 'Pyromancer',
    role: 'Mage',
    icon: '🔥',
    desc: 'Master of elemental reactions. Freezes enemies solid and detonates tar with explosive hellfire.',
    abilities: [
      { name: 'Frost Nova', icon: '❄️', desc: 'Freezes all nearby enemies solid in crystalline ice for 3.5 seconds.' },
      { name: 'Fireball', icon: '🔥', desc: 'Explosive projectile. Ignites Tar Bombs into an Infernal Conflagration firestorm!' },
      { name: 'Chaos Meteor', icon: '☄️', desc: 'Massive delayed orbital bombardment with extreme knockback.' }
    ]
  },
  ranger: {
    name: 'Deadeye',
    role: 'Ranger',
    icon: '🏹',
    desc: 'Sharpshooter that unleashes arrow storms and conceals allies for clutch rescues.',
    abilities: [
      { name: 'Rapid Volley', icon: '🎯', desc: 'Fires a fan of 7 piercing arrows. Triggers rapid radiant procs on branded targets.' },
      { name: 'Pinning Trap', icon: '🕸️', desc: 'Springs a trap that roots enemies in place and shreds their armor.' },
      { name: 'Smoke Veil', icon: '💨', desc: 'Drops a smoke cloud granting stealth & 100% evasion for safe teammate revives.' }
    ]
  },
  necromancer: {
    name: 'Dreadweaver',
    role: 'Necromancer',
    icon: '💀',
    desc: 'Dark sorcerer that harvests life essence and detonates fallen corpses into toxic clouds.',
    abilities: [
      { name: 'Bone Spikes', icon: '🦴', desc: 'Linear barrage of piercing bone spears that causes enemies to bleed.' },
      { name: 'Soul Drain', icon: '🔮', desc: 'Channels health siphon from the target, redistributing vitality to all allies.' },
      { name: 'Corpse Explosion', icon: '☣️', desc: 'Detonates fallen enemy corpses into massive toxic burst clouds.' }
    ]
  }
};

class GameApp {
  constructor() {
    this.selectedClass = 'juggernaut';
    this.localPlayerId = null;
    this.currentRoomCode = null;
    this.gameState = 'lobby'; // lobby, in_room, dungeon, victory, defeat
    this.container = document.getElementById('canvas-container');

    // Initialize AAA systems
    this.audio = new AudioManager();
    this.iap = new InAppPurchaseManager();
    this.achievements = new AchievementSystem();
    this.saveSystem = new SaveSystem();
    this.tutorial = new TutorialSystem(this);

    // Load saved progress
    this.loadGameProgress();

    // 1. Initialize Network & UI FIRST so lobby and room creation are never blocked
    this.narrator = new NarratorSystem(this.audio);
    this.initNetwork();

    this.controls = new GameControls({
      onInput: (vec, rot) => {
        if (this.gameState === 'dungeon' && this.network) {
          this.network.sendInput({ movement: vec, rotation: rot });
        }
      },
      onAction: (action, targetPos, rotation, targetId) => {
        if (this.gameState === 'dungeon' && this.network) {
          this.playActionSFX(action);
          this.network.sendInput({ action, targetPos, rotation, targetId });

          // Only trigger weapon swing animation & slash arc on combat attacks/skills (not jump or loot)
          if (action !== 'jump' && action !== 'loot' && action !== 'dash' && this.entities && this.combat) {
            this.entities.triggerAttackAnimation(this.localPlayerId);
            const localMesh = this.entities.playerMeshes.get(this.localPlayerId);
            if (localMesh) {
              const rot = rotation !== undefined ? rotation : localMesh.rotation.y;
              this.combat.spawnAttackSlash(localMesh.position.x, localMesh.position.z, rot);
            }
          }
        }
      },
      onHorn: () => {
        if (this.network) {
          this.audio.playSFX('war_horn');
          this.network.useWarHorn();
        }
      },
      onPing: (type, targetPos) => {
        if (this.network) {
          this.audio.playSFX('ui_select');
          this.network.sendInput({ ping: { type, x: targetPos?.x, z: targetPos?.z } });
        }
      }
    });

    this.initClassSelectionUI();
    this.initLobbyEvents();

    // UI overhaul track: dark-fantasy UI systems (all null-safe, DOM-lazy)
    applyTheme();
    this.ui = {};
    this.ui.menu = initMainMenu({ game: this });
    this.ui.characterSelect = initCharacterSelect({ classes: CLASSES });
    this.ui.hud = initHUD({ game: this });
    this.ui.screens = initScreens({
      onOpenSettings: () => this.ui.menu?.openSettings(),
      onRespawn: () => { if (this.network) this.network.sendInput({ action: 'respawn' }); },
      onQuitToLobby: () => window.location.reload(),
    });
    this.ui.damageNumbers = initDamageNumbers();
    this.ui.damageNumbers.setProjector((w) => {
      if (!this.renderer || !this.renderer.camera) return null;
      _projV.set(w.x, w.y !== undefined ? w.y : 1.5, w.z !== undefined ? w.z : 0);
      _projV.project(this.renderer.camera);
      if (_projV.z > 1) return null;
      return {
        x: (_projV.x * 0.5 + 0.5) * window.innerWidth,
        y: (-_projV.y * 0.5 + 0.5) * window.innerHeight,
      };
    });
    // Real damage numbers: driven by hp-drop detection on character groups
    setDamageListener((group, amount) => {
      if (!this.ui || !this.ui.damageNumbers || !group || !group.position) return;
      const p = group.position;
      this.ui.damageNumbers.spawn(
        { x: p.x, y: p.y + 1.7, z: p.z },
        amount,
        amount >= 120 ? 'crit' : 'phys'
      );
    });
    // Boot: loading screen first; lobby reveals on server connect
    this.ui.screens.loading.show();
    this.ui.screens.loading.setProgress(8, 'Waking the dungeon…');
    this.ui.screens.loading.startTips();

    // 2. Initialize 3D WebGL Subsystems
    try {
      this.container = document.getElementById('canvas-container');
      this.renderer = new GameRenderer(this.container);
      this.dungeon = new DungeonBuilder(this.renderer.scene);
      this.entities = new EntityManager(this.renderer.scene);
      // characters track: rim-light rig + PBR env reflections (characters only)
      initCharacterRimLight(this.renderer.scene, this.renderer.camera);
      this.renderer.camera.layers.enable(1); // rim light lives on layer 1
      if (typeof this.entities.setRenderer === 'function') {
        this.entities.setRenderer(this.renderer.renderer);
      }
      this.combat = new CombatVisuals(this.renderer.scene);
      this.loot = new LootSystem(this.renderer.scene, (choice) => {
        this.network.submitLootRoll(choice);
      });
    } catch (err) {
      console.error('3D Renderer initialization error:', err);
    }

    // Start Animation Loop
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.renderLoop(t));
  }

  // Load saved game progress & Persistent Covenant Account Profile
  loadGameProgress() {
    try {
      const rawProfile = localStorage.getItem('covenant_profile_v1');
      this.profile = rawProfile ? JSON.parse(rawProfile) : {
        shards: 300,
        unlockedAuras: [],
        cosmeticAura: null,
        title: 'Soul-Sworn',
        mightRank: 0,
        vitalityRank: 0,
        hasteRank: 0
      };
    } catch (e) {
      this.profile = { shards: 300, unlockedAuras: [], cosmeticAura: null, title: 'Soul-Sworn', mightRank: 0, vitalityRank: 0, hasteRank: 0 };
    }

    // Initialize Agnes AI's InAppPurchaseManager with our Emporium Catalog
    if (this.iap) {
      this.iap.init('web');
      this.iap.registerProduct('starter_pack', { name: 'Vanguard Starter Pack', price: 1.99, type: 'consumable' });
      this.iap.registerProduct('founder_pass', { name: "Founder's Sovereign Pass", price: 4.99, type: 'non_consumable' });
    }

    const save = this.saveSystem.load();
    if (save) {
      this.achievements.loadProgress();
      if (save.player) {
        this.selectedClass = save.player.classKey || 'juggernaut';
        document.getElementById('player-name-input').value = save.player.name || 'Hero';
      }
    }
    this.authToken = localStorage.getItem('covenant_auth_token') || null;
    if (this.authToken) {
      fetch(`/api/auth/me?token=${encodeURIComponent(this.authToken)}`)
        .then(r => r.json())
        .then(data => {
          if (data && data.ok && data.profile) {
            this.profile = { ...this.profile, ...data.profile };
            const badge = document.getElementById('auth-status-badge');
            if (badge) badge.innerText = `✅ Cloud Account Active: ${data.profile.displayName || data.profile.username}`;
            const nameInput = document.getElementById('player-name-input');
            if (nameInput && data.profile.displayName) nameInput.value = data.profile.displayName;
            this.syncEmporiumUI();
          }
        })
        .catch(() => {});
    }
    this.syncEmporiumUI();
  }

  saveProfile() {
    try {
      localStorage.setItem('covenant_profile_v1', JSON.stringify(this.profile));
    } catch (e) {}
    if (this.authToken) {
      fetch('/api/auth/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({ token: this.authToken, profile: this.profile })
      }).catch(() => {});
    }
    this.syncEmporiumUI();
  }

  syncEmporiumUI() {
    if (!this.profile) return;
    const s = this.profile.shards || 0;
    const el1 = document.getElementById('lobby-shard-balance');
    if (el1) el1.innerText = s;
    const el2 = document.getElementById('emporium-shard-balance');
    if (el2) el2.innerText = s;
    const el3 = document.getElementById('hud-hero-shards');
    if (el3) el3.innerText = `💎 ${s}`;

    const gsEl = document.getElementById('lobby-gear-score');
    if (gsEl) gsEl.innerText = this.profile.gearScore || (this.profile.equippedItem?.gearScore) || 100;
    const wepEl = document.getElementById('lobby-equipped-weapon');
    if (wepEl) {
      wepEl.innerText = this.profile.equippedItem ? `${this.profile.equippedItem.name} (GS ${this.profile.equippedItem.gearScore})` : 'Covenant Initiate Arms';
    }

    const rm = document.getElementById('rank-might');
    if (rm) rm.innerText = `Rank ${this.profile.mightRank || 0}`;
    const rv = document.getElementById('rank-vitality');
    if (rv) rv.innerText = `Rank ${this.profile.vitalityRank || 0}`;
    const rh = document.getElementById('rank-haste');
    if (rh) rh.innerText = `Rank ${this.profile.hasteRank || 0}`;

    document.querySelectorAll('.btn-cosmetic-buy').forEach(btn => {
      const aura = btn.getAttribute('data-aura');
      const cost = parseInt(btn.getAttribute('data-cost') || '200', 10);
      const isUnlocked = (this.profile.unlockedAuras || []).includes(aura);
      const isEquipped = this.profile.cosmeticAura === aura;
      if (isEquipped) {
        btn.innerText = '✅ EQUIPPED (3D ACTIVE)';
      } else if (isUnlocked) {
        btn.innerText = '✨ EQUIP 3D AURA';
      } else {
        btn.innerText = `Unlock (${cost} 💎)`;
      }
    });
  }

  // Save game progress
  saveGameProgress() {
    this.saveProfile();
    this.saveSystem.save({
      playerName: document.getElementById('player-name-input').value || 'Hero',
      playerClass: this.selectedClass,
      playerLevel: 1,
      playerXP: 0,
      playerGold: 0,
      playerSkills: {},
      playerInventory: [],
      currentZone: 'atrium',
      completedZones: [],
      bossDefeated: false,
      achievements: Array.from(this.achievements.unlocked),
      secretObjectives: []
    });
    this.achievements.saveProgress();
  }

  initClassSelectionUI() {
    const grid = document.getElementById('class-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const [key, info] of Object.entries(CLASSES)) {
      const btn = document.createElement('div');
      btn.className = `class-btn ${key === this.selectedClass ? 'selected' : ''}`;
      btn.setAttribute('data-class', key);
      btn.innerHTML = `
        <span class="class-icon">${info.icon}</span>
        <span class="class-name">${info.name}</span>
        <span class="class-role">${info.role}</span>
      `;
      btn.addEventListener('click', () => {
        this.selectClass(key);
        this.audio.playSFX('ui_select');
      });
      grid.appendChild(btn);
    }

    this.updateClassPreview();
  }

  selectClass(key) {
    this.selectedClass = key;
    document.querySelectorAll('.class-btn').forEach(b => {
      b.classList.toggle('selected', b.getAttribute('data-class') === key);
    });
    this.updateClassPreview();
    this.controls.setSkillInfo(CLASSES[key].abilities);
  }

  updateClassPreview() {
    const info = CLASSES[this.selectedClass];
    document.getElementById('preview-class-name').innerText = info.name;
    document.getElementById('preview-class-role').innerText = info.role;
    document.getElementById('preview-class-desc').innerText = info.desc;

    const abContainer = document.getElementById('preview-abilities');
    abContainer.innerHTML = '';
    info.abilities.forEach((ab, idx) => {
      const row = document.createElement('div');
      row.className = 'ability-row';
      row.innerHTML = `<span class="ability-tag">${ab.icon} ${ab.name}:</span><span class="ability-desc">${ab.desc}</span>`;
      abContainer.appendChild(row);
    });
  }

  initLobbyEvents() {
    // 0. Covenant Account Login / Register
    document.getElementById('btn-auth-login')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const username = document.getElementById('player-name-input')?.value.trim() || 'Vanguard';
      const password = document.getElementById('player-password-input')?.value || 'covenant';
      const badge = document.getElementById('auth-status-badge');
      if (badge) badge.innerText = '⏳ Authenticating...';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data && data.ok && data.profile) {
          this.authToken = data.token;
          localStorage.setItem('covenant_auth_token', data.token);
          this.profile = { ...this.profile, ...data.profile };
          this.saveProfile();
          this.audio.playSFX('powerup');
          if (badge) badge.innerText = `✅ Cloud Account Active: ${data.profile.displayName || username}`;
          this.narrator.say(`Welcome back, ${data.profile.displayName || username}! Cloud stats & gear restored.`, 'info');
        } else {
          if (badge) badge.innerText = `⚠️ ${data?.error || 'Auth failed'}`;
        }
      } catch (err) {
        if (badge) badge.innerText = '⚠️ Offline Local Mode';
      }
    });

    // 1. Instant Quickplay Auto-Matchmaking (Throws players directly into a live randomly generated dungeon together!)
    const quickplayBtn = document.getElementById('btn-quickplay-match');
    quickplayBtn?.addEventListener('click', () => {
      quickplayBtn.innerText = '⚔️ ENTERING RANDOM DUNGEON MATCH...';
      const name = document.getElementById('player-name-input')?.value.trim() || 'Vanguard';
      this.audio.playSFX('war_horn');
      this.network.quickplayMatchmaking(name, this.selectedClass, this.profile);
    });

    // Optional Private Chamber Create / Join
    const createBtn = document.getElementById('btn-create-room');
    createBtn?.addEventListener('click', () => {
      createBtn.innerText = 'CREATING CHAMBER...';
      const name = document.getElementById('player-name-input').value.trim() || 'Hero';
      this.audio.playSFX('ui_click');
      this.network.createRoom(name, this.selectedClass, this.profile);
    });

    const joinBtn = document.getElementById('btn-join-room');
    joinBtn?.addEventListener('click', () => {
      const name = document.getElementById('player-name-input').value.trim() || 'Hero';
      const code = document.getElementById('room-code-input').value.trim().toUpperCase();
      if (!code || code.length !== 4) {
        alert('Please enter a valid 4-letter room code.');
        return;
      }
      joinBtn.innerText = 'JOINING...';
      this.audio.playSFX('ui_click');
      this.network.joinRoom(code, name, this.selectedClass, this.profile);
    });

    // Open & Close Covenant Emporium & Sovereign Pass Modal
    const empModal = document.getElementById('emporium-modal');
    const openEmp = (e) => {
      e?.stopPropagation();
      this.audio.playSFX('ui_select');
      this.syncEmporiumUI();
      empModal?.classList.remove('hidden');
    };
    document.getElementById('btn-lobby-emporium')?.addEventListener('click', openEmp);
    document.getElementById('btn-hud-emporium')?.addEventListener('click', openEmp);
    document.getElementById('btn-close-emporium')?.addEventListener('click', (e) => {
      e.stopPropagation();
      empModal?.classList.add('hidden');
    });

    // 2. Unlock / Equip 3D Mythic Cosmetic Auras
    document.querySelectorAll('.btn-cosmetic-buy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const aura = btn.getAttribute('data-aura');
        const cost = parseInt(btn.getAttribute('data-cost') || '200', 10);
        const name = btn.getAttribute('data-name') || 'Mythic Aura';
        const title = btn.getAttribute('data-title') || 'Sovereign';
        if (!this.profile.unlockedAuras) this.profile.unlockedAuras = [];

        if (!this.profile.unlockedAuras.includes(aura)) {
          if ((this.profile.shards || 0) < cost) {
            this.narrator.say(`Need ${cost} Soul Shards (💎)! Slay Bosses or claim a Treasury Pack below.`, 'danger');
            return;
          }
          this.profile.shards -= cost;
          this.profile.unlockedAuras.push(aura);
        }

        this.profile.cosmeticAura = aura;
        this.profile.title = title;
        this.saveProfile();
        this.audio.playSFX('ui_select');
        this.narrator.say(`Equipped 3D Cosmetic: ${name}!`, 'info');

        if (this.gameState === 'dungeon' && this.network) {
          this.network.sendInput({ equipCosmetic: { aura, name, title } });
        }
      });
    });

    // 3. Permanent Account Soul-Tree Blessings
    document.querySelectorAll('.btn-blessing-buy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const bType = btn.getAttribute('data-blessing');
        const cost = parseInt(btn.getAttribute('data-cost') || '100', 10);
        if ((this.profile.shards || 0) < cost) {
          this.narrator.say(`Need ${cost} Soul Shards (💎) to awaken this Soul Blessing!`, 'danger');
          return;
        }
        this.profile.shards -= cost;
        if (bType === 'might') this.profile.mightRank = (this.profile.mightRank || 0) + 1;
        if (bType === 'vitality') this.profile.vitalityRank = (this.profile.vitalityRank || 0) + 1;
        if (bType === 'haste') this.profile.hasteRank = (this.profile.hasteRank || 0) + 1;
        this.saveProfile();
        this.audio.playSFX('ui_select');
        this.narrator.say(`Permanent Soul Blessing Awakened: ${bType.toUpperCase()}!`, 'info');

        if (this.gameState === 'dungeon' && this.network) {
          this.network.sendInput({ applyBlessing: bType });
        }
      });
    });

    // 4. Stripe Live .env Status Sync & Real Character Weapon/Aura Fulfillment
    const updateStripeBadge = async () => {
      const status = await this.iap.getStripeStatus();
      const badge = document.getElementById('stripe-mode-badge');
      if (badge) {
        if (status.stripeConfigured) {
          badge.innerText = '🔒 LIVE STRIPE .ENV CONNECTED';
          badge.style.background = 'rgba(46, 204, 113, 0.25)';
          badge.style.color = '#2ecc71';
          badge.style.borderColor = '#2ecc71';
        } else {
          badge.innerText = '⚡ STRIPE .ENV READY';
        }
      }
    };
    updateStripeBadge();

    const fulfillIAPProduct = (productId) => {
      if (!this.profile.unlockedAuras) this.profile.unlockedAuras = [];
      let grantedWeapon = null;

      if (productId === 'starter_pack') {
        this.profile.shards = (this.profile.shards || 0) + 500;
        if (!this.profile.unlockedAuras.includes('infernal')) this.profile.unlockedAuras.push('infernal');
        this.profile.cosmeticAura = 'infernal';
        this.profile.title = 'Hellfire Warlord';
        grantedWeapon = {
          id: 'iap_hellfire_cleaver',
          name: 'Hellfire Warlord Great-Blade (IAP)',
          slot: 'weapon',
          rarity: 'Legendary',
          color: '#ffaa00',
          beamColor: 0xffaa00,
          gearScore: 680,
          stats: { attackPower: 45, maxHp: 180, critChance: 0.15, lifesteal: 0.10, cooldownHaste: 0.12 }
        };
        this.narrator.say('🔥 Vanguard Starter Pack Equipped! +500 Shards, 3D Infernal Crown & Hellfire Great-Blade (GS 680: +45 ATK, +180 HP, +15% CRIT)!', 'info');
      } else if (productId === 'founder_pass') {
        this.profile.shards = (this.profile.shards || 0) + 1500;
        if (!this.profile.unlockedAuras.includes('sovereign')) this.profile.unlockedAuras.push('sovereign');
        this.profile.cosmeticAura = 'sovereign';
        this.profile.title = 'Sovereign Ascendant';
        this.profile.mightRank = (this.profile.mightRank || 0) + 1;
        this.profile.vitalityRank = (this.profile.vitalityRank || 0) + 1;
        this.profile.hasteRank = (this.profile.hasteRank || 0) + 1;
        grantedWeapon = {
          id: 'iap_sovereign_relicblade',
          name: 'Sovereign Seraph Relic-Blade (IAP)',
          slot: 'weapon',
          rarity: 'Mythic Covenant',
          color: '#ff2255',
          beamColor: 0xff2255,
          gearScore: 1150,
          stats: { attackPower: 85, maxHp: 350, critChance: 0.25, lifesteal: 0.18, cooldownHaste: 0.20, moveSpeed: 1.5 }
        };
        this.narrator.say("👑 Founder's Sovereign Pass Equipped! +1,500 Shards, 3D Seraph Wings & Sovereign Relic-Blade (GS 1150: +85 ATK, +350 HP)!", 'info');
      } else if (productId === 'mythic_3d_arsenal') {
        this.profile.shards = (this.profile.shards || 0) + 3500;
        ['infernal', 'frost', 'void', 'sovereign'].forEach(a => {
          if (!this.profile.unlockedAuras.includes(a)) this.profile.unlockedAuras.push(a);
        });
        this.profile.cosmeticAura = 'sovereign';
        this.profile.title = 'Grand Architect of the Covenant';
        this.profile.mightRank = (this.profile.mightRank || 0) + 2;
        this.profile.vitalityRank = (this.profile.vitalityRank || 0) + 2;
        this.profile.hasteRank = (this.profile.hasteRank || 0) + 2;
        grantedWeapon = {
          id: 'iap_godslayer_scythe',
          name: "Malakor's Godslayer Astral Scythe (IAP)",
          slot: 'weapon',
          rarity: 'Mythic Covenant',
          color: '#ff2255',
          beamColor: 0xff2255,
          gearScore: 1650,
          stats: { attackPower: 140, maxHp: 600, critChance: 0.35, lifesteal: 0.25, cooldownHaste: 0.30, moveSpeed: 2.2 }
        };
        this.narrator.say("⚔️ Mythic 3D Arsenal Equipped! +3,500 Shards, All 4 3D Auras & Malakor's Godslayer Scythe (GS 1650: +140 ATK, +600 HP)!", 'info');
      }

      if (grantedWeapon) {
        this.profile.equippedItem = grantedWeapon;
        this.profile.gearScore = Math.max(this.profile.gearScore || 100, grantedWeapon.gearScore);
      }

      this.saveProfile();
      this.audio.playSFX('war_horn');

      if (this.gameState === 'dungeon' && this.network) {
        this.network.sendInput({
          equipCosmetic: { aura: this.profile.cosmeticAura, name: this.profile.title, title: this.profile.title },
          equipIAPItem: grantedWeapon
        });
      }
    };

    // Check URL query params for Stripe Checkout return (?stripe_success=1&product_id=...)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('stripe_success') === '1') {
      const prodId = urlParams.get('product_id') || 'founder_pass';
      const sessId = urlParams.get('session_id') || '';
      fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessId)}&product_id=${encodeURIComponent(prodId)}&token=${encodeURIComponent(this.authToken || '')}`)
        .catch(() => {})
        .finally(() => {
          setTimeout(() => fulfillIAPProduct(prodId), 500);
        });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    document.getElementById('btn-iap-starter')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.iap.purchase('starter_pack');
      fulfillIAPProduct('starter_pack');
    });

    document.getElementById('btn-iap-founder')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.iap.purchase('founder_pass');
      fulfillIAPProduct('founder_pass');
    });

    document.getElementById('btn-iap-mythic-bundle')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.iap.purchase('mythic_3d_arsenal');
      fulfillIAPProduct('mythic_3d_arsenal');
    });

    // 4. Procedural Dungeon Floor Generator Button & Hotkey (N)
    const triggerFloorGen = (e) => {
      e?.stopPropagation();
      if (this.gameState === 'dungeon' && this.network && this.network.ws && this.network.ws.readyState === 1) {
        this.audio.playSFX('war_horn');
        this.network.ws.send(JSON.stringify({ type: 'generate_new_floor' }));
      }
    };
    document.getElementById('btn-generate-floor')?.addEventListener('click', triggerFloorGen);
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'n' || e.key === 'N') && this.gameState === 'dungeon' && document.activeElement?.tagName !== 'INPUT') {
        triggerFloorGen();
      }
    });

    // 5. Tactical Command Bar & Universal Dreadweaver Skill Deck
    const sendTacticalCmd = (command) => {
      if (this.gameState !== 'dungeon' || !this.network || !this.network.ws || this.network.ws.readyState !== 1) return;
      const aimX = this.controls?.currentTarget ? this.controls.currentTarget.x : (this.controls?.cursorWorldPos?.x || 0);
      const aimZ = this.controls?.currentTarget ? this.controls.currentTarget.z : (this.controls?.cursorWorldPos?.z || 0);
      if (command === 'heal') this.audio.playSFX('heal');
      else if (command === 'bone_spikes') this.audio.playSFX('bone');
      else if (command === 'corpse_explosion') this.audio.playSFX('explosion');
      else if (command === 'loot') this.audio.playSFX('loot');
      else if (command === 'attack') this.audio.playSFX('war_horn');
      else this.audio.playSFX('spell');

      this.network.ws.send(JSON.stringify({
        type: 'tactical_command',
        command,
        x: aimX,
        z: aimZ
      }));
    };

    const tacMap = {
      'btn-tac-attack': 'attack',
      'btn-tac-regroup': 'regroup',
      'btn-tac-loot': 'loot',
      'btn-tac-heal': 'heal',
      'btn-tac-spikes': 'bone_spikes',
      'btn-tac-drain': 'soul_drain',
      'btn-tac-explosion': 'corpse_explosion'
    };
    Object.entries(tacMap).forEach(([btnId, cmd]) => {
      document.getElementById(btnId)?.addEventListener('click', (e) => {
        e.stopPropagation();
        sendTacticalCmd(cmd);
      });
    });

    // Covenant Gold Forge Drawer & Upgrade Buttons
    const forgePanel = document.getElementById('forge-panel');
    document.getElementById('btn-forge-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('forge');
      forgePanel?.classList.toggle('hidden');
    });
    document.getElementById('btn-close-forge')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      forgePanel?.classList.add('hidden');
    });
    document.getElementById('btn-close-forge-x')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      forgePanel?.classList.add('hidden');
    });
    document.getElementById('btn-close-secret-x')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      document.getElementById('secret-card-panel')?.classList.add('hidden');
    });
    document.getElementById('btn-forge-weapon')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('forge');
      this.network.sendInput({ forgeUpgrade: 'weapon' });
    });
    document.getElementById('btn-forge-armor')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('forge');
      this.network.sendInput({ forgeUpgrade: 'armor' });
    });
    document.getElementById('btn-forge-elixir')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('heal');
      this.network.sendInput({ forgeUpgrade: 'elixir' });
    });

    // 6. Universal HUD Minimize / Collapse / Close Controls & Clean-View Toggle [H]
    this.hudCleanMode = false;

    const bindMinimizeToggle = (btnId, targetId, expandedText, collapsedText) => {
      const btn = document.getElementById(btnId);
      const target = document.getElementById(targetId);
      if (!btn || !target) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.playSFX('ui_click');
        const isHidden = target.classList.toggle('hidden');
        btn.innerText = isHidden ? collapsedText : expandedText;
      });
    };

    bindMinimizeToggle('btn-min-party', 'party-hud-list', '👥 PARTY [−]', '👥 PARTY [+]');
    bindMinimizeToggle('btn-min-boss', 'boss-hp-track-container', '[−]', '[+]');
    bindMinimizeToggle('btn-min-quest', 'hud-quest-text', '[−]', '[+]');
    bindMinimizeToggle('btn-min-right-stack', 'right-hud-body', '🗺️ MAP [−]', '🗺️ MAP [+]');
    bindMinimizeToggle('btn-min-proc-floor', 'proc-floor-details', '[−]', '[+]');
    bindMinimizeToggle('btn-min-tactical', 'tactical-buttons-group', '⚔️ [−]', '⚔️ [+]');

    // Start with Tactical Deck & Procedural Floor details minimized so the 3D screen is clean on entry
    document.getElementById('tactical-buttons-group')?.classList.add('hidden');
    const tacMinBtn = document.getElementById('btn-min-tactical');
    if (tacMinBtn) tacMinBtn.innerText = '⚔️ [+]';

    const toggleCleanHUD = (e) => {
      e?.stopPropagation();
      this.hudCleanMode = !this.hudCleanMode;
      this.audio.playSFX('ui_click');
      const cleanBtn = document.getElementById('btn-clean-hud');
      if (cleanBtn) {
        cleanBtn.innerText = this.hudCleanMode ? '👁️ UI [+] (H)' : '👁️ UI [H]';
        cleanBtn.style.borderColor = this.hudCleanMode ? 'rgba(52, 211, 153, 0.7)' : 'rgba(251, 191, 36, 0.5)';
        cleanBtn.style.color = this.hudCleanMode ? '#6ee7b7' : '#fde68a';
      }

      const panels = [
        { list: 'party-hud-list', btn: 'btn-min-party', exp: '👥 PARTY [−]', col: '👥 PARTY [+]' },
        { list: 'hud-quest-text', btn: 'btn-min-quest', exp: '[−]', col: '[+]' },
        { list: 'right-hud-body', btn: 'btn-min-right-stack', exp: '🗺️ MAP [−]', col: '🗺️ MAP [+]' },
        { list: 'tactical-buttons-group', btn: 'btn-min-tactical', exp: '⚔️ [−]', col: '⚔️ [+]' }
      ];

      panels.forEach(p => {
        const el = document.getElementById(p.list);
        const b = document.getElementById(p.btn);
        if (el) {
          if (this.hudCleanMode) el.classList.add('hidden');
          else el.classList.remove('hidden');
        }
        if (b) b.innerText = this.hudCleanMode ? p.col : p.exp;
      });

      if (this.hudCleanMode) {
        document.getElementById('narrator-banner')?.classList.add('hidden');
        document.getElementById('forge-panel')?.classList.add('hidden');
        document.getElementById('secret-card-panel')?.classList.add('hidden');
      }
    };

    document.getElementById('btn-clean-hud')?.addEventListener('click', toggleCleanHUD);

    const toggleAudio = (e) => {
      e?.stopPropagation();
      if (!this.audio) return;
      this.audio.init();
      const isEnabled = this.audio.toggle();
      const label = document.getElementById('audio-toggle-label');
      const btn = document.getElementById('btn-audio-toggle');
      if (label) label.innerText = isEnabled ? 'AUDIO ON' : 'MUTED';
      if (btn) {
        btn.style.borderColor = isEnabled ? '#34d399' : '#f87171';
        btn.style.background = isEnabled ? 'rgba(16, 65, 48, 0.88)' : 'rgba(69, 18, 24, 0.88)';
      }
      if (isEnabled) {
        this.audio.startAmbient();
        this.audio.playSFX('ui_select');
      }
    };
    document.getElementById('btn-audio-toggle')?.addEventListener('click', toggleAudio);

    // Keyboard Shortcuts: [H] Clean HUD Toggle, [M] Audio Toggle, [Escape] Close Any Open Popup/Drawer/Modal
    window.addEventListener('keydown', (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if ((e.key === 'h' || e.key === 'H') && this.gameState === 'dungeon') {
        toggleCleanHUD();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleAudio();
      } else if (e.key === 'Escape') {
        document.getElementById('emporium-modal')?.classList.add('hidden');
        document.getElementById('forge-panel')?.classList.add('hidden');
        document.getElementById('secret-card-panel')?.classList.add('hidden');
        document.getElementById('need-greed-modal')?.classList.add('hidden');
        document.getElementById('narrator-banner')?.classList.add('hidden');
        document.getElementById('ping-wheel')?.classList.add('hidden');
      }
    });

    // Click backdrop of Emporium Modal or Need/Greed Modal to close
    document.getElementById('emporium-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'emporium-modal') {
        e.currentTarget.classList.add('hidden');
      }
    });
    document.getElementById('need-greed-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'need-greed-modal') {
        e.currentTarget.classList.add('hidden');
      }
    });
    document.getElementById('btn-close-need-greed')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('need-greed-modal')?.classList.add('hidden');
    });

    // Start Game from Room Lobby
    document.getElementById('btn-start-game').addEventListener('click', () => {
      this.audio.playSFX('ui_select');
      this.network.startGame();
    });

    // Return to Lobby after Victory/Defeat
    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this.saveGameProgress();
      window.location.reload();
    });

    // In-game Exit to Lobby
    const hudLobbyBtn = document.getElementById('btn-hud-lobby');
    if (hudLobbyBtn) {
      hudLobbyBtn.addEventListener('click', () => {
        this.audio.playSFX('ui_click');
        window.location.reload();
      });
    }

    // Camera Control Toolbar Buttons (Zoom, Rotate, Overview)
    document.getElementById('btn-cam-zoom-out')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      if (this.renderer) this.renderer.zoomBy(4.0);
    });
    document.getElementById('btn-cam-zoom-in')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      if (this.renderer) this.renderer.zoomBy(-4.0);
    });
    document.getElementById('btn-cam-rot-left')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      if (this.renderer) this.renderer.rotateBy(-Math.PI / 4);
    });
    document.getElementById('btn-cam-rot-right')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      if (this.renderer) this.renderer.rotateBy(Math.PI / 4);
    });
    document.getElementById('btn-cam-overview')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playSFX('ui_click');
      if (this.renderer) {
        const isOverview = this.renderer.toggleTacticalOverview();
        e.currentTarget.innerText = isOverview ? '🗺️ CLOSE' : '🗺️ FAR';
      }
    });

    // 3D Tap / Click to Target Enemy
    if (this.container) {
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      this.container.addEventListener('pointerdown', (e) => {
        if (this.gameState !== 'dungeon' || !this.renderer || !this.entities) return;
        if (e.target.closest('#joystick-zone') || e.target.closest('#ability-controls') || e.target.closest('.hud-btn') || e.target.closest('#ping-wheel')) return;

        const rect = this.container.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, this.renderer.camera);
        const targets = [];
        if (this.entities.bossMesh) targets.push(this.entities.bossMesh);
        for (const m of this.entities.mobMeshes.values()) targets.push(m);

        const intersects = raycaster.intersectObjects(targets, true);
        if (intersects.length > 0) {
          let hitObj = intersects[0].object;
          while (hitObj.parent && hitObj.parent !== this.renderer.scene && !hitObj.userData.barCanvas) {
            hitObj = hitObj.parent;
          }

          if (hitObj === this.entities.bossMesh && this.latestSnapshot?.boss) {
            this.controls.setTarget(this.latestSnapshot.boss);
            this.entities.setTargetLock(this.latestSnapshot.boss);
          } else {
            for (const [id, mesh] of this.entities.mobMeshes.entries()) {
              if (hitObj === mesh || mesh.children.includes(hitObj)) {
                const mobData = this.latestSnapshot?.mobs?.find(m => m.id === id);
                if (mobData) {
                  this.controls.setTarget(mobData);
                  this.entities.setTargetLock(mobData);
                }
                break;
              }
            }
          }
        }
      });
    }

    // Audio context activation on first user interaction
    const activateAudio = () => {
      this.audio.init();
      this.audio.resume();
      document.removeEventListener('click', activateAudio);
      document.removeEventListener('touchstart', activateAudio);
    };
    document.addEventListener('click', activateAudio);
    document.addEventListener('touchstart', activateAudio);
  }

  initNetwork() {
    this.network = new NetworkClient({
      on_connect: () => {
        const badge = document.getElementById('connection-status-badge');
        const text = document.getElementById('status-text');
        if (badge) badge.classList.add('connected');
        if (text) text.innerText = 'Connected to Server';
        // UI overhaul track: loading done -> reveal the lobby
        if (this.ui && this.ui.screens) {
          this.ui.screens.loading.setProgress(100, 'Ready');
          this.ui.screens.loading.hide();
          document.getElementById('lobby-screen')?.classList.remove('hidden');
        }
      },
      on_disconnect: () => {
        const badge = document.getElementById('connection-status-badge');
        const text = document.getElementById('status-text');
        if (badge) badge.classList.remove('connected');
        if (text) text.innerText = 'Reconnecting to Server...';
      },
      room_created: (msg) => {
        const createBtn = document.getElementById('btn-create-room');
        if (createBtn) createBtn.innerText = 'CREATE NEW CHAMBER';
        this.currentRoomCode = msg.roomCode;
        this.localPlayerId = msg.player.id;
        this.showRoomLobby(msg.roomCode, msg.room);
        this.audio.playSFX('ui_select');
      },
      room_joined: (msg) => {
        const joinBtn = document.getElementById('btn-join-room');
        if (joinBtn) joinBtn.innerText = 'JOIN CHAMBER';
        this.currentRoomCode = msg.roomCode;
        this.localPlayerId = msg.player.id;
        this.showRoomLobby(msg.roomCode, msg.room);
        this.audio.playSFX('ui_select');
      },
      player_joined: (msg) => {
        this.narrator.say(`${msg.player.name} (${msg.player.role}) entered the chamber.`, 'info');
        this.audio.playSFX('ui_select');
      },
      dungeon_started: (msg) => {
        this.enterDungeon();
        this.audio.startAmbient();
      },
      secret_objective_assigned: (msg) => {
        const obj = msg.objective;
        document.getElementById('secret-title').innerText = obj.title;
        document.getElementById('secret-desc').innerText = obj.desc;
        this.narrator.say(`Secret Goal Received: ${obj.title}`, 'info');
        this.audio.playSFX('powerup');
      },
      tick: (msg) => {
        this.handleSnapshot(msg.snapshot);
      },
      narrator_announcement: (msg) => {
        this.narrator.say(msg.text, msg.tone);
      },
      party_ping: (msg) => {
        this.combat.spawnPartyPing(msg.pingType, msg.x, msg.z, msg.playerName);
        this.narrator.say(`${msg.playerName}: ${msg.pingType.toUpperCase()}!`, 'info');
      },
      player_attack_fx: (msg) => {
        this.entities.triggerAttackAnimation(msg.playerId);
        if (msg.playerId !== this.localPlayerId) {
          const p = this.latestSnapshot?.players?.find(pl => pl.id === msg.playerId);
          if (p) {
            this.combat.spawnAttackSlash(p.x, p.z, p.rotation, 0xffaa44);
            this.audio.playSFX('attack', { classKey: p.classKey || 'juggernaut' });
          }
        }
      },
      dash_fx: (msg) => {
        this.combat.spawnDashFX(msg.startX, msg.startZ, msg.endX, msg.endZ);
        this.audio.playSFX('dash');
      },
      level_up: (msg) => {
        this.combat.spawnLevelUpFX(msg.x, msg.z, msg.level, msg.playerName || msg.name);
        this.audio.playSFX('levelup');
        if (msg.playerId === this.localPlayerId) {
          this.narrator.say(`HERO LEVEL ${msg.level}! Attack Power & Max HP Increased!`, 'info');
        }
      },
      shards_earned: (msg) => {
        if (this.profile) {
          this.profile.shards = (this.profile.shards || 0) + (msg.amount || 5);
          this.saveProfile();
        }
        if (msg.amount >= 20) {
          this.combat.spawnFloatingText(msg.x || 0, msg.z || 0, `💎 +${msg.amount} SOUL SHARDS!`, 'combo');
          this.audio.playSFX('gold');
        }
      },
      ground_fx: (msg) => {
        if (msg.fxType === 'bone_spikes') {
          this.combat.spawnBoneSpikes(msg.startX, msg.startZ, msg.dirX, msg.dirZ, msg.length);
          this.audio.playSFX('bone');
        } else if (msg.fxType === 'corpse_explosion') {
          this.combat.spawnCorpseExplosion(msg.x, msg.z, msg.radius, msg.usedCorpse);
          this.audio.playSFX('explosion');
        } else if (msg.fxType === 'frost_nova') {
          this.combat.spawnFloatingText('❄️ FROST NOVA!', msg.x, msg.z, 'crit');
          this.audio.playSFX('frost');
        } else if (msg.fxType === 'seismic_vortex') {
          this.combat.spawnFloatingText('🌀 SEISMIC VORTEX!', msg.x, msg.z, 'crit');
          this.audio.playSFX('explosion');
        }
      },
      beam_fx: (msg) => {
        if (msg.beamType === 'soul_drain') {
          this.combat.spawnSoulDrainBeam(msg.sourceX, msg.sourceZ, msg.targetX, msg.targetZ, msg.color);
          this.audio.playSFX('heal');
        } else {
          this.combat.spawnBeam(msg.sourceX, msg.sourceZ, msg.targetX, msg.targetZ, msg.color);
          this.audio.playSFX('spell');
        }
      },
      floating_text: (msg) => {
        this.combat.spawnFloatingText(msg.text, msg.x, msg.z, msg.style);
        const t = String(msg.text || '').toUpperCase();
        if (t.includes('JUMP SLAM')) {
          this.audio.playSFX('jump_slam');
        } else if (t.includes('CHEST') || t.includes('MYTHIC') || t.includes('LEGENDARY') || t.includes('RELIC')) {
          this.audio.playSFX('chest');
        } else if (t.includes('GOLD') || (t.includes('G') && msg.style === 'combo')) {
          this.audio.playSFX('gold');
        } else if (t.includes('FROZEN') || t.includes('SHATTER')) {
          this.audio.playSFX('frost');
        } else if (t.includes('INFERNAL') || t.includes('FIRE') || t.includes('METEOR')) {
          this.audio.playSFX('fireball');
        } else if (t.includes('HEAL') || t.includes('ELIXIR') || t.includes('SANCTUARY')) {
          this.audio.playSFX('heal');
        } else if (t.includes('FORGE') || t.includes('ARMOR') || t.includes('WEAPON')) {
          this.audio.playSFX('forge');
        }
      },
      combo_alert: (msg) => {
        this.combat.spawnFloatingText(`COMBO: ${msg.comboName}!`, msg.x, msg.z, 'combo');
        this.renderer.triggerScreenShake(0.35);
        this.audio.playSFX('frost');
      },
      boss_awakened: (msg) => {
        this.renderer.triggerScreenShake(0.85);
        this.narrator.say(`${msg.bossName} AWAKENS!`, 'danger');
        this.audio.setMusicMode('boss');
        this.audio.playSFX('explosion');
        const bossBar = document.getElementById('boss-hud-bar');
        if (bossBar) bossBar.classList.remove('hidden');
      },
      boss_phase_change: (msg) => {
        this.renderer.triggerScreenShake(0.7);
        this.narrator.say('THE SOUL-FORGE ERUPTS INTO FLAMES!', 'danger');
        this.audio.setMusicMode('boss');
        this.audio.playSFX('war_horn');
      },
      war_horn_triggered: (msg) => {
        document.getElementById('war-horn-overlay').classList.remove('hidden');
        this.audio.playSFX('war_horn');
      },
      war_horn_ended: () => {
        document.getElementById('war-horn-overlay').classList.add('hidden');
      },
      last_stand_activated: (msg) => {
        document.getElementById('last-stand-overlay').classList.remove('hidden');
        this.audio.playSFX('powerup');
      },
      telegraph_start: (msg) => {
        this.combat.handleTelegraphStart(msg.telegraph);
      },
      screen_shake: (msg) => {
        this.renderer.triggerScreenShake(msg.magnitude);
      },
      slow_mo_kill_cam: (msg) => {
        this.renderer.startKillCam(msg.bossX, msg.bossZ);
        this.renderer.triggerScreenShake(0.9);
        this.audio.setMusicMode('dungeon');
        this.audio.playSFX('kill');
      },
      start_need_greed: (msg) => {
        this.loot.showNeedGreedModal(msg.itemName, msg.duration);
        this.audio.playSFX('chest');
      },
      roll_submitted: (msg) => {
        this.loot.addRollResult(msg.playerName, msg.choice, msg.roll);
        this.audio.playSFX('ui_click');
      },
      roll_result: (msg) => {
        setTimeout(() => this.loot.hideNeedGreedModal(), 2500);
      },
      procedural_floor_generated: (msg) => {
        const cfg = msg.config;
        if (cfg) {
          this.updateProceduralHUD(cfg);
          if (this.dungeon && typeof this.dungeon.applyProceduralFloorConfig === 'function') {
            this.dungeon.applyProceduralFloorConfig(cfg);
          }
          this.renderer.triggerScreenShake(0.6);
          this.audio.setMusicMode('dungeon');
          this.audio.playSFX('war_horn');
        }
      },
      dynamic_loot_equipped: (msg) => {
        const it = msg.item;
        if (it) {
          if (it.rarity === 'Mythic Covenant' || it.rarity === 'Legendary') {
            this.audio.playSFX('chest');
          } else {
            this.audio.playSFX('loot');
          }
          const statParts = [];
          if (it.stats?.attackPower) statParts.push(`+${it.stats.attackPower} ATK`);
          if (it.stats?.maxHp) statParts.push(`+${it.stats.maxHp} HP`);
          if (it.stats?.critChance) statParts.push(`+${Math.round(it.stats.critChance * 100)}% CRIT`);
          if (it.stats?.lifesteal) statParts.push(`+${Math.round(it.stats.lifesteal * 100)}% LEECH`);
          if (it.stats?.cooldownHaste) statParts.push(`+${Math.round(it.stats.cooldownHaste * 100)}% HASTE`);
          this.narrator.say(`${msg.playerName} equipped [${it.rarity.toUpperCase()}] ${it.name} (GS ${it.gearScore}: ${statParts.join(', ')})!`, 'info');
        }
      },
      run_completed: (msg) => {
        this.showVictoryPodium(msg.summary);
        this.audio.setMusicMode('dungeon');
        this.audio.playSFX('levelup');
        this.achievements.unlock('boss_slayer');
      },
      party_wipe: (msg) => {
        this.audio.playSFX('hurt');
        alert('PARTY WIPE! The darkness consumed the covenant.');
        setTimeout(() => window.location.reload(), 2000);
      },
      error: (msg) => {
        alert(msg.message);
      }
    });
  }

  /**
   * Maps every player action/ability to the exact physical-modeling sound of the weapon/element/object
   */
  playActionSFX(action) {
    if (!this.audio) return;
    const cls = this.selectedClass || 'juggernaut';

    if (action === 'jump') {
      this.audio.playSFX('jump');
      return;
    }
    if (action === 'dash') {
      this.audio.playSFX('dash');
      return;
    }
    if (action === 'loot') {
      this.audio.playSFX('loot');
      return;
    }
    if (action === 'attack') {
      this.audio.playSFX('attack', { classKey: cls });
      return;
    }

    // Class-specific physical & elemental sounds for Skill 1 (Q), Skill 2 (E), Skill 3 (R)
    const skillSFXMap = {
      juggernaut: { skill1: 'forge', skill2: 'forge', skill3: 'explosion' },
      cleric:     { skill1: 'heal',  skill2: 'heal',  skill3: 'powerup' },
      rogue:      { skill1: 'dash',  skill2: 'fireball', skill3: 'attack' },
      mage:       { skill1: 'frost', skill2: 'fireball', skill3: 'explosion' },
      ranger:     { skill1: 'attack', skill2: 'forge', skill3: 'dash' },
      necromancer:{ skill1: 'bone',  skill2: 'heal',  skill3: 'explosion' }
    };
    const sfxType = skillSFXMap[cls]?.[action] || 'spell';
    this.audio.playSFX(sfxType, { classKey: cls });
  }

  updateProceduralHUD(cfg) {
    if (!cfg) return;
    const titleEl = document.getElementById('proc-floor-title');
    if (titleEl) titleEl.innerText = `FLOOR ${cfg.floorNumber || 1}`;
    const biomeEl = document.getElementById('proc-biome-name');
    if (biomeEl && cfg.biome) biomeEl.innerText = cfg.biome.name;
    const hexEl = document.getElementById('proc-hex-anomaly');
    if (hexEl && cfg.hexAnomaly) hexEl.innerText = `⚡ Anomaly: ${cfg.hexAnomaly.name}`;
    const descEl = document.getElementById('proc-hex-desc');
    if (descEl && cfg.hexAnomaly) descEl.innerText = cfg.hexAnomaly.desc;
    const seedEl = document.getElementById('proc-seed-val');
    if (seedEl && cfg.seed) seedEl.innerText = `SEED: ${cfg.seed}`;

    const detailsEl = document.getElementById('proc-floor-details');
    const minBtn = document.getElementById('btn-min-proc-floor');
    if (detailsEl && !this.hudCleanMode) {
      detailsEl.classList.remove('hidden');
      if (minBtn) minBtn.innerText = '[−]';
      clearTimeout(this._procDetailsTimeout);
      this._procDetailsTimeout = setTimeout(() => {
        detailsEl.classList.add('hidden');
        if (minBtn) minBtn.innerText = '[+]';
      }, 4000);
    }
  }

  showRoomLobby(roomCode, roomSnapshot) {
    this.gameState = 'in_room';
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('room-lobby-screen').classList.remove('hidden');
    document.getElementById('display-room-code').innerText = roomCode;
    this.updateLobbyPartyList(roomSnapshot.players);
  }

  updateLobbyPartyList(players) {
    const list = document.getElementById('lobby-party-list');
    if (!list) return;
    list.innerHTML = '';

    players.forEach(p => {
      const row = document.createElement('div');
      row.className = 'party-member-row';
      row.innerHTML = `
        <div class="member-info">
          <span class="member-name">${p.name} ${p.id === this.localPlayerId ? '(You)' : ''}</span>
          <span class="member-role-badge">${p.role || p.classKey}</span>
        </div>
        <span class="ready-status">Ready</span>
      `;
      list.appendChild(row);
    });
  }

  enterDungeon() {
    this.gameState = 'dungeon';
    document.getElementById('room-lobby-screen').classList.add('hidden');
    document.getElementById('game-hud').classList.remove('hidden');
    this.controls.setSkillInfo(CLASSES[this.selectedClass].abilities);
    this.audio.playSFX('powerup');
  }

  handleSnapshot(snap) {
    if (this.gameState !== 'dungeon') return;
    this.latestSnapshot = snap;

    // Sync Procedural Floor Config on first load or floor change
    if (snap.proceduralConfig && this.lastProceduralSeed !== snap.proceduralConfig.seed) {
      this.lastProceduralSeed = snap.proceduralConfig.seed;
      this.updateProceduralHUD(snap.proceduralConfig);
      if (this.dungeon && typeof this.dungeon.applyProceduralFloorConfig === 'function') {
        this.dungeon.applyProceduralFloorConfig(snap.proceduralConfig);
      }
    }

    // 1. Sync Players
    this.entities.syncPlayers(snap.players, this.localPlayerId);

    // 2. Sync Mobs
    this.entities.syncMobs(snap.mobs);

    // 3. Sync Boss
    this.entities.syncBoss(snap.boss);
    this.updateBossHUD(snap.boss);

    // 4. Sync Projectiles & Ground Effects
    this.combat.syncProjectiles(snap.projectiles);
    this.combat.syncGroundEffects(snap.groundEffects);

    // 5. Sync Floor Loot
    this.loot.syncFloorLoot(snap.floorLoot);

    // 6. Update Party HUD & Quest Banner
    this.updatePartyHUD(snap.players);

    // UI overhaul track: vitals + death screen from real snapshot data
    if (this.ui && this.ui.hud) {
      const lp = snap.players.find(p => p.id === this.localPlayerId);
      if (lp) {
        this.ui.hud.updateVitals({ hp: lp.hp, maxHp: lp.maxHp, mana: lp.mana, maxMana: lp.maxMana });
        if (this.ui.screens) {
          if (lp.isDowned && !this.ui.screens.death.isOpen) {
            this.ui.screens.death.show({ floor: snap.floor ?? 1 });
          } else if (!lp.isDowned && this.ui.screens.death.isOpen) {
            this.ui.screens.death.hide();
          }
        }
      }
    }

    const questTextEl = document.getElementById('hud-quest-text');
    if (questTextEl) {
      const seals = snap.sanctumSealsRemaining ?? 2;
      const broken = 2 - seals;
      if (snap.boss && snap.boss.isDead) {
        questTextEl.innerText = '🏆 VICTORY! Claim Malakor\'s Molten Great-Relic Chest!';
      } else if (seals > 0) {
        questTextEl.innerText = `QUEST: Shatter Wing Soul-Seals (${broken}/2) • Malakor Ward: ${seals * 25}% DMG Reduction`;
      } else {
        questTextEl.innerText = '🔥 SANCTUM UNSEALED! Storm the South Soul-Forge (Malakor +20% Vulnerable!)';
      }
    }
  }

  updateBossHUD(boss) {
    const bossHud = document.getElementById('boss-hud-bar');
    if (!bossHud) return;

    if (!boss || boss.isDead || !boss.isAwake) {
      bossHud.classList.add('hidden');
      if (this.audio) this.audio.setMusicMode('dungeon');
      return;
    }

    if (this.audio) this.audio.setMusicMode('boss');
    bossHud.classList.remove('hidden');
    document.getElementById('boss-name').innerText = boss.name;
    // UI overhaul track: toast on real boss phase transitions
    if (this.ui && this.ui.hud && boss.phase !== this._lastBossPhase) {
      if (this._lastBossPhase !== undefined) {
        this.ui.hud.toast(`Malakor — Phase ${boss.phase}`, 'red');
      }
      this._lastBossPhase = boss.phase;
    }
    const seals = boss.sealsRemaining ?? 2;
    const sealTag = seals > 0 ? `🛡️ ${seals} SEAL${seals > 1 ? 'S' : ''} (${seals * 25}% WARD)` : '🔓 UNSEALED (+20% DMG)';
    document.getElementById('boss-phase-tag').innerText = `PHASE ${boss.phase} • ${sealTag} ${boss.isEnraged ? '🔥 ENRAGED' : ''}`;

    const pct = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100));
    document.getElementById('boss-hp-fill').style.width = `${pct}%`;
    document.getElementById('boss-hp-text').innerText = `${Math.round(pct)}%`;
  }

  updatePartyHUD(players) {
    const hudList = document.getElementById('party-hud-list');
    if (!hudList) return;
    hudList.innerHTML = '';

    players.forEach(p => {
      const portrait = document.createElement('div');
      portrait.className = `party-portrait-hud ${p.isDowned ? 'downed' : ''}`;
      const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));

      portrait.innerHTML = `
        <span class="portrait-icon">${CLASSES[p.classKey]?.icon || '🛡️'}</span>
        <div class="portrait-bars">
          <span class="portrait-name">Lv.${p.level || 1} ${p.name} ${p.isDowned ? '💀 DOWNED' : ''}</span>
          <div class="portrait-hp-track">
            <div class="portrait-hp-fill" style="width: ${hpPct}%;"></div>
          </div>
        </div>
      `;
      hudList.appendChild(portrait);

      // Update Local Hero Level, XP, Gold, Shards, Relics & Cooldown Sweeps
      if (p.id === this.localPlayerId) {
        const lvlEl = document.getElementById('hud-hero-level');
        if (lvlEl) lvlEl.innerText = `LVL ${p.level || 1}`;
        const xpEl = document.getElementById('hud-xp-fill');
        if (xpEl && p.nextLevelXp) {
          const xpPct = Math.max(0, Math.min(100, ((p.xp || 0) / p.nextLevelXp) * 100));
          xpEl.style.width = `${xpPct}%`;
        }
        const goldEl = document.getElementById('hud-hero-gold');
        if (goldEl) goldEl.innerText = `💰 ${p.gold || 0}g`;
        const shardsEl = document.getElementById('hud-hero-shards');
        if (shardsEl && this.profile) shardsEl.innerText = `💎 ${this.profile.shards || 0}`;

        const eq = p.equipment || {};
        const wCost = document.getElementById('forge-weapon-cost');
        if (wCost) wCost.innerText = `80g (Rank ${eq.weaponLevel || 0})`;
        const aCost = document.getElementById('forge-armor-cost');
        if (aCost) aCost.innerText = `80g (Rank ${eq.armorLevel || 0})`;

        const relicsEl = document.getElementById('hud-relics-summary');
        if (relicsEl) {
          const rList = eq.relics || [];
          const dmgBonus = Math.round(((p.damageBuff || 1) - 1) * 100);
          const hasteBonus = Math.round(((p.cooldownHaste || 1) - 1) * 100);
          const leachBonus = Math.round((p.lifesteal || 0) * 100);
          const gearLine = p.equippedItem
            ? `<div style="color:${p.equippedItem.color || '#ffaa22'}; font-weight:700; margin-top:2px;">⚔️ Gear: [${p.equippedItem.rarity.toUpperCase()}] ${p.equippedItem.name} (GS ${p.gearScore || p.equippedItem.gearScore || 0})</div>`
            : `<div style="color:#a89bb8; margin-top:2px;">⚔️ Gear Score: ${p.gearScore || 0} (Slay mobs or click 🧲 Loot!)</div>`;
          relicsEl.innerHTML = `
            <div><strong>Relics:</strong> ${rList.length ? rList.join(' &bull; ') : 'None (Slay Wing Mini-Bosses)'}</div>
            ${gearLine}
            <div style="color:#ffd700; margin-top:3px;">Stats: +${dmgBonus}% DMG &bull; +${hasteBonus}% Haste &bull; ${leachBonus}% Lifesteal</div>
          `;
        }

        // Update Live Ability Cooldown Sweep Overlays
        const cds = p.cooldowns || {};
        const maxCds = { skill1: 3.5, skill2: 6.0, skill3: 10.0, dash: 3.0 };
        const updateCdEl = (elId, rem, max) => {
          const el = document.getElementById(elId);
          if (!el) return;
          const pct = rem > 0.05 ? Math.min(100, (rem / max) * 100) : 0;
          el.style.height = `${pct}%`;
          el.innerText = rem > 0.1 ? `${rem.toFixed(1)}s` : '';
        };
        updateCdEl('skill-1-cd', cds.skill1 || 0, maxCds.skill1);
        updateCdEl('skill-2-cd', cds.skill2 || 0, maxCds.skill2);
        updateCdEl('skill-3-cd', cds.skill3 || 0, maxCds.skill3);
        updateCdEl('dash-cd', cds.dash || 0, maxCds.dash);
      }
    });
  }

  showVictoryPodium(summary) {
    this.gameState = 'victory';
    document.getElementById('game-hud').classList.add('hidden');
    document.getElementById('victory-screen').classList.remove('hidden');

    document.getElementById('final-party-score').innerText = summary.score.toLocaleString();

    // Play of the Game
    const potg = summary.playOfTheGame;
    document.getElementById('potg-hero-name').innerText = potg.heroName;
    document.getElementById('potg-title').innerText = potg.title;
    document.getElementById('potg-desc').innerText = potg.description;

    // Party stats & secret objective reveals
    const tbody = document.getElementById('podium-stats-body');
    tbody.innerHTML = '';
    summary.players.forEach(p => {
      const tr = document.createElement('tr');
      const objTitle = p.secretObjective ? p.secretObjective.title : 'None';
      const statusIcon = p.secretCompleted ? '✅ Passed' : '❌ Failed';
      tr.innerHTML = `
        <td><strong>${p.name}</strong></td>
        <td>${p.role}</td>
        <td>${p.damageDealt}</td>
        <td>💰 ${p.goldCollected}</td>
        <td>${objTitle} (${statusIcon})</td>
      `;
      tbody.appendChild(tr);
    });

    // Unlock achievement
    this.achievements.unlock('boss_slayer');
    this.saveGameProgress();
  }

  renderLoop(time) {
    const dt = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;

    // Auto-Aim & Target Lock
    if (this.latestSnapshot && this.latestSnapshot.players) {
      const localP = this.latestSnapshot.players.find(p => p.id === this.localPlayerId);
      if (localP) {
        this.controls.setPlayerPos(localP.x, localP.z);

        // Find nearest living enemy within 18m (boss only if awake!)
        let bestTarget = null;
        let minDist = 18.0;

        if (this.latestSnapshot.boss && !this.latestSnapshot.boss.isDead && this.latestSnapshot.boss.isAwake) {
          const d = Math.hypot(this.latestSnapshot.boss.x - localP.x, this.latestSnapshot.boss.z - localP.z);
          if (d < minDist) {
            minDist = d;
            bestTarget = this.latestSnapshot.boss;
          }
        }

        if (this.latestSnapshot.mobs) {
          for (const m of this.latestSnapshot.mobs) {
            const d = Math.hypot(m.x - localP.x, m.z - localP.z);
            if (d < minDist) {
              minDist = d;
              bestTarget = m;
            }
          }
        }

        this.controls.setTarget(bestTarget);
        this.entities.setTargetLock(bestTarget);
        this.updateMinimap(this.latestSnapshot, localP);
      }
    }

    // Sync Camera Yaw to Controls so Joystick/WASD moves relative to current camera angle
    if (this.renderer && this.controls) {
      this.controls.setCameraYaw(this.renderer.cameraYaw);
    }

    // Update Controls
    this.controls.update(dt);

    // Update Visuals & Animations
    this.combat.update(dt);
    this.loot.update(dt);
    this.entities.update(dt);
    // levels track: biome atmosphere tick (fog, torch flicker, particles)
    if (this.dungeon && typeof this.dungeon.update === 'function') {
      this.dungeon.update(dt, time * 0.001);
    }

    // Update Camera Target (Follow local player)
    let localMesh = this.entities.playerMeshes.get(this.localPlayerId);
    const followPos = localMesh ? localMesh.position : null;
    this.renderer.update(dt, followPos);

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  updateMinimap(snap, localP) {
    const canvas = document.getElementById('dungeon-minimap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Coordinate transform: world X in [-60, 60] -> [0, W], world Z in [-96, 32] -> [0, H]
    const toMapX = (wx) => ((wx + 60) / 120) * W;
    const toMapY = (wz) => ((wz + 96) / 128) * H;

    // Draw 7-Zone Citadel Floorplan Rectangles
    const rooms = [
      [-14, 14, 10, 28, '#282138'],   // 1. Atrium
      [-5, 5, -2, 10, '#231c30'],     // 2. Narthex
      [-18, 18, -26, -2, '#2d243f'],  // 3. Grand Crossroads
      [-30, -18, -18, -10, '#231c30'],// West Corridor
      [-54, -30, -28, 0, '#3a1a28'],  // 4. West Blood Reliquary
      [18, 30, -18, -10, '#231c30'],  // East Corridor
      [30, 54, -28, 0, '#182b44'],    // 5. East Alchemist's Vault
      [-6, 6, -44, -24, '#2b2024'],   // 6A. Abyssal Bridge (FIXED)
      [-16, 16, -56, -42, '#282138'], // 6B. Antechamber
      [-24, 24, -92, -56, '#3b1c18']  // 7. Boss Sanctum
    ];

    ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
    ctx.lineWidth = 1;
    for (const [minX, maxX, minZ, maxZ, fill] of rooms) {
      const rx = toMapX(minX);
      const ry = toMapY(minZ);
      const rw = toMapX(maxX) - rx;
      const rh = toMapY(maxZ) - ry;
      ctx.fillStyle = fill;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }

    // Draw Shrines & Chests
    if (snap.floorLoot) {
      for (const l of snap.floorLoot) {
        if (l.type === 'shrine_blood' || l.type === 'shrine_arcane') {
          ctx.fillStyle = l.type === 'shrine_blood' ? '#ff3366' : '#33ccff';
          ctx.beginPath();
          ctx.arc(toMapX(l.x), toMapY(l.z), 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (l.type === 'treasure_chest' || l.type === 'epic_chest') {
          ctx.fillStyle = '#ffd700';
          ctx.fillRect(toMapX(l.x) - 2.5, toMapY(l.z) - 2.5, 5, 5);
        }
      }
    }

    // Draw Mobs
    if (snap.mobs) {
      for (const m of snap.mobs) {
        const isElite = (m.type === 'elite_executioner' || m.type === 'elite_lich');
        ctx.fillStyle = isElite ? '#ff00ff' : '#ff4444';
        ctx.beginPath();
        ctx.arc(toMapX(m.x), toMapY(m.z), isElite ? 3.5 : 2.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw Boss Malakor
    if (snap.boss && !snap.boss.isDead) {
      ctx.fillStyle = '#ff6600';
      ctx.beginPath();
      ctx.arc(toMapX(snap.boss.x), toMapY(snap.boss.z), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Party Allies
    if (snap.players) {
      for (const p of snap.players) {
        if (p.id === localP.id) continue;
        ctx.fillStyle = '#3ba4ff';
        ctx.beginPath();
        ctx.arc(toMapX(p.x), toMapY(p.z), 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw Local Hero
    ctx.fillStyle = '#2ecc71';
    ctx.beginPath();
    ctx.arc(toMapX(localP.x), toMapY(localP.z), 3.8, 0, Math.PI * 2);
    ctx.fill();

    // Update Zone Name Label
    const zoneLabel = document.getElementById('minimap-zone-label');
    if (zoneLabel) {
      let zoneName = 'THE GRAND CROSSROADS';
      if (localP.z >= 9.5) zoneName = 'COVENANT ATRIUM';
      else if (localP.z >= -2.5) zoneName = 'NARTHEX PASSAGE';
      else if (localP.x < -19) zoneName = 'WEST: BLOOD RELIQUARY';
      else if (localP.x > 19) zoneName = 'EAST: ALCHEMIST VAULT';
      else if (localP.z <= -56) zoneName = 'SOUL-FORGE SANCTUM';
      else if (localP.z <= -42) zoneName = 'ANTECHAMBER OF CHAINS';
      else if (localP.z <= -24) zoneName = 'THE ABYSSAL BRIDGE';
      zoneLabel.innerText = zoneName;
    }
  }
}

// Launch on page load
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.gameApp = new GameApp();
  });
} else {
  window.gameApp = new GameApp();
}
