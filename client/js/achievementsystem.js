// AchievementSystem.js - Achievement & Progress Tracking System

export class AchievementSystem {
  constructor() {
    this.achievements = new Map();
    this.unlocked = new Set();
    this.progress = new Map();
    this.listeners = {
      onAchievementUnlocked: [],
      onProgressUpdated: []
    };
  }

  // Register an achievement
  register(achievement) {
    this.achievements.set(achievement.id, {
      ...achievement,
      unlocked: false,
      unlockedAt: null
    });
    this.progress.set(achievement.id, 0);
  }

  // Unlock an achievement
  unlock(achievementId) {
    const achievement = this.achievements.get(achievementId);
    if (!achievement || achievement.unlocked) return false;

    achievement.unlocked = true;
    achievement.unlockedAt = Date.now();
    this.unlocked.add(achievementId);
    this.progress.set(achievementId, 100);

    this.notifyListeners('onAchievementUnlocked', achievement);
    this.saveProgress();
    return true;
  }

  // Update progress towards an achievement
  updateProgress(achievementId, amount) {
    const achievement = this.achievements.get(achievementId);
    if (!achievement || achievement.unlocked) return;

    const current = this.progress.get(achievementId) || 0;
    const newValue = Math.min(100, current + amount);
    this.progress.set(achievementId, newValue);

    // Auto-unlock at 100%
    if (newValue >= 100) {
      this.unlock(achievementId);
    } else {
      this.notifyListeners('onProgressUpdated', { id: achievementId, progress: newValue });
    }
  }

  // Get achievement by ID
  get(achievementId) {
    return this.achievements.get(achievementId);
  }

  // Get all achievements
  getAll() {
    return Array.from(this.achievements.values());
  }

  // Get unlocked achievements
  getUnlocked() {
    return Array.from(this.unlocked);
  }

  // Get progress percentage
  getProgress(achievementId) {
    return this.progress.get(achievementId) || 0;
  }

  // Get total achievements unlocked
  getTotalUnlocked() {
    return this.unlocked.size;
  }

  // Get total achievements
  getTotal() {
    return this.achievements.size;
  }

  // Calculate completion percentage
  getCompletionPercentage() {
    if (this.achievements.size === 0) return 0;
    return (this.unlocked.size / this.achievements.size) * 100;
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
          console.error('AchievementSystem: Listener error:', error);
        }
      }
    }
  }

  // Save progress to localStorage
  saveProgress() {
    try {
      const data = {
        unlocked: Array.from(this.unlocked),
        progress: Object.fromEntries(this.progress),
        timestamp: Date.now()
      };
      localStorage.setItem('rpg_achievements', JSON.stringify(data));
    } catch (e) {
      console.warn('AchievementSystem: Failed to save progress:', e);
    }
  }

  // Load progress from localStorage
  loadProgress() {
    try {
      const raw = localStorage.getItem('rpg_achievements');
      if (!raw) return;

      const data = JSON.parse(raw);
      this.unlocked = new Set(data.unlocked || []);
      
      for (const [id, progress] of Object.entries(data.progress || {})) {
        this.progress.set(id, progress);
        if (progress >= 100) {
          const achievement = this.achievements.get(id);
          if (achievement) {
            achievement.unlocked = true;
            achievement.unlockedAt = data.timestamp;
          }
        }
      }
    } catch (e) {
      console.warn('AchievementSystem: Failed to load progress:', e);
    }
  }

  // Reset all progress
  reset() {
    this.unlocked.clear();
    this.progress.clear();
    for (const [id, achievement] of this.achievements) {
      achievement.unlocked = false;
      achievement.unlockedAt = null;
      this.progress.set(id, 0);
    }
    this.saveProgress();
  }
}
