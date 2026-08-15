// Detection + one-click MCP registration for the AI coding agents on this Mac.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AgentId, DetectedAgent } from '../shared/types'

const execFileP = promisify(execFile)
const HOME = os.homedir()

export function mcpServerPath(mainDir: string, isPackaged: boolean): string {
  // Packaged: extraResources copies the bundled server to Resources/mcp.
  // Unpackaged: main runs from <root>/out/main, the server source sits at <root>/mcp.
  return isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'server.mjs')
    : path.resolve(mainDir, '..', '..', 'mcp', 'server.mjs')
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

const whichCache = new Map<string, boolean>()

async function which(bin: string): Promise<boolean> {
  const hit = whichCache.get(bin)
  if (hit !== undefined) return hit
  try {
    // Login shell so we see the user's real PATH (nvm, homebrew...)
    await execFileP('/bin/zsh', ['-lc', `command -v ${bin}`], { timeout: 8000 })
    whichCache.set(bin, true)
    return true
  } catch {
    whichCache.set(bin, false)
    return false
  }
}

let cachedNodePath: string | null = null

/** Absolute node path — GUI agents (Cursor, Claude Desktop…) spawn MCP servers
 *  with a minimal PATH where a bare "node" does not resolve. */
export async function nodeBinPath(): Promise<string> {
  if (cachedNodePath) return cachedNodePath
  try {
    const { stdout } = await execFileP('/bin/zsh', ['-lc', 'command -v node'], { timeout: 8000 })
    const p = stdout.trim().split('\n').pop() ?? ''
    cachedNodePath = p.startsWith('/') ? p : process.execPath
  } catch {
    cachedNodePath = process.execPath
  }
  return cachedNodePath
}

function readJsonSafe(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/** Merge into an agent's config without ever destroying what is already there:
 *  refuse to touch a file that exists but does not parse, back it up, and
 *  write atomically. */
function writeJsonMerged(file: string, mutate: (cfg: Record<string, unknown>) => void): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let cfg: Record<string, unknown> = {}
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8')
    if (raw.trim()) {
      try {
        cfg = JSON.parse(raw)
      } catch {
        throw new Error(
          `${path.basename(file)} exists but is not valid JSON — not touching it. Fix or remove it, then retry.`
        )
      }
      fs.writeFileSync(`${file}.bak`, raw)
    }
  }
  mutate(cfg)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
  fs.renameSync(tmp, file)
}

type McpServersConfig = { mcpServers?: Record<string, unknown> }

function hasSpecdriveEntry(file: string): boolean {
  const cfg = readJsonSafe(file) as McpServersConfig
  return Boolean(cfg.mcpServers && 'specdrive' in cfg.mcpServers)
}

function addSpecdriveJsonEntry(file: string, serverPath: string, nodeBin: string): void {
  writeJsonMerged(file, (cfg) => {
    const c = cfg as McpServersConfig
    c.mcpServers = { ...(c.mcpServers ?? {}), specdrive: { command: nodeBin, args: [serverPath] } }
  })
}

const ANTIGRAVITY_MCP = path.join(HOME, '.gemini', 'antigravity', 'mcp_config.json')
const CURSOR_MCP = path.join(HOME, '.cursor', 'mcp.json')
const CLAUDE_DESKTOP_CFG = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
const WINDSURF_MCP = path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json')
const GEMINI_CFG = path.join(HOME, '.gemini', 'settings.json')
const CODEX_CFG = path.join(HOME, '.codex', 'config.toml')
const CLAUDE_JSON = path.join(HOME, '.claude.json')

function claudeCodeConnected(): boolean {
  const cfg = readJsonSafe(CLAUDE_JSON) as McpServersConfig
  return Boolean(cfg.mcpServers && 'specdrive' in cfg.mcpServers)
}

function codexConnected(): boolean {
  try {
    return fs.readFileSync(CODEX_CFG, 'utf8').includes('[mcp_servers.specdrive]')
  } catch {
    return false
  }
}

function specdriveEntry(file: string): { command: string; args: string[] } | null {
  const cfg = readJsonSafe(file) as McpServersConfig
  const e = cfg.mcpServers?.['specdrive'] as { command?: string; args?: string[] } | undefined
  if (!e?.command) return null
  return { command: e.command, args: e.args ?? [] }
}

function codexEntry(): { command: string; args: string[] } | null {
  try {
    const raw = fs.readFileSync(CODEX_CFG, 'utf8')
    const block = raw.split('[mcp_servers.specdrive]')[1]
    if (!block) return null
    const cmd = /command\s*=\s*"([^"]+)"/.exec(block)?.[1]
    const args = /args\s*=\s*\[([^\]]*)\]/.exec(block)?.[1]
    if (!cmd) return null
    return {
      command: cmd,
      args: args ? [...args.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []
    }
  } catch {
    return null
  }
}

function claudeEntry(): { command: string; args: string[] } | null {
  return specdriveEntry(CLAUDE_JSON)
}

const AGENT_CONFIGS: Record<string, { path: string; entry: () => { command: string; args: string[] } | null }> = {
  'claude-code': { path: CLAUDE_JSON, entry: claudeEntry },
  cursor: { path: CURSOR_MCP, entry: () => specdriveEntry(CURSOR_MCP) },
  'claude-desktop': { path: CLAUDE_DESKTOP_CFG, entry: () => specdriveEntry(CLAUDE_DESKTOP_CFG) },
  windsurf: { path: WINDSURF_MCP, entry: () => specdriveEntry(WINDSURF_MCP) },
  antigravity: { path: ANTIGRAVITY_MCP, entry: () => specdriveEntry(ANTIGRAVITY_MCP) },
  'gemini-cli': { path: GEMINI_CFG, entry: () => specdriveEntry(GEMINI_CFG) },
  'codex-cli': { path: CODEX_CFG, entry: codexEntry }
}

/** The truth test: launch exactly what the agent's config says, shake hands. */
export async function verifyAgent(id: AgentId): Promise<{ ok: boolean; detail: string; checkedAt: string }> {
  const checkedAt = new Date().toISOString()
  const cfg = AGENT_CONFIGS[id]
  if (!cfg) return { ok: false, detail: 'Unknown agent.', checkedAt }
  const entry = cfg.entry()
  if (!entry) {
    return { ok: false, detail: `No "specdrive" entry in ${cfg.path.replace(process.env.HOME ?? '', '~')} — not connected.`, checkedAt }
  }
  return await new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean, detail: string): void => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {}
      resolve({ ok, detail, checkedAt })
    }
    let child: ReturnType<typeof import('node:child_process').spawn>
    try {
      child = spawn(entry.command, entry.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ ok: false, detail: `Could not launch "${entry.command}": ${String(e)}`, checkedAt })
      return
    }
    const timer = setTimeout(() => done(false, `The configured server did not answer within 4s (command: ${entry.command}).`), 4000)
    let buf = ''
    child.stdout?.on('data', (d) => {
      buf += String(d)
      if (buf.includes('"serverInfo"') && buf.includes('specdrive')) {
        clearTimeout(timer)
        done(true, `Server responds — launched "${entry.command} ${entry.args.join(' ')}" and completed a real MCP handshake.`)
      }
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      done(false, `Launch failed: ${e.message} (command: ${entry.command}). The path in the config is probably wrong.`)
    })
    child.on('exit', (code) => {
      if (!settled) {
        clearTimeout(timer)
        done(false, `Server exited immediately (code ${code}).`)
      }
    })
    child.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'specdrive-app-check', version: '1.0' } }
      }) + '\n'
    )
  })
}

export async function detectAgents(serverPath: string): Promise<DetectedAgent[]> {
  const [claudeCli, geminiCli, codexCli] = await Promise.all([
    which('claude'),
    which('gemini'),
    which('codex')
  ])

  const agents: DetectedAgent[] = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      installed: claudeCli || exists(path.join(HOME, '.claude')),
      connected: claudeCodeConnected(),
      install: 'auto',
      manualCommand: `claude mcp add specdrive --scope user -- node "${serverPath}"`
    },
    {
      id: 'cursor',
      name: 'Cursor',
      installed: exists('/Applications/Cursor.app'),
      connected: hasSpecdriveEntry(CURSOR_MCP),
      install: 'auto'
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      installed: exists('/Applications/Claude.app'),
      connected: hasSpecdriveEntry(CLAUDE_DESKTOP_CFG),
      install: 'auto'
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      installed: exists('/Applications/Windsurf.app'),
      connected: hasSpecdriveEntry(WINDSURF_MCP),
      install: 'auto'
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      installed: exists('/Applications/Antigravity.app') || exists(path.dirname(ANTIGRAVITY_MCP)),
      connected: hasSpecdriveEntry(ANTIGRAVITY_MCP),
      install: 'auto'
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      installed: geminiCli || exists(path.join(HOME, '.gemini')),
      connected: hasSpecdriveEntry(GEMINI_CFG),
      install: 'auto'
    },
    {
      id: 'codex-cli',
      name: 'Codex CLI',
      installed: codexCli || exists(path.join(HOME, '.codex')),
      connected: codexConnected(),
      install: 'auto'
    }
  ]
  for (const a of agents) {
    const cfg = AGENT_CONFIGS[a.id]
    if (!cfg) continue
    a.configPath = cfg.path
    const entry = cfg.entry()
    if (entry) {
      a.command = entry.command
      a.args = entry.args
    }
  }
  return agents
}

export async function connectAgent(id: AgentId, serverPath: string): Promise<void> {
  const nodeBin = await nodeBinPath()
  switch (id) {
    case 'claude-code': {
      // The CLI merges into ~/.claude.json for us; user scope = available everywhere.
      await execFileP(
        '/bin/zsh',
        ['-lc', `claude mcp add specdrive --scope user -- "${nodeBin}" "${serverPath}"`],
        { timeout: 20000 }
      )
      return
    }
    case 'cursor':
      addSpecdriveJsonEntry(CURSOR_MCP, serverPath, nodeBin)
      return
    case 'claude-desktop':
      addSpecdriveJsonEntry(CLAUDE_DESKTOP_CFG, serverPath, nodeBin)
      return
    case 'windsurf':
      addSpecdriveJsonEntry(WINDSURF_MCP, serverPath, nodeBin)
      return
    case 'gemini-cli':
      addSpecdriveJsonEntry(GEMINI_CFG, serverPath, nodeBin)
      return
    case 'codex-cli': {
      if (codexConnected()) return
      fs.mkdirSync(path.dirname(CODEX_CFG), { recursive: true })
      const entry = `\n[mcp_servers.specdrive]\ncommand = "${nodeBin}"\nargs = ["${serverPath}"]\n`
      fs.appendFileSync(CODEX_CFG, entry)
      return
    }
    case 'antigravity':
      addSpecdriveJsonEntry(ANTIGRAVITY_MCP, serverPath, nodeBin)
      return
  }
}
