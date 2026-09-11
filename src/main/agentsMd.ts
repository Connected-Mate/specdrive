// Generates AGENTS.md: a one-way, read-only export of a project's SpecDrive
// house into its own codebase, for any coding tool that doesn't speak MCP.
// Pure rendering lives here so it can be unit-tested without Electron.
import fs from 'node:fs'
import path from 'node:path'
import type { AgentDef, Folder, FolderRule, Phase, ProjectBundle, Spec } from '../shared/types'
// Houses nest: a project inherits every house above it, closest house winning
// on a shared rule name. One shared module decides that, everywhere.
import { chainLabel, effectiveRules } from '../shared/house-chain.mjs'
import type { EffectiveRule } from '../shared/house-chain.mjs'
// The owner's own agents travel with the board: named in AGENTS.md, and written
// out as Claude Code subagents next to the code.
import { composeBrief, houseRulesForBrief, promptNameFor } from '../shared/crew-chain.mjs'
import type { EffectiveAgent } from '../shared/crew-chain.mjs'
import { syncClaudeAgents } from '../shared/crew-export.mjs'

const PHASE_LABEL: Record<Phase, string> = {
  capture: 'Capturing the idea',
  challenge: 'Challenging the specs',
  research: 'Researching',
  risks: 'Weighing the hard parts',
  plan: 'Planning the build',
  build: 'Building',
  done: 'Built'
}

function isQuestion(s: Spec): boolean {
  return /^question\b/i.test(s.title.trim())
}

function ruleLine(r: FolderRule, opts: { overriddenBy?: string; replacedByHouse?: string } = {}): string {
  const bits: string[] = []
  if (r.appliesTo) bits.push(`only for \`${r.appliesTo}\``)
  if (r.setBy) bits.push(`set by ${r.setBy === 'owner' ? 'the owner' : r.setBy.slice('agent:'.length)}`)
  if (r.confirmedByOwner) bits.push('owner approved')
  if (opts.replacedByHouse) bits.push(`replaced by the rule of the same name in "${opts.replacedByHouse}"`)
  if (opts.overriddenBy) bits.push(`overridden by project rule "${opts.overriddenBy}"`)
  const meta = bits.length ? ` (${bits.join(' · ')})` : ''
  return `- **${r.title}**${meta}: ${r.content}`
}

/** Standing rules: the whole line of houses above the project first — the
 *  outermost house at the top, the project's own house last — then confirmed
 *  project-level decisions. A rule overridden by a closer house, or by a
 *  project decision of the same title, is still listed and marked as replaced,
 *  never dropped silently. */
function standingRulesSection(bundle: ProjectBundle): string {
  const { specs } = bundle
  const decisions = specs.filter((s) => s.category === 'decisions' && s.status === 'confirmed' && !isQuestion(s))
  const decisionTitles = new Map(decisions.map((d) => [d.title.trim().toLowerCase(), d.title]))
  const chain: Folder[] =
    bundle.houseChain && bundle.houseChain.length
      ? bundle.houseChain
      : bundle.folder
        ? [bundle.folder]
        : []
  const rules: EffectiveRule[] = chain.length
    ? effectiveRules(chain[chain.length - 1].id, (id) => chain.find((f) => f.id === id) ?? null)
    : []
  const lines: string[] = []
  for (const [i, house] of chain.entries()) {
    const mine = rules.filter((r) => r.houseId === house.id)
    if (!mine.length) continue
    const address = chain.slice(0, i + 1).map((f) => f.name).join(' · ')
    const own = i === chain.length - 1
    lines.push(
      `${lines.length ? '\n' : ''}From the house "${address}"${own ? '' : ' (inherited)'}:`
    )
    for (const r of mine) {
      lines.push(
        ruleLine(r, {
          overriddenBy: r.supersededBy ? undefined : decisionTitles.get(r.title.trim().toLowerCase()),
          replacedByHouse: r.supersededBy ? r.supersededByHouse : undefined
        })
      )
    }
  }
  if (decisions.length) {
    lines.push(lines.length ? '\nFrom this project (overrides the houses on the same topic):' : 'From this project:')
    for (const d of decisions) {
      lines.push(`- **${d.title}**: ${d.content.trim().split('\n')[0]}`)
    }
  }
  return lines.length ? lines.join('\n') : 'No standing rules recorded yet.'
}

function currentStateSection(bundle: ProjectBundle): string {
  const { project, specs, activity } = bundle
  const openQuestions = specs.filter((s) => s.category === 'decisions' && isQuestion(s)).length
  const lastActivity = activity[activity.length - 1]
  const lastTouched = lastActivity
    ? `${lastActivity.actor === 'agent' ? 'an agent' : 'the app'} · ${new Date(lastActivity.ts).toLocaleString()}`
    : `${new Date(project.updatedAt).toLocaleString()}`
  const lines = [
    `- Phase: **${PHASE_LABEL[project.phase]}**`,
    `- Open questions: ${openQuestions}`,
    `- Last touched by: ${lastTouched}`
  ]
  if (project.mode === 'existing') lines.push('- Mode: existing app — code is ground truth, specs cover the delta only')
  return lines.join('\n')
}

/** The agents that actually reach this project: the ones available everywhere
 *  plus every house above it, minus the ones a house switched off and the ones
 *  a closer house replaced. */
function liveAgents(bundle: ProjectBundle): EffectiveAgent[] {
  return (bundle.agents ?? []).filter((a) => !a.disabled && !a.supersededBy)
}

/** The owner's own team members, and the exact command that runs each one. */
function yourAgentsSection(bundle: ProjectBundle): string {
  const agents = liveAgents(bundle)
  if (!agents.length) return 'No agents saved yet.'
  return agents
    .map((a) => {
      const head = `- **${a.emoji} ${a.name}** — ${a.role} (${
        a.from && a.from !== 'Everywhere' ? `from the house "${a.from}"` : 'available everywhere'
      }) → run it with \`/mcp__specdrive__${promptNameFor(a.slug)}\``
      // Where the brief came from: one indented line, so the lineage travels
      // with the export without burying the list that matters.
      if (!a.sources?.length) return head
      const built = a.sources
        .map((s) => `[${s.title || s.url}](${s.url})${s.license ? ` · ${s.license}` : ''}`)
        .join(', ')
      return `${head}\n  - Built from: ${built}`
    })
    .join('\n')
}

/** Title-only list of things this AGENTS.md export says "do not touch" without
 *  explicit new instruction: frozen or as-built areas the house has verified. */
function whatNotToTouchSection(specs: Spec[]): string {
  const frozen = specs.filter(
    (s) => (s.tags.includes('frozen') || s.tags.includes('as-built')) && s.confidence === 'confirmed'
  )
  if (!frozen.length) return 'Nothing marked frozen or as-built yet.'
  return frozen.map((s) => `- ${s.title}`).join('\n')
}

const HEADER = '<!-- Generated by SpecDrive — edit via SpecDrive, not here. Your changes will be overwritten. -->'

/** Pure render: bundle in, canonical AGENTS.md text out. No I/O. */
export function renderAgentsMd(bundle: ProjectBundle): string {
  const { project } = bundle
  return `${HEADER}
# AGENTS.md — ${project.name}

## What this house is
${project.oneLiner || 'A product being built with SpecDrive.'}
This file is a generated, read-only mirror of the SpecDrive board for tools that don't speak its MCP — the board itself is the source of truth.

## Standing rules
${standingRulesSection(bundle)}

## Current state
${currentStateSection(bundle)}

## Your agents
The owner's own saved agents, available on this project. Each one is a standing brief — run it and follow it exactly, then report back with \`log_agent_run\`.
${yourAgentsSection(bundle)}

## What not to touch
${whatNotToTouchSection(bundle.specs)}

## How to work here
Connect the specdrive MCP server, call \`get_guidance\` first, and follow it — every task needs proof (what you ran, what you observed) before it counts as done.
`
}

const CLAUDE_MD_STUB = 'Read AGENTS.md — generated by SpecDrive.\n'

export interface AgentsMdSyncResult {
  wrote: boolean
  path?: string
  skipped?: 'no-codebase-path' | 'path-missing' | 'opted-out' | 'unchanged'
  claudeMdWritten?: boolean
  /** Claude Code subagent files written / removed under .claude/agents */
  agentFiles?: { wrote: string[]; removed: string[] }
}

/** The composed brief of every live agent, for the .claude/agents export. Pure:
 *  the houses come from the bundle, exactly like the standing rules do, so this
 *  never reads the disk. The language line is left out — a subagent file is
 *  read as a role, not sent as a message. */
function agentBriefs(bundle: ProjectBundle): { agent: AgentDef; brief: string }[] {
  const agents = liveAgents(bundle)
  if (!agents.length) return []
  const chain: Folder[] =
    bundle.houseChain && bundle.houseChain.length ? bundle.houseChain : bundle.folder ? [bundle.folder] : []
  const readFolder = (id: string | null | undefined): Folder | null =>
    chain.find((f) => f.id === id) ?? null
  const ownId = chain.length ? chain[chain.length - 1].id : ''
  const houseRules = ownId ? houseRulesForBrief(ownId, readFolder) : ''
  const houseAddress = chain.length ? chainLabel(chain) : ''
  const { project } = bundle
  return agents.map((agent) => ({
    agent,
    brief: composeBrief(agent, {
      project: {
        id: project.id,
        name: project.name,
        oneLiner: project.oneLiner,
        phase: project.phase,
        codebasePath: project.codebasePath,
        mode: project.mode
      },
      houseRules,
      houseAddress,
      includeLanguageLine: false
    })
  }))
}

/** Writes AGENTS.md (and a first-run CLAUDE.md stub) into one project's
 *  codebase, only when the content actually changed. Never overwrites an
 *  existing hand-written CLAUDE.md. */
export function syncOneAgentsMd(bundle: ProjectBundle): AgentsMdSyncResult {
  const dir = bundle.project.codebasePath
  if (!dir) return { wrote: false, skipped: 'no-codebase-path' }
  if (bundle.project.syncAgentsMd === false) return { wrote: false, skipped: 'opted-out' }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { wrote: false, skipped: 'path-missing' }

  const content = renderAgentsMd(bundle)
  const target = path.join(dir, 'AGENTS.md')
  let existing = ''
  try {
    existing = fs.readFileSync(target, 'utf8')
  } catch {
    // first write
  }
  let wrote = false
  if (existing !== content) {
    fs.writeFileSync(target, content)
    wrote = true
  }

  let claudeMdWritten = false
  const claudePath = path.join(dir, 'CLAUDE.md')
  if (!fs.existsSync(claudePath)) {
    fs.writeFileSync(claudePath, CLAUDE_MD_STUB)
    claudeMdWritten = true
  }

  // The crew also lands as Claude Code subagents, so `claude` picks them up
  // natively. Only ever SpecDrive's own files are written or removed there.
  let agentFiles
  try {
    agentFiles = syncClaudeAgents(dir, agentBriefs(bundle))
  } catch {
    // an unwritable .claude folder must never block the AGENTS.md export
  }

  return { wrote, path: target, skipped: wrote ? undefined : 'unchanged', claudeMdWritten, agentFiles }
}

/** Sync every bundle that has a codebase path. Each project is isolated —
 *  one bad path (deleted folder, permission error) must never block the rest. */
export function syncAllAgentsMd(bundles: ProjectBundle[]): void {
  for (const b of bundles) {
    if (!b.project.codebasePath) continue
    try {
      syncOneAgentsMd(b)
    } catch (err) {
      console.error(`[specdrive] AGENTS.md sync failed for "${b.project.name}":`, err)
    }
  }
}
