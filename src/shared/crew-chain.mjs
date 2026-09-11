// The owner's own agents — their "crew". One agent = a saved team member with a
// mission, rules, a method and a deliverable, reusable in EVERY project where
// SpecDrive is connected.
//
// Agents are scoped exactly like house rules: "global" (available everywhere)
// or attached to a house (inherited by every project inside it, down the whole
// chain, closest house winning on the same slug). A house can switch off an
// agent it inherited.
//
// This is the ONE place that logic lives. The MCP server (mcp/server.mjs), the
// app's store (src/main/crew.ts), the Claude Code export and the app's screens
// all import it, so the owner and an agent can never be told two different
// things about which crew is available.
//
// Plain ESM so `node mcp/server.mjs` can load it directly; TypeScript sees it
// through crew-chain.d.mts. Everything here is pure: houses are read only
// through the `readFolder(id)` function the caller hands in.

import { effectiveRules, houseChain } from './house-chain.mjs'

/** Hard caps. Both doors (app and MCP server) refuse exactly the same things. */
export const CREW_LIMITS = {
  agents: 60,
  name: 60,
  slug: 40,
  emoji: 8,
  role: 140,
  mission: 4000,
  rules: 20,
  rule: 400,
  method: 20,
  step: 400,
  deliverable: 1500,
  tools: 12,
  tool: 40,
  model: 40,
  runs: 50,
  summary: 2000,
  findings: 30,
  findingTitle: 160,
  findingDetail: 1500,
  where: 300,
  description: 160,
  allowedTools: 12,
  sources: 12,
  sourceUrl: 500,
  sourceTitle: 160,
  license: 40,
  sourceWhat: 300,
  research: 1500
}

export const VERDICTS = ['pass', 'issues', 'blocked', 'info']
export const SEVERITIES = ['blocker', 'major', 'minor', 'note']

/** Plain words for the owner — never the raw verdict key. */
export const VERDICT_LABEL = {
  pass: 'All good',
  issues: 'Found problems',
  blocked: 'Could not finish',
  info: 'Report'
}

export const SEVERITY_LABEL = {
  blocker: 'Blocker',
  major: 'Major',
  minor: 'Minor',
  note: 'Note'
}

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

/** Same shape as the server's slugify(), capped shorter: an agent slug becomes
 *  part of an MCP prompt name (`agent_<slug>`) and a filename. */
export function agentSlug(name) {
  return (
    str(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, CREW_LIMITS.slug)
      .replace(/-$/, '') || 'agent'
  )
}

/** The MCP prompt name an agent is exposed under. Prompt names allow letters,
 *  digits and underscores — the slug's dashes become underscores. */
export function promptNameFor(slug) {
  return `agent_${str(slug).replace(/-/g, '_')}`
}

/** The file an agent is exported to inside a codebase's .claude/agents. */
export function agentFileName(slug) {
  return `specdrive-${str(slug)}.md`
}

/** Only files SpecDrive itself wrote are ever removed from .claude/agents. */
export const AGENT_FILE_PREFIX = 'specdrive-'

function cleanList(raw, max, itemMax) {
  if (raw === undefined || raw === null) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const out = []
  for (const item of arr) {
    const v = str(item).trim()
    if (!v) continue
    out.push(v.slice(0, itemMax))
    if (out.length >= max) break
  }
  return out
}

// ---------- the tool allowlist: a guardrail, not a hint ----------
// A reviewer handed only Read, Grep and Glob cannot edit the code even if it
// decides to. That is worth far more than a rule asking it not to, so an
// agent whose own brief says it never fixes anything is stripped of every
// writing tool on its way out to .claude/agents.

/** Tool names a Claude Code subagent can actually be granted. */
export const KNOWN_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'WebFetch',
  'WebSearch',
  'Edit',
  'Write',
  'NotebookEdit',
  'Task',
  'TodoWrite'
]

/** What a reviewer, tester or auditor gets by default: everything needed to
 *  look, nothing that changes the product. */
export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch']

const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit']

/** Does this brief promise not to touch the product? Then it must not be able
 *  to. Reads the agent's own words — the rules it published to its owner. */
export function isReadOnlyBrief(agent) {
  const hay = [
    agent?.mission ?? '',
    ...(Array.isArray(agent?.rules) ? agent.rules : []),
    ...(Array.isArray(agent?.method) ? agent.method : [])
  ]
    .join(' ')
    .toLowerCase()
  return /\bnever\s+(?:fix|change|edit|modify|rewrite|touch|alter)\b|\bdo not\s+(?:fix|change|edit|modify|rewrite)\b|reporting is the whole job/.test(
    hay
  )
}

/** Normalize an allowlist: real tool names only, no duplicates, capped — and
 *  no writing tools at all for an agent that promised not to write. */
export function cleanAllowedTools(raw, agent) {
  const seen = new Set()
  const out = []
  for (const t of Array.isArray(raw) ? raw : []) {
    const name = KNOWN_TOOLS.find((k) => k.toLowerCase() === str(t).trim().toLowerCase())
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
    if (out.length >= CREW_LIMITS.allowedTools) break
  }
  if (!out.length) return []
  if (agent && isReadOnlyBrief(agent)) return out.filter((t) => !WRITE_TOOLS.includes(t))
  return out
}

/** Only real web addresses become links the owner can click. Anything else is
 *  kept out rather than rendered as a dead or dangerous link. */
const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i

/** What the brief was built from. Each entry needs a usable address and one
 *  line saying what was taken from it — a bare link proves nothing. */
export function cleanSources(raw) {
  const out = []
  for (const s of Array.isArray(raw) ? raw : []) {
    const url = str(s?.url).trim()
    if (!url || url.length > CREW_LIMITS.sourceUrl || !SAFE_URL.test(url)) continue
    const what = str(s?.what).trim()
    if (!what) continue
    const source = { url, what: what.slice(0, CREW_LIMITS.sourceWhat) }
    const title = str(s?.title).trim()
    if (title) source.title = title.slice(0, CREW_LIMITS.sourceTitle)
    const license = str(s?.license).trim()
    if (license) source.license = license.slice(0, CREW_LIMITS.license)
    out.push(source)
    if (out.length >= CREW_LIMITS.sources) break
  }
  return out
}

/** Trim, cap and normalize what an agent or the app sent. Returns a plain-words
 *  error string on anything either door would refuse — never a thrown error. */
export function cleanAgent(input, opts = {}) {
  if (!input || typeof input !== 'object') return { agent: null, error: 'No agent given.' }
  const name = str(input.name).trim()
  if (!name) return { agent: null, error: 'Give your agent a name.' }
  if (name.length > CREW_LIMITS.name)
    return { agent: null, error: `That name is too long — ${CREW_LIMITS.name} characters max.` }
  const role = str(input.role).trim()
  if (!role) return { agent: null, error: 'Say in one line what this agent does — that is what you will read on its card.' }
  if (role.length > CREW_LIMITS.role)
    return { agent: null, error: `The one-line role is too long — ${CREW_LIMITS.role} characters max.` }
  const mission = str(input.mission).trim()
  if (!mission) return { agent: null, error: 'Describe the mission: what this agent is for.' }
  if (mission.length > CREW_LIMITS.mission)
    return { agent: null, error: `The mission is too long — ${CREW_LIMITS.mission} characters max.` }
  const deliverable = str(input.deliverable).trim().slice(0, CREW_LIMITS.deliverable)
  const rules = cleanList(input.rules, CREW_LIMITS.rules, CREW_LIMITS.rule)
  const method = cleanList(input.method, CREW_LIMITS.method, CREW_LIMITS.step)
  const tools = cleanList(input.tools, CREW_LIMITS.tools, CREW_LIMITS.tool)
  const scope = input.scope === 'house' ? 'house' : 'global'
  const folderId = scope === 'house' ? str(input.folderId).trim() : ''
  if (scope === 'house' && !folderId)
    return { agent: null, error: 'Pick the house this agent belongs to, or make it available everywhere.' }
  // One emoji (or two) — never a sentence in the badge.
  const emoji = [...str(input.emoji).trim()].slice(0, CREW_LIMITS.emoji).join('') || '🤖'
  const slug = agentSlug(str(input.slug).trim() || name)
  const agent = {
    id: str(input.id).trim() || slug,
    slug,
    name,
    emoji,
    role,
    mission,
    rules,
    method,
    deliverable,
    tools,
    scope,
    createdAt: str(input.createdAt) || opts.now || new Date().toISOString(),
    updatedAt: opts.now || new Date().toISOString()
  }
  if (folderId) agent.folderId = folderId
  const model = str(input.modelHint).trim().slice(0, CREW_LIMITS.model)
  if (model) agent.modelHint = model
  const preset = str(input.preset).trim().slice(0, 40)
  if (preset) agent.preset = preset
  // What it was built from — the published agents and prompts that were read
  // before this brief was written, and how they compared.
  // The routing line: when to reach for this agent. Falls back to the role,
  // which is at least a description, if a narrower one.
  const description = str(input.description).trim().slice(0, CREW_LIMITS.description)
  if (description) agent.description = description
  // The allowlist is resolved against the FINISHED brief, so a "never fix"
  // rule the caller sent in the same breath already counts.
  const allowedTools = cleanAllowedTools(input.allowedTools, agent)
  if (allowedTools.length) agent.allowedTools = allowedTools
  const sources = cleanSources(input.sources)
  if (sources.length) agent.sources = sources
  const research = str(input.research).trim().slice(0, CREW_LIMITS.research)
  if (research) agent.research = research
  const disabledIn = cleanList(input.disabledIn, 40, 64)
  if (disabledIn.length) agent.disabledIn = disabledIn
  agent.runs = cleanRuns(input.runs)
  return { agent, error: '' }
}

/** One report an agent posted back after a run. Same caps on both doors. */
export function cleanRun(input, opts = {}) {
  if (!input || typeof input !== 'object') return { run: null, error: 'No report given.' }
  const verdict = VERDICTS.includes(input.verdict) ? input.verdict : ''
  if (!verdict) return { run: null, error: `Say how it went: ${VERDICTS.join(', ')}.` }
  const summary = str(input.summary).trim()
  if (!summary) return { run: null, error: 'Write one short paragraph saying what happened, in plain words.' }
  const findings = []
  for (const f of Array.isArray(input.findings) ? input.findings : []) {
    const title = str(f?.title).trim()
    if (!title) continue
    const severity = SEVERITIES.includes(f?.severity) ? f.severity : 'note'
    const finding = {
      severity,
      title: title.slice(0, CREW_LIMITS.findingTitle),
      detail: str(f?.detail).trim().slice(0, CREW_LIMITS.findingDetail)
    }
    const where = str(f?.where).trim()
    if (where) finding.where = where.slice(0, CREW_LIMITS.where)
    findings.push(finding)
    if (findings.length >= CREW_LIMITS.findings) break
  }
  const run = {
    id: str(input.id).trim() || String(Date.now().toString(36)),
    verdict,
    summary: summary.slice(0, CREW_LIMITS.summary),
    findings,
    at: str(input.at) || opts.now || new Date().toISOString()
  }
  const projectId = str(input.projectId).trim()
  if (projectId) run.projectId = projectId
  const projectName = str(input.projectName).trim()
  if (projectName) run.projectName = projectName.slice(0, 80)
  const by = str(input.by).trim()
  if (by) run.by = by.slice(0, 60)
  return { run, error: '' }
}

/** Newest first, capped — a run history is a feed, not an archive. */
export function cleanRuns(raw) {
  const out = []
  for (const r of Array.isArray(raw) ? raw : []) {
    const { run } = cleanRun(r)
    if (run) out.push(run)
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, CREW_LIMITS.runs)
}

/** Add a report to an agent, newest first, capped. Pure: returns a new list. */
export function withRun(runs, run) {
  return [run, ...(Array.isArray(runs) ? runs : [])].slice(0, CREW_LIMITS.runs)
}

const key = (s) => str(s).trim().toLowerCase()

/** Every agent that reaches a project, in the order it should be read: the ones
 *  available everywhere first, then the outermost house, the project's own house
 *  last. Each carries where it comes from. An agent whose slug matches one from
 *  a house further in is kept but marked `supersededBy` — never silently
 *  dropped, so the owner can always see what replaced what. An agent switched
 *  off by a house in the line is marked `disabled`. */
export function effectiveAgents(folderId, readFolder, agents) {
  const chain = houseChain(folderId, readFolder)
  const chainIds = new Set(chain.map((f) => f.id))
  const all = []
  for (const a of agents ?? []) {
    if (a?.scope !== 'house') {
      all.push({ ...a, from: 'Everywhere', houseId: null, house: null, inherited: false, own: false })
    }
  }
  for (const [i, folder] of chain.entries()) {
    for (const a of agents ?? []) {
      if (a?.scope !== 'house' || a.folderId !== folder.id) continue
      all.push({
        ...a,
        from: folder.name,
        houseId: folder.id,
        house: folder.name,
        /** Comes from a house ABOVE the project's own one */
        inherited: i < chain.length - 1,
        own: i === chain.length - 1
      })
    }
  }
  // Anything the line of houses switched off is out of the running entirely —
  // it must not win a slug over an agent that is actually available.
  const live = all.map((a) => ({
    ...a,
    disabled: (a.disabledIn ?? []).some((id) => chainIds.has(id))
  }))
  const winner = new Map()
  live.forEach((a, i) => {
    if (!a.disabled) winner.set(key(a.slug), i)
  })
  return live.map((a, i) => {
    if (a.disabled) return a
    const w = winner.get(key(a.slug))
    if (w === i) return a
    const by = live[w]
    return { ...a, supersededBy: by.id, supersededByHouse: by.house ?? 'Everywhere' }
  })
}

/** Only the agents that can actually be run on this project. */
export function activeAgents(folderId, readFolder, agents) {
  return effectiveAgents(folderId, readFolder, agents).filter((a) => !a.disabled && !a.supersededBy)
}

/** The one agent a slug resolves to for a given project — closest house wins,
 *  an agent available everywhere is the fallback. Null when nothing matches. */
export function resolveAgent(slug, folderId, readFolder, agents) {
  const k = key(slug)
  const found = activeAgents(folderId, readFolder, agents).filter((a) => key(a.slug) === k)
  return found.length ? found[found.length - 1] : null
}

/** What a HOUSE page shows: its own agents, everything it inherits from the
 *  houses above it, and the ones available everywhere — each with where it
 *  comes from, so the owner reads provenance the same way rules show it. */
export function agentsForHouse(folderId, readFolder, agents) {
  return effectiveAgents(folderId, readFolder, agents)
}

/** Every distinct slug across the whole crew — what the MCP server registers a
 *  prompt for. A slug shared by two agents is one prompt; which one runs is
 *  decided per project, at call time. */
export function crewSlugs(agents) {
  const out = []
  const seen = new Set()
  for (const a of agents ?? []) {
    const k = key(a?.slug)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(a.slug)
  }
  return out
}

function bullets(list, marker = '- ') {
  return (list ?? []).map((l) => `${marker}${l}`).join('\n')
}

function numbered(list) {
  return (list ?? []).map((l, i) => `${i + 1}. ${l}`).join('\n')
}

/** The house rules in force on a project, rendered for an agent brief. Pure:
 *  the caller hands in the same readFolder every other module uses. */
export function houseRulesForBrief(folderId, readFolder) {
  const rules = effectiveRules(folderId, readFolder).filter((r) => !r.supersededBy)
  if (!rules.length) return ''
  return rules.map((r) => `- ${r.title}${r.appliesTo ? ` (only for ${r.appliesTo})` : ''}: ${r.content}`).join('\n')
}

/** Does this agent's own brief give it leave to edit the board? Anything else
 *  gets told, in the brief itself, to keep its hands off the specs. */
function mayEditBoard(agent) {
  const hay = `${agent.mission} ${(agent.rules ?? []).join(' ')} ${(agent.method ?? []).join(' ')}`.toLowerCase()
  return /\b(add_spec|update_spec|add_task|edit_task|update_task|set_phase|edit the spec|write the spec|update the spec|change the spec)\b/.test(
    hay
  )
}

/** THE composed, runnable brief: identity, mission, rules, method, the project
 *  it runs on, the house rules in force, what to hand back, how to report.
 *  Pure — everything it needs arrives in `ctx`. Used by run_agent, by the
 *  dynamic MCP prompts and by the .claude/agents export, so the three can never
 *  drift apart. */
export function composeBrief(agent, ctx = {}) {
  const { project, houseRules, focus, houseAddress, includeLanguageLine = true } = ctx
  const parts = []
  if (includeLanguageLine) parts.push('Always talk to me in the language I write to you in.')
  parts.push(
    `You are ${agent.emoji} **${agent.name}** — ${agent.role}.\n\nThis is a standing role the owner saved in SpecDrive. Play it exactly: the brief below is the whole job, and nothing outside it is yours to do.`
  )
  if (agent.description) parts.push(`## When you are the right one to call\n${agent.description}`)
  parts.push(`## Your mission\n${agent.mission}`)
  if (agent.rules?.length)
    parts.push(
      `## Your rules — binding, every time\n${bullets(agent.rules)}\nThese are not suggestions. If one of them makes the job impossible here, say so plainly instead of working around it.`
    )
  if (agent.method?.length) parts.push(`## How you work, in order\n${numbered(agent.method)}`)
  if (project) {
    const lines = [`**${project.name}** — ${project.oneLiner || 'no one-liner yet'}`]
    if (project.phase) lines.push(`Where it stands: ${project.phase}`)
    if (houseAddress) lines.push(`House: ${houseAddress}`)
    if (project.codebasePath) lines.push(`The code lives at: ${project.codebasePath}`)
    if (project.mode === 'existing') lines.push('This app already exists — the real code is the ground truth.')
    lines.push(
      `Read the board first with \`get_project\` (project "${project.id}") so you work against what is actually there.`
    )
    parts.push(`## The project you are working on\n${lines.join('\n')}`)
  } else {
    parts.push(
      `## The project you are working on\nNo project was named. Ask the owner which one, or call \`list_projects\` and pick the one they mean — then call \`get_project\` before starting.`
    )
  }
  if (houseRules)
    parts.push(
      `## House rules in force here — binding\n${houseRules}\nThey constrain the PRODUCT. Judge what you see against them too, not only against your own rules.`
    )
  if (focus) parts.push(`## What the owner asked you to focus on right now\n${focus}`)
  if (agent.deliverable) parts.push(`## What you hand back\n${agent.deliverable}`)
  if (agent.tools?.length) parts.push(`## What to use\n${bullets(agent.tools)}`)
  if (!mayEditBoard(agent))
    parts.push(
      `## Stay inside your job\nDo not rewrite the specs, the plan or the tasks, and do not fix the code — that is not this role. Report what you find; the owner decides what happens next.`
    )
  // The reporting contract. Every agent gets it, whatever its job: a finding
  // the owner cannot act on is not a finding, and a number nobody measured is
  // worse than no number at all.
  parts.push(
    `## How to write what you find\nOne block per problem, in this shape — nothing else:\n\n` +
      '```\n' +
      'WHERE: the screen, the file and line, or the exact address\n' +
      'HOW BAD: blocker (stops someone) · major (hurts, there is a way round) · minor (small) · note (worth knowing)\n' +
      'WHAT I SAW: the evidence — what you ran, clicked or read, and what actually happened\n' +
      'WHY IT MATTERS: what it costs the person using this\n' +
      'THE FIX: the smallest change that settles it, in one or two lines\n' +
      '```\n\n' +
      'Order them worst first. Close with a count by severity and the ONE thing to fix first.'
  )
  parts.push(
    `## Two things that are never allowed\n- **Never invent a number.** No counts, percentages, scores or timings you did not actually measure. "I ran 1,847 checks, 94% passed" is a lie unless you ran them and read the output. When you have no number, say what you did instead.\n- **Never dress up a pass.** If you found nothing, say "I found nothing wrong" plainly and say what you covered. An honest empty report is a good report; a padded one wastes the owner's day.`
  )
  parts.push(
    `## Before you report, check yourself\nAnswer these to yourself, honestly, and fix your report where the answer is no:\n- Did I actually go and look, or am I assuming from what the code or the board says?\n- Did I go looking for evidence that this is BROKEN, not only evidence that it works?\n- Can someone else follow every finding from my words alone, without asking me anything?\n- Is every number in my report one I measured myself?\n- Did I stay inside my job, or did I drift into somebody else's?`
  )
  const slug = agent.slug
  parts.push(
    `## When you are finished\nCall \`log_agent_run\` with agent "${slug}"${project ? `, project "${project.id}"` : ''}, your verdict (\`pass\` = nothing wrong, \`issues\` = problems found, \`blocked\` = you could not do the job, \`info\` = just a report), a short plain-words summary, and one finding per problem (severity \`blocker\`/\`major\`/\`minor\`/\`note\`, a title, the detail, and where it is). That report is what the owner reads in SpecDrive — without it, this run leaves no trace.`
  )
  return parts.join('\n\n')
}

/** "Built from" — the published work this brief was written against, and what
 *  each piece contributed. Markdown, shared by the codebase export and the
 *  AGENTS.md section so both credit the same thing the same way. Empty string
 *  when the agent carries no sources. */
export function sourcesFooter(agent, heading = '## Built from') {
  const sources = Array.isArray(agent?.sources) ? agent.sources : []
  if (!sources.length && !str(agent?.research).trim()) return ''
  const lines = [heading]
  if (sources.length) {
    lines.push(
      'This brief was written after reading what already exists in the open. What it borrows, and from where:'
    )
    for (const s of sources) {
      const title = s.title || s.url
      lines.push(`- [${title}](${s.url})${s.license ? ` · ${s.license}` : ''} — ${s.what}`)
    }
  }
  const research = str(agent?.research).trim()
  if (research) lines.push('', '**How they compared:** ' + research)
  return lines.join('\n')
}

/** Claude Code custom subagent file: YAML frontmatter + the composed brief.
 *  Written to <codebase>/.claude/agents/specdrive-<slug>.md */
export function renderAgentFile(agent, brief) {
  const esc = (s) => str(s).replace(/"/g, "'").replace(/\s+/g, ' ').trim()
  // `description` is the routing key: the tool picks this agent from this line
  // alone, so it says WHEN to use it. The role stands in when none was written.
  const lines = [
    '---',
    `name: specdrive-${agent.slug}`,
    `description: "${esc(agent.description || agent.role)}"`
  ]
  if (agent.modelHint) lines.push(`model: ${esc(agent.modelHint)}`)
  // Real tool names only, and never a writing tool for a brief that promised
  // not to write — the allowlist is what actually holds it to its word.
  const allowed = cleanAllowedTools(
    agent.allowedTools?.length ? agent.allowedTools : READ_ONLY_TOOLS,
    agent
  )
  if (allowed.length) lines.push(`tools: ${allowed.join(', ')}`)
  lines.push('---', '')
  lines.push('<!-- Generated by SpecDrive — edit this agent in SpecDrive, not here. -->', '')
  lines.push(brief, '')
  const footer = sourcesFooter(agent)
  if (footer) lines.push('---', '', footer, '')
  return lines.join('\n')
}
