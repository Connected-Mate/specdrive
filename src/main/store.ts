// Read-side of the ~/.specdrive store (the MCP server owns the write side).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { ActivityEntry, OwnerComment, ProjectBundle, Project, Task } from '../shared/types'

export const DATA_DIR = path.join(os.homedir(), '.specdrive')
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')

export function ensureDataDirs(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true })
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function readActivity(dir: string): ActivityEntry[] {
  let raw: string
  try {
    raw = fs.readFileSync(path.join(dir, 'activity.jsonl'), 'utf8')
  } catch {
    return []
  }
  const out: ActivityEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line) as ActivityEntry)
    } catch {
      // one bad line must not erase the feed
    }
  }
  return out.slice(-200)
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

function safeId(id: string): string | null {
  const base = path.basename(id)
  return SAFE_ID.test(base) ? base : null
}

/** Has the codebase moved while nobody was working on the board? Same rule as
 *  the MCP server (baseline = last seen ref, only after a 10-min idle gap), so
 *  the app never shows a drift badge during normal mark-done-then-commit work.
 *  Cheap and cached per HEAD: git runs once per project per new commit, with a
 *  timeout, never on every file-change tick. */
const DRIFT_IDLE_MS = 10 * 60 * 1000
const driftCache = new Map<string, { at: number; value: ProjectBundle['drift'] }>()

function computeDrift(project: Project, tasks: Task[]): ProjectBundle['drift'] {
  if (!project.codebasePath) return null
  const cached = driftCache.get(project.id)
  if (cached && Date.now() - cached.at < 30_000) return cached.value
  let value: ProjectBundle['drift'] = null
  try {
    const git = (args: string[]): string =>
      execFileSync('git', args, {
        cwd: project.codebasePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000
      }).trim()
    const head = git(['rev-parse', 'HEAD'])
    const lastTaskRef = tasks
      .filter((t) => t.status === 'done' && t.gitRef)
      .sort((a, b) => ((a.doneAt ?? '') < (b.doneAt ?? '') ? 1 : -1))[0]?.gitRef
    const baseRef = (project as { lastSeenRef?: string }).lastSeenRef ?? lastTaskRef
    if (!baseRef || baseRef === head) value = { moved: false, commits: 0 }
    else {
      const idle = Date.now() - new Date(project.updatedAt).getTime() > DRIFT_IDLE_MS
      let commits = 0
      try {
        commits = parseInt(git(['rev-list', '--count', `${baseRef}..${head}`]), 10) || 0
      } catch {
        commits = 0
      }
      value = { moved: idle, commits }
    }
  } catch {
    value = null
  }
  driftCache.set(project.id, { at: Date.now(), value })
  return value
}

export function loadBundle(id: string): ProjectBundle | null {
  const dir = path.join(PROJECTS_DIR, id)
  const project = readJson(path.join(dir, 'project.json'), null)
  if (!project) return null
  const tasks = readJson<Task[]>(path.join(dir, 'tasks.json'), [])
  return {
    project,
    specs: readJson(path.join(dir, 'specs.json'), []),
    tasks,
    wireframes: readJson(path.join(dir, 'wireframes.json'), []),
    flow: readJson(path.join(dir, 'flow.json'), null),
    scenarios: readJson(path.join(dir, 'scenarios.json'), []),
    planDoc: readJson(path.join(dir, 'plan-doc.json'), null),
    documents: readJson(path.join(dir, 'documents.json'), []),
    activity: readActivity(dir),
    comments: readJson(path.join(dir, 'comments.json'), []),
    folder: (project as { folderId?: string }).folderId
      ? readJson(path.join(DATA_DIR, 'folders', `${(project as { folderId?: string }).folderId}.json`), null)
      : null,
    drift: computeDrift(project as Project, tasks)
  } as ProjectBundle
}

export function listBundles(): ProjectBundle[] {
  ensureDataDirs()
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadBundle(d.name))
    .filter((b): b is ProjectBundle => b !== null)
    .sort((a, b) => (a.project.updatedAt < b.project.updatedAt ? 1 : -1))
}

export function readWireframe(projectId: string, file: string): string {
  // Defensive: never allow escaping the wireframes dir.
  const pid = safeId(projectId)
  const safe = path.basename(file)
  if (!pid || !/^[a-z0-9]+\.(html|json)$/.test(safe)) return '<p>Wireframe not found.</p>'
  try {
    return fs.readFileSync(path.join(PROJECTS_DIR, pid, 'wireframes', safe), 'utf8')
  } catch {
    return '<p>Wireframe not found.</p>'
  }
}

export function readDocument(projectId: string, file: string): string {
  const pid = safeId(projectId)
  const safe = path.basename(file)
  if (!pid || !/^[a-z0-9]+\.md$/.test(safe)) return 'Document not found.'
  try {
    return fs.readFileSync(path.join(PROJECTS_DIR, pid, 'documents', safe), 'utf8')
  } catch {
    return 'Document not found.'
  }
}

const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i

export function readImage(projectId: string, file: string): string {
  const pid = safeId(projectId)
  const safe = path.basename(file)
  if (!pid || !IMG_EXT.test(safe) || safe.includes('..')) return ''
  try {
    const buf = fs.readFileSync(path.join(PROJECTS_DIR, pid, 'documents', safe))
    const ext = safe.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg')
    return `data:image/${ext};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

/** Same pid-stamped lock protocol as the MCP server: steal only a DEAD
 *  process's lock (a live holder just gets more time), and the ownership stamp
 *  inside the lock dir makes a non-owner's rmdir fail harmlessly. */
function withFileLock<T>(metaFile: string, fn: () => T): T {
  const lock = metaFile + '.lock'
  const mine = path.join(lock, `owner-${process.pid}`)
  let deadline = Date.now() + 3000
  for (;;) {
    try {
      fs.mkdirSync(lock)
      fs.writeFileSync(mine, '')
      break
    } catch {
      if (Date.now() > deadline) {
        try {
          const owner = fs.readdirSync(lock).find((f) => f.startsWith('owner-'))
          const ownerPid = owner ? Number(owner.slice('owner-'.length)) : null
          let alive = false
          if (ownerPid) {
            try {
              process.kill(ownerPid, 0)
              alive = true
            } catch {
              // dead
            }
          }
          if (!alive) {
            if (owner) fs.unlinkSync(path.join(lock, owner))
            fs.rmdirSync(lock)
          } else {
            deadline = Date.now() + 3000
          }
        } catch {
          // lock vanished between checks — loop retries
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15) // real sleep, no CPU spin
    }
  }
  try {
    return fn()
  } finally {
    try {
      fs.unlinkSync(mine)
    } catch {
      // already stolen
    }
    try {
      fs.rmdirSync(lock)
    } catch {
      // someone else's stamp inside — their lock survives
    }
  }
}

export function addImage(projectId: string, name: string, dataBase64: string): string {
  const pid = safeId(projectId)
  if (!pid) return 'Unknown project.'
  const clean = path.basename(name)
  const m = IMG_EXT.exec(clean)
  if (!m) return 'Only png, jpg, gif or webp images.'
  const buf = Buffer.from(dataBase64, 'base64')
  if (buf.length > 8 * 1024 * 1024) return 'Image too large — 8 MB max.'
  const id = crypto.randomBytes(5).toString('hex')
  const file = `${id}${m[0].toLowerCase()}`
  const dir = path.join(PROJECTS_DIR, pid)
  fs.mkdirSync(path.join(dir, 'documents'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'documents', file), buf)
  const metaFile = path.join(dir, 'documents.json')
  // Same lock + atomic-write protocol as the MCP server — a concurrent
  // add_document must never tear this file.
  withFileLock(metaFile, () => {
    let docs: unknown[] = []
    try {
      docs = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    } catch {}
    docs.push({
      id,
      title: clean.replace(IMG_EXT, ''),
      kind: 'image',
      file,
      size: buf.length,
      createdAt: new Date().toISOString()
    })
    const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(docs, null, 2))
    fs.renameSync(tmp, metaFile)
  })
  try {
    fs.appendFileSync(
      path.join(dir, 'activity.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), actor: 'app', action: 'add_image', summary: `Image added: "${clean}"` }) + '\n'
    )
  } catch {}
  return ''
}

/** The owner leaves a note on a spec/task/project card; the agent reads it
 *  through MCP on its next pass. Same lock + atomic-write protocol as
 *  addImage — a concurrent MCP write must never tear comments.json. */
export function addComment(projectId: string, target: OwnerComment['target'], text: string): string {
  const pid = safeId(projectId)
  if (!pid) return 'Unknown project.'
  const clean = text.trim()
  if (!clean) return 'Note is empty.'
  if (clean.length > 4000) return 'Note is too long — 4000 characters max.'
  const dir = path.join(PROJECTS_DIR, pid)
  fs.mkdirSync(dir, { recursive: true })
  const metaFile = path.join(dir, 'comments.json')
  withFileLock(metaFile, () => {
    let comments: OwnerComment[] = []
    try {
      comments = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    } catch {}
    comments.push({
      id: crypto.randomBytes(5).toString('hex'),
      target,
      text: clean,
      status: 'open',
      createdAt: new Date().toISOString()
    })
    const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(comments, null, 2))
    fs.renameSync(tmp, metaFile)
  })
  try {
    fs.appendFileSync(
      path.join(dir, 'activity.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        actor: 'app',
        action: 'add_comment',
        summary: `Note left on a ${target.kind}`
      }) + '\n'
    )
  } catch {}
  return ''
}

/** Owner flips the "write AGENTS.md into the code folder" toggle. Same lock +
 *  atomic-write protocol as the MCP server's own project.json writes (withLock
 *  in mcp/server.mjs) — safe to touch from the app side alongside it. */
export function setSyncAgentsMd(projectId: string, on: boolean): void {
  const pid = safeId(projectId)
  if (!pid) return
  const metaFile = path.join(PROJECTS_DIR, pid, 'project.json')
  withFileLock(metaFile, () => {
    let project: Record<string, unknown>
    try {
      project = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    } catch {
      return
    }
    project.syncAgentsMd = on
    project.updatedAt = new Date().toISOString()
    const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(project, null, 2))
    fs.renameSync(tmp, metaFile)
  })
}

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
const SESSION_FRESH_MS = 75_000

export function listSessions(): import('../shared/types').LiveSession[] {
  let files: string[]
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: import('../shared/types').LiveSession[] = []
  for (const f of files) {
    const p = path.join(SESSIONS_DIR, f)
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'))
      const beat = s.heartbeatAt ?? s.lastToolAt
      if (Date.now() - new Date(beat).getTime() < SESSION_FRESH_MS) out.push(s)
      else fs.unlinkSync(p)
    } catch {
      try {
        fs.unlinkSync(p)
      } catch {}
    }
  }
  return out.sort((a, b) => (a.lastToolAt < b.lastToolAt ? 1 : -1))
}

export function deleteProject(id: string): void {
  const pid = safeId(id)
  if (!pid) return
  const dir = path.join(PROJECTS_DIR, pid)
  // Move to a trash dir instead of destroying data.
  const trash = path.join(DATA_DIR, 'trash')
  fs.mkdirSync(trash, { recursive: true })
  if (fs.existsSync(dir)) fs.renameSync(dir, path.join(trash, `${pid}-${Date.now()}`))
}
