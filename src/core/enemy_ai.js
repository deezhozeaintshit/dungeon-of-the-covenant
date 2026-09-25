// ============================================================
// VOID WALKER - Enemy AI System
// ============================================================

/**
 * Advanced AI system for enemies including state machines and boss multi-phase logic
 */

class EnemyAI {
  constructor(enemy, gameWorld) {
    this.enemy = enemy;
    this.gameWorld = gameWorld;
    this.player = gameWorld.player;
    this.state = 'patrol';
    this.stateTimer = 0;
    this.visionRange = 15;
    this.attackRange = 3;
    this.lastAttackTime = 0;
    this.attackCooldown = 1500;
  }

  // Main update loop
  update(dt) {
    this.stateTimer += dt;

    // Check if player is in range
    const distToPlayer = this.getDistanceToPlayer();
    const canSeePlayer = distToPlayer < this.visionRange;

    // Update state machine
    switch (this.state) {
      case 'patrol':
        this.patrol(dt);
        if (canSeePlayer) this.setState('chase');
        break;
      case 'chase':
        this.chase(dt);
        if (distToPlayer < this.attackRange) {
          this.setState('attack');
        } else if (!canSeePlayer) {
          this.setState('search');
        }
        break;
      case 'attack':
        this.attack(dt);
        if (distToPlayer > this.attackRange * 1.5) {
          this.setState('chase');
        }
        break;
      case 'search':
        this.search(dt);
        if (canSeePlayer) {
          this.setState('chase');
        } else if (this.stateTimer > 5000) {
          this.setState('patrol');
        }
        break;
      case 'retreat':
        this.retreat(dt);
        if (this.enemy.health > this.enemy.maxHealth * 0.3) {
          this.setState('chase');
        }
        break;
    }
  }

  // Patrol behavior
  patrol(dt) {
    // Move in random direction
    if (this.stateTimer > 2000) {
      this.enemy.direction = this.getRandomDirection();
      this.stateTimer = 0;
    }

    this.move(dt, 0.5);
  }

  // Chase player
  chase(dt) {
    const dir = this.getDirectionToPlayer();
    this.enemy.direction = dir;
    this.move(dt, this.enemy.speed);
  }

  // Attack player
  attack(dt) {
    if (Date.now() - this.lastAttackTime > this.attackCooldown) {
      this.performAttack();
      this.lastAttackTime = Date.now();
    }
  }

  // Search for player
  search(dt) {
    // Move towards last known player position
    const dir = this.getDirectionTo(this.enemy.lastKnownPlayerPos);
    this.enemy.direction = dir;
    this.move(dt, this.enemy.speed * 0.7);
  }

  // Retreat when low health
  retreat(dt) {
    const dir = this.getDirectionAwayFromPlayer();
    this.enemy.direction = dir;
    this.move(dt, this.enemy.speed * 1.2);
  }

  // Perform attack
  performAttack() {
    const damage = this.enemy.attackDamage;
    this.player.takeDamage(damage);

    // Apply special effects based on enemy type
    if (this.enemy.type === 'void_minion') {
      // Void minions cause brief confusion
      this.player.applyDebuff('confusion', 1000);
    } else if (this.enemy.type === 'shadow_knight') {
      // Knights can knockback
      if (Math.random() < 0.3) {
        this.player.applyPush(this.getDirectionToPlayer());
      }
    }
  }

  // Move enemy
  move(dt, speedMultiplier) {
    const moveX = this.enemy.direction.x * this.enemy.speed * speedMultiplier * (dt / 1000);
    const moveY = this.enemy.direction.y * this.enemy.speed * speedMultiplier * (dt / 1000);

    this.enemy.x += moveX;
    this.enemy.y += moveY;
  }

  // State management
  setState(newState) {
    this.state = newState;
    this.stateTimer = 0;
  }

  // Utility functions
  getDistanceToPlayer() {
    return Math.hypot(
      this.player.x - this.enemy.x,
      this.player.y - this.enemy.y
    );
  }

  getDirectionToPlayer() {
    const dx = this.player.x - this.enemy.x;
    const dy = this.player.y - this.enemy.y;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }

  getDirectionTo(target) {
    const dx = target.x - this.enemy.x;
    const dy = target.y - this.enemy.y;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }

  getDirectionAwayFromPlayer() {
    const dir = this.getDirectionToPlayer();
    return { x: -dir.x, y: -dir.y };
  }

  getRandomDirection() {
    const angle = Math.random() * Math.PI * 2;
    return {
      x: Math.cos(angle),
      y: Math.sin(angle)
    };
  }
}

// Boss AI (Void Lord - Multi-phase)
class BossAI extends EnemyAI {
  constructor(enemy, gameWorld) {
    super(enemy, gameWorld);
    this.phase = 1;
    this.abilities = [
      { id: 'void_blast', cooldown: 5000, lastUse: 0 },
      { id: 'summon_minion', cooldown: 10000, lastUse: 0 },
      { id: 'teleport', cooldown: 8000, lastUse: 0 },
      { id: 'enrage', cooldown: 0, lastUse: 0 }
    ];
  }

  update(dt) {
    super.update(dt);

    // Phase transition logic
    const healthPercent = this.enemy.health / this.enemy.maxHealth;

    if (healthPercent < 0.66 && this.phase === 1) {
      this.enterPhase(2);
    } else if (healthPercent < 0.33 && this.phase === 2) {
      this.enterPhase(3);
    }

    // Use abilities
    this.useAbilities(dt);
  }

  enterPhase(newPhase) {
    this.phase = newPhase;
    this.enemy.applyVFX('phase_change', this.enemy.x, this.enemy.y);

    // Increase difficulty
    this.enemy.speed *= 1.2;
    this.enemy.attackDamage *= 1.3;
    this.visionRange *= 1.2;

    // Show phase announcement
    this.gameWorld.showNotification(`Void Lord enters Phase ${newPhase}!`);
  }

  useAbilities(dt) {
    const now = Date.now();

    for (const ability of this.abilities) {
      if (now - ability.lastUse >= ability.cooldown) {
        if (Math.random() < 0.3) {
          this.executeAbility(ability.id);
          ability.lastUse = now;
        }
      }
    }
  }

  executeAbility(abilityId) {
    switch (abilityId) {
      case 'void_blast':
        this.voidBlast();
        break;
      case 'summon_minion':
        this.summonMinion();
        break;
      case 'teleport':
        this.teleport();
        break;
      case 'enrage':
        this.enrage();
        break;
    }
  }

  voidBlast() {
    // Fire energy blast at player
    const dir = this.getDirectionToPlayer();
    this.gameWorld.spawnProjectile({
      x: this.enemy.x,
      y: this.enemy.y,
      vx: dir.x * 300,
      vy: dir.y * 300,
      damage: 50 * this.phase,
      type: 'void_energy'
    });
  }

  summonMinion() {
    // Spawn void minions around boss
    for (let i = 0; i < 2; i++) {
      const angle = (Math.PI * 2 / 2) * i;
      this.gameWorld.spawnEnemy({
        type: 'void_minion',
        x: this.enemy.x + Math.cos(angle) * 5,
        y: this.enemy.y + Math.sin(angle) * 5
      });
    }
  }

  teleport() {
    // Teleport to random location near player
    const angle = Math.random() * Math.PI * 2;
    const distance = 10 + Math.random() * 5;
    this.enemy.x = this.player.x + Math.cos(angle) * distance;
    this.enemy.y = this.player.y + Math.sin(angle) * distance;
    this.enemy.applyVFX('teleport_effect', this.enemy.x, this.enemy.y);
  }

  enrage() {
    // Enrage mode - increased speed and damage
    this.enemy.speed *= 1.5;
    this.enemy.attackDamage *= 2;
    this.enemy.applyVFX('enrage_effect', this.enemy.x, this.enemy.y);
  }
}

// AI Factory
class AIFactory {
  static create(enemy, gameWorld) {
    if (enemy.type === 'void_lord') {
      return new BossAI(enemy, gameWorld);
    }
    return new EnemyAI(enemy, gameWorld);
  }
}

module.exports = { EnemyAI, BossAI, AIFactory };
