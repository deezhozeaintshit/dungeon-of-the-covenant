# ⚔️ Dungeon of the Covenant (AAA 3D Co-Op Action RPG)

**Dungeon of the Covenant** is a real-time multiplayer 3D Dungeon Crawler & Co-Op Action RPG powered by **Three.js (WebGL)** on the client and an authoritative **20Hz Node.js + WebSocket (`ws`) + Express + Stripe** server on the backend.

---

## 🌟 Core AAA Features & Systems

### 1. Six Unique Articulated 3D Hero Classes (`client/js/entities.js`)
Every hero class features a custom-sculpted, multi-limbed 3D character model with class-specific armor silhouettes, headgear, capes, and animated weapons:
- 🛡️ **Juggernaut (Tank)**: Heavy fortress tower-plate pauldrons, horned great-helm, crimson paladin cape, **Tower Bulwark Shield** (left arm) & **2-Handed Runic Warhammer** (right arm).
- 🗡️ **Shadowblade (Rogue)**: Sleek nocturnal assassin cowl, glowing emerald night-vision eyes, twin scarf tails & **Dual Reverse-Grip Serrated Daggers** in both hands.
- 🔥 **Pyromancer (Mage)**: Tall pointed arcane wizard hat with golden band, ornate elemental robes, **Blazing Sun-Staff** (right hand) & **Floating Orbiting Fire Tome** (left hand).
- ✨ **Radiant Cleric (Healer)**: Golden papal mitre crown, white/gold vestments, **6-Pointed Floating Golden Seraph Halo**, **Blessed Sun-Kite Shield** & **Radiant Sun-Star Mace**.
- 🏹 **Deadeye (Ranger)**: Emerald forest hood with crimson feather plume, leather bracers, **Back-Mounted Arrow Quiver**, **Masterwork Recurve Longbow** & drawn glowing arrow.
- 💀 **Dreadweaver (Necromancer)**: Jagged bone-crown skull mask with glowing toxic eye sockets, tattered shroud, **3 Orbiting Soul Skulls** & **Giant Curved Reaper Bone-Scythe**.

### 2. Eight Distinct 3D Enemy Models & Boss Malakor (`client/js/entities.js`, `server/game/Mob.js`, `server/game/Boss.js`)
- **8 Unique Monster Silhouettes**:
  1. `goblin`: Hunched green skin, long pointed ears, jagged cleaver.
  2. `skeleton`: Ribcage torso, skull head, rusted broadsword & buckler.
  3. `orc_berserker`: Massive hulking brute, lower tusks, horned pauldrons & dual double-bladed greataxes.
  4. `dark_cultist`: Hooded crimson-and-void acolyte with floating purple sacrifice orb.
  5. `flame_elemental`: Levitating magma core with 4 orbiting volcanic rock shards.
  6. `frost_revenant`: Translucent glacial crystal phantom with crown of jagged ice spikes.
  7. `elite_executioner`: Towering black-iron inquisitor warden with executioner hood & 2-handed crimson guillotine axe.
  8. `elite_lich`: Levitating arch-necromancer with golden phylactery crown, skeletal ribcage & twin necrotic orbs.
- **Arch-Inquisitor Malakor (Multi-Phase Boss)**: Guarded by two Wing Soul-Seals (`25%` damage ward each) that shatter into `+20%` Boss Vulnerability once both Wing Wardens fall.

### 3. Five Procedural 3D Biome Worlds (`client/js/dungeon.js`, `server/game/Room.js`)
Every match (or pressing `🎲 NEXT FLOOR [N]`) generates a new dungeon floor with custom procedural 512×512 canvas stone/lava/ice/emerald/void textures, 3D environmental architecture, dynamic fog/lighting, and TTRPG Hex Anomalies:
1. **Sunken Ossuary**: Crypt skull flagstones, towering **Bone Obelisks** & **Glowing Green Acid Cauldrons**.
2. **Magma Foundry**: Volcanic basalt with glowing lava veins, **Molten Lava Geysers** & **Iron Anvil Monoliths**.
3. **Frostbound Sanctum**: Fractured glacial ice, **Translucent Ice Crystal Spires** & **Frozen Runestones**.
4. **Verdant Plague-Crypt**: Mossy overgrown ruins, **Twisted Plague-Root Trees** & **Glowing Toxic Spore Pods**.
5. **Astral Void Nexus**: Obsidian star-grid tiles, **Floating Levitating Void Cubes** & **Spinning Astral Portal Rings**.

### 4. Studio Orchestral Soundtrack & Physical-Modeling SFX Engine (`client/js/audiomanager.js`)
- **Continuous 16-Step Dark-Fantasy Orchestral Sequencer**: Auto-unlocks on first user interaction and routes through a **2.2s Stereo Cathedral Convolution Reverb** + Master Compressor (Contrabass/Cello D-Phrygian Ostinato, Cathedral Organ & Choir Pads, Plucked Harp/Lute Arpeggios, and Taiko War-Toms). Dynamically accelerates into a **136 BPM Boss Battle Symphony** when Malakor awakens.
- **Object-Matched Physical-Modeling SFX**: Every weapon, spell, jump, and interactable object synthesizes its real physical acoustic signature (Warhammer anvil clang, twin dagger steel slices, bowstring twang + arrow whistle, fireball detonation, brittle ice crystal shatter, rattling bone spikes, clinking gold coins, creaking iron chest hinges, and blacksmith anvil strikes).

### 5. 3D Jumping, Ledge Vaulting & Magnetic Loot Vacuum (`server/game/Collision.js`, `server/game/Room.js`)
- **Vertical Jump Physics (`y`, `vy`)**: Jump (`Spacebar` / Gamepad `A` / Touch `🦘 JUMP`) vaults across interior room ledges and divider steps (`isAirborne`) while unleashing a **Jump-Slam AoE Shockwave** upon landing near enemies.
- **Magnetic Loot Vacuum**: Automatically pulls nearby gold coins, Soul Shards, and equipment drops toward your hero (`9.5m` standing / `16.0m` while jumping).

---

## 🎮 Complete Controls Reference

### 📱 Mobile & Touch Controls (Ergonomic Right-Thumb Arc)
- **Left Half of Screen (`#joystick-zone`)**: Floating 360° Analog Movement Stick (100% unobstructed).
- **Right Thumb Arc (`.abilities-zone`)**:
  - **Center-Right Large Button (`⚔️`)**: Primary Class Weapon Attack (Hold for auto-combo).
  - **Bottom-Left of Attack (`#btn-skill-1`)**: Ability 1 (`Shadowstep` / `Shield Slam` / `Frost Nova` / `Luminary Lance` / `Rapid Volley` / `Bone Spikes`).
  - **Between Ability 1 & Ability 2 (`💨 DASH`)**: Invulnerable Dodge Dash (`i-frames`).
  - **Diagonal North-West of Attack (`#btn-skill-2`)**: Ability 2 (`Tar Bomb` / `Iron Bastion` / `Fireball` / `Sanctuary Ward` / `Pinning Trap` / `Soul Drain`).
  - **North of Attack (`#btn-skill-3`)**: Ultimate Ability 3 (`Eviscerate` / `Seismic Vortex` / `Chaos Meteor` / `Judgement Brand` / `Smoke Veil` / `Corpse Explosion`).
  - **North of Ultimate & Ability 2, Right Between Them (`🦘 JUMP`)**: 3D Jump, Ledge Vault & Magnetic Loot Pull.

### 🎮 Gamepad / Controller (Xbox, PlayStation DualSense/DualShock, Switch Pro)
- **Left Stick**: 360° Movement (camera-relative).
- **Right Stick**: Aim Direction & Camera Rotation (`Q/E`).
- **`A` (Xbox) / `Cross` (PS)**: 🦘 **Jump / Ledge Vault & Loot Pull**.
- **`B` (Xbox) / `Circle` (PS)**: 💨 **Tactical Dodge Dash**.
- **`X` (Xbox) / `Square` (PS)** or **Right Trigger (`RT` / `R2`)**: ⚔️ **Primary Weapon Attack**.
- **`Y` (Xbox) / `Triangle` (PS)**: 💥 **Ability 1 (`Q`)**.
- **Left Bumper (`LB` / `L1`)**: 🛡️ **Ability 2 (`E`)**.
- **Right Bumper (`RB` / `R1`)** or **Left Trigger (`LT` / `L2`)**: ☄️ **Ultimate Ability 3 (`R`)**.
- **`Start` / `Options` or `D-Pad Up`**: 📯 **Party War Horn**.
- **`Select` / `Share` or `D-Pad Down`**: 👁️ **Toggle Clean HUD Mode (`[H]`)**.

### ⌨️ Keyboard & Mouse
- **`W A S D` / Arrow Keys**: Move Hero.
- **`Spacebar`**: 🦘 Jump / Ledge Vault / Air-Slam.
- **`Shift`**: 💨 Dodge Dash (`i-frames`).
- **`Left Click` or `F`**: ⚔️ Primary Weapon Attack.
- **`1 / 2 / 3` (or `Q / E / R`)**: Cast Class Abilities 1, 2, and 3.
- **`G`**: 🧲 Magnetic Loot Pickup & Shrine Activation.
- **`N`**: 🎲 Generate Next Procedural Dungeon Floor.
- **`H`**: 👁️ Master Clean-HUD Toggle (collapses/expands all HUD panels at once).
- **`M`**: 🔊 Mute / Unmute Studio Orchestral Music & SFX.
- **`Escape`**: ✖ Close any open modal or drawer (`Shop`, `Forge`, `Secret`, `Need/Greed`).

---

## 🚀 Cloud Deployment Guide: Fly.io vs. Vercel vs. Netlify

### 🏆 Recommended Platform: **Fly.io** (Best Choice!)

| Platform | Persistent WebSockets (`ws`) | 20Hz Stateful Game Loop | Automatic HTTPS / SSL | Verdict |
| :--- | :---: | :---: | :---: | :--- |
| **Fly.io** *(Recommended)* | ✅ **Yes (Native)** | ✅ **Yes (Always-On VM)** | ✅ **Yes (`fly.dev`)** | **#1 Best Fit — Deploy Full Stack Here** |
| **Vercel** | ❌ No (Serverless timeouts) | ❌ No (Stateless functions) | ✅ Yes | Frontend-only (Cannot run `Room.js` WebSockets) |
| **Netlify** | ❌ No (Serverless timeouts) | ❌ No (Stateless functions) | ✅ Yes | Frontend-only (Cannot run `Room.js` WebSockets) |

#### Why Fly.io Wins for *Dungeon of the Covenant*:
Because your game runs a **real-time 20Hz (`50ms` tick) authoritative multiplayer simulation (`server/game/Room.js`) over persistent WebSockets (`ws`)**, serverless platforms like **Netlify** and **Vercel** cannot host the backend—their serverless functions spin down after a few seconds and drop WebSocket connections.
**Fly.io** runs your full Node.js server (`server/server.js`) inside an always-on Firecracker micro-VM with **native WebSockets (`wss://`)**, **automatic HTTPS**, and serves both your **3D Three.js frontend (`client/`)** and **WebSocket/Stripe backend** from one unified domain with zero CORS issues.

---

### ⚡ Step-by-Step Deployment to Fly.io (Takes ~2 Minutes)

I have already generated the production [`Dockerfile`](./Dockerfile), [`.dockerignore`](./.dockerignore), and [`fly.toml`](./fly.toml) in your project root.

#### 1. Install the Fly CLI & Sign In
In PowerShell:
```powershell
iwr https://fly.io/install.ps1 -useb | iex
fly auth login
```

#### 2. Launch the App on Fly.io
From `c:\Users\deezh\Documents\rpg crawler game`:
```powershell
fly launch --copy-config --no-deploy
```
*(When prompted to tweak settings, press `N` to keep the pre-configured `fly.toml` settings).*

#### 3. Set Your Live Stripe API Key as an Encrypted Fly Secret
```powershell
fly secrets set STRIPE_SECRET_KEY="sk_live_or_test_your_key_here"
```

#### 4. (Optional) Attach a 1GB Persistent Volume for Cloud Player Accounts
So `server/data/accounts.json` persists permanently across container restarts:
```powershell
fly volumes create covenant_data --region ord --size 1
```

#### 5. Deploy!
```powershell
fly deploy
```
Once complete, your game will be live worldwide with full HTTPS and secure WebSockets (`wss://`) at:
**`https://<your-app-name>.fly.dev`**

---

## 💻 Local Development
```powershell
npm install
npm start
```
Then open **[http://localhost:3000](http://localhost:3000)** in any desktop or mobile browser.
