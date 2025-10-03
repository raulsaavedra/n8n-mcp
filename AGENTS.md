# Agent Guide

Use this repository to maintain and extend the n8n MCP server.

## Focus Areas
- `src/mcp/server.ts` & `src/mcp/handlers-*`: MCP entrypoints and tool implementations.
- `src/config/n8n-api.ts`: market-aware configuration loader (remember the `N8N_<MARKET>_API_*` pattern).
- `data/nodes.db`: bundled node + tool documentation snapshot that powers all lookups.

## Maintenance Notes
- Current documentation comes from the bundled `data/nodes.db`; no rebuild pipeline ships today.
- Schedule time to build a lean refresh script when upstream n8n ships noteworthy node updates.
- Template, telemetry, and enhanced-doc subsystems were removed—keep new work aligned with the simplified surface area.
- Reminder: carve out time to draft the lightweight refresh script so `nodes.db` stays current with n8n releases.

## Guidelines
1. Always pass `market` (or full instance context) to handlers that talk to n8n so regional config is honored.
2. Keep tool metadata (`src/mcp/tools*.ts`, docs) and runtime behavior in sync—trim unused options as features evolve.
3. Use the shared logger; avoid raw `console.log` in runtime paths.
4. Update README/agent notes when behavior changes; keep explanations concise.
5. Manage dependencies deliberately; remove anything unused.

## Common Commands
```bash
npm install
npm run build
npm run rebuild:optimized   # optional: regenerate data/nodes.db locally
npm start                   # stdio MCP server
npm run start:http          # optional HTTP bridge
npm run test:unit
```
