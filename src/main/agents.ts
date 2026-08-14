// Detection + one-click MCP registration for the AI coding agents on this Mac.
import { execFile } from 'node:child_process'
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
