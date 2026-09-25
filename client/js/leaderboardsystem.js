// LeaderboardSystem.js - Multiplayer Leaderboard & Ranking System

export class LeaderboardSystem {
  constructor() {
    this.leaderboards = new Map();
    this.sessions = new Map();
    this.listeners = {
      onRankUpdate: [],
      onNewRecord: [],
      onSeasonStart: []
    };
    this.currentSeason = 1;
  }

  // Register a leaderboard
  registerLeaderboard(config) {
    const leaderboard = {
      id: config.id,
      name: config.name,
      description: config.description || '',
      metrics: config.metrics || ['score'],
      sortOrder: config.sortOrder || 'desc', // 'asc' or 'desc'
      entries: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      season: this.currentSeason
    };

    this.leaderboards.set(leaderboard.id, leaderboard);
    return leaderboard;
  }

  // Submit a score
  submitScore(leaderboardId, playerId, score, metadata = {}) {
    const leaderboard = this.leaderboards.get(leaderboardId);
    if (!leaderboard) {
      console.error(`LeaderboardSystem: Leaderboard ${leaderboardId} not found`);
      return null;
    }

    const entry = {
      playerId,
      score,
      metadata,
      timestamp: Date.now(),
      season: this.currentSeason,
      rank: 0
    };

    // Update or create entry
    leaderboard.entries.set(playerId, entry);
    leaderboard.updatedAt = Date.now();

    // Recalculate ranks
    this.recalculateRanks(leaderboardId);

    // Check for new record
    const oldScore = leaderboard.entries.get(playerId)?.score || 0;
    if (score > oldScore) {
      this.notifyListeners('onNewRecord', {
        leaderboardId,
        playerId,
        score,
        oldScore
      });
    }

    // Notify rank update
    const newRank = entry.rank;
    this.notifyListeners('onRankUpdate', {
      leaderboardId,
      playerId,
      score,
      rank: newRank
    });

    return entry;
  }

  // Recalculate ranks for a leaderboard
  recalculateRanks(leaderboardId) {
    const leaderboard = this.leaderboards.get(leaderboardId);
    if (!leaderboard) return;

    // Sort entries by score
    const sortedEntries = Array.from(leaderboard.entries.values())
      .sort((a, b) => leaderboard.sortOrder === 'asc' ? a.score - b.score : b.score - a.score);

    // Assign ranks
    sortedEntries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    // Update entries map
    leaderboard.entries.clear();
    sortedEntries.forEach(entry => {
      leaderboard.entries.set(entry.playerId, entry);
    });
  }

  // Get leaderboard entry
  getEntry(leaderboardId, playerId) {
    const leaderboard = this.leaderboards.get(leaderboardId);
    if (!leaderboard) return null;
    return leaderboard.entries.get(playerId) || null;
  }

  // Get leaderboard standings
  getStandings(leaderboardId, limit = 10) {
    const leaderboard = this.leaderboards.get(leaderboardId);
    if (!leaderboard) return [];

    return Array.from(leaderboard.entries.values())
      .sort((a, b) => leaderboard.sortOrder === 'asc' ? a.score - b.score : b.score - a.score)
      .slice(0, limit);
  }

  // Get all leaderboards
  getAllLeaderboards() {
    return Array.from(this.leaderboards.values());
  }

  // Start a new season
  startNewSeason() {
    this.currentSeason++;
    this.notifyListeners('onSeasonStart', { season: this.currentSeason });
    console.log(`LeaderboardSystem: Started season ${this.currentSeason}`);
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
          console.error('LeaderboardSystem: Listener error:', error);
        }
      }
    }
  }
}
