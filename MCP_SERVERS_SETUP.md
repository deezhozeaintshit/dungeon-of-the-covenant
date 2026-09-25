# MCP 服务器安装配置

本文档包含三个游戏开发相关的 MCP 服务器配置：
1. game-asset-mcp - 游戏素材生成
2. rpg-generator-mcp-server - RPG 内容生成
3. summer-engine-mcp - 游戏引擎集成

## 1. game-asset-mcp

### 安装步骤
```bash
# 克隆仓库
git clone https://github.com/MubarakHAlketbi/game-asset-mcp.git
cd game-asset-mcp

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，添加你的 Hugging Face API Key
```

### 配置方式
将以下配置添加到 AgnesCode 的 MCP 配置文件（通常是 `~/.claude/settings.json` 或 `~/.config/agnescode/mcp.json`）：

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

### 功能
- 生成 2D 游戏素材（精灵图、图标、背景）
- 创建 3D 游戏模型（角色、道具、环境）
- 文本到图像生成

### 所需 API Key
- Hugging Face API Key（[获取地址](https://huggingface.co/settings/tokens)）

---

## 2. rpg-generator-mcp-server

### 安装步骤
```bash
# 克隆仓库
git clone https://github.com/guyroyse/rpg-generator-mcp-server.git
cd rpg-generator-mcp-server

# 安装依赖
npm install

# 构建项目
npm run build
```

### 配置方式
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

### 功能
- `random_campaign_idea` - 生成随机 RPG 战役创意
- `random_region_attributes` - 生成幻想区域属性

---

## 3. summer-engine-mcp

### 安装步骤
```bash
# 安装 Summer Engine CLI
npx -y summer-engine@latest install

# 登录账号
npx -y summer-engine@latest login

# 运行 MCP 服务器
npx -y summer-engine@latest mcp
```

### 配置方式
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

### 功能
- 56 个游戏引擎工具
- 场景树管理
- 运行时控制
- 资产导入
- 游戏构建和调试

### 所需依赖
- Node.js 18+
- Summer Engine 桌面应用或 CLI

---

## AgnesCode 配置位置

### 方式 1: 用户级配置
编辑文件：`~/.config/AgnesCode/mcp.json`

如果文件不存在，创建它：
```json
{
  "mcpServers": {
    "videogamemcp.com": {
      "url": "https://sse.videogamemcp.com/sse",
      "enabled": true
    },
    "game-asset-mcp": {
      "command": "node",
      "args": ["/path/to/game-asset-mcp/dist/index.js"],
      "env": {
        "HUGGINGFACE_API_KEY": "your_api_key_here"
      }
    },
    "rpg-generator-mcp-server": {
      "command": "node",
      "args": ["dist/index.js"]
    },
    "summer-engine": {
      "command": "npx",
      "args": ["-y", "summer-engine", "mcp"]
    }
  }
}
```

### 方式 2: 项目级配置
在项目根目录创建 `.mcp.json` 或 `.claude/mcp.json`：
```json
{
  "mcpServers": {
    "game-asset-mcp": { ... }
  }
}
```

---

## 验证安装

重启 AgnesCode 后，可以使用以下命令验证 MCP 服务器是否成功连接：

```
请列出所有可用的 MCP 工具
```

或者查看 AgnesCode 的设置界面，确认 MCP 服务器状态。

---

## 注意事项

1. **game-asset-mcp** 需要 Hugging Face API Key，在 https://huggingface.co/settings/tokens 获取
2. **summer-engine-mcp** 需要 Node.js 18+，可以通过 `node --version` 检查
3. 所有配置修改后需要重启 AgnesCode 才能生效
4. 如果某个服务器启动失败，检查日志文件：`~/Library/Logs/AgnesCode/` 或 `%APPDATA%\AgnesCode\logs\`
