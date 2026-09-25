# Void Walker - Quick Setup Guide

## Problem: Module Not Found Error

The error you're seeing is because the file paths in `Game.js` don't match your actual project structure.

---

## Solution

### Option 1: Check Your Folder Structure

Run this command to see your actual folder structure:

```bash
cd "C:\Users\deezh\Documents\rpg crawler game"
dir /s /b
```

You should see something like:
```
src/
  core/
    abilities.js
    loot.js
    enemy_ai.js
    level_generator.js
  payments/
    stripe.js
  game/
    Game.js
```

**If the structure is correct**, the issue might be:
1. Files weren't copied properly
2. Case sensitivity (Windows is case-insensitive but Node.js might have issues)
3. Node.js caching

### Option 2: Run These Commands to Fix

```bash
# Navigate to your project
cd "C:\Users\deezh\Documents\rpg crawler game"

# Clear any Node cache
node --gc-global --clear-module-cache src/game/Game.js

# Or reinstall dependencies
npm install

# Try running again
npm start
```

### Option 3: Check File Paths Manually

Open `src/game/Game.js` and verify the require statements at the top:

```javascript
const { AbilitySystem } = require('./core/abilities');
const { LootSystem } = require('./core/loot');
const { AIFactory } = require('./core/enemy_ai');
const { LevelGenerator } = require('./core/level_generator');
const { StripePaymentSystem } = require('./payments/stripe');
```

**These paths assume:**
- You're running from the project root (`rpg crawler game/`)
- The files are in `src/core/` and `src/payments/`

---

## Quick Diagnostic

Run this to check if all files exist:

```bash
cd "C:\Users\deezh\Documents\rpg crawler game"
if exist src\core\abilities.js echo "abilities.js: OK" else echo "abilities.js: MISSING"
if exist src\core\loot.js echo "loot.js: OK" else echo "loot.js: MISSING"
if exist src\core\enemy_ai.js echo "enemy_ai.js: OK" else echo "enemy_ai.js: MISSING"
if exist src\core\level_generator.js echo "level_generator.js: OK" else echo "level_generator.js: MISSING"
if exist src\payments\stripe.js echo "stripe.js: OK" else echo "stripe.js: MISSING"
if exist src\game\Game.js echo "Game.js: OK" else echo "Game.js: MISSING"
```

---

## Most Likely Fix

The issue is probably that the `src` folder structure didn't copy correctly. Make sure your project looks like this:

```
rpg crawler game/
├── src/
│   ├── core/
│   │   ├── abilities.js
│   │   ├── loot.js
│   │   ├── enemy_ai.js
│   │   └── level_generator.js
│   ├── payments/
│   │   └── stripe.js
│   └── game/
│       └── Game.js
├── package.json
├── .env.example
└── README.md
```

**If files are missing**, re-copy them from:
```
C:\Users\deezh\.agnes\temporary\2026-09-24\20260924_5\work\src\
```

---

## After Fixing

1. Make sure you have Node.js installed (v18+)
2. Run: `npm install`
3. Copy `.env.example` to `.env`
4. Add your Stripe API key to `.env`
5. Run: `npm start`

---

## Need More Help?

If you're still having issues, run this command and paste the output:

```bash
cd "C:\Users\deezh\Documents\rpg crawler game"
node -e "console.log(require('path').resolve('.'))"
dir src
```

This will show me exactly where Node.js is looking for files.
