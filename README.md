# SpecDrive

**Your idea, built properly.** SpecDrive is a free Mac app that makes spec-driven development effortless for people who don't code.

You describe what you want to build — in your own words. Your AI coding agent (Claude Code, Cursor, Windsurf, Gemini CLI, Codex CLI…) fills a beautiful live board with your project's specs, challenges them, researches them online, flags the genuinely hard parts, sketches the screens, then builds the product step by step — and you watch every card appear in real time.

## How it works

1. **Connect** — SpecDrive detects the AI agents installed on your Mac and registers its local MCP server with them in one click.
2. **Talk** — Copy the starter prompt into your agent and describe your idea. Every answer becomes a spec card on your board, live.
3. **Loop** — The board walks you through the quality loop, handing you the exact prompt for each step (best pasted into a fresh agent session):
   - **Idea** → capture everything you know
   - **Challenge** → a fresh session hunts for holes and contradictions
   - **Research** → web research: similar products, reusable building blocks, pitfalls
   - **Hard parts** → a pre-mortem ranks difficulty and plans fallbacks; hard topics get dedicated deep-dive sessions
   - **Plan** → architecture, screen sketches (wireframes) and a small-steps build plan
   - **Build** → strict discipline: one task at a time, verified, checked off on your board

The loop never really ends: new ideas become new specs, new tasks, new builds.

## Run it

```bash
npm install
npm run dev        # development
npm run dist       # package a Mac app (dmg)
```

## Under the hood

- **Electron + React + TypeScript** (electron-vite). Design system: Portal twilight-editorial (Perfectly Nineties display serif, single #007aff accent, pill shapes, glow-ring elevation).
- **MCP server** (`mcp/server.mjs`, stdio, @modelcontextprotocol/sdk): tools `create_project`, `add_spec`, `update_spec`, `add_task`, `update_task`, `add_wireframe`, `set_phase`, `get_project`, `get_guidance`, `log_note`.
- **Shared store**: plain JSON under `~/.specdrive/projects/<id>/` — the MCP server writes, the app watches (chokidar) and updates live. Deleting a project moves it to `~/.specdrive/trash`, never destroys it.
- Wireframes are self-contained grayscale HTML files rendered in sandboxed iframes (scripts stripped server-side).

## Agent registration details

| Agent | Config written |
|---|---|
| Claude Code | `claude mcp add specdrive --scope user -- node <server>` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Codex CLI | `~/.codex/config.toml` |
| Antigravity | manual (instructions provided in-app) |
