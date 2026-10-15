# SpecDrive

**Your idea, built properly.** SpecDrive is a free, open-source Mac app that makes spec-driven development effortless for people who don't code.

**Download the app**: [specdrive website](https://connected-mate.github.io/specdrive-site/) · MIT licensed · built by [Connected Mate](https://github.com/Connected-Mate)

Why an MCP and not a "skill"/prompt file? Prompts live in the agent's context and fade as it fills up — that's exactly when agents drift. SpecDrive puts the discipline in the *tools*: the to-do list is enforced, out-of-phase moves fail, "done" requires proof, and the board (not the context) carries the memory. Works with any MCP-capable agent, for any team.

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

## The house

SpecDrive is the house where any coding agent comes to read the rules and drive the project — not just one agent's memory. The MCP server is the single write path: every spec, task and decision goes through it, so the board stays the one source of truth no matter which tool is talking to it. For agents that can't speak MCP, SpecDrive also exports a generated, read-only `AGENTS.md` straight into the project's codebase — regenerated automatically, never hand-edited. Every standing rule carries provenance (who set it, when, and whether the owner approved it), and nothing an agent proposes becomes binding until the owner says so.

## Personalize your agent

Open **Personnaliser mon agent** in the sidebar, choose your personal or project `CLAUDE.md` / `AGENTS.md`, and copy the audit prompt into your MCP-capable agent. It inventories local Claude Code and Codex conversation logs, examines requests and follow-up corrections, and sends evidence-backed suggestions to the Studio. You can inspect exact quotes, edit individual proposed rules, compare the Markdown, then apply only the selected changes. The original is backed up; an externally changed target or overlapping replacements block application.

The agent provides the interpretation; SpecDrive checks quoted text and message references against captured conversation snapshots. Outcomes distinguish a delivery **declared by the agent**, **validated by the user**, and **unknown**. Times are calculated from source timestamps and include human pauses; they are not active work time or a model quality benchmark. The Studio labels captured conversations separately from analyzed requests.

This first version reads bounded local histories (`~/.claude/projects`, Codex `sessions` and `archived_sessions`), up to 100 recent sessions by default, and discloses unavailable or omitted sources. It does **not** retrieve cloud-only Claude/ChatGPT conversations, import exports, or claim access to all past chats. Local transcript formats are version dependent. The prompt asks the agent to disclose any conversations it did not finish reading. Conversation excerpts pass to the agent you run the prompt in; SpecDrive itself does not call a model API.

Audit snapshots stay under `~/.specdrive/agent-audits`. A backup is saved beside the instruction file as `<filename>.specdrive-<audit-id>.bak`. The MCP tools (`start_agent_audit`, `read_agent_audit_session`, `get_agent_audit`, `submit_agent_audit`) can create proposals but cannot apply them. Generated SpecDrive `AGENTS.md` exports remain owned by the project board. Codex's personal instructions use its configured `CODEX_HOME` when present; `AGENTS.override.md` takes precedence, as explained in the [official instructions guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

For isolated development and tests, `SPECDRIVE_DATA_DIR` selects the board/audit store and `SPECDRIVE_HISTORY_HOME` selects a fixture home containing `.claude` / `.codex`. The latter takes precedence over `CODEX_HOME` for audit reads. No real instruction files are needed for tests.

To open a working Studio demo with fictional conversations, run `npm run build` then `node scripts/agent-studio-demo.mjs`. It uses a fresh temporary data store and Electron profile. Add `--screenshot /absolute/path/preview.png` to capture the view and exit. The demo never scans personal conversation logs or changes personal instruction files.

## Run it

```bash
npm install
npm run dev        # development
npm run dist       # package a Mac app (dmg)
```

## Under the hood

- **Electron + React + TypeScript** (electron-vite). Design system: twilight-editorial (display serif, single #007aff accent, pill shapes, glow-ring elevation). Note: the commercial display/UI fonts used in official builds are not in this repo — the app falls back to Georgia/SF Pro automatically.
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
