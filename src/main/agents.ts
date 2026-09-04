// Detection + one-click MCP registration for the AI coding agents on this Mac.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AgentId, DetectedAgent } from '../shared/types'

const execFileP = promisify(execFile)
const HOME = os.homedir()

/** Exactly what an agent's config tells it to launch — command, args AND the
 *  environment. Verification must use this and nothing else, or it can pass
 *  while the real agent fails. */
interface AgentEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

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

let cachedNode: { path: string; isElectron: boolean } | null = null

/** Where Node usually lives when the login shell does not say. Homebrew (both
 *  architectures), the system, MacPorts, then whatever nvm has installed. */
function knownNodePaths(): string[] {
  const list = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', '/opt/local/bin/node']
  try {
    const nvm = path.join(HOME, '.nvm', 'versions', 'node')
    for (const v of fs.readdirSync(nvm).sort().reverse()) list.push(path.join(nvm, v, 'bin', 'node'))
  } catch {
    // no nvm — nothing to add
  }
  return list
}

/** The binary an agent must launch, and whether it is our own app standing in
 *  for Node. That distinction matters: the Electron binary only behaves as Node
 *  when ELECTRON_RUN_AS_NODE=1 is in its environment — without it, launching it
 *  opens ANOTHER copy of SpecDrive instead of serving the board. */
export async function nodeBin(): Promise<{ path: string; isElectron: boolean }> {
  if (cachedNode) return cachedNode
  try {
    const { stdout } = await execFileP('/bin/zsh', ['-lc', 'command -v node'], { timeout: 8000 })
    const p = stdout.trim().split('\n').pop() ?? ''
    if (p.startsWith('/') && exists(p)) {
      cachedNode = { path: p, isElectron: false }
      return cachedNode
    }
  } catch {
    // login shell told us nothing — try the usual places
  }
  const found = knownNodePaths().find((p) => exists(p))
  cachedNode = found ? { path: found, isElectron: false } : { path: process.execPath, isElectron: true }
  return cachedNode
}

/** Kept for the callers that only need the path (the copy-paste setup snippet). */
export async function nodeBinPath(): Promise<string> {
  return (await nodeBin()).path
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

function addSpecdriveJsonEntry(file: string, serverPath: string, bin: string, isElectron: boolean): void {
  writeJsonMerged(file, (cfg) => {
    const c = cfg as McpServersConfig
    c.mcpServers = {
      ...(c.mcpServers ?? {}),
      specdrive: {
        command: bin,
        args: [serverPath],
        // Only when the stand-in is our own app binary: it must be told to act
        // as plain Node, or launching it opens another SpecDrive window.
        ...(isElectron ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {})
      }
    }
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
  return entryLooksUsable(claudeEntry())
}

function codexConnected(): boolean {
  return entryLooksUsable(codexEntry())
}

/** A written entry only counts when the binary it names still exists, and when
 *  an Electron stand-in carries the flag that makes it behave as Node. */
function entryLooksUsable(e: AgentEntry | null): boolean {
  if (!e?.command || !exists(e.command)) return false
  const isElectronBin = /\.app\/Contents\/MacOS\//.test(e.command)
  if (isElectronBin && e.env.ELECTRON_RUN_AS_NODE !== '1') return false
  return true
}

function specdriveEntry(file: string): AgentEntry | null {
  const cfg = readJsonSafe(file) as McpServersConfig
  const e = cfg.mcpServers?.['specdrive'] as { command?: string; args?: string[]; env?: Record<string, string> } | undefined
  if (!e?.command) return null
  return { command: e.command, args: e.args ?? [], env: e.env ?? {} }
}

function codexEntry(): AgentEntry | null {
  try {
    const raw = fs.readFileSync(CODEX_CFG, 'utf8')
    // Stop at the next [section] so we never read a neighbour's settings.
    const after = raw.split('[mcp_servers.specdrive]')[1]
    if (after === undefined) return null
    const block = after.split(/\n\[/)[0]
    const cmd = /command\s*=\s*"([^"]+)"/.exec(block)?.[1]
    const args = /args\s*=\s*\[([^\]]*)\]/.exec(block)?.[1]
    if (!cmd) return null
    const env: Record<string, string> = {}
    const envInline = /env\s*=\s*\{([^}]*)\}/.exec(block)?.[1]
    if (envInline) for (const m of envInline.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g)) env[m[1]] = m[2]
    const envTable = after.split('[mcp_servers.specdrive.env]')[1]?.split(/\n\[/)[0]
    if (envTable) for (const m of envTable.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g)) env[m[1]] = m[2]
    return {
      command: cmd,
      args: args ? [...args.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [],
      env
    }
  } catch {
    return null
  }
}

function claudeEntry(): AgentEntry | null {
  return specdriveEntry(CLAUDE_JSON)
}

const AGENT_CONFIGS: Record<string, { path: string; entry: () => AgentEntry | null }> = {
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
      // The config's own environment, never a friendlier one: this must fail
      // exactly where the real agent would.
      child = spawn(entry.command, entry.args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...entry.env }
      })
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
        done(true, 'The link answers for real — this agent can reach your board.')
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
      // Real binary on PATH only — a leftover ~/.claude dir is not an install.
      installed: claudeCli,
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
      // App bundle only. Never the config dir: connectAgent creates it ourselves,
      // which made Antigravity look "installed" forever on machines without it.
      installed: exists('/Applications/Antigravity.app'),
      connected: hasSpecdriveEntry(ANTIGRAVITY_MCP),
      install: 'auto'
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      // Binary only — ~/.gemini also hosts Antigravity config, so the dir proves nothing.
      installed: geminiCli,
      connected: hasSpecdriveEntry(GEMINI_CFG),
      install: 'auto'
    },
    {
      id: 'codex-cli',
      name: 'Codex CLI',
      installed: codexCli,
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
      // "Connected" must mean the configured server can actually exist:
      // a stale path (moved repo, old install) is a dead link, not a link.
      const target = entry.args[0]
      if (a.connected && target && !exists(target)) a.connected = false
    }
  }
  return agents
}

export async function connectAgent(id: AgentId, serverPath: string): Promise<void> {
  const { path: bin, isElectron } = await nodeBin()
  const nodeBin_ = bin
  // Both paths end up inside a shell command and a TOML file: only accept
  // plain path characters, never quotes, backticks or $(...).
  for (const p of [nodeBin_, serverPath]) {
    if (!/^[A-Za-z0-9_./ +@()-]+$/.test(p)) throw new Error(`Refusing to write an unsafe path into agent config: ${p}`)
  }
  switch (id) {
    case 'claude-code': {
      // The CLI merges into ~/.claude.json for us; user scope = available everywhere.
      const envFlag = isElectron ? '--env ELECTRON_RUN_AS_NODE=1 ' : ''
      await execFileP(
        '/bin/zsh',
        ['-lc', `claude mcp add specdrive --scope user ${envFlag}-- "${nodeBin_}" "${serverPath}"`],
        { timeout: 20000 }
      )
      return
    }
    case 'cursor':
      addSpecdriveJsonEntry(CURSOR_MCP, serverPath, nodeBin_, isElectron)
      return
    case 'claude-desktop':
      addSpecdriveJsonEntry(CLAUDE_DESKTOP_CFG, serverPath, nodeBin_, isElectron)
      return
    case 'windsurf':
      addSpecdriveJsonEntry(WINDSURF_MCP, serverPath, nodeBin_, isElectron)
      return
    case 'gemini-cli':
      addSpecdriveJsonEntry(GEMINI_CFG, serverPath, nodeBin_, isElectron)
      return
    case 'codex-cli': {
      // Rewrite rather than append: a broken entry written by an earlier try
      // must not survive, or Codex keeps launching the wrong thing forever.
      fs.mkdirSync(path.dirname(CODEX_CFG), { recursive: true })
      let raw = ''
      try {
        raw = fs.readFileSync(CODEX_CFG, 'utf8')
      } catch {
        raw = ''
      }
      const head = raw.split('[mcp_servers.specdrive]')[0].replace(/\s+$/, '')
      const rest = raw.includes('[mcp_servers.specdrive]')
        ? raw.split('[mcp_servers.specdrive]').slice(1).join('[mcp_servers.specdrive]')
        : ''
      // Everything after our block that belongs to somebody else is kept.
      const tailIdx = rest.search(/\n\[(?!mcp_servers\.specdrive)/)
      const tail = tailIdx >= 0 ? rest.slice(tailIdx) : ''
      const block =
        `[mcp_servers.specdrive]\ncommand = "${nodeBin_}"\nargs = ["${serverPath}"]\n` +
        (isElectron ? `env = { ELECTRON_RUN_AS_NODE = "1" }\n` : '')
      fs.writeFileSync(CODEX_CFG, `${head ? `${head}\n\n` : ''}${block}${tail}`)
      return
    }
    case 'antigravity':
      addSpecdriveJsonEntry(ANTIGRAVITY_MCP, serverPath, nodeBin_, isElectron)
      return
  }
}
