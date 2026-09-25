# Phase 3: Core Systems Implementation

## Part A: Character Abilities System

### Ability 1: Fireball (Basic Magic)
**Type:** Projectile
**Damage:** 25
**Cooldown:** 2s
**Cost:** 15 mana

**Code Structure:**
```javascript
// ability_fireball.js
const fireball = {
  name: "Fireball",
  type: "projectile",
  damage: 25,
  cooldown: 2000,
  manaCost: 15,
  speed: 800,
  radius: 0.5,
  effects: ["burn", 3], // 3 ticks of burn damage
  
  cast: function(player, target) {
    // Create projectile entity
    // Apply physics
    // Handle collision
    // Apply burn DoT
  }
};
```

### Ability 2: Frost Shard (Basic Magic)
**Type:** Projectile
**Damage:** 20
**Cooldown:** 1.5s
**Cost:** 12 mana
**Effect:** Slow enemy by 30% for 3s

### Ability 3: Lightning Bolt (Basic Magic)
**Type:** Instant
**Damage:** 30
**Cooldown:** 3s
**Cost:** 20 mana
**Effect:** Chain to 3 nearby enemies

---

## Part B: Loot System

### Loot Table Structure
```javascript
// loot_tables.js
const lootTables = {
  void_minion: {
    drops: [
      { item: "void_shard", chance: 0.3, min: 1, max: 3 },
      { item: "health_potion_small", chance: 0.5, min: 1, max: 1 },
      { item: "gold", chance: 1.0, min: 5, max: 15 }
    ]
  },
  shadow_knight: {
    drops: [
      { item: "knight_sword", chance: 0.1, quality: "rare" },
      { item: "knight_shield", chance: 0.08, quality: "rare" },
      { item: "void_shard", chance: 0.5, min: 2, max: 5 },
      { item: "gold", chance: 1.0, min: 20, max: 50 }
    ]
  },
  void_lord: {
    drops: [
      { item: "void_crown", chance: 1.0, quality: "legendary" },
      { item: "ether_blade", chance: 0.5, quality: "epic" },
      { item: "void_shard", chance: 1.0, min: 10, max: 20 },
      { item: "gold", chance: 1.0, min: 100, max: 200 }
    ]
  }
};
```

### Item Quality System
```javascript
const qualities = {
  common: { color: "#9D9D9D", multiplier: 1, suffix: "" },
  uncommon: { color: "#1EFF0E", multiplier: 1.5, suffix: " of the Bear" },
  rare: { color: "#0070DD", multiplier: 2, suffix: " of the Tiger" },
  epic: { color: "#A335EE", multiplier: 3, suffix: " of the Dragon" },
  legendary: { color: "#FF8000", multiplier: 5, suffix: " of the Gods" }
};
```

---

## Part C: Dynamic Loot System

### Loot Generation Algorithm
```javascript
function generateLoot(enemy, playerLevel) {
  const table = lootTables[enemy.type];
  const drops = [];
  
  for (const drop of table.drops) {
    if (Math.random() < drop.chance) {
      const quantity = randomRange(drop.min, drop.max);
      const quality = determineQuality(playerLevel, enemy.difficulty);
      const item = createItem(drop.item, quality, quantity);
      drops.push(item);
    }
  }
  
  return drops;
}
```

### Affix Generation
```javascript
function generateAffixes(item, quality) {
  const affixes = [];
  const count = quality.multiplier;
  
  for (let i = 0; i < count; i++) {
    const affix = randomAffix();
    affixes.push(affix);
  }
  
  return affixes;
}
```

---

## Part D: Enemy AI System

### Minion AI (Void Minion)
```javascript
const voidMinion = {
  state: "patrol",
  visionRange: 10,
  attackRange: 2,
  speed: 3,
  
  update: function(player) {
    const dist = distance(this, player);
    
    if (dist < this.visionRange) {
      this.state = "chase";
    } else {
      this.state = "patrol";
    }
    
    if (dist < this.attackRange) {
      this.state = "attack";
    }
    
    switch(this.state) {
      case "patrol":
        this.patrol();
        break;
      case "chase":
        this.chase(player);
        break;
      case "attack":
        this.attack(player);
        break;
    }
  }
};
```

### Boss AI (Void Lord)
```javascript
const voidLord = {
  phase: 1,
  maxHealth: 10000,
  abilities: ["void_blast", "summon_minion", "teleport", "enrage"],
  
  update: function(player) {
    // Phase transition logic
    if (this.health < this.maxHealth * 0.66 && this.phase === 1) {
      this.phase = 2;
      this.triggerPhaseChange();
    }
    if (this.health < this.maxHealth * 0.33 && this.phase === 2) {
      this.phase = 3;
      this.triggerPhaseChange();
    }
    
    // Ability selection
    this.selectAbility(player);
    this.executeAbility(player);
  }
};
```

---

## Part E: Random Level Generator

### Dungeon Generation Algorithm
```javascript
class DungeonGenerator {
  constructor(seed) {
    this.seed = seed;
    this.rooms = [];
    this.corridors = [];
  }
  
  generate(width, height, roomCount) {
    // Place rooms
    for (let i = 0; i < roomCount; i++) {
      this.placeRoom(width, height);
    }
    
    // Connect rooms with corridors
    this.connectRooms();
    
    // Add enemies and loot
    this.populate();
    
    return { rooms: this.rooms, corridors: this.corridors };
  }
  
  placeRoom(maxWidth, maxHeight) {
    const room = {
      x: random(10, maxWidth - 10),
      y: random(10, maxHeight - 10),
      w: random(8, 20),
      h: random(8, 15)
    };
    
    // Check overlap
    if (!this.overlaps(room)) {
      this.rooms.push(room);
    }
  }
}
```

### Biome Selection
```javascript
const biomes = {
  void_hollow: {
    enemies: ["void_minion", "void_serpent"],
    loot: "void_shard",
    terrain: "crystal"
  },
  shadow_forest: {
    enemies: ["shadow_wolf", "corrupted_tree"],
    loot: "forest_essence",
    terrain: "forest"
  },
  crystal_caverns: {
    enemies: ["crystal_golem", "void_serpent"],
    loot: "crystal_shard",
    terrain: "cavern"
  }
};
```

---

## Part F: Stripe Payment Integration

### Payment Product Structure
```javascript
const stripeProducts = {
  hero_skin_void_walker: {
    price: 4.99,
    currency: "usd",
    description: "Exclusive Void Walker skin for Aetherion"
  },
  weapon_skin_void_blade: {
    price: 9.99,
    currency: "usd",
    description: "Ethereal void energy blade skin"
  },
  vfx_pack_cosmic: {
    price: 2.99,
    currency: "usd",
    description: "Cosmic particle effects pack"
  },
  battle_pass_monthly: {
    price: 4.99,
    currency: "usd",
    recurring: true,
    description: "Monthly battle pass with rewards"
  }
};
```

### Payment Flow
```javascript
// 1. Create checkout session
async function createCheckout(product) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: product.name },
        unit_amount: product.price * 100,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/cancel`,
  });
  
  return session.url;
}

// 2. Handle webhook
app.post('/webhook', express.json(), (req, res) => {
  const event = req.body;
  
  switch (event.type) {
    case 'payment_intent.succeeded':
      handlePaymentSuccess(event.data.object);
      break;
    case 'checkout.session.completed':
      handleCheckoutComplete(event.data.object);
      break;
  }
  
  res.json({ received: true });
});
```

---

## Implementation Order

1. **Abilities System** (Foundation)
2. **Loot System** (Core gameplay)
3. **Enemy AI** (Combat)
4. **Level Generator** (Content)
5. **Payment System** (Monetization)

---

## Next Steps
After implementing these systems:
1. Test each system individually
2. Integrate with generated assets
3. Balance gameplay
4. Add polish and VFX
5. Performance optimization
