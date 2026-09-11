// Exporting the owner's crew into a codebase, for coding tools that read files
// instead of speaking MCP. Claude Code picks up custom subagents from
// <codebase>/.claude/agents/*.md — so every agent that reaches a project is
// written there as specdrive-<slug>.md, and disappears again the moment it
// stops being available.
//
// Two doors write this: the Electron app (src/main/agentsMd.ts, whenever the
// board changes) and the MCP server (whenever an agent is created, edited,
// deleted or reports back while the app is closed). Both call this one
// function, so the folder can never end up half-written.
//
// Every filesystem call here is defensive: a codebase path that moved, a
// read-only checkout or a .claude folder owned by something else must never
// take down a tool call or the app.

import fs from 'node:fs'
import path from 'node:path'
import { AGENT_FILE_PREFIX, agentFileName, renderAgentFile } from './crew-chain.mjs'

/** Only ever touch files SpecDrive itself wrote. Anything else in that folder —
 *  the owner's own subagents, another tool's — is left exactly as it is. */
const OURS = new RegExp(`^${AGENT_FILE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\.md$`)

/**
 * Write one codebase's .claude/agents folder so it mirrors the agents that
 * actually reach that project.
 *
 * @param {string} codebasePath absolute path to the codebase root
 * @param {{agent: any, brief: string}[]} agentsWithBriefs the effective crew, each with its composed brief
 * @returns {{wrote: string[], removed: string[]}} filenames written (content changed) and removed
 */
export function syncClaudeAgents(codebasePath, agentsWithBriefs) {
  const out = { wrote: [], removed: [] }
  if (!codebasePath || typeof codebasePath !== 'string') return out
  try {
    if (!fs.existsSync(codebasePath) || !fs.statSync(codebasePath).isDirectory()) return out
  } catch {
    return out // path vanished or is unreadable — nothing to do, never a crash
  }
  const dir = path.join(codebasePath, '.claude', 'agents')
  const list = Array.isArray(agentsWithBriefs) ? agentsWithBriefs : []
  // Nothing to write and no folder yet → do not create an empty folder in
  // someone's repo just to prove we were there.
  let exists = false
  try {
    exists = fs.existsSync(dir)
  } catch {}
  if (!list.length && !exists) return out
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return out
  }
  const keep = new Set()
  for (const entry of list) {
    const agent = entry?.agent
    if (!agent?.slug) continue
    const file = agentFileName(agent.slug)
    keep.add(file)
    const target = path.join(dir, file)
    let content
    try {
      content = renderAgentFile(agent, entry?.brief ?? '')
    } catch {
      continue
    }
    let existing = ''
    try {
      existing = fs.readFileSync(target, 'utf8')
    } catch {
      // first write for this agent
    }
    if (existing === content) continue
    try {
      fs.writeFileSync(target, content)
      out.wrote.push(file)
    } catch {
      // read-only checkout — the board stays the source of truth either way
    }
  }
  let present = []
  try {
    present = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const file of present) {
    if (!OURS.test(file) || keep.has(file)) continue
    try {
      fs.unlinkSync(path.join(dir, file))
      out.removed.push(file)
    } catch {}
  }
  return out
}
