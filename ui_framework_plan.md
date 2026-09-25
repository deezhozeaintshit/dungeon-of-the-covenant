# Phase 4: UI Framework Implementation

## Part A: HUD System

### Health Bar Component
```javascript
// hud_health_bar.js
class HealthBar extends Component {
  constructor() {
    super();
    this.width = 300;
    this.height = 30;
    this.segments = 10;
  }
  
  render(player) {
    const healthPercent = player.health / player.maxHealth;
    const color = this.getHealthColor(healthPercent);
    
    return `
      <div class="health-bar-container">
        <div class="health-bar-bg"></div>
        <div class="health-bar-fill" style="width: ${healthPercent * 100}%"></div>
        <div class="health-bar-text">${Math.ceil(player.health)}/${player.maxHealth}</div>
      </div>
    `;
  }
  
  getHealthColor(percent) {
    if (percent > 0.6) return '#48BB78'; // Green
    if (percent > 0.3) return '#ECC94B'; // Yellow
    return '#F56565'; // Red
  }
}
```

### Mana Bar Component
```javascript
// hud_mana_bar.js
class ManaBar extends Component {
  constructor() {
    super();
    this.width = 300;
    this.height = 25;
  }
  
  render(player) {
    const manaPercent = player.mana / player.maxMana;
    
    return `
      <div class="mana-bar-container">
        <div class="mana-bar-bg"></div>
        <div class="mana-bar-fill" style="width: ${manaPercent * 100}%"></div>
        <div class="mana-bar-text">${Math.ceil(player.mana)}/${player.maxMana}</div>
      </div>
    `;
  }
}
```

---

## Part B: Ability HUD

### Ability Icon Component
```javascript
// hud_ability_icon.js
class AbilityIcon extends Component {
  constructor(ability) {
    super();
    this.ability = ability;
    this.cooldownTimer = 0;
  }
  
  render() {
    const isOnCooldown = this.cooldownTimer > 0;
    const keyBinding = this.getKeyBinding(this.ability.key);
    
    return `
      <div class="ability-icon ${isOnCooldown ? 'cooldown' : ''}">
        <img src="${this.ability.icon}" alt="${this.ability.name}" />
        <div class="cooldown-overlay" style="height: ${this.cooldownTimer}%"></div>
        <div class="ability-key">${keyBinding}</div>
        <div class="mana-cost">${this.ability.manaCost}</div>
      </div>
    `;
  }
  
  update(dt) {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= (dt / this.ability.cooldown) * 100;
    }
  }
}
```

### Ability Bar Layout
```
[1] [2] [3] [4] [5] [6] [7] [8]
  ↑
  Basic attacks and abilities
```

---

## Part C: Mini-Map System

### Mini-Map Component
```javascript
// hud_minimap.js
class MiniMap extends Component {
  constructor() {
    super();
    this.size = 200;
    this.players = [];
    this.enemies = [];
    this.waypoints = [];
  }
  
  render() {
    return `
      <div class="minimap-container">
        <canvas id="minimap" width="${this.size}" height="${this.size}"></canvas>
        <div class="minimap-compass"></div>
      </div>
    `;
  }
  
  draw() {
    const ctx = this.canvas.getContext('2d');
    
    // Draw terrain
    this.drawTerrain(ctx);
    
    // Draw players
    this.drawEntities(ctx, this.players, '#48BB78');
    
    // Draw enemies
    this.drawEntities(ctx, this.enemies, '#F56565');
    
    // Draw waypoints
    this.drawWaypoints(ctx);
  }
}
```

---

## Part D: Menu Screens

### Main Menu
```javascript
// menu_main.js
class MainMenu extends Component {
  constructor() {
    super();
    this.buttons = [
      { text: 'Play', action: 'startGame' },
      { text: 'Continue', action: 'continueGame', enabled: false },
      { text: 'Options', action: 'openSettings' },
      { text: 'Store', action: 'openStore' },
      { text: 'Quit', action: 'quitGame' }
    ];
  }
  
  render() {
    return `
      <div class="main-menu">
        <div class="menu-background">
          <canvas id="void-bg"></canvas>
        </div>
        <div class="menu-content">
          <h1 class="game-title">VOID WALKER</h1>
          <div class="menu-buttons">
            ${this.buttons.map((btn, i) => `
              <button class="menu-button" onclick="menu.${btn.action}()">${btn.text}</button>
            `).join('')}
          </div>
          <div class="version-info">v0.1.0-alpha</div>
        </div>
      </div>
    `;
  }
}
```

### Inventory Screen
```javascript
// menu_inventory.js
class InventoryMenu extends Component {
  constructor() {
    super();
    this.gridSize = { cols: 10, rows: 8 };
    this.items = [];
    this.selectedSlot = null;
  }
  
  render() {
    return `
      <div class="inventory-screen">
        <div class="inventory-grid">
          ${this.generateGrid()}
        </div>
        <div class="item-details">
          ${this.selectedSlot ? this.renderItemDetails(this.selectedSlot) : '<p>Select an item</p>'}
        </div>
      </div>
    `;
  }
}
```

---

## Part E: UI VFX System

### Damage Number Popup
```javascript
// vfx_damage_number.js
class DamageNumber extends Component {
  constructor(value, isCritical = false) {
    super();
    this.value = value;
    this.isCritical = isCritical;
    this.life = 1.5; // seconds
  }
  
  render() {
    const color = this.isCritical ? '#FF8000' : '#FFFFFF';
    const scale = this.isCritical ? 1.5 : 1;
    
    return `
      <div class="damage-number" style="
        color: ${color};
        font-size: ${scale * 24}px;
        transform: translateY(-${(1.5 - this.life) * 50}px);
      ">
        ${this.value}
      </div>
    `;
  }
}
```

### Notification System
```javascript
// ui_notification.js
class Notification {
  constructor(message, type = 'info') {
    this.message = message;
    this.type = type; // 'info', 'success', 'warning', 'error'
    this.duration = 3000; // ms
  }
  
  show() {
    const notification = document.createElement('div');
    notification.className = `notification notification-${this.type}`;
    notification.textContent = this.message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, this.duration);
  }
}
```

---

## Part F: Store/Shop System

### Store Items
```javascript
// store_products.js
const storeItems = [
  {
    id: 'hero_skin_void',
    name: 'Void Walker Skin',
    price: 4.99,
    description: 'Exclusive cosmic skin for Aetherion',
    category: 'cosmetics'
  },
  {
    id: 'weapon_skin_blade',
    name: 'Void Blade Skin',
    price: 9.99,
    description: 'Ethereal energy blade effect',
    category: 'cosmetics'
  },
  {
    id: 'vfx_cosmic_pack',
    name: 'Cosmic VFX Pack',
    price: 2.99,
    description: 'Particle effects for all abilities',
    category: 'vfx'
  },
  {
    id: 'battle_pass_monthly',
    name: 'Battle Pass',
    price: 4.99,
    description: 'Monthly rewards and exclusive items',
    category: 'subscription',
    recurring: true
  }
];
```

### Purchase Flow
```javascript
// store_purchase.js
class Store {
  async purchase(item) {
    try {
      // Create checkout session
      const session = await this.createCheckoutSession(item);
      
      // Redirect to Stripe
      window.location.href = session.url;
    } catch (error) {
      this.showError(error.message);
    }
  }
  
  async createCheckoutSession(item) {
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: item.id,
        price: item.price * 100, // cents
        name: item.name
      })
    });
    
    return await response.json();
  }
}
```

---

## Implementation Order

1. **HUD System** (Health, Mana, Abilities)
2. **Mini-Map** (Terrain, entities, waypoints)
3. **Menu Screens** (Main, Inventory, Settings)
4. **UI VFX** (Damage numbers, notifications)
5. **Store System** (Products, checkout, delivery)

---

## Success Criteria
- [ ] Health and mana bars functional
- [ ] Ability icons with cooldowns
- [ ] Mini-map rendering
- [ ] Main menu with animations
- [ ] Inventory grid system
- [ ] Damage number popups
- [ ] Store integration with Stripe
- [ ] All UI responsive and accessible

---

## Next Steps
1. Integrate with generated UI assets
2. Add animations and transitions
3. Polish visual effects
4. Test on multiple resolutions
5. Optimize performance
