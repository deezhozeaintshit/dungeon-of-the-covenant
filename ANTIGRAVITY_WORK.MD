# ANTIGRAVITY_WORK.MD — Complete AAA 3D Engine, Blender 5.2 Assets, Auth, Matchmaker & Live Stripe Armory

**Last Updated:** September 24, 2026  
**Lead Architect:** Antigravity AI  
**Live Local URL:** `http://localhost:3000`  
**Live Public HTTPS Tunnel:** `https://membership-nato-sheets-syndrome.trycloudflare.com`

---

## 1. 20 AAA Blender 5.2 `.glb` 3D Assets (`client/assets/models/`)

Generated via [`tools/blender-mcp/generate_aaa_models.py`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/tools/blender-mcp/generate_aaa_models.py) and [`tools/blender-mcp/generate_3d_assets.py`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/tools/blender-mcp/generate_3d_assets.py) using **Blender 5.2 LTS** (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`):

### A. 6 Playable Hero Class 3D `.glb` Models (Mounted in [`client/js/entities.js`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/client/js/entities.js))
1. `hero_juggernaut.glb` — Obsidian Plate Titan with Horned Greathelm, Tower Bulwark Shield & Seismic War-Hammer
2. `hero_cleric.glb` — Radiant Seraph Templar with Floating Golden Halo Ring, Ivory/Gold Armor & Luminary Sun-Staff
3. `hero_rogue.glb` — Shadowblade Assassin with Night-Leather Cowl, Crimson Trim & Dual Venom Twin-Daggers
4. `hero_mage.glb` — Pyromancer Archmage with Arcane Robes, Floating Hellfire Orb & Runed Flame-Staff
5. `hero_ranger.glb` — Deadeye Hunter with Emerald/Bronze Armor, Recurve Longbow & Quiver
6. `hero_necromancer.glb` — Dreadweaver Lich-Lord with Bone Pauldrons & Necrotic Soul-Scythe

### B. 6 Enemy Archetypes + Colossal Boss Sovereign 3D `.glb` Models (Mounted in [`client/js/entities.js`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/client/js/entities.js))
7. `enemy_skeleton_warrior.glb` — Armored Skeletal Legionnaire with Ribcage, Red Eye Visor & Rusted Cleaver
8. `enemy_cultist_archer.glb` — Crimson Hooded Blood-Cultist with Glowing Blood Sigil
9. `enemy_void_assassin.glb` — Ethereal Void-Stalker with Twin Phase-Sickles
10. `enemy_blight_necrolyte.glb` — Plague-Priest with Floating Toxic Blight Orb
11. `enemy_elite_executioner.glb` — Towering Gore-Executioner with Giant Two-Handed Greataxe
12. `enemy_elite_lich.glb` — Floating Arch-Lich Sovereign with Arcane Halo Torus
13. `boss_sovereign.glb` — Colossal Multi-Winged Demon Sovereign with Great-Wings, Horned Crown & Runed Greatsword

### C. 7 Procedural Level Design 3D `.glb` Models (Mounted in [`client/js/dungeon.js`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/client/js/dungeon.js) & [`ProceduralLevelGenerator.js`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/server/game/ProceduralLevelGenerator.js))
14. `covenant_obelisk.glb`
15. `mythic_chest.glb`
16. `soul_altar.glb`
17. `gothic_pillar_brazier.glb`
18. `arcane_portal_gate.glb`
19. `bone_reliquary_throne.glb`
20. `cursed_sarcophagus.glb`

---

## 2. Instant Quickplay Auto-Matchmaking & Procedural Level Generation on Every Match

- **1-Click Quickplay Matchmaking (`#btn-quickplay-match` -> `quickplay_matchmaking`)**:
  - Players simply click **`⚔️ PLAY NOW — FIND MATCH (RANDOM DUNGEON)`** in the Main Menu.
  - [`server/server.js`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/server/server.js) (`findOrCreateQuickplayRoom()`) automatically places connecting players into an active live dungeon match together (replacing AI companion bots as human players drop in) and immediately generates a fresh procedural dungeon floor!
- **Every Match Starts on a Randomly Generated Procedural Level (`Room.startDungeon`)**:
  - Rolls 1 of 5 **Biomes** (*Sunken Ossuary*, *Frost-Bitten Reliquary*, *Crimson Slaughter-Vault*, *Astral Rift*, *Plague-Weep Necropolis*).
  - Rolls 1 of 6 **`rpg-generator` MCP Hex Anomalies** (*Dimensional Echoes*, *Awoken Land*, *Conjuration Backwash*, *Blood Moon Surge*, *Fallen Covenant Monastery*, *Brood-Hive Catacomb Tunnels*) that grant active combat modifiers to all heroes.
  - Rolls 1 of 4 **Multi-Phase Boss Variants** (*Malakor*, *Vaelgor*, *Xal'korith*, *Morvath*).
  - Randomly spawns enemy packs, Elite Mini-Bosses, all 7 Blender `.glb` Level Design Props, and guaranteed `Rare`, `Epic`, and `Legendary` 3D Gear Drops on the floor.

---

## 3. Cloud Account Authentication (`server/authService.js`)

- **Endpoints:** `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/sync`.
- **Storage:** [`server/data/accounts.json`](file:///c:/Users/deezh/Documents/rpg%20crawler%20game/server/data/accounts.json) persists `username`, `passwordHash`, `token`, `level`, `xp`, `gold`, `shards`, `gearScore`, `equippedItem`, `unlockedAuras`, `cosmeticAura`, `title`, and `mightRank` / `vitalityRank` / `hasteRank`.

---

## 4. Live Stripe `.env` In-App Purchases & Real Character Item Fulfillment (`server/stripeService.js`)

- Automatically loads `STRIPE_API_KEY` / `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `BASE_URL` from `.env` (and `.env.txt`).
- Removed the Secret/Publishable Key input fields from the Main Menu / Emporium UI as requested.
- Every purchase (`starter_pack`, `founder_pass`, `mythic_3d_arsenal`) creates a real Stripe Checkout session (`mode: "live"`) AND immediately grants and equips the corresponding **Mythic/Legendary Weapon**, **3D Cosmetic Aura**, **Soul Shards**, and **Permanent Soul-Tree Blessings** onto the player's account and live character in combat (`Room.equipProceduralItem`).
