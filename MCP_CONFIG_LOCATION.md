# MCP Config File Locations

## For AgnesCode on Windows

The MCP configuration file is typically located at one of these paths:

### Option 1: User-level config (recommended)
```
C:\Users\deezh\.mcp.json
```

### Option 2: AgnesCode app config
```
C:\Users\deezh\AppData\Roaming\AgnesCode\settings.json
```
(Add MCP configuration inside the settings.json file)

### Option 3: Project-level config
```
C:\Users\deezh\your-project\.mcp.json
```
or
```
C:\Users\deezh\your-project\.vscode\mcp.json
```

---

## How to Add MCP Servers

### Step 1: Create/Edit the MCP Config File
Open or create `C:\Users\deezh\.mcp.json` and add:

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

### Step 2: Restart AgnesCode
After saving the config file, restart AgnesCode for the changes to take effect.

---

## Verification

To verify the MCP servers are loaded:
1. Open AgnesCode settings (Ctrl+,)
2. Look for MCP Servers section
3. Check if your servers show as "Connected"

Or try asking:
- "List all available MCP tools"
- "Generate a random RPG campaign idea"
- "Create a 2D game sprite"

---

## Notes

- If `.mcp.json` doesn't exist at `C:\Users\deezh\.mcp.json`, create it
- The file must be valid JSON
- Each server needs its own unique name/key
- Windows paths should use `\\` or `/` (forward slashes work too)
