// The owner's own agents ("crew") — the app's side of what a coding agent does
// over MCP. Validation, the lock protocol and the crew/<id>.log audit trail
// mirror mcp/server.mjs exactly, so an agent written here is indistinguishable
// from one an agent wrote. Files live in ~/.specdrive/crew/<id>.json.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AgentDef, AgentScope, ProjectBundle } from '../shared/types'
import { DATA_DIR, listFolders, readFolder, withFileLock } from './store'
import { chainLabel, houseChain } from '../shared/house-chain.mjs'
import {
  CREW_LIMITS,
  agentSlug,
  cleanAgent,
  composeBrief,
  effectiveAgents,
  houseRulesForBrief
} from '../shared/crew-chain.mjs'
import { AGENT_PRESETS } from '../shared/crew-presets.mjs'
import type { AgentPresetKey } from '../shared/crew-presets.mjs'

export const CREW_DIR = path.join(DATA_DIR, 'crew')

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

function safeId(id: string): string | null {
  const base = path.basename(String(id ?? ''))
  return SAFE_ID.test(base) ? base : null
}

function agentFile(id: string): string {
  return path.join(CREW_DIR, `${id}.json`)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Every change to an agent steers every future run of it — it goes in the
 *  crew log. Never silent. */
function logCrewChange(id: string, summary: string): void {
  try {
    fs.mkdirSync(CREW_DIR, { recursive: true })
    fs.appendFileSync(path.join(CREW_DIR, `${id}.log`), `${new Date().toISOString()} ${summary}\n`)
  } catch {
    // the log is an audit convenience, never a blocker
  }
}

export function ensureCrewDir(): void {
  fs.mkdirSync(CREW_DIR, { recursive: true })
}

export function listCrew(): AgentDef[] {
  ensureCrewDir()
  let files: string[]
  try {
    files = fs.readdirSync(CREW_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  return files
    .map((f) => readJson<AgentDef | null>(path.join(CREW_DIR, f), null))
    .filter((a): a is AgentDef => Boolean(a && a.id && a.name && a.slug))
    .map((a) => ({
      ...a,
      rules: Array.isArray(a.rules) ? a.rules : [],
      method: Array.isArray(a.method) ? a.method : [],
      tools: Array.isArray(a.tools) ? a.tools : [],
      runs: Array.isArray(a.runs) ? a.runs : []
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function readAgent(id: string): AgentDef | null {
  const aid = safeId(id)
  if (!aid) return null
  const a = readJson<AgentDef | null>(agentFile(aid), null)
  if (!a) return null
  return {
    ...a,
    rules: Array.isArray(a.rules) ? a.rules : [],
    method: Array.isArray(a.method) ? a.method : [],
    tools: Array.isArray(a.tools) ? a.tools : [],
    runs: Array.isArray(a.runs) ? a.runs : []
  }
}

function writeAgent(agent: AgentDef): void {
  ensureCrewDir()
  const file = agentFile(agent.id)
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(agent, null, 2))
  fs.renameSync(tmp, file)
}

/** A free file id for this slug — the slug itself, or the slug plus a short
 *  suffix when another agent already claimed it. */
function freeId(slug: string): string {
  ensureCrewDir()
  let id = slug
  if (fs.existsSync(agentFile(id))) id = `${slug}-${crypto.randomBytes(2).toString('hex')}`
  return id
}

/** Create an agent — from scratch, or from a ready-made one. */
export function createAgent(
  input: Partial<AgentDef> & { preset?: string }
): { id: string; error: string } {
  ensureCrewDir()
  if (listCrew().length >= CREW_LIMITS.agents)
    return {
      id: '',
      error: `You already have ${CREW_LIMITS.agents} agents — that is the limit. Delete one you no longer use first.`
    }
  const preset = input.preset ? AGENT_PRESETS[input.preset as AgentPresetKey] : undefined
  if (input.preset && !preset)
    return { id: '', error: `There is no ready-made agent called "${input.preset}".` }
  const merged: Record<string, unknown> = {
    ...(preset ?? {}),
    ...stripEmpty(input as Record<string, unknown>)
  }
  if (preset) merged.preset = input.preset
  // A house-scoped agent must point at a house that actually exists.
  if (merged.scope === 'house') {
    const folder = merged.folderId ? readFolder(String(merged.folderId)) : null
    if (!folder) return { id: '', error: 'That house no longer exists — pick another one.' }
  }
  const { agent, error } = cleanAgent(merged)
  if (error || !agent) return { id: '', error }
  agent.id = freeId(agentSlug(agent.slug))
  agent.runs = []
  withFileLock(agentFile(agent.id), () => writeAgent(agent))
  logCrewChange(
    agent.id,
    `Agent "${agent.name}" created by the owner (${agent.scope === 'house' ? `house ${agent.folderId}` : 'available everywhere'})`
  )
  return { id: agent.id, error: '' }
}

/** Drop keys the caller left empty so a preset's own value survives. */
function stripEmpty<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && !v.trim()) continue
    if (Array.isArray(v) && !v.length) continue
    out[k] = v
  }
  return out as Partial<T>
}

export function updateAgent(id: string, patch: Partial<AgentDef>): string {
  const aid = safeId(id)
  if (!aid) return 'Unknown agent.'
  const file = agentFile(aid)
  let error = ''
  let name = ''
  withFileLock(file, () => {
    const current = readJson<AgentDef | null>(file, null)
    if (!current) {
      error = 'That agent no longer exists.'
      return
    }
    const merged = { ...current, ...stripEmpty(patch as Record<string, unknown>) } as AgentDef
    // The slug is part of the MCP prompt name and the exported filename: it
    // follows the name unless the caller set one explicitly.
    if (patch.name && !patch.slug) merged.slug = agentSlug(patch.name)
    merged.id = current.id
    merged.createdAt = current.createdAt
    merged.runs = current.runs ?? []
    if (merged.scope === 'house' && !readFolder(merged.folderId ?? '')) {
      error = 'That house no longer exists — pick another one.'
      return
    }
    const cleaned = cleanAgent(merged)
    if (cleaned.error || !cleaned.agent) {
      error = cleaned.error
      return
    }
    cleaned.agent.id = current.id
    name = cleaned.agent.name
    writeAgent(cleaned.agent)
  })
  if (!error) logCrewChange(aid, `Agent "${name}" edited by the owner`)
  return error
}

export function setAgentScope(id: string, scope: AgentScope, folderId: string | null): string {
  if (scope === 'house' && !folderId) return 'Pick the house this agent belongs to.'
  if (scope === 'house' && !readFolder(folderId as string)) return 'That house no longer exists.'
  const patch: Partial<AgentDef> = { scope }
  const err = updateAgent(id, scope === 'house' ? { ...patch, folderId: folderId as string } : patch)
  if (err) return err
  // Going global must actually drop the old house, which stripEmpty cannot do.
  if (scope === 'global') {
    const file = agentFile(safeId(id) as string)
    withFileLock(file, () => {
      const current = readJson<AgentDef | null>(file, null)
      if (!current) return
      delete current.folderId
      writeAgent(current)
    })
  }
  const where =
    scope === 'house' ? `the house "${chainLabel(houseChain(folderId, readFolder))}"` : 'every project'
  logCrewChange(safeId(id) as string, `Agent scope changed by the owner — now available in ${where}`)
  return ''
}

/** A house can switch off an agent it inherited, without touching the original. */
export function setAgentDisabled(id: string, folderId: string, off: boolean): string {
  const aid = safeId(id)
  if (!aid) return 'Unknown agent.'
  if (!readFolder(folderId)) return 'That house no longer exists.'
  const file = agentFile(aid)
  let error = ''
  withFileLock(file, () => {
    const current = readJson<AgentDef | null>(file, null)
    if (!current) {
      error = 'That agent no longer exists.'
      return
    }
    const set = new Set(Array.isArray(current.disabledIn) ? current.disabledIn : [])
    if (off) set.add(folderId)
    else set.delete(folderId)
    if (set.size) current.disabledIn = [...set]
    else delete current.disabledIn
    current.updatedAt = new Date().toISOString()
    writeAgent(current)
  })
  if (!error)
    logCrewChange(aid, `Agent ${off ? 'switched off' : 'switched back on'} in house "${folderId}" by the owner`)
  return error
}

export function duplicateAgent(id: string): { id: string; error: string } {
  const original = readAgent(id)
  if (!original) return { id: '', error: 'That agent no longer exists.' }
  const copyName = `${original.name} (copy)`.slice(0, CREW_LIMITS.name)
  return createAgent({
    ...original,
    id: undefined,
    name: copyName,
    slug: agentSlug(copyName),
    runs: [],
    createdAt: undefined,
    updatedAt: undefined
  } as Partial<AgentDef>)
}

/** Set aside in the trash, never destroyed — same as a deleted project. */
export function deleteAgent(id: string): string {
  const aid = safeId(id)
  if (!aid) return 'Unknown agent.'
  const agent = readAgent(aid)
  if (!agent) return 'That agent no longer exists.'
  const trash = path.join(DATA_DIR, 'trash')
  fs.mkdirSync(trash, { recursive: true })
  try {
    fs.renameSync(agentFile(aid), path.join(trash, `agent-${aid}-${Date.now()}.json`))
  } catch {
    return 'That agent no longer exists.'
  }
  logCrewChange(aid, `Agent "${agent.name}" deleted by the owner${agent.runs.length ? ` (it had ${agent.runs.length} report(s))` : ''}`)
  return ''
}

/** The crew that reaches a project, resolved through its line of houses. */
export function agentsForProject(folderId: string | null | undefined): ProjectBundle['agents'] {
  return effectiveAgents(folderId, readFolder, listCrew())
}

/** Attach the effective crew to every bundle — the app's screens and the
 *  AGENTS.md export both read it from there. */
export function attachCrew<T extends ProjectBundle>(bundles: T[]): T[] {
  const crew = listCrew()
  if (!crew.length) return bundles.map((b) => ({ ...b, agents: [] }))
  return bundles.map((b) => ({
    ...b,
    agents: effectiveAgents(b.project.folderId, readFolder, crew)
  }))
}

export function attachCrewOne<T extends ProjectBundle>(bundle: T | null): T | null {
  if (!bundle) return null
  return attachCrew([bundle])[0]
}

/** The runnable brief for this agent on this project — the exact text the MCP
 *  server's run_agent hands a coding agent, so the app can show and copy it. */
export function agentBrief(id: string, bundle: ProjectBundle | null): string {
  const agent = readAgent(id)
  if (!agent) return ''
  const folderId = bundle?.project.folderId
  return composeBrief(agent, {
    project: bundle
      ? {
          id: bundle.project.id,
          name: bundle.project.name,
          oneLiner: bundle.project.oneLiner,
          phase: bundle.project.phase,
          codebasePath: bundle.project.codebasePath,
          mode: bundle.project.mode
        }
      : undefined,
    houseRules: folderId ? houseRulesForBrief(folderId, readFolder) : '',
    houseAddress: folderId ? chainLabel(houseChain(folderId, readFolder)) : ''
  })
}

/** Houses the owner can attach an agent to, as a flat list with their address. */
export function crewHouseOptions(): { id: string; name: string; path: string }[] {
  return listFolders().map((f) => ({
    id: f.id,
    name: f.name,
    path: chainLabel(houseChain(f.id, readFolder))
  }))
}
