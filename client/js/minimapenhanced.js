// MinimapEnhanced.js - Advanced Mini-Map with Dynamic Features

export class MinimapEnhanced {
  constructor(canvas, gameApp) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = gameApp;
    this.width = canvas.width;
    this.height = canvas.height;
    this.zoom = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.showEnemies = true;
    this.showLoot = true;
    this.showShrines = true;
    this.showPath = false;
    this.waypoints = [];
  }

  // Update minimap with current game state
  update(snapshot, localPlayer) {
    if (!snapshot || !localPlayer) return;

    this.ctx.clearRect(0, 0, this.width, this.height);

    // Draw dungeon layout
    this.drawDungeonLayout();

    // Draw waypoints
    if (this.showPath && this.waypoints.length > 1) {
      this.drawWaypoints();
    }

    // Draw loot
    if (this.showLoot && snapshot.floorLoot) {
      this.drawLoot(snapshot.floorLoot);
    }

    // Draw enemies
    if (this.showEnemies && snapshot.mobs) {
      this.drawEnemies(snapshot.mobs);
    }

    // Draw boss
    if (snapshot.boss && !snapshot.boss.isDead) {
      this.drawBoss(snapshot.boss);
    }

    // Draw party
    if (snapshot.players) {
      this.drawParty(snapshot.players, localPlayer.id);
    }

    // Draw local player
    this.drawLocalPlayer(localPlayer);

    // Draw zoom/offset indicators
    this.drawHUD();
  }

  // Draw dungeon layout
  drawDungeonLayout() {
    const rooms = [
      { x: -14, z: 10, w: 28, h: 18, color: '#282138', name: 'Atrium' },
      { x: -5, z: -2, w: 10, h: 12, color: '#231c30', name: 'Narthex' },
      { x: -18, z: -26, w: 36, h: 24, color: '#2d243f', name: 'Crossroads' },
      { x: -30, z: -18, w: 12, h: 8, color: '#231c30', name: 'West Corridor' },
      { x: -54, z: -28, w: 24, h: 28, color: '#3a1a28', name: 'Blood Reliquary' },
      { x: 18, z: -18, w: 12, h: 8, color: '#231c30', name: 'East Corridor' },
      { x: 30, z: -28, w: 24, h: 28, color: '#182b44', name: 'Alchemist Vault' },
      { x: -6, z: -42, w: 12, h: 16, color: '#2b2024', name: 'Abyssal Bridge' },
      { x: -16, z: -56, w: 32, h: 14, color: '#282138', name: 'Antechamber' },
      { x: -24, z: -92, w: 48, h: 36, color: '#3b1c18', name: 'Boss Sanctum' }
    ];

    const scaleX = this.width / 120;
    const scaleY = this.height / 128;
    const scale = Math.min(scaleX, scaleY) * this.zoom;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const room of rooms) {
      const rx = centerX + (room.x + room.w / 2) * scale + this.offsetX;
      const ry = centerY + (room.z + room.h / 2) * scale + this.offsetY;
      const rw = room.w * scale;
      const rh = room.h * scale;

      this.ctx.fillStyle = room.color;
      this.ctx.fillRect(rx - rw / 2, ry - rh / 2, rw, rh);

      this.ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(rx - rw / 2, ry - rh / 2, rw, rh);
    }
  }

  // Draw waypoints
  drawWaypoints() {
    if (this.waypoints.length < 2) return;

    this.ctx.strokeStyle = '#ffd700';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    this.ctx.beginPath();

    for (let i = 0; i < this.waypoints.length; i++) {
      const wp = this.waypoints[i];
      const x = this.width / 2 + wp.x * (this.width / 120) * this.zoom + this.offsetX;
      const y = this.height / 2 + wp.z * (this.height / 128) * this.zoom + this.offsetY;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }

    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Draw waypoint markers
    for (let i = 0; i < this.waypoints.length; i++) {
      const wp = this.waypoints[i];
      const x = this.width / 2 + wp.x * (this.width / 120) * this.zoom + this.offsetX;
      const y = this.height / 2 + wp.z * (this.height / 128) * this.zoom + this.offsetY;

      this.ctx.fillStyle = i === 0 ? '#2ecc71' : '#ffd700';
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  // Draw loot items
  drawLoot(loot) {
    const scaleX = this.width / 120;
    const scaleY = this.height / 128;
    const scale = Math.min(scaleX, scaleY) * this.zoom;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const item of loot) {
      if (item.pickedUp) continue;

      let x = centerX + item.x * scale + this.offsetX;
      let y = centerY + item.z * scale + this.offsetY;

      if (item.type === 'treasure_chest' || item.type === 'epic_chest') {
        this.ctx.fillStyle = '#ffd700';
        this.ctx.fillRect(x - 3, y - 3, 6, 6);
      } else if (item.type === 'shrine_blood') {
        this.ctx.fillStyle = '#ff3366';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 3, 0, Math.PI * 2);
        this.ctx.fill();
      } else if (item.type === 'shrine_arcane') {
        this.ctx.fillStyle = '#33ccff';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 3, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  // Draw enemies
  drawEnemies(mobs) {
    const scaleX = this.width / 120;
    const scaleY = this.height / 128;
    const scale = Math.min(scaleX, scaleY) * this.zoom;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const mob of mobs) {
      const x = centerX + mob.x * scale + this.offsetX;
      const y = centerY + mob.z * scale + this.offsetY;

      const isElite = mob.type === 'elite_executioner' || mob.type === 'elite_lich';
      this.ctx.fillStyle = isElite ? '#ff00ff' : '#ff4444';
      this.ctx.beginPath();
      this.ctx.arc(x, y, isElite ? 4 : 2.5, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  // Draw boss
  drawBoss(boss) {
    const scaleX = this.width / 120;
    const scaleY = this.height / 128;
    const scale = Math.min(scaleX, scaleY) * this.zoom;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    const x = centerX + boss.x * scale + this.offsetX;
    const y = centerY + boss.z * scale + this.offsetY;

    this.ctx.fillStyle = '#ff6600';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = '#ffaa00';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  // Draw party members
  drawParty(players, localId) {
    const scaleX = this.width / 120;
    const scaleY = this.height / 128;
    const scale = Math.min(scaleX, scaleY) * this.zoom;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const p of players) {
      if (p.id === localId) continue;

      const x = centerX + p.x * scale + this.offsetX;
      const y = centerY + p.z * scale + this.offsetY;

      this.ctx.fillStyle = p.isDowned ? '#ff8800' : '#3ba4ff';
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  // Draw local player
  drawLocalPlayer(player) {
    const scaleX = this.width / 120;
    const scaleY = this.height / 128;
    const scale = Math.min(scaleX, scaleY) * this.zoom;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    const x = centerX + player.x * scale + this.offsetX;
    const y = centerY + player.z * scale + this.offsetY;

    // Player indicator
    this.ctx.fillStyle = '#2ecc71';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 4, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // Direction indicator
    const dirX = x + Math.sin(player.rotation) * 8;
    const dirY = y - Math.cos(player.rotation) * 8;
    this.ctx.strokeStyle = '#2ecc71';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(dirX, dirY);
    this.ctx.stroke();
  }

  // Draw HUD information
  drawHUD() {
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(5, 5, 80, 20);
    this.ctx.fillStyle = '#ffd700';
    this.ctx.font = '10px sans-serif';
    this.ctx.fillText(`Zoom: ${this.zoom.toFixed(1)}x`, 10, 18);
  }

  // Add waypoint
  addWaypoint(x, z) {
    this.waypoints.push({ x, z });
    if (this.waypoints.length > 10) {
      this.waypoints.shift();
    }
  }

  // Clear waypoints
  clearWaypoints() {
    this.waypoints = [];
  }

  // Set zoom level
  setZoom(level) {
    this.zoom = Math.max(0.5, Math.min(3.0, level));
  }

  // Pan minimap
  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  // Reset view
  resetView() {
    this.zoom = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
  }
}
