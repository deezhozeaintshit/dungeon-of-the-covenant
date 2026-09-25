# game-asset-mcp MCP Server Configuration

## Prerequisites
1. Clone the repository:
   ```bash
   git clone https://github.com/MubarakHAlketbi/game-asset-mcp.git
   ```
2. Navigate to the project directory:
   ```bash
   cd game-asset-mcp
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
5. Add your Hugging Face API key to `.env` file:
   ```
   HUGGINGFACE_API_KEY=your_api_key_here
   ```

## MCP Server Configuration
Add the following to your AgnesCode MCP configuration file (`~/.config/agnescode/mcp.json`):

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

## Available Tools
The game-asset-mcp server provides tools for:
- Generating 2D game assets (sprites, icons, backgrounds)
- Creating 3D game models (characters, props, environments)
- Text-to-image generation for game development

## Usage Example
Once configured, you can use tools like:
- `generate_2d_asset`: Create 2D sprites and graphics
- `generate_3d_model`: Generate 3D game assets
- `texture_generator`: Create textures for game objects

## Notes
- Requires a valid Hugging Face API key
- The server uses AI models from Hugging Face Spaces
- Generate assets by describing what you need in natural language
