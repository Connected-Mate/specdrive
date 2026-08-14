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
    'CAPTURE: interview the owner about their idea (one simple question at a time, no jargon). After each answer, immediately add_spec so the board fills live. When complete, set_phase to "challenge".',
  challenge:
    'CHALLENGE: act as a fresh, skeptical reviewer. Find contradictions, vagueness, missing essentials, oversized scope. Fix via update_spec (status "challenged" + challenge_note) or add_spec. Record v1 cuts as a "decisions" spec. Then set_phase to "research".',
  research:
    'RESEARCH: search the web for similar products, reusable building blocks, pitfalls. One finding per add_spec (category "research"), with links. End with a "What we learned" spec, then set_phase to "risks".',
  risks:
    'RISKS: pre-mortem. Rate spec difficulty 1-5 via update_spec. For difficulty 4-5, add a "risks" spec with mitigation/fallback. Flag topics deserving a dedicated deep-dive session. End with a readiness verdict (PASS / CONCERNS / FAIL) recorded as a "decisions" spec; only advance on PASS or owner-accepted CONCERNS. Then set_phase to "plan".',
  plan:
    'PLAN: choose architecture (record as "tech" specs), sketch 3-6 core screens with add_wireframe (grayscale boxes HTML), define the screen flow with set_flow (screens + labeled links — the owner\'s visual map), create small ordered tasks with add_task (spikes for hard parts first, each with a clear "done" meaning). Then set_phase to "build".',
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

function writeJson(file, data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
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

/** Resolve a project by id or (fuzzy) name. Returns {id, project} or null. */
function resolveProject(ref) {
  const ids = listProjectIds()
  const norm = slugify(ref)
  for (const id of ids) {
    if (id === ref || id === norm) return { id, project: readJson(path.join(projectDir(id), 'project.json')) }
  }
  for (const id of ids) {
    const p = readJson(path.join(projectDir(id), 'project.json'))
    if (p && p.name.toLowerCase() === ref.toLowerCase()) return { id, project: p }
  }
  return null
}

function loadBundle(id) {
  const dir = projectDir(id)
  return {
    project: readJson(path.join(dir, 'project.json')),
    specs: readJson(path.join(dir, 'specs.json'), []),
    tasks: readJson(path.join(dir, 'tasks.json'), []),
    wireframes: readJson(path.join(dir, 'wireframes.json'), []),
    flow: readJson(path.join(dir, 'flow.json'), null)
  }
}

function saveProject(id, project) {
  project.updatedAt = now()
  writeJson(path.join(projectDir(id), 'project.json'), project)
}

function logActivity(id, actor, action, summary) {
  const line = JSON.stringify({ ts: now(), actor, action, summary }) + '\n'
  fs.appendFileSync(path.join(projectDir(id), 'activity.jsonl'), line)
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
        `\n\nGround rules:\n- The board is the single source of truth; write EVERYTHING you learn or decide into it immediately (small focused specs, one topic each).\n- Talk to the owner in plain words, never jargon; one question at a time.\n- Never invent progress: only mark tasks done after verifying they work.` +
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
    const specs = readJson(path.join(dir, 'specs.json'), [])
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
    specs.push(spec)
    writeJson(path.join(dir, 'specs.json'), specs)
    const p = readJson(path.join(dir, 'project.json'))
    saveProject(id, p)
    logActivity(id, 'agent', 'add_spec', `New ${category} spec: "${title}"`)
    const count = specs.filter((s) => s.category === category).length
    return ok(`Spec "${title}" saved (id: ${spec.id}). Board now has ${specs.length} specs (${count} in ${category}).`)
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
    const specs = readJson(path.join(dir, 'specs.json'), [])
    const spec = specs.find((s) => s.id === spec_id)
    if (!spec) return fail(`No spec with id "${spec_id}". Use get_project to list spec ids.`)
    if (title !== undefined) spec.title = title
    if (content !== undefined) spec.content = content
    if (status !== undefined) spec.status = status
    if (difficulty !== undefined) spec.difficulty = difficulty
    if (challenge_note !== undefined) spec.challengeNote = challenge_note
    spec.updatedAt = now()
    writeJson(path.join(dir, 'specs.json'), specs)
    saveProject(id, readJson(path.join(dir, 'project.json')))
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
      order: z.number().int().optional().describe('Position in the plan; defaults to end')
    }
  },
  async ({ project, title, detail, spec_ids, order }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const tasks = readJson(path.join(dir, 'tasks.json'), [])
    const task = {
      id: uid(),
      title,
      detail,
      specIds: spec_ids ?? [],
      status: 'todo',
      order: order ?? (tasks.length ? Math.max(...tasks.map((t) => t.order)) + 1 : 1),
      createdAt: now(),
      updatedAt: now()
    }
    tasks.push(task)
    writeJson(path.join(dir, 'tasks.json'), tasks)
    saveProject(id, readJson(path.join(dir, 'project.json')))
    logActivity(id, 'agent', 'add_task', `Task added: "${title}"`)
    return ok(`Task "${title}" added (id: ${task.id}, position ${task.order}). Plan has ${tasks.length} tasks.`)
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
    const tasks = readJson(path.join(dir, 'tasks.json'), [])
    const task = tasks.find((t) => t.id === task_id)
    if (!task) return fail(`No task with id "${task_id}". Use get_project to list task ids.`)
    if (status === 'done' && task.status !== 'in_progress') {
      return fail(
        `Task "${task.title}" is "${task.status}", not "in_progress". Set it in_progress first, actually do and VERIFY the work, then mark it done.`
      )
    }
    if (status === 'done' && !note) {
      return fail('A "done" task needs a note: one plain sentence describing what now works.')
    }
    task.status = status
    if (note !== undefined) task.note = note
    task.updatedAt = now()
    writeJson(path.join(dir, 'tasks.json'), tasks)
    saveProject(id, readJson(path.join(dir, 'project.json')))
    logActivity(id, 'agent', 'update_task', `Task "${task.title}" → ${status}${note ? ` — ${note}` : ''}`)
    const remaining = tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress').length
    const next = tasks
      .filter((t) => t.status === 'todo')
      .sort((a, b) => a.order - b.order)[0]
    return ok(
      `Task "${task.title}" → ${status}. ${remaining} task(s) remaining.` +
        (status === 'done' && next ? ` Next up: "${next.title}" (id: ${next.id}).` : '') +
        (status === 'done' && !remaining
          ? ' All tasks complete — verify the product end-to-end, then set_phase to "done".'
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
      html: z.string().describe('Complete self-contained HTML document. Grayscale boxes + labels. No scripts, no external URLs.')
    }
  },
  async ({ project, screen, title, html }) => {
    const { id } = requireProject(project)
    const dir = projectDir(id)
    const wfs = readJson(path.join(dir, 'wireframes.json'), [])
    const wid = uid()
    const file = `${wid}.html`
    // Strip scripts defensively — wireframes are sketches, not apps.
    const safe = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '')
    fs.mkdirSync(path.join(dir, 'wireframes'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'wireframes', file), safe)
    wfs.push({ id: wid, screen, title, file, createdAt: now() })
    writeJson(path.join(dir, 'wireframes.json'), wfs)
    saveProject(id, readJson(path.join(dir, 'project.json')))
    logActivity(id, 'agent', 'add_wireframe', `Wireframe added: "${screen}" — ${title}`)
    return ok(`Wireframe "${screen}" saved. The owner can now see the sketch.`)
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
            id: z.string().describe('Short stable id, e.g. "home"'),
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
    const bad = links.find((l) => !ids.has(l.from) || !ids.has(l.to))
    if (bad) return fail(`Link ${bad.from} → ${bad.to} references an unknown screen id. Screen ids: ${[...ids].join(', ')}`)
    if (screens.filter((s) => s.entry).length > 1) return fail('Only one screen can have entry: true.')
    writeJson(path.join(projectDir(id), 'flow.json'), { screens, links, updatedAt: now() })
    saveProject(id, readJson(path.join(projectDir(id), 'project.json')))
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
    logActivity(id, 'agent', 'check_convergence', 'Convergence check started')
    return ok(
      `CONVERGENCE CHECK for "${bundle.project.name}" — go through this honestly, one item at a time:\n\n` +
        `1. Open tasks: ${open.length ? open.map((t) => `"${t.title}" (${t.status})`).join(', ') : 'none'}. If any exist, you are NOT done — finish or re-scope them first.\n` +
        `2. For EVERY feature/design/tech/data spec, verify the built product actually honors it. Run the product, do not assume. Specs to walk: ${bundle.specs.filter((s) => ['features', 'design', 'tech', 'data'].includes(s.category)).map((s) => `"${s.title}"`).join(', ') || '(none)'}.\n` +
        `3. Acceptance scenarios to execute for real (${withAcceptance.length}): ${withAcceptance.map((s) => `"${s.title}"`).join(', ') || 'none recorded'}. Each must pass as written — ideally as an automated test.\n` +
        `4. Every gap, mismatch or "mostly works" you find → specdrive add_task immediately (small, verifiable). Do not silently fix without a task; the owner follows progress through the board.\n` +
        `5. Specs the build revealed to be wrong or outdated → specdrive update_spec so the board stays the truth (${unconfirmed.length} spec(s) not yet confirmed).\n\n` +
        `If, and only if, steps 1-5 produce zero new tasks: report "CONVERGED" to the owner in plain words and call set_phase to "done". Otherwise: build the new tasks, then run check_convergence again.`
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
