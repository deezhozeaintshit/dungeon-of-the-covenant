# MCP Servers Setup Guide

This document contains configuration for three game development MCP servers:
1. game-asset-mcp - AI-generated game assets
2. rpg-generator-mcp-server - RPG content generation
3. summer-engine-mcp - Game engine integration

## 1. game-asset-mcp

### Installation Steps
```bash
# Clone the repository
git clone https://github.com/MubarakHAlketbi/game-asset-mcp.git
cd game-asset-mcp

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env and add your Hugging Face API Key
```

### Configuration
Add the following to your AgnesCode MCP config file (usually `~/.claude/settings.json` or `~/.config/agnescode/mcp.json`):

```json
{
  "mcpServers": {
    "game-asset-mcp": {
      "command": "node",
      "args": ["/path/to/game-asset-mcp/dist/index.js"],
      "env": {
        "HUGGINGFACE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Features
- Generate 2D game assets (sprites, icons, backgrounds)
- Create 3D game models (characters, props, environments)
- Text-to-image generation

### Required API Key
- Hugging Face API Key ([Get one here](https://huggingface.co/settings/tokens))

---

## 2. rpg-generator-mcp-server

### Installation Steps
```bash
# Clone the repository
git clone https://github.com/guyroyse/rpg-generator-mcp-server.git
cd rpg-generator-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration
```json
{
  "mcpServers": {
    "rpg-generator-mcp-server": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

### Features
- `random_campaign_idea` - Generate random RPG campaign ideas
- `random_region_attributes` - Generate fantasy region attributes

---

## 3. summer-engine-mcp

### Installation Steps
```bash
# Install Summer Engine CLI
npx -y summer-engine@latest install

# Login to your account
npx -y summer-engine@latest login

# Run the MCP server
npx -y summer-engine@latest mcp
```

### Configuration
```json
{
  "mcpServers": {
    "summer-engine": {
      "command": "npx",
      "args": ["-y", "summer-engine", "mcp"]
    }
  }
}
```

### Features
- 56 game engine tools
- Scene tree management
- Runtime control
- Asset importing
- Game building and debugging

### Requirements
- Node.js 18+
- Summer Engine desktop app or CLI

---

## AgnesCode Configuration

### Option 1: User-level Configuration
Edit the file: `~/.config/AgnesCode/mcp.json`

If the file doesn't exist, create it:
```json
{
  "mcpServers": {
    "videogamemcp.com": {
      "url": "https://sse.videogamemcp.com/sse",
      "enabled": true
    },
    "game-asset-mcp": {
      "command": "node",
      "args": ["C:\\Users\\deezh\\game-asset-mcp\\dist\\index.js"],
      "env": {
        "HUGGINGFACE_API_KEY": "your_api_key_here"
      }
    },
    "rpg-generator-mcp-server": {
      "command": "node",
      "args": ["C:\\Users\\deezh\\rpg-generator-mcp-server\\dist\\index.js"]
    },
    "summer-engine": {
      "command": "npx",
      "args": ["-y", "summer-engine", "mcp"]
    }
  }
}
```

### Option 2: Project-level Configuration
Create `.mcp.json` or `.claude/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "game-asset-mcp": { ... }
  }
}
```

---

## Verify Installation

After restarting AgnesCode, you can verify the MCP servers are connected by trying:
- "Generate a random RPG campaign idea"
- "Create a 2D game sprite"
- "Create a new scene in Summer Engine"

Or check the AgnesCode settings interface to confirm MCP server status.

---

## Notes

1. **game-asset-mcp** requires a Hugging Face API Key, get one at https://huggingface.co/settings/tokens
2. **summer-engine-mcp** requires Node.js 18+, check with `node --version`
3. All configuration changes require restarting AgnesCode to take effect
4. If a server fails to start, check the log files: `~/Library/Logs/AgnesCode/` or `%APPDATA%\AgnesCode\logs\`
