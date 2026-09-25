# Void Walker - Setup Instructions

## 🚀 Quick Start

### 1. Copy All Files to Your Project
Copy these folders/files from the temp location to your project:
```
From: C:\Users\deezh\.agnes\temporary\2026-09-24\20260924_5\work\
To: C:\Users\deezh\Documents\rpg crawler game\
```

**Important folders to copy:**
- `public/` - Contains index.html
- `src/` - Contains all JavaScript modules
- `server.js` - Web server file
- `package.json` - Dependencies
- `.env.example` - Environment config template

### 2. Install Dependencies
```bash
cd "C:\Users\deezh\Documents\rpg crawler game"
npm install
```

### 3. Configure Environment
```bash
# Copy environment template
copy .env.example .env

# Edit .env and add your Stripe API key
# STRIPE_API_KEY=sk_test_your_key_here
```

### 4. Start the Server
```bash
npm start
```

### 5. Open Your Browser
Go to: **http://localhost:3000**

---

## 🎮 How to Play

### Controls
- **WASD** or **Arrow Keys** - Move
- **Mouse** - Aim
- **Left Click** - Attack
- **1-8** - Cast abilities
- **Enter** - Start game (from menu)

### Abilities
| Key | Ability | Cost |
|-----|---------|------|
| 1 | Fireball | 15 Mana |
| 2 | Frost Shard | 12 Mana |
| 3 | Lightning Bolt | 20 Mana |
| 4 | Heal | 25 Mana |
| 5 | Dash | 10 Mana |
| 6 | Meteor | 40 Mana |
| 7 | Shield | 30 Mana |
| 8 | Inferno (Ultimate) | 200 Mana |

---

## 📁 Project Structure

```
rpg crawler game/
├── public/
│   └── index.html          # Main game file
├── src/
│   ├── core/
│   │   ├── abilities.js    # Ability system
│   │   ├── loot.js         # Loot system
│   │   ├── enemy_ai.js     # Enemy AI
│   │   └── level_generator.js # Level generation
│   ├── payments/
│   │   └── stripe.js       # Payment system
│   └── game/
│       └── Game.js         # Game class
├── assets/                  # Generated assets
├── server.js               # Express server
├── package.json            # Dependencies
├── .env                    # Environment variables
└── README.md               # Documentation
```

---

## 🔧 Troubleshooting

### Error: Cannot find module
Make sure all files are in the correct folders:
```bash
# Check structure
dir src
dir public
```

### Error: Port already in use
```bash
# Kill the process using port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or change the port in .env
PORT=3001
```

### Game not loading
1. Make sure you ran `npm install`
2. Check that `public/index.html` exists
3. Open browser console (F12) for errors

---

## 🌐 Web Deployment

To deploy online:

### Option 1: Vercel
```bash
npm install -g vercel
vercel
```

### Option 2: Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod
```

### Option 3: Railway
```bash
railway login
railway init
railway up
```

---

## 📝 Notes

- The game runs entirely in the browser
- No backend required for basic gameplay
- Stripe integration requires valid API key
- Assets are placeholder images (generate with Agnes AI)

---

**Game URL: http://localhost:3000**
