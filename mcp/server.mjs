#!/usr/bin/env node
// SpecDrive MCP server — stdio. Registered with AI coding agents (Claude Code,
// Cursor, ...). Reads/writes the same ~/.specdrive data the Electron app watches,
// so every tool call shows up live on the user's spec board.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const DATA_DIR = path.join(os.homedir(), '.specdrive')
const PROJECTS_DIR = path.join(DATA_DIR, 'projects')

const PHASES = ['capture', 'challenge', 'research', 'risks', 'plan', 'build', 'done']
const CATEGORIES = [
  'vision',
  'audience',
  'features',
  'design',
  'tech',
  'data',
  'research',
  'risks',
  'decisions'
]

const PHASE_GUIDE = {
  capture:
    'CAPTURE: understand the owner\'s idea — follow their lead, this is a conversation, not a questionnaire. If they ask you to research something, do it NOW (web search, real pages) and add_spec the findings (category "research"). Never ask what the web or the board can answer; ask only what only the owner knows (taste, priorities, constraints), one short question at a time with your recommended answer first. add_spec everything the moment you learn it. When complete, set_phase to "challenge".',
  challenge:
    'CHALLENGE: act as a fresh, skeptical reviewer. Find contradictions, vagueness, missing essentials, oversized scope. Fix via update_spec (status "challenged" + challenge_note) or add_spec. Write 4-8 usage scenarios with add_scenario (happy paths AND unhappy paths), walk each against the specs, record gaps with update_scenario and close them. Record v1 cuts as a "decisions" spec. Then set_phase to "research".',
  research:
    'RESEARCH: search the web for similar products, reusable building blocks, pitfalls. One finding per add_spec (category "research"), with links. End with a "What we learned" spec, then set_phase to "risks".',
  risks:
    'RISKS: pre-mortem. Rate spec difficulty 1-5 via update_spec. For difficulty 4-5, add a "risks" spec with mitigation/fallback. Flag topics deserving a dedicated deep-dive session. End with a readiness verdict (PASS / CONCERNS / FAIL) recorded as a "decisions" spec; only advance on PASS or owner-accepted CONCERNS. Then set_phase to "plan".',
  plan:
    'PLAN: first author the visual plan document with set_plan_doc (narrative sections, decision/risk callouts, an architecture diagram, a trade-off table, open questions with recommended answers). Then sketch 3-6 core screens with add_wireframe, define the screen flow with set_flow, and create small ordered tasks with add_task (spikes for hard parts first, sub-steps via parent_task_id). Then set_phase to "build".',
  build:
    'BUILD: strict loop — take first "todo" task, set "in_progress", re-read its specs, build production-grade, VERIFY it works, set "done" with a plain-words note. Blocked? mark "blocked" + note, move on. When the task list looks finished, call check_convergence and honestly compare code vs board; gaps become new tasks. Only a clean convergence check earns set_phase to "done".',
  done: 'DONE: v1 is complete and converged. Fold any lasting decisions into the specs (update_spec, status "confirmed") so the board stays the truth. New ideas → new specs → new tasks → set_phase back to "build".'
}

// ---------- tiny store ----------

function ensureDirs() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'project'
  )
}

function uid() {
  return crypto.randomBytes(5).toString('hex')
}

function now() {
  return new Date().toISOString()
}

// Several agent sessions can write the same board at once (the app encourages
// fresh sessions per phase) — every read-modify-write goes through a lock dir,
// and tmp files are unique so concurrent renames can't eat each other.
function withLock(file, fn) {
  const lock = file + '.lock'
  const deadline = Date.now() + 3000
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch {
      if (Date.now() > deadline) {
        // Stale lock (crashed process) — steal it.
        try {
          fs.rmdirSync(lock)
        } catch {}
      }
      const wait = Date.now() + 15
      while (Date.now() < wait) {} // tiny sync backoff; calls are millisecond-scale
    }
  }
  try {
    return fn()
  } finally {
    try {
      fs.rmdirSync(lock)
    } catch {}
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

/** Read-modify-write a JSON list/object under the file's lock. */
function updateJson(file, fallback, mutate) {
  return withLock(file, () => {
    const data = readJson(file, fallback)
    const result = mutate(data)
    if (data !== null && data !== undefined) writeJson(file, data)
    return result
  })
}

function readJson(file, fallback) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return fallback // missing file — a normal state
  }
  try {
    return JSON.parse(raw)
  } catch {
    // Corrupted file: preserve it for recovery, never silently overwrite.
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
      console.error(`[specdrive] ${path.basename(file)} was corrupted — set aside, starting fresh`)
    } catch {}
    return fallback
  }
}

function projectDir(id) {
  return path.join(PROJECTS_DIR, id)
}

function listProjectIds() {
  ensureDirs()
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => fs.existsSync(path.join(projectDir(id), 'project.json')))
}

/** Resolve a project by id or exact name. Throws when ambiguous. */
function resolveProject(ref) {
  const ids = listProjectIds()
  const norm = slugify(ref)
  for (const id of ids) {
    if (id === ref || id === norm) return { id, project: readJson(path.join(projectDir(id), 'project.json')) }
  }
  const matches = []
  for (const id of ids) {
    const p = readJson(path.join(projectDir(id), 'project.json'))
    if (p && p.name.toLowerCase() === ref.toLowerCase()) matches.push({ id, project: p })
  }
  if (matches.length > 1) {
    throw new Error(
      `"${ref}" matches ${matches.length} projects (${matches.map((m) => m.id).join(', ')}). Use the exact project id.`
    )
  }
  return matches[0] ?? null
}

function loadBundle(id) {
  const dir = projectDir(id)
  return {
    project: readJson(path.join(dir, 'project.json')),
    specs: readJson(path.join(dir, 'specs.json'), []),
    tasks: readJson(path.join(dir, 'tasks.json'), []),
    wireframes: readJson(path.join(dir, 'wireframes.json'), []),
    flow: readJson(path.join(dir, 'flow.json'), null),
    scenarios: readJson(path.join(dir, 'scenarios.json'), []),
    planDoc: readJson(path.join(dir, 'plan-doc.json'), null)
  }
}

function saveProject(id, project) {
  if (!project) return
  project.updatedAt = now()
  writeJson(path.join(projectDir(id), 'project.json'), project)
}

/** Bump the project's updatedAt (and optionally patch it) safely. */
function touchProject(id, patch) {
  updateJson(path.join(projectDir(id), 'project.json'), null, (p) => {
    if (!p) return
    if (patch) Object.assign(p, patch)
    p.updatedAt = now()
  })
}

function logActivity(id, actor, action, summary) {
  try {
    const file = path.join(projectDir(id), 'activity.jsonl')
    fs.appendFileSync(file, JSON.stringify({ ts: now(), actor, action, summary }) + '\n')
    // Keep the log bounded: past ~512KB, keep the newest 2000 lines.
    if (fs.statSync(file).size > 512 * 1024) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      fs.writeFileSync(file, lines.slice(-2000).join('\n') + '\n')
    }
  } catch {
    // Activity is best-effort; never fail a tool call over it.
  }
}

function ok(text) {
  return { content: [{ type: 'text', text }] }
}

function fail(text) {
  return { content: [{ type: 'text', text: `ERROR: ${text}` }], isError: true }
}

function requireProject(ref) {
  const found = resolveProject(ref)
  if (!found) {
    const ids = listProjectIds()
    throw new Error(
      `Unknown project "${ref}". Existing projects: ${ids.length ? ids.join(', ') : '(none — call create_project first)'}`
    )
  }
  return found
}

// ---------- MCP server ----------

const server = new McpServer({ name: 'specdrive', version: '0.1.0' })

// ---------- live session presence ----------
// Every tool call heartbeats a session file the app watches, so the owner SEES
// which agent is talking to the board right now (client name/version, last
// tool, project). Cleaned up on exit; the app ignores stale files.

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
const SESSION_FILE = path.join(SESSIONS_DIR, `${process.pid}.json`)
let sessionStartedAt = null
let lastSession = null
let heartbeatTimer = null

function writeSessionFile() {
  if (!lastSession) return
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    writeJson(SESSION_FILE, { ...lastSession, heartbeatAt: now() })
  } catch {}
}

function recordSession(tool, projectRef) {
  try {
    if (!sessionStartedAt) sessionStartedAt = now()
    let client = { name: 'AI agent', version: '' }
    try {
      const info = server.server.getClientVersion()
      if (info?.name) client = { name: info.name, version: info.version ?? '' }
    } catch {}
    lastSession = {
      pid: process.pid,
      client: client.name,
      version: client.version,
      lastTool: tool,
      project: projectRef ?? lastSession?.project ?? null,
      lastToolAt: now(),
      startedAt: sessionStartedAt
    }
    writeSessionFile()
    // Keep the presence alive between tool calls: the agent session stays
    // connected while it thinks/talks, so beat every 25s until exit.
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(writeSessionFile, 25000)
      heartbeatTimer.unref()
    }
  } catch {
    // presence is best-effort
  }
}

function endSession() {
  try {
    fs.unlinkSync(SESSION_FILE)
  } catch {}
}
process.on('exit', endSession)
process.on('SIGINT', () => {
  endSession()
  process.exit(0)
})
process.on('SIGTERM', () => {
  endSession()
  process.exit(0)
})

// Wrap registerTool so every handler heartbeats without touching each one.
const _registerTool = server.registerTool.bind(server)
server.registerTool = (name, def, handler) =>
  _registerTool(name, def, async (args) => {
    recordSession(name, args && typeof args.project === 'string' ? args.project : undefined)
    return handler(args)
  })

server.registerTool(
  'get_guidance',
  {
    title: 'How the SpecDrive workflow works',
    description:
      'Call this first. Explains the SpecDrive spec-driven loop, the phases, and what the agent should do right now.',
    inputSchema: { project: z.string().optional().describe('Project id or name, if one exists already') }
  },
  async ({ project }) => {
    let current = ''
    if (project) {
      const found = resolveProject(project)
      if (found) {
        current = `\n\nCurrent project "${found.project.name}" is in phase "${found.project.phase}".\nWhat to do now → ${PHASE_GUIDE[found.project.phase]}`
      }
    }
    return ok(
      `SpecDrive turns a spoken idea into a rigorous spec-driven build, visualised live for a NON-TECHNICAL owner.\n\n` +
        `The loop: capture → challenge → research → risks → plan → build → done.\n` +
        Object.entries(PHASE_GUIDE)
          .map(([p, g]) => `• ${p}: ${g}`)
          .join('\n') +
        `\n\nGround rules:\n- The board is the single source of truth; write EVERYTHING you learn or decide into it immediately (small focused specs, one topic each).\n- Follow the owner\'s lead: if they ask you to research, compare or check something, do it right away and write the findings to the board — do not push on with your own question list.\n- Never ask the owner a question the web or the board can answer; ask only what only they can know, one short question at a time, your recommended answer first.\n- Talk to the owner in plain words, never jargon.\n- Never invent progress: only mark tasks done after verifying they work.` +
        current
    )
  }
)

server.registerTool(
  'list_projects',
  {
    title: 'List projects',
    description: 'List all SpecDrive projects with their current phase.',
    inputSchema: {}
  },
  async () => {
    const ids = listProjectIds()
    if (!ids.length) return ok('No projects yet. Use create_project.')
    const lines = ids.map((id) => {
      const p = readJson(path.join(projectDir(id), 'project.json'))
      return `${id} — "${p.name}" (${p.phase}) — ${p.oneLiner}`
    })
    return ok(lines.join('\n'))
  }
)

server.registerTool(
  'create_project',
  {
    title: 'Create a project',
    description:
      'Create a new SpecDrive project. Do this once, right after the owner describes their idea.',
    inputSchema: {
      name: z.string().min(1).max(60).describe('Short product name'),
      one_liner: z.string().min(1).max(140).describe('One plain-English sentence: what it is, for whom'),
      idea: z.string().describe("The owner's raw idea, in their words")
    }
  },
  async ({ name, one_liner, idea }) => {
    ensureDirs()
    let id = slugify(name)
    if (fs.existsSync(projectDir(id))) id = `${id}-${uid().slice(0, 4)}`
    fs.mkdirSync(path.join(projectDir(id), 'wireframes'), { recursive: true })
    const project = {
      id,
      name,
      oneLiner: one_liner,
      idea,
      phase: 'capture',
      phaseHistory: {},
      createdAt: now(),
      updatedAt: now()
    }
    writeJson(path.join(projectDir(id), 'project.json'), project)
    writeJson(path.join(projectDir(id), 'specs.json'), [])
    writeJson(path.join(projectDir(id), 'tasks.json'), [])
    writeJson(path.join(projectDir(id), 'wireframes.json'), [])
    logActivity(id, 'agent', 'create_project', `Project "${name}" created`)
    return ok(
      `Project created (id: ${id}). It just appeared on the owner's SpecDrive board.\n` +
        `Now: ${PHASE_GUIDE.capture}`
    )
  }
)

server.registerTool(
  'get_project',
  {
    title: 'Read the whole board',
    description:
      'Get the full project state: specs, tasks, wireframes, current phase. Read this before working.',
    inputSchema: { project: z.string().describe('Project id or name') }
  },
  async ({ project }) => {
    const { id } = requireProject(project)
    const bundle = loadBundle(id)
    return ok(
      JSON.stringify(bundle, null, 2) +
        `\n\nCurrent phase "${bundle.project.phase}" → ${PHASE_GUIDE[bundle.project.phase]}`
    )
  }
)

server.registerTool(
  'add_spec',
  {
    title: 'Add a spec to the board',
    description:
      'Write one focused piece of knowledge to the spec board. Small specs, one topic each. The owner sees it appear instantly.',
    inputSchema: {
      project: z.string().describe('Project id or name'),
      category: z.enum(CATEGORIES),
      title: z.string().min(1).max(80).describe('Short plain-English title'),
      content: z
        .string()
        .min(1)
        .max(20000)
        .describe('Markdown body. Start with 1-2 plain sentences a non-developer understands; details/links after.'),
      tags: z.array(z.string()).optional(),
      difficulty: z.number().int().min(1).max(5).optional().describe('1 easy → 5 hardest'),
      acceptance: z
        .string()
        .optional()
        .describe(
          'How we will know it works: short Given/When/Then scenario(s), plain language. Becomes the basis for real acceptance tests during build.'
        )
    }
  },
  async ({ project, category, title, content, tags, difficulty, acceptance }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const spec = {
      id: uid(),
      category,
      title,
      content,
      status: 'draft',
      difficulty,
      acceptance,
      tags: tags ?? [],
      createdAt: now(),
      updatedAt: now()
    }
    const counts = updateJson(path.join(dir, 'specs.json'), [], (specs) => {
      specs.push(spec)
      return { total: specs.length, cat: specs.filter((s) => s.category === category).length }
    })
    touchProject(id)
    logActivity(id, 'agent', 'add_spec', `New ${category} spec: "${title}"`)
    return ok(`Spec "${title}" saved (id: ${spec.id}). Board now has ${counts.total} specs (${counts.cat} in ${category}).`)
  }
)

server.registerTool(
  'update_spec',
  {
    title: 'Update a spec',
    description:
      'Modify an existing spec: refine content, set status (draft/challenged/confirmed), difficulty, or leave a challenge note explaining what you questioned.',
    inputSchema: {
      project: z.string(),
      spec_id: z.string(),
      title: z.string().max(80).optional(),
      content: z.string().optional(),
      status: z.enum(['draft', 'challenged', 'confirmed']).optional(),
      difficulty: z.number().int().min(1).max(5).optional(),
      challenge_note: z.string().optional().describe('Plain-words note: what was questioned or changed, and why')
    }
  },
  async ({ project, spec_id, title, content, status, difficulty, challenge_note }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const spec = updateJson(path.join(dir, 'specs.json'), [], (specs) => {
      const s = specs.find((x) => x.id === spec_id)
      if (!s) return null
      if (title !== undefined) s.title = title
      if (content !== undefined) s.content = content
      if (status !== undefined) s.status = status
      if (difficulty !== undefined) s.difficulty = difficulty
      if (challenge_note !== undefined) s.challengeNote = challenge_note
      s.updatedAt = now()
      return s
    })
    if (!spec) return fail(`No spec with id "${spec_id}". Use get_project to list spec ids.`)
    touchProject(id)
    logActivity(id, 'agent', 'update_spec', `Spec updated: "${spec.title}"${status ? ` → ${status}` : ''}`)
    return ok(`Spec "${spec.title}" updated.`)
  }
)

server.registerTool(
  'add_task',
  {
    title: 'Add a build task',
    description:
      'Add one small, ordered task to the build plan (30-90 min of agent work, clear "done" meaning). Created during the plan phase.',
    inputSchema: {
      project: z.string(),
      title: z.string().min(1).max(100),
      detail: z
        .string()
        .describe('What to build and what "done" means (visible result or passing test). Plain words first.'),
      spec_ids: z.array(z.string()).optional().describe('Specs this task implements'),
      order: z.number().int().optional().describe('Position in the plan; defaults to end'),
      parent_task_id: z
        .string()
        .optional()
        .describe('Nest this as a sub-step of an existing task (one level deep). Use for breaking a big step into smaller checkable pieces.')
    }
  },
  async ({ project, title, detail, spec_ids, order, parent_task_id }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const result = updateJson(path.join(dir, 'tasks.json'), [], (tasks) => {
      if (parent_task_id) {
        const parent = tasks.find((t) => t.id === parent_task_id)
        if (!parent) return { err: `No task with id "${parent_task_id}" to nest under.` }
        if (parent.parentId) return { err: 'Sub-steps only nest one level deep — pick a top-level task as parent.' }
      }
      const task = {
        id: uid(),
        title,
        detail,
        specIds: spec_ids ?? [],
        status: 'todo',
        order: order ?? (tasks.length ? Math.max(...tasks.map((t) => t.order)) + 1 : 1),
        parentId: parent_task_id,
        createdAt: now(),
        updatedAt: now()
      }
      tasks.push(task)
      return { task, total: tasks.length }
    })
    if (result.err) return fail(result.err)
    touchProject(id)
    logActivity(id, 'agent', 'add_task', `Task added: "${title}"`)
    return ok(`Task "${title}" added (id: ${result.task.id}, position ${result.task.order}). Plan has ${result.total} tasks.`)
  }
)

server.registerTool(
  'update_task',
  {
    title: 'Update a task',
    description:
      'Move a task through the build loop: in_progress when you start, done ONLY after verifying it works (with a plain-words note), blocked with a reason.',
    inputSchema: {
      project: z.string(),
      task_id: z.string(),
      status: z.enum(['todo', 'in_progress', 'done', 'blocked']),
      note: z.string().optional().describe('For done: what now works, in words a non-developer understands. For blocked: why.')
    }
  },
  async ({ project, task_id, status, note }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const r = updateJson(path.join(dir, 'tasks.json'), [], (tasks) => {
      const task = tasks.find((t) => t.id === task_id)
      if (!task) return { err: `No task with id "${task_id}". Use get_project to list task ids.` }
      if (status === 'done' && task.status !== 'in_progress') {
        return {
          err: `Task "${task.title}" is "${task.status}", not "in_progress". Set it in_progress first, actually do and VERIFY the work, then mark it done.`
        }
      }
      if (status === 'done' && !note) {
        return { err: 'A "done" task needs a note: one plain sentence describing what now works.' }
      }
      if (status === 'done') {
        const openChildren = tasks.filter((t) => t.parentId === task.id && t.status !== 'done')
        if (openChildren.length) {
          return {
            err: `Task "${task.title}" still has ${openChildren.length} open sub-step(s): ${openChildren.map((t) => `"${t.title}"`).join(', ')}. Finish them first.`
          }
        }
      }
      task.status = status
      if (note !== undefined) task.note = note
      task.updatedAt = now()
      const remaining = tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress').length
      const next = tasks.filter((t) => t.status === 'todo').sort((a, b) => a.order - b.order)[0]
      return { title: task.title, remaining, next: next ? { title: next.title, id: next.id } : null }
    })
    if (r.err) return fail(r.err)
    touchProject(id)
    logActivity(id, 'agent', 'update_task', `Task "${r.title}" → ${status}${note ? ` — ${note}` : ''}`)
    return ok(
      `Task "${r.title}" → ${status}. ${r.remaining} task(s) remaining.` +
        (status === 'done' && r.next ? ` Next up: "${r.next.title}" (id: ${r.next.id}).` : '') +
        (status === 'done' && !r.remaining
          ? ' All tasks complete — run check_convergence before declaring the project done.'
          : '')
    )
  }
)

server.registerTool(
  'add_wireframe',
  {
    title: 'Add a wireframe',
    description:
      'Save a simple visual sketch of one product screen: a single self-contained HTML file using grayscale boxes and labels only (no real styling, no external resources). The owner sees it rendered in SpecDrive.',
    inputSchema: {
      project: z.string(),
      screen: z.string().max(60).describe('Which screen this is, e.g. "Home", "Checkout"'),
      title: z.string().max(80),
      nodes: z
        .array(z.record(z.string(), z.any()))
        .max(40)
        .optional()
        .describe(
          'PREFERRED: a semantic kit tree, hand-drawn rendering handled by the app. Each node: {el, ...props, children?}. els: screen, statusBar, browserBar, toolbar, row, col, sidebar, navItem, main, title, text, lines, section, taskRow, chips, chip, pill, check, field, btn, fab, card, column, avatar, iconSquare, kv, searchBar, box, divider. Props are semantic only (text, label, tone: default|accent|warn|ok|muted, active, n, widths, items:[{label,active}], rows:[{k,v}]) — NO geometry, NO css. Start with one {el:"screen"} root (lead with statusBar for mobile or browserBar for web).'
        ),
      html: z
        .string()
        .max(120000)
        .optional()
        .describe('Legacy fallback only if you cannot emit a kit tree: self-contained HTML, no scripts.')
    }
  },
  async ({ project, screen, title, nodes, html }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    if (!nodes && !html) return fail('Provide nodes (preferred kit tree) or html.')
    const wid = uid()
    if (nodes) {
      const KIT_ELS = new Set(['screen','browserBar','statusBar','toolbar','row','col','sidebar','navItem','main','title','text','lines','section','taskRow','chips','chip','pill','check','field','btn','fab','card','column','avatar','iconSquare','kv','searchBar','box','divider'])
      let count = 0
      const check = (list, depth) => {
        if (depth > 8) throw new Error('Kit tree too deep (max 8 levels).')
        for (const node of list) {
          count++
          if (count > 150) throw new Error('Kit tree too large (max 150 nodes).')
          if (typeof node.el !== 'string' || !KIT_ELS.has(node.el)) {
            throw new Error(`Unknown kit element "${node.el}". Allowed: ${[...KIT_ELS].join(', ')}`)
          }
          if (node.children) check(node.children, depth + 1)
        }
      }
      try {
        check(nodes, 1)
      } catch (e) {
        return fail(e.message)
      }
      const file = `${wid}.json`
      fs.mkdirSync(path.join(dir, 'wireframes'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'wireframes', file), JSON.stringify(nodes, null, 2))
      updateJson(path.join(dir, 'wireframes.json'), [], (wfs) => {
        wfs.push({ id: wid, screen, title, file, kind: 'kit', createdAt: now() })
      })
      touchProject(id)
      logActivity(id, 'agent', 'add_wireframe', `Wireframe added: "${screen}" — ${title}`)
      return ok(`Wireframe "${screen}" saved (kit tree, ${count} nodes). The owner sees it hand-drawn.`)
    }
    const file = `${wid}.html`
    // Strip scripts defensively — wireframes are sketches, not apps.
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '')
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    const safe = /<head[^>]*>/i.test(stripped)
      ? stripped.replace(/<head[^>]*>/i, (m) => `${m}${csp}`)
      : `${csp}${stripped}`
    fs.mkdirSync(path.join(dir, 'wireframes'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'wireframes', file), safe)
    updateJson(path.join(dir, 'wireframes.json'), [], (wfs) => {
      wfs.push({ id: wid, screen, title, file, kind: 'html', createdAt: now() })
    })
    touchProject(id)
    logActivity(id, 'agent', 'add_wireframe', `Wireframe added: "${screen}" — ${title}`)
    return ok(`Wireframe "${screen}" saved. The owner can now see the sketch.`)
  }
)

const sanitizeHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')

server.registerTool(
  'set_plan_doc',
  {
    title: 'Write the visual plan document',
    description:
      'Author the plan as a rich document the owner reads like a magazine page — BEFORE creating tasks. Blocks in reading order: "section" (serif-titled prose), "callout" (decision/risk/note the owner must not miss), "diagram" (small self-contained HTML+CSS sketch, hand-drawn style — use class diagram-panel with diagram-card children and the CSS vars --wf-line/--wf-card/--wf-accent-soft), "table" (trade-offs, options), "questions" (open questions with your recommended answer first). Replaces the whole document — send it complete.',
    inputSchema: {
      project: z.string(),
      blocks: z
        .array(
          z.discriminatedUnion('type', [
            z.object({
              type: z.literal('section'),
              title: z.string().max(80),
              body: z.string().max(4000).describe('Markdown prose, plain words first')
            }),
            z.object({
              type: z.literal('callout'),
              tone: z.enum(['decision', 'risk', 'note']),
              body: z.string().max(1000)
            }),
            z.object({
              type: z.literal('table'),
              title: z.string().max(80).optional(),
              columns: z.array(z.string().max(60)).min(2).max(5),
              rows: z.array(z.array(z.string().max(200))).min(1).max(12)
            }),
            z.object({
              type: z.literal('diagram'),
              html: z.string().max(8000).describe('Self-contained HTML fragment, no scripts'),
              css: z.string().max(4000).optional(),
              caption: z.string().max(200).optional()
            }),
            z.object({
              type: z.literal('questions'),
              items: z
                .array(z.object({ q: z.string().max(200), suggestion: z.string().max(200).optional() }))
                .min(1)
                .max(6)
            })
          ])
        )
        .min(1)
        .max(24)
    }
  },
  async ({ project, blocks }) => {
    const { id } = requireProject(project)
    const clean = blocks.map((b) =>
      b.type === 'diagram' ? { ...b, html: sanitizeHtml(b.html), css: b.css ? sanitizeHtml(b.css) : b.css } : b
    )
    writeJson(path.join(projectDir(id), 'plan-doc.json'), { blocks: clean, updatedAt: now() })
    touchProject(id)
    logActivity(id, 'agent', 'set_plan_doc', `Visual plan written: ${blocks.length} blocks`)
    return ok(
      `Visual plan saved (${blocks.length} blocks) — the owner now reads it above the task list. Next: wireframes (add_wireframe), the screen flow (set_flow), then the tasks (add_task).`
    )
  }
)

server.registerTool(
  'add_scenario',
  {
    title: 'Add a usage scenario',
    description:
      'One person, one path through the product, step by step ("A does B, then C happens"). Scenarios are how holes and bugs get found BEFORE code: write them during challenge/plan, walk each one against the specs (and later against the real product). One path = one scenario; cover the unhappy paths too.',
    inputSchema: {
      project: z.string(),
      title: z.string().max(80).describe('Short name, e.g. "Racing for the last loaf"'),
      actor: z.string().max(80).describe('Who is doing this, e.g. "A neighbor on her phone at 8pm"'),
      steps: z
        .array(
          z.object({
            action: z.string().max(160).describe('What the person does, plain words'),
            screen: z.string().max(40).optional().describe('Screen where it happens (same names as set_flow)'),
            expect: z.string().max(160).optional().describe('What must happen next')
          })
        )
        .min(2)
        .max(12)
    }
  },
  async ({ project, title, actor, steps }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const scenario = {
      id: uid(),
      title,
      actor,
      steps,
      status: 'draft',
      createdAt: now(),
      updatedAt: now()
    }
    updateJson(path.join(dir, 'scenarios.json'), [], (scenarios) => {
      scenarios.push(scenario)
    })
    touchProject(id)
    logActivity(id, 'agent', 'add_scenario', `New scenario: "${title}"`)
    return ok(
      `Scenario "${title}" saved (id: ${scenario.id}, ${steps.length} steps). Now WALK it: check every step against the specs — if a step has no spec covering it, that is a gap. Report the walk with update_scenario (status "walked", or "gap_found" with gap_note + fix the board).`
    )
  }
)

server.registerTool(
  'update_scenario',
  {
    title: 'Walk / update a scenario',
    description:
      'Record the result of walking a scenario: "walked" = every step is covered by the specs (later: verified against the real product); "gap_found" = something is missing or would break — say what in gap_note, then FIX the board (add_spec / add_task) so the gap gets closed.',
    inputSchema: {
      project: z.string(),
      scenario_id: z.string(),
      status: z.enum(['draft', 'walked', 'gap_found']),
      gap_note: z.string().optional().describe('For gap_found: what is missing or would break, plain words'),
      steps: z
        .array(
          z.object({
            action: z.string().max(160),
            screen: z.string().max(40).optional(),
            expect: z.string().max(160).optional()
          })
        )
        .min(2)
        .max(12)
        .optional()
        .describe('Optionally rewrite the steps')
    }
  },
  async ({ project, scenario_id, status, gap_note, steps }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const res = updateJson(path.join(dir, 'scenarios.json'), [], (scenarios) => {
      const sc = scenarios.find((s) => s.id === scenario_id)
      if (!sc) return { err: `No scenario with id "${scenario_id}". Use get_project to list them.` }
      if (status === 'gap_found' && !gap_note && !sc.gapNote) {
        return { err: 'gap_found needs gap_note: one plain sentence saying what is missing or would break.' }
      }
      sc.status = status
      if (gap_note !== undefined) sc.gapNote = gap_note
      if (steps !== undefined) sc.steps = steps
      sc.updatedAt = now()
      return { title: sc.title, remaining: scenarios.filter((s) => s.status === 'draft').length }
    })
    if (res.err) return fail(res.err)
    const sc = { title: res.title }
    const remainingDraft = res.remaining
    touchProject(id)
    logActivity(
      id,
      'agent',
      'update_scenario',
      `Scenario "${sc.title}" → ${status}${gap_note ? ` — ${gap_note}` : ''}`
    )
    const remaining = remainingDraft
    return ok(
      `Scenario "${sc.title}" → ${status}.` +
        (status === 'gap_found'
          ? ' Now close the gap: add_spec / add_task so the board covers it, then re-walk.'
          : '') +
        (remaining ? ` ${remaining} scenario(s) still to walk.` : ' All scenarios walked.')
    )
  }
)

server.registerTool(
  'set_flow',
  {
    title: 'Set the visual plan (screen flow)',
    description:
      'Define the product\'s screens and how users move between them. Drawn as a flow map the owner can read at a glance. Call during the plan phase, after (or alongside) add_wireframe. Replaces the whole flow — send the complete picture each time.',
    inputSchema: {
      project: z.string(),
      screens: z
        .array(
          z.object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).describe('Short stable id, letters/digits/dash only, e.g. "home"'),
            name: z.string().max(40).describe('Screen name shown on the map, e.g. "Shop page"'),
            purpose: z.string().max(120).optional().describe('One plain sentence: what the user does here'),
            entry: z.boolean().optional().describe('True for the ONE screen where the user starts')
          })
        )
        .min(1)
        .max(12),
      links: z
        .array(
          z.object({
            from: z.string(),
            to: z.string(),
            label: z.string().max(40).optional().describe('What triggers the move, e.g. "taps Reserve"'),
            condition: z
              .string()
              .max(30)
              .optional()
              .describe('Only for alternative/branch paths, e.g. "sold out", "error" — drawn dashed')
          })
        )
        .max(24)
    }
  },
  async ({ project, screens, links }) => {
    const { id } = requireProject(project)
    const ids = new Set(screens.map((s) => s.id))
    if (ids.size !== screens.length) return fail('Duplicate screen ids — each screen needs a unique id.')
    const bad = links.find((l) => !ids.has(l.from) || !ids.has(l.to))
    if (bad) return fail(`Link ${bad.from} → ${bad.to} references an unknown screen id. Screen ids: ${[...ids].join(', ')}`)
    if (screens.filter((s) => s.entry).length > 1) return fail('Only one screen can have entry: true.')
    writeJson(path.join(projectDir(id), 'flow.json'), { screens, links, updatedAt: now() })
    touchProject(id)
    logActivity(id, 'agent', 'set_flow', `Visual plan updated: ${screens.length} screens, ${links.length} links`)
    return ok(`Visual plan saved — ${screens.length} screens, ${links.length} links. The owner now sees the flow map. Tip: name wireframe "screen" fields exactly like these screen names so sketches attach to the map.`)
  }
)

server.registerTool(
  'set_phase',
  {
    title: 'Move to the next phase',
    description:
      'Advance the project through the loop (capture → challenge → research → risks → plan → build → done). Also used to loop back to build for a new iteration.',
    inputSchema: {
      project: z.string(),
      phase: z.enum(PHASES),
      summary: z.string().optional().describe('One plain-words sentence on what was accomplished in the finished phase')
    }
  },
  async ({ project, phase, summary }) => {
    const { id, project: p } = requireProject(project)
    if (phase === 'done') {
      const tasks = readJson(path.join(projectDir(id), 'tasks.json'), [])
      const open = tasks.filter((t) => t.status !== 'done')
      if (!tasks.length) {
        return fail('Cannot set phase "done": there is no build plan at all. Plan and build first.')
      }
      if (open.length) {
        return fail(
          `Cannot set phase "done": ${open.length} task(s) are not done yet (${open.slice(0, 3).map((t) => `"${t.title}"`).join(', ')}${open.length > 3 ? '…' : ''}).`
        )
      }
      const lastTaskUpdate = tasks.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), '')
      if (!p.lastConvergenceAt || p.lastConvergenceAt < lastTaskUpdate) {
        return fail(
          'Cannot set phase "done": run check_convergence AFTER the last task change, walk it honestly, and only then close the project.'
        )
      }
    }
    const prev = p.phase
    p.phaseHistory = p.phaseHistory || {}
    if (prev !== phase) p.phaseHistory[prev] = now()
    p.phase = phase
    saveProject(id, p)
    logActivity(id, 'agent', 'set_phase', summary ? `${prev} → ${phase}: ${summary}` : `${prev} → ${phase}`)
    return ok(
      `Phase is now "${phase}".\nWhat to do → ${PHASE_GUIDE[phase]}\n\nIMPORTANT for the owner experience: if you have finished your role in the previous phase, tell the owner to go back to the SpecDrive app — it shows them the exact prompt for the "${phase}" step (often in a FRESH agent session, which gives better results than continuing here).`
    )
  }
)

server.registerTool(
  'get_next_task',
  {
    title: 'Get the next task to build',
    description:
      'The build loop\'s cheap read: returns the next unblocked task (sub-steps first) plus ONLY the specs it implements — no full board dump. Use this instead of get_project between tasks.',
    inputSchema: { project: z.string() }
  },
  async ({ project }) => {
    const { id, project: p } = requireProject(project)
    const dir = projectDir(id)
    const tasks = readJson(path.join(dir, 'tasks.json'), [])
    const specs = readJson(path.join(dir, 'specs.json'), [])
    const inProgress = tasks.find((t) => t.status === 'in_progress')
    const todo = tasks.filter((t) => t.status === 'todo').sort((a, b) => a.order - b.order)
    // Prefer finishing an open parent's sub-steps before starting new roots.
    const next =
      inProgress ??
      todo.find((t) => t.parentId && tasks.find((x) => x.id === t.parentId)?.status !== 'done') ??
      todo[0]
    if (!next) {
      return ok('No open tasks. Run check_convergence — only a clean check earns set_phase "done".')
    }
    const linked = specs.filter((sp) => (next.specIds ?? []).includes(sp.id))
    const parent = next.parentId ? tasks.find((t) => t.id === next.parentId) : null
    return ok(
      `NEXT TASK${inProgress ? ' (already in progress)' : ''}: "${next.title}" (id: ${next.id})\n` +
        (parent ? `Sub-step of: "${parent.title}"\n` : '') +
        `What to do: ${next.detail}\n` +
        (linked.length
          ? `Specs it implements:\n${linked.map((sp) => `--- ${sp.title} [${sp.category}]\n${sp.content}${sp.acceptance ? `\nHow we'll know it works: ${sp.acceptance}` : ''}`).join('\n')}`
          : 'No specs linked — re-read the board if unsure.') +
        `\n\nDiscipline: set it "in_progress" first (update_task), build production-grade, VERIFY for real, then mark "done" with a plain-words note. Project phase: ${p.phase}.`
    )
  }
)

server.registerTool(
  'check_convergence',
  {
    title: 'Convergence check — does the code match the board?',
    description:
      'The honesty ritual of the build phase. Call after finishing the task list (and after any big iteration): it hands you the checklist for comparing what was ACTUALLY built against every spec and task. Any gap you find must become a new task via add_task. Loop build → check_convergence until it comes back clean.',
    inputSchema: { project: z.string() }
  },
  async ({ project }) => {
    const { id } = requireProject(project)
    const bundle = loadBundle(id)
    const open = bundle.tasks.filter((t) => t.status !== 'done')
    const unconfirmed = bundle.specs.filter((s) => s.status !== 'confirmed')
    const withAcceptance = bundle.specs.filter((s) => s.acceptance)
    const scenarios = bundle.scenarios ?? []

    // Computed findings — a real diff of the board, not a vibe check.
    const buildable = bundle.specs.filter((sp) => ['features', 'design', 'tech', 'data'].includes(sp.category))
    const coveredSpecIds = new Set(bundle.tasks.flatMap((t) => t.specIds ?? []))
    const uncoveredSpecs = buildable.filter((sp) => !coveredSpecIds.has(sp.id))
    const specIdSet = new Set(bundle.specs.map((sp) => sp.id))
    const orphanTasks = bundle.tasks.filter((t) => (t.specIds ?? []).some((sid) => !specIdSet.has(sid)))
    const draftScenarios = scenarios.filter((sc) => sc.status === 'draft')
    const gapScenarios = scenarios.filter((sc) => sc.status === 'gap_found')
    const findings = []
    if (open.length) findings.push(`OPEN TASKS (${open.length}): ${open.map((t) => `"${t.title}" [${t.status}]`).join(', ')}`)
    if (uncoveredSpecs.length)
      findings.push(`SPECS WITH NO TASK (${uncoveredSpecs.length}): ${uncoveredSpecs.map((sp) => `"${sp.title}"`).join(', ')} — either link/add tasks or explain why none is needed`)
    if (orphanTasks.length)
      findings.push(`TASKS CITING UNKNOWN SPECS (${orphanTasks.length}): ${orphanTasks.map((t) => `"${t.title}"`).join(', ')}`)
    if (draftScenarios.length)
      findings.push(`SCENARIOS NEVER WALKED (${draftScenarios.length}): ${draftScenarios.map((sc) => `"${sc.title}"`).join(', ')}`)
    if (gapScenarios.length)
      findings.push(`SCENARIOS WITH OPEN GAPS (${gapScenarios.length}): ${gapScenarios.map((sc) => `"${sc.title}"`).join(', ')}`)
    if (!scenarios.length) findings.push('NO USAGE SCENARIOS AT ALL — write them with add_scenario; converging without scenarios is not credible')

    touchProject(id, { lastConvergenceAt: now() })
    logActivity(id, 'agent', 'check_convergence', findings.length ? `Convergence check: ${findings.length} finding group(s)` : 'Convergence check: computed clean')
    return ok(
      `CONVERGENCE CHECK for "${bundle.project.name}"\n\n` +
        (findings.length
          ? `COMPUTED FINDINGS — resolve every line before claiming convergence:\n${findings.map((f) => `  • ${f}`).join('\n')}\n\n`
          : 'COMPUTED FINDINGS: none — the board is internally consistent. Now verify REALITY matches it:\n\n') +
        `Walk this honestly, one item at a time:\n\n` +
        `1. Open tasks: ${open.length ? open.map((t) => `"${t.title}" (${t.status})`).join(', ') : 'none'}. If any exist, you are NOT done — finish or re-scope them first.\n` +
        `2. For EVERY feature/design/tech/data spec, verify the built product actually honors it. Run the product, do not assume. Specs to walk: ${bundle.specs.filter((s) => ['features', 'design', 'tech', 'data'].includes(s.category)).map((s) => `"${s.title}"`).join(', ') || '(none)'}.\n` +
        `3. Acceptance scenarios to execute for real (${withAcceptance.length}): ${withAcceptance.map((s) => `"${s.title}"`).join(', ') || 'none recorded'}. Each must pass as written — ideally as an automated test.\n` +
        `4. USAGE SCENARIOS to act out on the real product, step by step (${scenarios.length}): ${scenarios.map((s) => `"${s.title}"`).join(', ') || 'none — that is itself a gap; write them with add_scenario'}. Each step's expectation must actually happen. Update each with update_scenario ("walked" or "gap_found" + gap_note).\n` +
        `5. Every gap, mismatch or "mostly works" you find → specdrive add_task immediately (small, verifiable). Do not silently fix without a task; the owner follows progress through the board.\n` +
        `6. Specs the build revealed to be wrong or outdated → specdrive update_spec so the board stays the truth (${unconfirmed.length} spec(s) not yet confirmed).\n\n` +
        `If, and only if, steps 1-6 produce zero new tasks and zero scenario gaps: report "CONVERGED" to the owner in plain words and call set_phase to "done". Otherwise: build the new tasks, then run check_convergence again.`
    )
  }
)

server.registerTool(
  'log_note',
  {
    title: 'Leave a note in the activity feed',
    description:
      "Post a short plain-words progress note the owner sees in SpecDrive's activity feed. Use sparingly for meaningful moments.",
    inputSchema: { project: z.string(), message: z.string().max(280) }
  },
  async ({ project, message }) => {
    const { id } = requireProject(project)
    logActivity(id, 'agent', 'note', message)
    return ok('Noted.')
  }
)

ensureDirs()
const transport = new StdioServerTransport()
await server.connect(transport)
