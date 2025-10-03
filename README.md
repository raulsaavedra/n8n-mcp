# n8n-MCP

MCP server that exposes n8n documentation and management tools for AI agents. 
Based on https://github.com/czlonkowski/n8n-mcp aiming to build a more streamlined version.

## Features
- Tooling to inspect, validate, and operate on n8n workflows through MCP.
- Market-aware API configuration using `N8N_<MARKET>_API_URL` and `N8N_<MARKET>_API_KEY` (any market codes supported).
- Vitest suites covering handlers, workflow diff operations, and tool metadata.

## Prerequisites
- Node.js 18+
- npm (repository contains `package-lock.json`)
- n8n instances with API access for configured markets.

## Setup
```bash
npm install
npm run build
```

## Running the MCP Server
```bash
npm start            # stdio mode
npm run start:http   # optional HTTP bridge
```

## IDE Integrations

### Claude Code CLI
- Register the server for documentation tools only:
  ```bash
  claude mcp add n8n-mcp \
    -e MCP_MODE=stdio \
    -e LOG_LEVEL=error \
    -e DISABLE_CONSOLE_OUTPUT=true \
    -- npx n8n-mcp
  ```
- Add market-aware credentials when you need management tools. Example for Chile (`CL`) and Mexico (`MX`):
  ```bash
  claude mcp add n8n-mcp \
    -e MCP_MODE=stdio \
    -e LOG_LEVEL=error \
    -e DISABLE_CONSOLE_OUTPUT=true \
    -e N8N_CL_API_URL=https://cl.your-n8n.com \
    -e N8N_CL_API_KEY=xxxx \
    -e N8N_MX_API_URL=https://mx.your-n8n.com \
    -e N8N_MX_API_KEY=yyyy \
    -- npx n8n-mcp
  ```
- Check status with `claude mcp list` and remove with `claude mcp remove n8n-mcp`.

### Codex CLI
- Edit `~/.codex/config.toml` and add:
  ```toml
  [mcp_servers.n8n]
  command = "npx"
  args = ["n8n-mcp"]
  env = { MCP_MODE = "stdio", LOG_LEVEL = "error", DISABLE_CONSOLE_OUTPUT = "true" }
  ```
- Include market-prefixed credentials when you need workflow management. Example:
  ```toml
  [mcp_servers.n8n]
  command = "npx"
  args = ["n8n-mcp"]
  env = {
    MCP_MODE = "stdio",
    LOG_LEVEL = "error",
    DISABLE_CONSOLE_OUTPUT = "true",
    N8N_CL_API_URL = "https://cl.your-n8n.com",
    N8N_CL_API_KEY = "xxxx",
    N8N_MX_API_URL = "https://mx.your-n8n.com",
    N8N_MX_API_KEY = "yyyy"
  }
  ```
- Use the Codex `/mcp` command to verify connectivity and review available tools.

### Cursor IDE
- Create `.cursor/mcp.json` in your project:
  ```json
  {
    "mcpServers": {
      "n8n-mcp": {
        "command": "npx",
        "args": ["n8n-mcp"],
        "env": {
          "MCP_MODE": "stdio",
          "LOG_LEVEL": "error",
          "DISABLE_CONSOLE_OUTPUT": "true"
        }
      }
    }
  }
  ```
- Add market-prefixed credentials to enable management tools. Example:
  ```json
  {
    "mcpServers": {
      "n8n-mcp": {
        "command": "npx",
        "args": ["n8n-mcp"],
        "env": {
          "MCP_MODE": "stdio",
          "LOG_LEVEL": "error",
          "DISABLE_CONSOLE_OUTPUT": "true",
          "N8N_CL_API_URL": "https://cl.your-n8n.com",
          "N8N_CL_API_KEY": "xxxx",
          "N8N_MX_API_URL": "https://mx.your-n8n.com",
          "N8N_MX_API_KEY": "yyyy"
        }
      }
    }
  }
  ```
- Enable the server from Cursor settings and refresh your project rules so the assistant knows about n8n-MCP.
