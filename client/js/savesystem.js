// SaveSystem.js - Local Storage Save/Load System

export class SaveSystem {
  constructor() {
    this.storageKey = 'rpg_covenant_save';
    this.autoSaveInterval = 60000; // 1 minute
    this.autoSaveTimer = null;
  }

  // Save game state
  save(gameState) {
    try {
      const saveData = {
        version: '1.0',
        timestamp: Date.now(),
        player: {
          name: gameState.playerName,
          classKey: gameState.playerClass,
          level: gameState.playerLevel,
          experience: gameState.playerXP,
          gold: gameState.playerGold,
          skills: gameState.playerSkills,
          inventory: gameState.playerInventory
        },
        progress: {
          currentZone: gameState.currentZone,
          completedZones: gameState.completedZones || [],
          bossDefeated: gameState.bossDefeated || false,
          achievements: gameState.achievements || [],
          secretObjectives: gameState.secretObjectives || []
        },
        stats: {
          totalPlayTime: gameState.totalPlayTime,
          gamesPlayed: gameState.gamesPlayed,
          gamesWon: gameState.gamesWon,
          totalDamageDealt: gameState.totalDamageDealt,
          totalHealingDone: gameState.totalHealingDone,
          enemiesKilled: gameState.enemiesKilled,
          chestsOpened: gameState.chestsOpened
        }
      };

      localStorage.setItem(this.storageKey, JSON.stringify(saveData));
      console.log('SaveSystem: Game saved successfully');
      return true;
    } catch (e) {
      console.error('SaveSystem: Failed to save game:', e);
      return false;
    }
  }

  // Load game state
  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;

      const saveData = JSON.parse(raw);
      
      // Validate version
      if (saveData.version !== '1.0') {
        console.warn('SaveSystem: Incompatible save version');
        return null;
      }

      console.log('SaveSystem: Game loaded successfully');
      return saveData;
    } catch (e) {
      console.error('SaveSystem: Failed to load game:', e);
      return null;
    }
  }

  // Check if save exists
  hasSave() {
    return localStorage.getItem(this.storageKey) !== null;
  }

  // Delete save
  deleteSave() {
    try {
      localStorage.removeItem(this.storageKey);
      console.log('SaveSystem: Save deleted');
      return true;
    } catch (e) {
      console.error('SaveSystem: Failed to delete save:', e);
      return false;
    }
  }

  // Get save info (without full data)
  getSaveInfo() {
    const save = this.load();
    if (!save) return null;

    return {
      timestamp: save.timestamp,
      playerName: save.player?.name,
      playerClass: save.player?.classKey,
      level: save.player?.level,
      currentZone: save.progress?.currentZone,
      bossDefeated: save.progress?.bossDefeated
    };
  }

  // Auto-save timer
  startAutoSave(callback) {
    this.autoSaveTimer = setInterval(() => {
      callback();
    }, this.autoSaveInterval);
  }

  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
}
